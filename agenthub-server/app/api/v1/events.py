from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.services import event_store

router = APIRouter()


@router.get("/conversations/{conversation_id}/events")
async def list_events(
    conversation_id: str,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """AgentEvent 审计与回放查询（可观测性）。"""
    events = await event_store.list_events(db, conversation_id, limit=limit)
    return {"events": events}
