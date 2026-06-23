"""TaskRunner._handle_event 单测：适配器 UnifiedEvent -> 业务域写入（B-2b 事件转换）。

被测核心 = _handle_event 的事件分发与落库（不 mock）；用真实 task_service / message /
approval 服务 + 临时 SQLite。状态机要求先 running 再终态（镜像 run() 的 line 216 顺序）。
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.adapters.base import UnifiedEvent
from app.db.engine import dispose_engine, get_session_factory, init_database
from app.orchestrator.task_executor import ExecutionState, TaskRunner
from app.orchestrator.task_planner import PlannedTask
from app.services import task as task_service

_CID = "conv-run"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("AGENTHUB_DATABASE_URL", url)
    await dispose_engine()
    await init_database()
    try:
        yield
    finally:
        await dispose_engine()


async def _seed_running(agent: str = "coder") -> tuple[str, TaskRunner]:
    """落库一个任务并置 running（镜像 run() 先 update running 的顺序），返回 (db_id, runner)。"""
    factory = get_session_factory()
    async with factory() as session, session.begin():
        outs = await task_service.create_tasks(
            session, _CID, [{"title": "t", "agent_role": agent, "depends_on": []}]
        )
    db_id = outs[0].id
    async with factory() as session, session.begin():
        await task_service.update_task_status(session, db_id, "running")
    state = ExecutionState(
        conversation_id=_CID, project_name="p", workspace_path="",
        user_instructions="x", id_map={"t1": db_id},
    )
    runner = TaskRunner(state, PlannedTask(id="t1", agent=agent, title="t"), {agent: agent.title()})
    return db_id, runner


async def _status(db_id: str) -> str | None:
    factory = get_session_factory()
    async with factory() as session:
        out = await task_service.get_task(session, db_id)
    return out.status if out else None


async def _messages() -> list[tuple[str, str]]:
    from app.db.models import Message

    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(Message).where(Message.conversation_id == _CID).order_by(Message.created_at)
            )
        ).scalars().all()
    return [(m.type, m.content) for m in rows]


# ---- completed -> success + 落 agent 消息 ----


async def test_completed_marks_success_and_persists_message(db) -> None:
    db_id, runner = await _seed_running()

    result = await runner._handle_event(
        UnifiedEvent(type="completed", data={"result": "done"}, adapter="fake")
    )

    assert result is True
    assert await _status(db_id) == "success"
    assert ("agent", "done") in await _messages()


async def test_completed_cancelled_returns_false(db) -> None:
    db_id, runner = await _seed_running()

    result = await runner._handle_event(
        UnifiedEvent(
            type="completed", data={"result": "stopped", "cancelled": True}, adapter="fake"
        )
    )

    assert result is False
    assert await _status(db_id) == "cancelled"


# ---- error -> failed + 落 error 消息 ----


async def test_error_marks_failed(db) -> None:
    db_id, runner = await _seed_running()

    result = await runner._handle_event(
        UnifiedEvent(type="error", data={"error": "boom"}, adapter="fake")
    )

    assert result is False
    assert await _status(db_id) == "failed"
    types = [t for t, _ in await _messages()]
    assert "error" in types


# ---- approval_request -> waiting_approval + 建审批记录 ----


async def test_approval_request_sets_waiting_and_creates_approval(db) -> None:
    db_id, runner = await _seed_running()

    result = await runner._handle_event(
        UnifiedEvent(
            type="approval_request",
            data={"request_id": "r1", "action_type": "run_command", "summary": "运行命令"},
            adapter="fake",
            risk_level="medium",
        )
    )

    assert result is None  # 非终态，继续消费事件流
    assert await _status(db_id) == "waiting_approval"

    from app.db.models import Approval

    factory = get_session_factory()
    async with factory() as session:
        approvals = (
            await session.execute(select(Approval).where(Approval.conversation_id == _CID))
        ).scalars().all()
    assert len(approvals) == 1
    assert approvals[0].request_id == "r1"


# ---- started -> 缓存 codex thread_id 供 resume ----


async def test_started_caches_thread_id(db) -> None:
    _db_id, runner = await _seed_running()

    result = await runner._handle_event(
        UnifiedEvent(type="started", data={"thread_id": "th-1"}, adapter="fake")
    )

    assert result is None
    assert runner.sdk_session_id == "th-1"


# ---- tool_call running -> 落 tool 消息并登记在途 ----


async def test_tool_call_running_persists_tool_message(db) -> None:
    _db_id, runner = await _seed_running()

    result = await runner._handle_event(
        UnifiedEvent(
            type="tool_call",
            data={
                "tool_name": "Bash",
                "tool_input": "ls -la",
                "status": "running",
                "tool_id": "k1",
            },
            adapter="fake",
        )
    )

    assert result is None
    types = [t for t, _ in await _messages()]
    assert "tool" in types
    assert runner.running_tool_msgs  # 在途工具已登记，供终态收口


# ---- 流式 delta 去重：增量 + 最终整块不重复累积 ----


async def test_streaming_deltas_dedup_final_full_block(db) -> None:
    """claude 流式：逐 token delta（is_delta=True）累积后，最终整块 TextBlock（无 is_delta）
    被去重跳过，落库正文不翻倍。"""
    _db_id, runner = await _seed_running()

    for piece in ("Hel", "lo", " world"):
        await runner._handle_event(
            UnifiedEvent(
                type="text_delta", data={"text": piece, "is_delta": True}, adapter="claude-code"
            )
        )
    # 最终整块（AssistantMessage 的 TextBlock，无 is_delta）——delta_mode 下应跳过
    await runner._handle_event(
        UnifiedEvent(type="text_delta", data={"text": "Hello world"}, adapter="claude-code")
    )
    await runner._handle_event(UnifiedEvent(type="completed", data={}, adapter="claude-code"))

    agent_msgs = [c for t, c in await _messages() if t == "agent"]
    assert agent_msgs == ["Hello world"]


async def test_non_streaming_full_blocks_accumulate(db) -> None:
    """未流式（无 is_delta）时整块 text_delta 照常累积（兜底行为不变，换行分隔）。"""
    _db_id, runner = await _seed_running()

    await runner._handle_event(
        UnifiedEvent(type="text_delta", data={"text": "block one"}, adapter="claude-code")
    )
    await runner._handle_event(
        UnifiedEvent(type="text_delta", data={"text": "block two"}, adapter="claude-code")
    )
    await runner._handle_event(UnifiedEvent(type="completed", data={}, adapter="claude-code"))

    agent_msgs = [c for t, c in await _messages() if t == "agent"]
    assert agent_msgs == ["block one\nblock two"]
