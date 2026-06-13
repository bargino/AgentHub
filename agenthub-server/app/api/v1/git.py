"""Git 面板只读端点（按会话 workspace 查询）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.services import git_panel
from app.services.workspace import get_workspace

router = APIRouter()


async def _workspace_path(db: AsyncSession, conversation_id: str) -> str:
    ws = await get_workspace(db, conversation_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="Workspace not found（会话尚未执行过任务）")
    return ws.path


@router.get("/conversations/{conversation_id}/git/status")
async def git_status(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    return await git_panel.git_status(await _workspace_path(db, conversation_id))


@router.get("/conversations/{conversation_id}/git/log")
async def git_log(
    conversation_id: str, limit: int = 30, db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    return await git_panel.git_log(await _workspace_path(db, conversation_id), limit)


@router.get("/conversations/{conversation_id}/git/branches")
async def git_branches(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    return await git_panel.git_branches(await _workspace_path(db, conversation_id))


@router.get("/conversations/{conversation_id}/git/diff")
async def git_diff(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    return await git_panel.git_unified_diff(await _workspace_path(db, conversation_id))
