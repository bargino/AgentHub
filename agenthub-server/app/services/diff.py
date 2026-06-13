"""Diff 业务服务（代码变更与审批状态）。

模块级 async 函数：接收 AsyncSession（事务由调用方管理），返回 Pydantic Out 模型。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import get_event_bus
from app.db.models import DiffRecord
from app.schemas import DiffFileOut, DiffOut, WSEvent


def _to_out(record: DiffRecord) -> DiffOut:
    return DiffOut(
        id=record.id,
        conversation_id=record.conversation_id,
        task_id=record.task_id,
        # DiffOut.agent_id 对应模型的 agent_role 列
        agent_id=record.agent_role,
        summary=record.summary,
        files=[DiffFileOut.model_validate(f) for f in (record.files or [])],
        status=record.status,
    )


async def create_diff(
    session: AsyncSession,
    conversation_id: str,
    *,
    summary: str,
    files: list[dict],
    task_id: str | None = None,
    agent_role: str | None = None,
) -> DiffOut:
    record = DiffRecord(
        conversation_id=conversation_id,
        task_id=task_id,
        agent_role=agent_role,
        summary=summary,
        files=files,
    )
    session.add(record)
    await session.flush()

    out = _to_out(record)
    await get_event_bus().publish(
        WSEvent(
            type="diff.generated",
            conversation_id=conversation_id,
            data={"diff": out.model_dump(by_alias=True)},
        )
    )
    return out


async def get_latest_diff(session: AsyncSession, conversation_id: str) -> DiffOut | None:
    stmt = (
        select(DiffRecord)
        .where(DiffRecord.conversation_id == conversation_id)
        .order_by(DiffRecord.created_at.desc())
        .limit(1)
    )
    record = (await session.execute(stmt)).scalars().first()
    if record is None:
        return None
    return _to_out(record)


async def resolve_diff(
    session: AsyncSession, diff_id: str, approved: bool
) -> DiffOut | None:
    record = await session.get(DiffRecord, diff_id)
    if record is None:
        return None
    record.status = "approved" if approved else "rejected"
    await session.flush()

    out = _to_out(record)
    await get_event_bus().publish(
        WSEvent(
            type="approval.resolved",
            conversation_id=record.conversation_id,
            data={"diff": out.model_dump(by_alias=True)},
        )
    )
    return out
