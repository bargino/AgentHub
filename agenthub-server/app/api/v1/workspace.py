"""Workspace 只读文件浏览端点（Explorer 文件树 + 读单文件）。

按会话定位 workspace 目录后委托 services.workspace_files；同步 I/O 用线程池包裹，
避免阻塞事件循环。所有访问限制在 workspace 根内（穿越防护见 workspace_files）。
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.services import workspace_files
from app.services.workspace import get_workspace

router = APIRouter()


async def _workspace_path(db: AsyncSession, conversation_id: str) -> str:
    ws = await get_workspace(db, conversation_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="Workspace not found（会话尚未执行过任务）")
    return ws.path


@router.get("/conversations/{conversation_id}/workspace/tree")
async def workspace_tree(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    path = await _workspace_path(db, conversation_id)
    return await asyncio.to_thread(workspace_files.build_tree, path)


@router.get("/conversations/{conversation_id}/workspace/file")
async def workspace_file(
    conversation_id: str,
    path: str = Query(..., description="相对 workspace 根的文件路径"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws_path = await _workspace_path(db, conversation_id)
    try:
        return await asyncio.to_thread(workspace_files.read_file, ws_path, path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
