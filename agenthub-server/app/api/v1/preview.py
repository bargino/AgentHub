from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.db.models import Workspace
from app.services.preview import get_preview_manager

router = APIRouter()


@router.post("/conversations/{conversation_id}/preview/start")
async def start_preview(conversation_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(Workspace).where(Workspace.conversation_id == conversation_id)
    )
    ws = result.scalars().first()
    if ws is None:
        raise HTTPException(status_code=404, detail="Workspace not found for conversation")

    try:
        preview = await get_preview_manager().start(conversation_id, ws.path)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"previewUrl": preview.url, "port": preview.port, "projectType": preview.project_type}


@router.post("/conversations/{conversation_id}/preview/stop")
async def stop_preview(conversation_id: str) -> dict:
    stopped = await get_preview_manager().stop(conversation_id)
    return {"stopped": stopped}


@router.get("/conversations/{conversation_id}/preview/logs")
async def preview_logs(conversation_id: str) -> dict:
    manager = get_preview_manager()
    preview = manager.get(conversation_id)
    return {
        "running": bool(preview and preview.running),
        "previewUrl": preview.url if preview else None,
        "projectType": preview.project_type if preview else None,
        "logs": manager.get_logs(conversation_id),
    }
