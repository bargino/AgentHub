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
    after: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """AgentEvent 审计与回放查询（可观测性）。

    游标分页：after=上一页最后一条事件 id，重复以 nextAfter 翻页直到 events 为空，
    避免大会话事件被默认 limit 静默截断。
    """
    events = await event_store.list_events(db, conversation_id, limit=limit, after=after)
    next_after = events[-1]["id"] if len(events) == limit else None
    return {"events": events, "nextAfter": next_after}
