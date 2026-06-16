from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.db.models import Workspace
from app.schemas import DiffOut
from app.services import diff as diff_service
from app.services import workspace as workspace_service

logger = logging.getLogger(__name__)

router = APIRouter()


async def _apply_workspace_action(db: AsyncSession, diff: DiffOut, approved: bool) -> None:
    """审批结果落到 workspace：通过则提交基线，拒绝则回滚变更。"""
    result = await db.execute(
        select(Workspace).where(Workspace.conversation_id == diff.conversation_id)
    )
    ws = result.scalars().first()
    if ws is None:
        return
    try:
        if approved:
            await workspace_service.commit_changes(ws.path, f"apply diff {diff.id[:8]}")
        else:
            await workspace_service.discard_changes(ws.path)
    except Exception:
        logger.warning("Workspace action failed for diff %s", diff.id, exc_info=True)


@router.get("/diffs/{diff_id}", response_model=DiffOut)
async def get_diff(diff_id: str, db: AsyncSession = Depends(get_db)) -> DiffOut:
    """按 id 取单条 diff（审查界面按 approval.diffId 联动拉取历史会话的关联 diff）。"""
    diff = await diff_service.get_diff_by_id(db, diff_id)
    if diff is None:
        raise HTTPException(status_code=404, detail="Diff not found")
    return diff


@router.post("/diffs/{diff_id}/approve", response_model=DiffOut)
async def approve_diff(diff_id: str, db: AsyncSession = Depends(get_db)) -> DiffOut:
    diff = await diff_service.resolve_diff(db, diff_id, approved=True)
    if diff is None:
        raise HTTPException(status_code=404, detail="Diff not found")
    await _apply_workspace_action(db, diff, approved=True)
    return diff


@router.post("/diffs/{diff_id}/reject", response_model=DiffOut)
async def reject_diff(diff_id: str, db: AsyncSession = Depends(get_db)) -> DiffOut:
    diff = await diff_service.resolve_diff(db, diff_id, approved=False)
    if diff is None:
        raise HTTPException(status_code=404, detail="Diff not found")
    await _apply_workspace_action(db, diff, approved=False)
    return diff
