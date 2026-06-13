"""Approval 业务服务（高风险动作审批）。

模块级 async 函数：接收 AsyncSession（事务由调用方管理），返回 Pydantic Out 模型。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import get_event_bus
from app.db.models import Approval
from app.schemas import ApprovalOut, WSEvent


def _to_out(record: Approval) -> ApprovalOut:
    return ApprovalOut(
        id=record.id,
        conversation_id=record.conversation_id,
        task_id=record.task_id,
        agent_role=record.agent_role,
        agent_name=record.agent_name,
        action_type=record.action_type,
        summary=record.summary,
        risk_level=record.risk_level,
        status=record.status,
    )


async def create_approval(
    session: AsyncSession,
    conversation_id: str,
    *,
    action_type: str,
    summary: str,
    risk_level: str = "low",
    task_id: str | None = None,
    request_id: str | None = None,
    agent_role: str | None = None,
    agent_name: str | None = None,
) -> ApprovalOut:
    record = Approval(
        conversation_id=conversation_id,
        task_id=task_id,
        agent_role=agent_role,
        agent_name=agent_name,
        action_type=action_type,
        summary=summary,
        risk_level=risk_level,
        request_id=request_id,
    )
    session.add(record)
    await session.flush()

    out = _to_out(record)
    await get_event_bus().publish(
        WSEvent(
            type="approval.required",
            conversation_id=conversation_id,
            data={"approval": out.model_dump(by_alias=True)},
        )
    )
    return out


async def get_pending_approval(
    session: AsyncSession, conversation_id: str
) -> ApprovalOut | None:
    stmt = (
        select(Approval)
        .where(Approval.conversation_id == conversation_id, Approval.status == "pending")
        .order_by(Approval.created_at.desc())
        .limit(1)
    )
    record = (await session.execute(stmt)).scalars().first()
    if record is None:
        return None
    return _to_out(record)


async def list_pending_approvals(
    session: AsyncSession, conversation_id: str
) -> list[ApprovalOut]:
    """返回会话内全部待决审批（按创建时间升序，前端向导按序展示）。

    支持多 Agent 并发请求时一次性返回多个待确认项。
    """
    stmt = (
        select(Approval)
        .where(Approval.conversation_id == conversation_id, Approval.status == "pending")
        .order_by(Approval.created_at.asc())
    )
    records = (await session.execute(stmt)).scalars().all()
    return [_to_out(r) for r in records]


async def resolve_approval(
    session: AsyncSession, approval_id: str, approved: bool
) -> ApprovalOut | None:
    record = await session.get(Approval, approval_id)
    if record is None:
        return None
    record.status = "approved" if approved else "rejected"
    await session.flush()

    out = _to_out(record)
    await get_event_bus().publish(
        WSEvent(
            type="approval.resolved",
            conversation_id=record.conversation_id,
            data={"approval": out.model_dump(by_alias=True)},
        )
    )
    return out
