"""orchestrator.engine 单测：意图快路径 + spec确认门禁 TTL（_take_pending / _sweep）。

_fast_path_decision 为纯函数；_take_pending / _sweep_expired_pending 涉及内存暂存 +
DB 取消，复用临时文件 SQLite。被测核心 = engine 自身逻辑，不 mock。
"""

from __future__ import annotations

import time

import pytest

from app.db.engine import dispose_engine, get_session_factory, init_database
from app.orchestrator import engine as eng
from app.orchestrator.engine import (
    _fast_path_decision,
    _sweep_expired_pending,
    _take_pending,
)
from app.orchestrator.task_executor import ExecutionState
from app.orchestrator.task_planner import SpecTask, TaskSpec
from app.services import task as task_service

_CID = "conv-eng"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    """临时文件 SQLite 引擎，结束 dispose 还原全局单例。"""
    url = f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("AGENTHUB_DATABASE_URL", url)
    await dispose_engine()
    await init_database()
    try:
        yield
    finally:
        await dispose_engine()


@pytest.fixture(autouse=True)
def _clear_pending():
    """隔离内存暂存全局态，避免跨用例泄漏。"""
    eng._PENDING_SPECS.clear()
    yield
    eng._PENDING_SPECS.clear()


async def _seed_one(title: str = "x") -> tuple[TaskSpec, dict[str, str]]:
    plan = TaskSpec(goal="g", tasks=[SpecTask(id="t1", agent="coder", title=title)])
    factory = get_session_factory()
    async with factory() as session, session.begin():
        outs = await task_service.create_tasks(
            session, _CID, [{"title": title, "agent_role": "coder", "depends_on": []}]
        )
    return plan, {"t1": outs[0].id}


def _state(id_map: dict[str, str]) -> ExecutionState:
    return ExecutionState(
        conversation_id=_CID,
        project_name="proj",
        workspace_path="",
        user_instructions="do it",
        id_map=id_map,
    )


async def _status(db_id: str) -> str | None:
    factory = get_session_factory()
    async with factory() as session:
        out = await task_service.get_task(session, db_id)
    return out.status if out else None


# ---- _fast_path_decision：高置信社交语免 LLM ----


@pytest.mark.parametrize(
    "text",
    ["你好", "您好", "hi", "hello", "hey", "thanks", "好的", "在吗", "你好！", "hello~", "ok"],
)
def test_fast_path_greeting_returns_direct(text: str) -> None:
    d = _fast_path_decision(text)
    assert d is not None
    assert d.mode == "direct"
    assert d.answer  # 直接回答非空


@pytest.mark.parametrize(
    "text",
    [
        "",
        "帮我把登录接口加上限流",
        "请重构整个支付模块并补测试",
        "你好请帮我做一个完整的电商后台系统",  # 以问候开头但超长 / 非纯社交 → 不误伤
    ],
)
def test_fast_path_non_greeting_returns_none(text: str) -> None:
    assert _fast_path_decision(text) is None


# ---- _sweep_expired_pending：清除过期内存暂存 ----


def test_sweep_removes_expired_keeps_fresh() -> None:
    now = time.monotonic()
    eng._PENDING_SPECS["fresh"] = (None, None, None, now)  # type: ignore[assignment]
    eng._PENDING_SPECS["stale"] = (None, None, None, now - eng._PENDING_TTL_S - 100)  # type: ignore[assignment]

    _sweep_expired_pending()

    assert "fresh" in eng._PENDING_SPECS
    assert "stale" not in eng._PENDING_SPECS


# ---- _take_pending：内存 TTL 有效 / 过期取消 / 无暂存重建 ----


async def test_take_pending_fresh_returns_entry(db) -> None:
    plan, id_map = await _seed_one()
    state = _state(id_map)
    eng._PENDING_SPECS[_CID] = (state, plan, "standard", time.monotonic())

    taken = await _take_pending(get_session_factory(), _CID)

    assert taken is not None
    rstate, rplan, rci = taken
    assert rstate is state
    assert rplan is plan
    assert rci == "standard"
    assert _CID not in eng._PENDING_SPECS  # 取出即弹出
    assert await _status(id_map["t1"]) == "pending"  # 有效期内不取消任务


async def test_take_pending_expired_cancels_and_returns_none(db) -> None:
    plan, id_map = await _seed_one()
    state = _state(id_map)
    expired_at = time.monotonic() - eng._PENDING_TTL_S - 100
    eng._PENDING_SPECS[_CID] = (state, plan, None, expired_at)

    taken = await _take_pending(get_session_factory(), _CID)

    assert taken is None
    assert _CID not in eng._PENDING_SPECS
    assert await _status(id_map["t1"]) == "cancelled"  # 过期视为失效并取消其任务


async def test_take_pending_no_memory_no_db_returns_none(db) -> None:
    # 无内存暂存且 DB 无该会话 → 重建失败 → None（不抛异常）
    assert await _take_pending(get_session_factory(), "ghost-conv") is None
