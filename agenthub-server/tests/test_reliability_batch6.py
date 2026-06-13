"""批6 · P0 健壮性测试：

- A3 任务状态机守卫（合法迁移表 + 非法拒绝 + 幂等）
- A1 启动自愈（中断态收口 + 系统消息 + 幂等）
- R2 SQLite WAL 连接级 PRAGMA
- A6 execute_plan 幽灵 pending 调度兜底

运行：cd agenthub-server && python -m pytest tests/test_reliability_batch6.py -v
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import startup
from app.db.models import Base, Conversation, Message, Task
from app.orchestrator import task_executor
from app.orchestrator.task_planner import PlannedTask, TaskPlan
from app.services import task as task_service

# ---------------------------------------------------------------------------
# 共用：内存单会话（A3 用，update_task_status 接收显式 session）
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


# 多连接测试（A1/A6）需文件库：内存库每个连接是独立空库，跨 session 不可见
@pytest_asyncio.fixture()
async def file_factory(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path / 'b6.db'}"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def _add_task(session, task_id: str, status: str) -> None:
    session.add(Conversation(id=f"conv-{task_id}", title="t"))
    session.add(
        Task(
            id=task_id,
            conversation_id=f"conv-{task_id}",
            title="x",
            agent_role="coder",
            status=status,
        )
    )
    await session.flush()


# ---------------------------------------------------------------------------
# A3 状态机守卫
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a3_rejects_success_to_running(db_session) -> None:
    """success 是吸收态：重跑（success→running）必须被拒，终态不被污染。"""
    await _add_task(db_session, "t-suc", "success")
    out = await task_service.update_task_status(db_session, "t-suc", "running")
    assert out is not None and out.status == "success"  # 未改动
    task = await db_session.get(Task, "t-suc")
    assert task.status == "success"


@pytest.mark.asyncio
async def test_a3_allows_failed_to_running_reentrant(db_session) -> None:
    """failed→running 是 batch2 可重入续跑依赖的合法迁移，必须放行。"""
    await _add_task(db_session, "t-fail", "failed")
    out = await task_service.update_task_status(db_session, "t-fail", "running")
    assert out is not None and out.status == "running"


@pytest.mark.asyncio
async def test_a3_allows_cancelled_to_running_reentrant(db_session) -> None:
    await _add_task(db_session, "t-can", "cancelled")
    out = await task_service.update_task_status(db_session, "t-can", "running")
    assert out is not None and out.status == "running"


@pytest.mark.asyncio
async def test_a3_allows_failed_to_pending_retry(db_session) -> None:
    """重试入口：failed→pending 合法，且清空上轮执行痕迹。"""
    await _add_task(db_session, "t-retry", "failed")
    task = await db_session.get(Task, "t-retry")
    task.result = "旧结果"
    await db_session.flush()
    out = await task_service.update_task_status(db_session, "t-retry", "pending")
    assert out is not None and out.status == "pending"
    task = await db_session.get(Task, "t-retry")
    assert task.result is None and task.started_at is None


@pytest.mark.asyncio
async def test_a3_normal_running_to_success(db_session) -> None:
    await _add_task(db_session, "t-ok", "pending")
    await task_service.update_task_status(db_session, "t-ok", "running")
    out = await task_service.update_task_status(db_session, "t-ok", "success", result="done")
    assert out is not None and out.status == "success"
    task = await db_session.get(Task, "t-ok")
    assert task.finished_at is not None


@pytest.mark.asyncio
async def test_a3_rejects_pending_to_waiting_approval(db_session) -> None:
    """pending 不能直接跳到 waiting_approval（须先 running）。"""
    await _add_task(db_session, "t-jump", "pending")
    out = await task_service.update_task_status(db_session, "t-jump", "waiting_approval")
    assert out is not None and out.status == "pending"


@pytest.mark.asyncio
async def test_a3_idempotent_same_status(db_session) -> None:
    """同态重复幂等放行，可补 result。"""
    await _add_task(db_session, "t-idem", "running")
    out = await task_service.update_task_status(db_session, "t-idem", "running", result="r")
    assert out is not None and out.status == "running" and out.result == "r"


def test_a3_transition_table_success_is_absorbing() -> None:
    assert task_service._LEGAL_TRANSITIONS["success"] == set()
    assert task_service._is_legal_transition("success", "running") is False
    assert task_service._is_legal_transition("failed", "running") is True
    assert task_service._is_legal_transition("running", "running") is True


# ---------------------------------------------------------------------------
# A1 启动自愈
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a1_recovers_stuck_tasks_and_conversations(file_factory, monkeypatch) -> None:
    monkeypatch.setattr(startup, "get_session_factory", lambda: file_factory)
    async with file_factory() as s:
        async with s.begin():
            s.add(Conversation(id="c-run", title="t", status="running"))
            s.add(Conversation(id="c-idle", title="t", status="idle"))
            s.add(Task(id="tk-run", conversation_id="c-run", title="x", agent_role="coder", status="running"))
            s.add(Task(id="tk-wait", conversation_id="c-run", title="x", agent_role="coder", status="waiting_approval"))
            s.add(Task(id="tk-done", conversation_id="c-run", title="x", agent_role="coder", status="success"))

    counts = await startup.recover_interrupted_state()
    assert counts["tasks"] == 2  # run + wait（success 不动）

    async with file_factory() as s:
        assert (await s.get(Task, "tk-run")).status == "failed"
        assert (await s.get(Task, "tk-wait")).status == "failed"
        assert (await s.get(Task, "tk-done")).status == "success"
        assert (await s.get(Conversation, "c-run")).status == "idle"
        assert (await s.get(Conversation, "c-idle")).status == "idle"
        msgs = (
            (await s.execute(select(Message).where(Message.conversation_id == "c-run")))
            .scalars()
            .all()
        )
        assert any(m.type == "system" for m in msgs)


@pytest.mark.asyncio
async def test_a1_idempotent_second_run_noop(file_factory, monkeypatch) -> None:
    monkeypatch.setattr(startup, "get_session_factory", lambda: file_factory)
    async with file_factory() as s:
        async with s.begin():
            s.add(Conversation(id="c1", title="t", status="running"))
            s.add(Task(id="tk1", conversation_id="c1", title="x", agent_role="coder", status="running"))

    first = await startup.recover_interrupted_state()
    assert first["tasks"] == 1
    second = await startup.recover_interrupted_state()
    assert second["tasks"] == 0 and second["conversations"] == 0


# ---------------------------------------------------------------------------
# R2 SQLite WAL
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_r2_sqlite_wal_enabled(tmp_path) -> None:
    from app.db import engine as db_engine

    url = f"sqlite+aiosqlite:///{tmp_path / 'wal.db'}"
    engine = create_async_engine(url)
    db_engine._enable_sqlite_wal(engine)
    async with engine.connect() as conn:
        mode = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
        busy = (await conn.execute(text("PRAGMA busy_timeout"))).scalar()
    await engine.dispose()
    assert str(mode).lower() == "wal"
    assert int(busy) == 10000


# ---------------------------------------------------------------------------
# A6 幽灵 pending 调度兜底
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a6_strands_unreachable_pending(file_factory, monkeypatch) -> None:
    """任务依赖一个不存在的上游 → 永不就绪、永不级联失败：
    execute_plan 必须把它置 cancelled 并计入失败，而非死循环 / 幽灵 pending。"""
    monkeypatch.setattr(task_executor, "get_session_factory", lambda: file_factory)
    async with file_factory() as s:
        async with s.begin():
            s.add(Conversation(id="c1", title="t"))
            s.add(
                Task(
                    id="dbt1", conversation_id="c1", title="x",
                    agent_role="coder", status="pending", depends_on=["ghost"],
                )
            )

    state = task_executor.ExecutionState(
        conversation_id="c1",
        project_name="p",
        workspace_path="/tmp",
        user_instructions="",
        id_map={"t1": "dbt1"},
    )
    plan = TaskPlan(
        goal="g",
        tasks=[PlannedTask(id="t1", agent="coder", title="x", depends_on=["ghost"])],
    )
    done, failed = await task_executor.execute_plan(state, plan)
    assert (done, failed) == (0, 1)

    async with file_factory() as s:
        assert (await s.get(Task, "dbt1")).status == "cancelled"
