"""记忆与 token 计量单元测试：标准化计量、压力分级、软修剪、预算缩放、压缩边界、
session resume 映射与增量窗口。

运行：cd agenthub-server && python -m pytest tests/test_memory.py -v
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.models import Base, Conversation, Message
from app.memory import conversation_memory, token_meter
from app.memory.conversation_memory import soft_trim, window_profile
from app.memory.summary import parse_summary_output, summarize_entries
from app.memory.conversation_memory import MemoryEntry
from app.services import agent_session as agent_session_service

# ---------------------------------------------------------------------------
# token_meter：usage 标准化
# ---------------------------------------------------------------------------


def test_normalize_usage_claude_format() -> None:
    raw = {
        "input_tokens": 1200,
        "output_tokens": 300,
        "cache_creation_input_tokens": 5000,
        "cache_read_input_tokens": 80000,
    }
    usage = token_meter.normalize_usage(raw)
    assert usage is not None
    assert usage["input_tokens"] == 1200
    assert usage["output_tokens"] == 300
    assert usage["cache_write_tokens"] == 5000
    assert usage["cache_read_tokens"] == 80000
    assert usage["total_tokens"] == 1200 + 300 + 5000 + 80000


def test_normalize_usage_codex_format() -> None:
    raw = {"inputTokens": 9000, "cachedInputTokens": 2000, "outputTokens": 500, "totalTokens": 11500}
    usage = token_meter.normalize_usage(raw)
    assert usage is not None
    assert usage["input_tokens"] == 9000
    assert usage["cache_read_tokens"] == 2000
    assert usage["total_tokens"] == 11500


def test_normalize_usage_invalid() -> None:
    assert token_meter.normalize_usage(None) is None
    assert token_meter.normalize_usage("not a dict") is None
    assert token_meter.normalize_usage({}) is None
    assert token_meter.normalize_usage({"input_tokens": 0, "output_tokens": 0}) is None


def test_context_tokens_counts_input_side() -> None:
    usage = token_meter.normalize_usage(
        {"input_tokens": 1000, "output_tokens": 999, "cache_read_input_tokens": 50000}
    )
    assert usage is not None
    # 输入侧 = input + cache 读写，不含 output
    assert token_meter.context_tokens(usage) == 51000


# ---------------------------------------------------------------------------
# token_meter：压力分级与预算缩放
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("used", "window", "expected"),
    [
        (0, 200_000, 0),
        (99_000, 200_000, 0),       # 49.5% -> 0
        (100_000, 200_000, 1),      # 50% -> 1
        (139_000, 200_000, 1),      # 69.5% -> 1
        (140_000, 200_000, 2),      # 70% -> 2
        (170_000, 200_000, 3),      # 85% -> 3
        (250_000, 200_000, 3),      # 超窗 -> 3
        (1000, 0, 0),               # 无窗口信息 -> 0
    ],
)
def test_pressure_level(used: int, window: int, expected: int) -> None:
    assert token_meter.pressure_level(used, window) == expected


def test_budget_scale_levels() -> None:
    assert token_meter.budget_scale(0) == 1.0
    assert token_meter.budget_scale(1) == 0.75
    assert token_meter.budget_scale(2) == 0.5
    assert token_meter.budget_scale(3) == 0.35
    assert token_meter.budget_scale(99) == 1.0  # 未知等级不缩


def test_window_profile_pressure_scaling() -> None:
    base = window_profile("claude-sonnet-4", pressure=0)
    p2 = window_profile("claude-sonnet-4", pressure=2)
    assert p2.char_budget == int(base.char_budget * 0.5)
    assert p2.window_tokens == base.window_tokens


# ---------------------------------------------------------------------------
# conversation_memory：软修剪
# ---------------------------------------------------------------------------


def test_soft_trim_short_text_untouched() -> None:
    assert soft_trim("hello", 100) == "hello"


def test_soft_trim_long_text_keeps_head_and_tail() -> None:
    text = "A" * 600 + "B" * 600
    trimmed = soft_trim(text, 200)
    assert trimmed.startswith("A" * 120)       # 头部 60%
    assert trimmed.endswith("B" * 60)          # 尾部 30%
    assert "中间省略" in trimmed
    assert len(trimmed) < len(text)


def test_soft_trim_tiny_limit_degrades_to_cut() -> None:
    assert soft_trim("abcdefgh", 1) == "a"


# ---------------------------------------------------------------------------
# DB 路径：usage 落库读取 / 压力 / 软修剪进窗口 / 压缩边界前移
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


def _msg(cid: str, i: int, *, type: str = "agent", content: str = "", meta: dict | None = None) -> Message:
    base_time = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return Message(
        conversation_id=cid,
        type=type,
        content=content or f"message-{i}",
        agent_role="coder" if type == "agent" else None,
        meta=meta or {},
        created_at=base_time + timedelta(seconds=i),
    )


@pytest.mark.asyncio
async def test_get_last_usage_and_pressure(db_session) -> None:
    cid = "conv1"
    usage = {"input_tokens": 150_000, "output_tokens": 100, "cache_read_tokens": 0,
             "cache_write_tokens": 0, "total_tokens": 150_100}
    db_session.add(_msg(cid, 1, meta={"tokenUsage": usage}))
    db_session.add(_msg(cid, 2))  # 最近一条无计量，应回溯到上一条
    await db_session.flush()

    found = await token_meter.get_last_usage(db_session, cid)
    assert found is not None
    assert found["input_tokens"] == 150_000

    # 150K / 200K = 75% -> level 2
    assert await token_meter.get_pressure(db_session, cid, 200_000) == 2
    # 无计量会话 -> 0
    assert await token_meter.get_pressure(db_session, "no-such", 200_000) == 0


@pytest.mark.asyncio
async def test_recent_window_applies_soft_trim(db_session) -> None:
    cid = "conv2"
    long_text = "H" * 3000 + "T" * 3000
    db_session.add(_msg(cid, 1, type="user", content=long_text))
    await db_session.flush()

    window = await conversation_memory.get_recent_window(
        db_session, cid, per_message_limit=1000
    )
    assert len(window) == 1
    content = window[0].content
    assert "中间省略" in content
    assert content.startswith("H" * 600)
    assert content.endswith("T" * 300)


@pytest.mark.asyncio
async def test_overflow_window_size_shrinks_under_pressure(db_session) -> None:
    cid = "conv3"
    for i in range(40):
        db_session.add(_msg(cid, i, type="user", content=f"msg-{i}"))
    await db_session.flush()

    normal = await conversation_memory.get_overflow_messages(db_session, cid, window_size=30)
    halved = await conversation_memory.get_overflow_messages(db_session, cid, window_size=15)
    assert len(normal) == 10   # 40 - 30
    assert len(halved) == 25   # 40 - 15：压缩边界前移后吞掉更多旧消息


# ---------------------------------------------------------------------------
# conversation_memory：since 增量窗口（SDK session resume 场景）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recent_window_since_filters_incremental(db_session) -> None:
    cid = "conv-since"
    for i in range(6):
        db_session.add(_msg(cid, i, type="user", content=f"msg-{i}"))
    await db_session.flush()

    # 水位设在第 3 条之后（_msg 时间 = base + i 秒）
    watermark = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=3)
    window = await conversation_memory.get_recent_window(db_session, cid, since=watermark)
    assert [e.content for e in window] == ["msg-4", "msg-5"]

    # 无水位 = 全量窗口
    full = await conversation_memory.get_recent_window(db_session, cid)
    assert len(full) == 6


# ---------------------------------------------------------------------------
# agent_session：resume 映射 upsert / get / clear
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_session_upsert_get_clear(db_session) -> None:
    conv = Conversation(title="t", project_name="p")
    db_session.add(conv)
    await db_session.flush()
    cid = conv.id

    # 未映射 -> None（冷启动）
    assert await agent_session_service.get_agent_session(db_session, cid, "coder", "claude-code") is None

    # 首次 upsert -> 新建（含水位）
    await agent_session_service.upsert_agent_session(db_session, cid, "coder", "claude-code", "sess-1")
    record = await agent_session_service.get_agent_session(db_session, cid, "coder", "claude-code")
    assert record is not None
    assert record.session_id == "sess-1"
    assert record.last_message_at is not None

    # 再次 upsert -> 原记录刷新而非新建（unique 索引保证单条）
    await agent_session_service.upsert_agent_session(db_session, cid, "coder", "claude-code", "sess-2")
    record = await agent_session_service.get_agent_session(db_session, cid, "coder", "claude-code")
    assert record is not None
    assert record.session_id == "sess-2"
    assert record.last_message_at is not None

    # 维度隔离：不同角色 / 不同适配器互不可见
    assert await agent_session_service.get_agent_session(db_session, cid, "reviewer", "claude-code") is None
    assert await agent_session_service.get_agent_session(db_session, cid, "coder", "codex") is None

    # clear -> 映射移除，下次冷启动
    await agent_session_service.clear_agent_session(db_session, cid, "coder", "claude-code")
    assert await agent_session_service.get_agent_session(db_session, cid, "coder", "claude-code") is None


@pytest.mark.asyncio
async def test_agent_session_clear_missing_is_noop(db_session) -> None:
    conv = Conversation(title="t", project_name="p")
    db_session.add(conv)
    await db_session.flush()
    # 清除不存在的映射不应抛错（失败收口路径对冷启动任务也会调用）
    await agent_session_service.clear_agent_session(db_session, conv.id, "coder", "claude-code")


# ---------------------------------------------------------------------------
# summary：LLM 不可用时的回退路径
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_summarize_entries_fallback_without_llm() -> None:
    entries = [
        MemoryEntry(role="user", content="实现登录功能，要求支持 OAuth"),
        MemoryEntry(role="assistant", content="已创建 login.py"),
        MemoryEntry(role="assistant", content="已接入 OAuth 回调"),
    ]
    # 测试进程未初始化 AdapterRegistry，summarize_entries 应走截断回退
    result, memory_items = await summarize_entries(entries)
    assert "实现登录功能" in result
    assert "OAuth 回调" in result
    assert memory_items == []  # 回退路径不产出记忆条目


# ---------------------------------------------------------------------------
# summary：双产出解析（摘要 + 项目记忆条目）
# ---------------------------------------------------------------------------


def test_parse_summary_output_with_memory_items() -> None:
    raw = """### 目标
完成登录模块

===MEMORY===
[{"category": "tech_stack", "key": "auth", "value": "OAuth2 + JWT"},
 {"category": "decision", "key": "db", "value": "选用 SQLite 单文件部署"},
 {"category": "bad_category", "key": "x", "value": "应被过滤"},
 {"category": "conventions", "key": "", "value": "key 为空应被过滤"}]"""
    summary, items = parse_summary_output(raw)
    assert summary.startswith("### 目标")
    assert "===MEMORY===" not in summary
    assert len(items) == 2
    assert items[0] == {"category": "tech_stack", "key": "auth", "value": "OAuth2 + JWT"}
    assert items[1]["category"] == "decision"


def test_parse_summary_output_without_marker() -> None:
    summary, items = parse_summary_output("纯摘要正文，无分隔标记")
    assert summary == "纯摘要正文，无分隔标记"
    assert items == []


def test_parse_summary_output_broken_json_keeps_summary() -> None:
    raw = "摘要正文\n===MEMORY===\n[{broken json"
    summary, items = parse_summary_output(raw)
    assert summary == "摘要正文"
    assert items == []


def test_parse_summary_output_json_code_fence() -> None:
    raw = '摘要\n===MEMORY===\n```json\n[{"category": "decision", "key": "k", "value": "v"}]\n```'
    summary, items = parse_summary_output(raw)
    assert summary == "摘要"
    assert items == [{"category": "decision", "key": "k", "value": "v"}]
