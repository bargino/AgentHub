"""自定义 context_window + per-agent 压力 + 群级最小窗口（多 agent 上下文收敛）。

运行：cd agenthub-server && python -m pytest tests/test_context_window.py -v
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.adapters.base import AdapterContext
from app.db.models import AgentRecord, Base, Message
from app.memory import conversation_memory, token_meter

# ---------------------------------------------------------------------------
# resolve_window_tokens：有效窗口优先级（纯函数）
# ---------------------------------------------------------------------------


def test_resolve_window_override_wins() -> None:
    assert conversation_memory.resolve_window_tokens("claude-opus", 50_000) == 50_000


def test_resolve_window_fallback_to_table() -> None:
    assert conversation_memory.resolve_window_tokens("gpt-5.1", None) == 400_000
    assert conversation_memory.resolve_window_tokens("claude-sonnet-4-5", None) == 200_000


def test_resolve_window_unknown_default() -> None:
    default = conversation_memory.DEFAULT_WINDOW_TOKENS
    assert conversation_memory.resolve_window_tokens("totally-unknown", None) == default
    assert conversation_memory.resolve_window_tokens(None, None) == default


def test_resolve_window_ignores_nonpositive_override() -> None:
    # 0 / 负值视为未设置，回退查表
    assert conversation_memory.resolve_window_tokens("gpt-5.1", 0) == 400_000
    assert conversation_memory.resolve_window_tokens("gpt-5.1", -1) == 400_000


# ---------------------------------------------------------------------------
# window_profile：window_override 生效
# ---------------------------------------------------------------------------


def test_window_profile_uses_override() -> None:
    small = conversation_memory.window_profile("unknown-model", window_override=40_000)
    big = conversation_memory.window_profile("unknown-model", window_override=400_000)
    assert small.window_tokens == 40_000
    assert big.window_tokens == 400_000
    # 40k*0.15*2=12000 < 400k 预算（clamp 到 64000）
    assert small.char_budget < big.char_budget


# ---------------------------------------------------------------------------
# DB fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture()
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


def _agent(role: str, model: str = "", context_window: int | None = None, enabled: bool = True) -> AgentRecord:
    return AgentRecord(
        name=role, role=role, model=model,
        context_window=context_window, enabled=enabled,
    )


def _agent_msg(cid: str, i: int, role: str, meta: dict | None = None) -> Message:
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return Message(
        conversation_id=cid, type="agent", content=f"m{i}",
        agent_role=role, meta=meta or {},
        created_at=base + timedelta(seconds=i),
    )


def _usage(input_tokens: int) -> dict[str, int]:
    return {
        "input_tokens": input_tokens, "output_tokens": 0,
        "cache_read_tokens": 0, "cache_write_tokens": 0,
        "total_tokens": input_tokens,
    }


# ---------------------------------------------------------------------------
# min_member_window：群级保守基准（最小成员窗口）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_min_member_window_picks_smallest(db_session) -> None:
    a = _agent("planner", model="gpt-5.1")            # 400k
    b = _agent("coder", model="claude-sonnet-4-5")    # 200k
    c = _agent("reviewer", context_window=64_000)     # 显式 64k
    db_session.add_all([a, b, c])
    await db_session.flush()
    # 全员 = 最小 64k
    assert await conversation_memory.min_member_window(db_session, None) == 64_000
    # 限定 planner+coder = 最小 200k
    assert await conversation_memory.min_member_window(db_session, [a.id, b.id]) == 200_000


@pytest.mark.asyncio
async def test_min_member_window_excludes_disabled(db_session) -> None:
    a = _agent("planner", model="gpt-5.1")                       # 400k enabled
    b = _agent("coder", context_window=16_000, enabled=False)    # 禁用，不计
    db_session.add_all([a, b])
    await db_session.flush()
    assert await conversation_memory.min_member_window(db_session, None) == 400_000


@pytest.mark.asyncio
async def test_min_member_window_empty_defaults(db_session) -> None:
    assert (
        await conversation_memory.min_member_window(db_session, None)
        == conversation_memory.DEFAULT_WINDOW_TOKENS
    )


# ---------------------------------------------------------------------------
# token_meter：per-agent usage / pressure（群聊不跨 agent 错配）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_last_usage_filters_by_agent(db_session) -> None:
    cid = "c1"
    db_session.add(_agent_msg(cid, 1, "planner", meta={"tokenUsage": _usage(300_000)}))
    db_session.add(_agent_msg(cid, 2, "coder", meta={"tokenUsage": _usage(10_000)}))
    await db_session.flush()
    # 不指定 agent = 最近一条（coder）
    u_any = await token_meter.get_last_usage(db_session, cid)
    assert u_any is not None and u_any["input_tokens"] == 10_000
    # 指定 planner = planner 的计量，不被更晚的 coder 覆盖
    u_planner = await token_meter.get_last_usage(db_session, cid, agent_role="planner")
    assert u_planner is not None and u_planner["input_tokens"] == 300_000


@pytest.mark.asyncio
async def test_get_pressure_per_agent_no_cross_contamination(db_session) -> None:
    cid = "c2"
    # 只有 planner 用了 300k；coder 本轮无计量
    db_session.add(_agent_msg(cid, 1, "planner", meta={"tokenUsage": _usage(300_000)}))
    await db_session.flush()
    # 按 coder 维度（200k 窗口）：coder 无 usage -> 0，不被 planner 的 300k 污染
    assert await token_meter.get_pressure(db_session, cid, 200_000, agent_role="coder") == 0
    # 按 planner 维度（400k 窗口）：300k/400k=75% -> level 2
    assert await token_meter.get_pressure(db_session, cid, 400_000, agent_role="planner") == 2


# ---------------------------------------------------------------------------
# AdapterContext 携带 context_window（codex 透传 model_context_window 的载体）
# ---------------------------------------------------------------------------


def test_adapter_context_carries_window() -> None:
    ctx = AdapterContext(instructions="x", workspace_path=".", context_window=123_456)
    assert ctx.context_window == 123_456
    # 默认 None：未配置时 codex 不透传 model_context_window
    assert AdapterContext(instructions="x", workspace_path=".").context_window is None
