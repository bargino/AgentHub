"""会话控制能力：运行句柄注册表（停止）、消息回退删除。

运行：cd agenthub-server && python -m pytest tests/test_conversation_controls.py -v
"""

from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import run_registry
from app.db.models import Base, Conversation, Message
from app.services import message as message_service

# ---------------------------------------------------------------------------
# run_registry：注册 / 取消 / 覆盖
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_registry_cancel_running_task() -> None:
    started = asyncio.Event()

    async def long_job() -> None:
        started.set()
        await asyncio.sleep(60)

    task = asyncio.create_task(long_job())
    run_registry.register("conv-1", task)
    await started.wait()

    assert run_registry.is_running("conv-1")
    assert run_registry.cancel("conv-1") is True
    with pytest.raises(asyncio.CancelledError):
        await task
    assert run_registry.is_running("conv-1") is False
    # 已结束后再次 cancel 返回 False
    assert run_registry.cancel("conv-1") is False


@pytest.mark.asyncio
async def test_registry_cancel_unknown_conversation() -> None:
    assert run_registry.cancel("no-such-conv") is False
    assert run_registry.is_running("no-such-conv") is False


@pytest.mark.asyncio
async def test_registry_new_task_overrides_old() -> None:
    async def quick() -> None:
        await asyncio.sleep(0)

    t1 = asyncio.create_task(quick())
    run_registry.register("conv-2", t1)
    await t1
    # 旧任务完成后注册新任务，cancel 作用于新任务
    t2 = asyncio.create_task(asyncio.sleep(60))
    run_registry.register("conv-2", t2)
    assert run_registry.cancel("conv-2") is True
    with pytest.raises(asyncio.CancelledError):
        await t2


# ---------------------------------------------------------------------------
# delete_messages_from：回退删除
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


async def _seed_conversation(session, conv_id: str, n_messages: int) -> list[str]:
    session.add(Conversation(id=conv_id, title="t", project_name="p"))
    ids: list[str] = []
    for i in range(n_messages):
        out = await message_service.append_message(
            session, conv_id, type="user" if i % 2 == 0 else "agent", content=f"m{i}"
        )
        ids.append(out.id)
        # SQLite datetime 精度有限，强制拉开 created_at 保证稳定排序
        msg = await session.get(Message, out.id)
        from datetime import datetime, timedelta, timezone

        msg.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i)
    await session.flush()
    return ids


@pytest.mark.asyncio
async def test_delete_from_anchor_inclusive(db_session) -> None:
    ids = await _seed_conversation(db_session, "c1", 5)
    deleted = await message_service.delete_messages_from(db_session, "c1", ids[2])
    assert deleted == 3  # ids[2..4]
    remain = (
        (await db_session.execute(select(Message).where(Message.conversation_id == "c1")))
        .scalars()
        .all()
    )
    assert sorted(m.content for m in remain) == ["m0", "m1"]


@pytest.mark.asyncio
async def test_delete_from_missing_anchor_noop(db_session) -> None:
    await _seed_conversation(db_session, "c2", 3)
    assert await message_service.delete_messages_from(db_session, "c2", "ghost") == 0
    remain = (
        (await db_session.execute(select(Message).where(Message.conversation_id == "c2")))
        .scalars()
        .all()
    )
    assert len(remain) == 3


@pytest.mark.asyncio
async def test_delete_from_guards_cross_conversation(db_session) -> None:
    ids_a = await _seed_conversation(db_session, "ca", 2)
    await _seed_conversation(db_session, "cb", 2)
    # 用会话 A 的消息 id 回退会话 B：拒绝（返回 0，B 不受影响）
    assert await message_service.delete_messages_from(db_session, "cb", ids_a[0]) == 0
    remain_b = (
        (await db_session.execute(select(Message).where(Message.conversation_id == "cb")))
        .scalars()
        .all()
    )
    assert len(remain_b) == 2
