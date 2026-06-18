"""Task 业务服务（DAG 任务节点）。

模块级 async 函数：接收 AsyncSession（事务由调用方管理），返回 Pydantic Out 模型。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import get_event_bus
from app.db.models import Task
from app.schemas import TaskOut, WSEvent, fmt_time

logger = logging.getLogger(__name__)

_TERMINAL_STATUSES = {"success", "failed", "cancelled"}

# 任务状态机合法迁移表（守卫并发竞态与重复终态写，对应审计 A3）。
# 设计要点：
# - success 为吸收态（无出边）：可重入续跑（execute_plan）跳过 success 任务、
#   不重跑，故 success 永不被改写，杜绝终态被二次污染统计。
# - failed / cancelled 保留到 running/pending 的出边：支撑重试（API failed/
#   cancelled→pending）与断点续跑（execute_plan 重入时非 success 任务重新调度
#   →running），二者是 batch2 已落地能力，不能被守卫误杀。
# - 同态→同态（current==target）视为幂等 no-op，不算非法（见 _is_legal_transition）。
_LEGAL_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"running", "cancelled", "failed"},
    "running": {"waiting_approval", "success", "failed", "cancelled"},
    "waiting_approval": {"running", "success", "failed", "cancelled"},
    "failed": {"pending", "running", "cancelled"},
    "cancelled": {"pending", "running", "failed"},
    "success": set(),
}


def _is_legal_transition(current: str, target: str) -> bool:
    """同态重复为幂等放行；否则必须在合法出边集合内。"""
    if current == target:
        return True
    return target in _LEGAL_TRANSITIONS.get(current, set())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_out(task: Task) -> TaskOut:
    return TaskOut(
        id=task.id,
        conversation_id=task.conversation_id,
        title=task.title,
        agent_role=task.agent_role,
        status=task.status,
        depends_on=list(task.depends_on or []),
        acceptance=task.acceptance or "",
        result=task.result,
        started_at=fmt_time(task.started_at) if task.started_at else None,
        finished_at=fmt_time(task.finished_at) if task.finished_at else None,
    )


async def create_tasks(
    session: AsyncSession, conversation_id: str, tasks: list[dict]
) -> list[TaskOut]:
    records = [
        Task(
            conversation_id=conversation_id,
            title=item["title"],
            description=item.get("description", ""),
            agent_role=item["agent_role"],
            depends_on=list(item.get("depends_on") or []),
            requires_approval=bool(item.get("requires_approval", False)),
            acceptance=str(item.get("acceptance", "") or ""),
        )
        for item in tasks
    ]
    session.add_all(records)
    await session.flush()
    return [_to_out(t) for t in records]


async def resolve_dependencies(session: AsyncSession, id_map: dict[str, str]) -> None:
    """把已创建任务里以「计划内本地 id」(如 t1/fix) 存储的 depends_on 翻译成真实 DB 任务 id。

    create_tasks 时只能先落库再由 zip 得到 planner->db 的 id_map，故 depends_on 初始存的是
    planner 本地 id，与 task.id(uuid) 不匹配，前端据此无法连边渲染 DAG。本函数在 id_map 就绪后
    回填为 db id（丢弃无法映射的悬挂依赖），不影响调度（execute_plan 用内存 plan 的 depends_on）。
    """
    for db_id in id_map.values():
        task = await session.get(Task, db_id)
        if task is None:
            continue
        current = list(task.depends_on or [])
        translated = [id_map[d] for d in current if d in id_map]
        if translated != current:
            task.depends_on = translated
    await session.flush()


async def list_tasks(session: AsyncSession, conversation_id: str) -> list[TaskOut]:
    stmt = (
        select(Task)
        .where(Task.conversation_id == conversation_id)
        .order_by(Task.created_at.asc())
    )
    records = (await session.execute(stmt)).scalars().all()
    return [_to_out(t) for t in records]


async def update_task_status(
    session: AsyncSession, task_id: str, status: str, result: str | None = None
) -> TaskOut | None:
    task = await session.get(Task, task_id)
    if task is None:
        return None

    # 状态机守卫：非法迁移（如 success→running 重跑终态、终态被二次改写）直接拒绝，
    # 返回当前未改动状态 + warning；合法/同态放行
    if not _is_legal_transition(task.status, status):
        logger.warning(
            "拒绝非法任务状态迁移 %s -> %s (task=%s)", task.status, status, task_id
        )
        return _to_out(task)

    task.status = status
    if result is not None:
        task.result = result
    if status == "running" and task.started_at is None:
        task.started_at = _now()
    elif status in _TERMINAL_STATUSES:
        task.finished_at = _now()
    elif status == "pending":
        # 重试场景：清空上一轮执行痕迹
        task.result = None
        task.started_at = None
        task.finished_at = None

    await session.flush()

    out = _to_out(task)
    await get_event_bus().publish(
        WSEvent(
            type="task.status.changed",
            conversation_id=task.conversation_id,
            data={"task": out.model_dump(by_alias=True)},
        )
    )
    return out


async def get_task(session: AsyncSession, task_id: str) -> TaskOut | None:
    task = await session.get(Task, task_id)
    if task is None:
        return None
    return _to_out(task)
