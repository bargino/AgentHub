from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas import ApprovalDecisionIn, ApprovalOut
from app.security.approval_manager import get_approval_coordinator
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
    approval = await approval_service.resolve_approval(db, approval_id, decision.approved)
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")

    # 回传决策给适配器，解除 Agent 执行阻塞（无对应 pending 时为纯业务审批，忽略）
    registry = getattr(request.app.state, "registry", None)
    if registry is not None:
        try:
            await get_approval_coordinator().resolve(approval_id, decision.approved, registry)
        except Exception:
            logger.warning("Adapter approval callback failed for %s", approval_id, exc_info=True)

    return approval
