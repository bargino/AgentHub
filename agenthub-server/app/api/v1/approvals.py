from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas import ApprovalDecisionIn, ApprovalOut
from app.security.approval_manager import ResolveOutcome, get_approval_coordinator
from app.services import approval as approval_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/approvals/{approval_id}/resolve", response_model=ApprovalOut)
async def resolve_approval(
    approval_id: str,
    decision: ApprovalDecisionIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    # 先取 adapter 绑定（持久化），再落库决策：即便内存协调器映射已因重启丢失，
    # 也能据 DB 绑定回传决策 / 判定是否真正解除。
    binding = await approval_service.get_adapter_binding(db, approval_id)
    approval = await approval_service.resolve_approval(db, approval_id, decision.approved)
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")

    # 回传决策给适配器，解除 Agent 执行阻塞。区分三种结果：
    # - NO_BINDING：纯业务审批，无需回传；
    # - RESOLVED：已成功解除；
    # - ADAPTER_UNAVAILABLE：绑定了 adapter 但无法解除（重启/超时/执行已结束）→ 诚实兜底，
    #   把关联任务置 failed 并广播 approval.resolve_failed，杜绝「显示已通过实则挂起」分叉。
    registry = getattr(request.app.state, "registry", None)
    if registry is not None and binding is not None:
        try:
            outcome = await get_approval_coordinator().resolve(
                approval_id, decision.approved, registry, fallback=binding
            )
        except Exception:
            logger.warning("Adapter approval callback failed for %s", approval_id, exc_info=True)
            outcome = ResolveOutcome.ADAPTER_UNAVAILABLE
        if outcome == ResolveOutcome.ADAPTER_UNAVAILABLE:
            logger.warning(
                "Approval %s resolved in DB but adapter could not be unblocked", approval_id
            )
            await approval_service.mark_resolve_failed(
                db, approval_id,
                "审批已记录，但执行该操作的 Agent 已不在（可能服务重启或审批超时），"
                "未能继续。请在任务面板重试该任务。",
            )

    return approval
