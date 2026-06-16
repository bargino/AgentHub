"""AgentEvent 持久化服务（可观测性 / 回放）。

模块级 async 函数：接收 AsyncSession（事务由调用方管理）。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentEventRecord


async def record_event(
    session: AsyncSession,
    conversation_id: str,
    event_type: str,
    payload: dict,
    task_id: str | None = None,
    agent_role: str | None = None,
) -> None:
    session.add(
        AgentEventRecord(
            conversation_id=conversation_id,
            task_id=task_id,
            agent_role=agent_role,
            event_type=event_type,
            payload=payload,
        )
    )
    await session.flush()


async def list_events(
    session: AsyncSession,
    conversation_id: str,
    limit: int = 500,
    after: int | None = None,
) -> list[dict]:
    # after=游标（上一页最后一条 id），按 id 升序取其后 limit 条；
    # 杜绝大会话（>limit 事件）被静默截断丢失最新事件（观测性回放需要全量可达）。
    stmt = select(AgentEventRecord).where(
        AgentEventRecord.conversation_id == conversation_id
    )
    if after is not None:
        stmt = stmt.where(AgentEventRecord.id > after)
    stmt = stmt.order_by(AgentEventRecord.id.asc()).limit(limit)
    records = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": r.id,
            "conversation_id": r.conversation_id,
            "task_id": r.task_id,
            "agent_role": r.agent_role,
            "event_type": r.event_type,
            "payload": r.payload,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in records
    ]
