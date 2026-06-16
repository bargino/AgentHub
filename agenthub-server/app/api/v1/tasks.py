from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core import run_registry
from app.schemas import TaskOut
from app.services import task as task_service

router = APIRouter()

# 持有后台重试任务的强引用，防止被 GC 回收
_retry_tasks: set[asyncio.Task] = set()


@router.post("/tasks/{task_id}/retry", response_model=TaskOut)
async def retry_task(task_id: str, db: AsyncSession = Depends(get_db)) -> TaskOut:
    task = await task_service.get_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ("failed", "cancelled"):
        raise HTTPException(status_code=409, detail="Only failed/cancelled tasks can be retried")
    # 会话正在执行时拒绝并发重试，避免同一 workspace 并行写覆盖
    if run_registry.is_running(task.conversation_id):
        raise HTTPException(
            status_code=409, detail="Conversation is busy; stop the current run before retrying"
        )

    # 真正重新调度执行（弥补旧实现"只改状态不执行"的缺陷）：
    # 后台拉起 rerun_task 并注册到 run_registry，支持 /conversations/{id}/stop 取消。
    from app.orchestrator.engine import rerun_task

    bg = asyncio.create_task(rerun_task(task.conversation_id, task_id))
    _retry_tasks.add(bg)
    bg.add_done_callback(_retry_tasks.discard)
    run_registry.register(task.conversation_id, bg)

    # 状态迁移（pending -> running -> 终态）全部由 rerun_task 在独立会话内串行写并经
    # WS 推送，避免与本请求会话并发写同一行；此处仅回包当前任务（前端依赖 WS 更新）。
    return task
