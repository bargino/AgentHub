"""Approval 业务服务（高风险动作审批）。

模块级 async 函数：接收 AsyncSession（事务由调用方管理），返回 Pydantic Out 模型。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import get_event_bus
from app.db.models import Approval
from app.schemas import ApprovalOut, WSEvent
from app.security.approval_manager import PendingApproval
from app.services import diff as diff_service


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
        diff_id=record.diff_id,
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
    adapter_name: str | None = None,
    agent_role: str | None = None,
    agent_name: str | None = None,
    diff_id: str | None = None,
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
        adapter_name=adapter_name,
        diff_id=diff_id,
    )
    session.add(record)
    await session.flush()
    return _to_out(record)


async def publish_required(out: ApprovalOut) -> None:
    """发 approval.required 事件。

    必须在审批记录所在事务提交「后」调用：否则客户端收到事件立即 POST resolve 时，
    新连接查不到尚未提交的审批记录（SQLite 写未提交对其它连接不可见），稳定 404。
    """
    await get_event_bus().publish(
        WSEvent(
            type="approval.required",
            conversation_id=out.conversation_id,
            data={"approval": out.model_dump(by_alias=True)},
        )
    )


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


async def get_adapter_binding(
    session: AsyncSession, approval_id: str
) -> PendingApproval | None:
    """读取审批的 adapter 绑定（持久化的 adapter_name + request_id），供协调器在内存
    映射丢失（进程重启）时回退定位。无 request_id 视为纯业务审批，返回 None。"""
    record = await session.get(Approval, approval_id)
    if record is None or not record.request_id:
        return None
    return PendingApproval(
        approval_id=record.id,
        adapter_name=record.adapter_name or "",
        request_id=record.request_id,
        conversation_id=record.conversation_id,
    )


async def mark_resolve_failed(
    session: AsyncSession, approval_id: str, reason: str
) -> None:
    """adapter 无法真正解除审批（重启/超时/执行已结束）时的诚实兜底：把关联任务置
    failed 并广播明确信号，避免「UI 显示已通过、agent 实际挂起/被拒」的静默分叉。"""
    from app.services import task as task_service

    record = await session.get(Approval, approval_id)
    if record is None:
        return
    if record.task_id:
        await task_service.update_task_status(
            session, record.task_id, "failed", result=reason
        )
    await get_event_bus().publish(
        WSEvent(
            type="approval.resolve_failed",
            conversation_id=record.conversation_id,
            data={"approvalId": record.id, "taskId": record.task_id, "reason": reason},
        )
    )


async def resolve_approval(
    session: AsyncSession, approval_id: str, approved: bool
) -> ApprovalOut | None:
    record = await session.get(Approval, approval_id)
    if record is None:
        return None
    record.status = "approved" if approved else "rejected"
    # 级联：apply_diff 审批联动把对应 diff 置同一终态（单一决策出口，避免两套审批割裂）
    diff_out = None
    if record.diff_id:
        diff_out = await diff_service.set_status_silent(session, record.diff_id, record.status)
    await session.flush()

    out = _to_out(record)
    data: dict = {"approval": out.model_dump(by_alias=True)}
    if diff_out is not None:
        data["diff"] = diff_out.model_dump(by_alias=True)
    await get_event_bus().publish(
        WSEvent(
            type="approval.resolved",
            conversation_id=record.conversation_id,
            data=data,
        )
    )
    return out
