"""codex 启动期退避重试纯函数单测（Epic：codex sqlite 并发可靠性）。

覆盖 _is_transient_bringup_error（可/不可重试分流）与 _bringup_with_retry（重试次数 /
退避序列 / 抛出最后异常 / 不可重试快速失败），不触碰真实 SDK 子进程。
"""
from __future__ import annotations

import pytest

from app.adapters.codex import adapter as cx


class _TransientError(Exception):
    pass


class _FatalError(Exception):
    pass


# ---- _is_transient_bringup_error：可/不可重试分流 ----

def test_transient_type_match() -> None:
    assert cx._is_transient_bringup_error(_TransientError("x"), (_TransientError,)) is True


def test_transient_text_disk_io_without_type() -> None:
    # 类型不在清单（空元组），靠错误文本兜底命中 disk I/O
    assert cx._is_transient_bringup_error(Exception("... (code: 1546) disk I/O error"), ()) is True


def test_transient_text_sqlite_without_type() -> None:
    assert cx._is_transient_bringup_error(Exception("failed to init SQLite runtime"), ()) is True


def test_not_transient_config_error() -> None:
    # config 解析失败 = 确定性错误，不该重试
    assert cx._is_transient_bringup_error(Exception("provider name must not be empty"), ()) is False


def test_not_transient_auth_error() -> None:
    # 401/403 鉴权错误不重试（即便清单非空，文本也不含 sqlite/disk）
    assert (
        cx._is_transient_bringup_error(
            Exception("401 Unauthorized: Invalid token"), (_TransientError,)
        )
        is False
    )


# ---- _bringup_with_retry：重试次数 / 退避 / 抛出 ----

def _sleep_recorder() -> tuple[list[float], object]:
    sleeps: list[float] = []
    return sleeps, (lambda s: sleeps.append(s))


def test_success_first_try_no_sleep() -> None:
    sleeps, sleep = _sleep_recorder()
    calls = {"n": 0}

    def attempt() -> str:
        calls["n"] += 1
        return "ok"

    out = cx._bringup_with_retry(
        attempt, attempts=3, backoff_s=0.6, is_retryable=lambda e: True, sleep=sleep
    )
    assert out == "ok"
    assert calls["n"] == 1
    assert sleeps == []


def test_fail_once_then_succeed() -> None:
    sleeps, sleep = _sleep_recorder()
    calls = {"n": 0}

    def attempt() -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            raise _TransientError("disk I/O error")
        return "ok"

    out = cx._bringup_with_retry(
        attempt,
        attempts=3,
        backoff_s=0.6,
        is_retryable=lambda e: isinstance(e, _TransientError),
        sleep=sleep,
    )
    assert out == "ok"
    assert calls["n"] == 2
    assert sleeps == [0.6]  # 线性退避 backoff*(0+1)


def test_exhaust_attempts_raises_last() -> None:
    sleeps, sleep = _sleep_recorder()
    calls = {"n": 0}

    def attempt() -> str:
        calls["n"] += 1
        raise _TransientError(f"fail{calls['n']}")

    with pytest.raises(_TransientError):
        cx._bringup_with_retry(
            attempt, attempts=3, backoff_s=0.5, is_retryable=lambda e: True, sleep=sleep
        )
    assert calls["n"] == 3  # 用满 attempts 次
    assert sleeps == [0.5, 1.0]  # 末次前退避 2 次（线性）


def test_non_retryable_raises_immediately() -> None:
    sleeps, sleep = _sleep_recorder()
    calls = {"n": 0}

    def attempt() -> str:
        calls["n"] += 1
        raise _FatalError("provider name must not be empty")

    with pytest.raises(_FatalError):
        cx._bringup_with_retry(
            attempt,
            attempts=3,
            backoff_s=0.5,
            is_retryable=lambda e: isinstance(e, _TransientError),
            sleep=sleep,
        )
    assert calls["n"] == 1  # 不可重试 → 只试一次
    assert sleeps == []
