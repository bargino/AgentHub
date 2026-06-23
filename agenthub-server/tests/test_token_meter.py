"""token_meter 纯函数单测：usage 标准化 / 上下文占用 / 压力分级 / 预算缩放 / 缓存命中率。

全部纯函数，无 DB / SDK；DB 相关的 get_last_usage / get_pressure 见 executor 级 DB fixture 思路，
本文件只锁定确定性计量口径（Claude 蛇形 / Codex 驼峰双来源、阈值边界、零值兜底）。
"""

from __future__ import annotations

import pytest

from app.memory.token_meter import (
    budget_scale,
    cache_hit_rate,
    context_tokens,
    normalize_usage,
    pressure_level,
)

# ---- normalize_usage：双命名来源 + 兜底 ----


def test_normalize_claude_snake_case() -> None:
    raw = {
        "input_tokens": 100,
        "output_tokens": 50,
        "cache_read_input_tokens": 200,
        "cache_creation_input_tokens": 30,
    }
    assert normalize_usage(raw) == {
        "input_tokens": 100,
        "output_tokens": 50,
        "cache_read_tokens": 200,
        "cache_write_tokens": 30,
        "total_tokens": 380,
    }


def test_normalize_codex_camel_case_uses_given_total() -> None:
    raw = {
        "inputTokens": 100,
        "outputTokens": 50,
        "cachedInputTokens": 200,
        "totalTokens": 500,
    }
    out = normalize_usage(raw)
    assert out is not None
    assert out["cache_read_tokens"] == 200
    assert out["total_tokens"] == 500  # 给定 total 优先于累加


def test_normalize_total_computed_when_absent() -> None:
    out = normalize_usage({"input_tokens": 10, "output_tokens": 5})
    assert out is not None
    assert out["total_tokens"] == 15


def test_normalize_non_dict_returns_none() -> None:
    assert normalize_usage(None) is None
    assert normalize_usage("x") is None


def test_normalize_all_zero_returns_none() -> None:
    assert normalize_usage({}) is None
    assert normalize_usage({"input_tokens": 0, "output_tokens": 0}) is None


def test_normalize_negative_values_ignored() -> None:
    out = normalize_usage({"input_tokens": -5, "output_tokens": 10})
    assert out is not None
    assert out["input_tokens"] == 0  # 负值被丢弃为 0
    assert out["total_tokens"] == 10


# ---- context_tokens：输入侧占用 = 新输入 + 读缓存 + 写缓存 ----


def test_context_tokens_sums_input_side() -> None:
    usage = {"input_tokens": 100, "cache_read_tokens": 200, "cache_write_tokens": 30}
    assert context_tokens(usage) == 330


def test_context_tokens_missing_keys_default_zero() -> None:
    assert context_tokens({"input_tokens": 40}) == 40
    assert context_tokens({}) == 0


# ---- pressure_level：50% / 70% / 85% 分档 ----


@pytest.mark.parametrize(
    "used,window,expected",
    [
        (0, 1000, 0),       # 零占用
        (100, 0, 0),        # 窗口未知
        (100, 1000, 0),     # 0.10 < 0.50
        (500, 1000, 1),     # 0.50 恰好落入档 1（<0.50 为假）
        (600, 1000, 1),     # 0.60
        (700, 1000, 2),     # 0.70 落入档 2
        (800, 1000, 2),     # 0.80
        (850, 1000, 3),     # 0.85 落入档 3
        (950, 1000, 3),     # 0.95
    ],
)
def test_pressure_level_thresholds(used: int, window: int, expected: int) -> None:
    assert pressure_level(used, window) == expected


# ---- budget_scale：压力越高注入越少 ----


@pytest.mark.parametrize(
    "level,expected",
    [(0, 1.0), (1, 0.75), (2, 0.5), (3, 0.35), (9, 1.0)],
)
def test_budget_scale(level: int, expected: float) -> None:
    assert budget_scale(level) == expected


# ---- cache_hit_rate：命中读 / 输入侧总量 ----


def test_cache_hit_rate_partial() -> None:
    usage = {"input_tokens": 100, "cache_read_tokens": 200, "cache_write_tokens": 0}
    assert cache_hit_rate(usage) == pytest.approx(200 / 300)


def test_cache_hit_rate_full_hit() -> None:
    usage = {"input_tokens": 0, "cache_read_tokens": 100, "cache_write_tokens": 0}
    assert cache_hit_rate(usage) == 1.0


def test_cache_hit_rate_no_input_side_returns_zero() -> None:
    assert cache_hit_rate({}) == 0.0
    assert cache_hit_rate({"output_tokens": 50}) == 0.0
