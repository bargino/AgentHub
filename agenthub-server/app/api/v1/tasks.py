from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas import TaskOut
from app.services import task as task_service

router = APIRouter()


@router.post("/tasks/{task_id}/retry", response_model=TaskOut)
async def retry_task(task_id: str, db: AsyncSession = Depends(get_db)) -> TaskOut:
    task = await task_service.get_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ("failed", "cancelled"):
        raise HTTPException(status_code=409, detail="Only failed/cancelled tasks can be retried")
    updated = await task_service.update_task_status(db, task_id, "pending", result=None)
    assert updated is not None
    return updated
