"""会话级黑板（#10 多 Agent 共享上下文）。

模块级 async 函数：接收 AsyncSession（事务由调用方管理）。按 (conversation_id, key)
upsert——并行多方案各 attempt 写 proposal:<task>:<i>、裁决写 decision:<task>；下游经
context_builder 注入共享黑板。写入内容应由调用方先过 #8 消毒（黑板会注入下游上下文，
防注入经黑板跨任务传播）。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BlackboardEntry


async def put(
    session: AsyncSession,
    conversation_id: str,
    key: str,
    value: dict,
    *,
    agent_role: str | None = None,
    trace_id: str = "",
) -> None:
    """按 (conversation_id, key) upsert 黑板条目（同主题增量更新，不堆叠）。"""
    stmt = select(BlackboardEntry).where(
        BlackboardEntry.conversation_id == conversation_id,
        BlackboardEntry.key == key,
    )
    entry = (await session.execute(stmt)).scalars().first()
    if entry is None:
        session.add(
            BlackboardEntry(
                conversation_id=conversation_id,
                key=key,
                value=value,
                agent_role=agent_role,
                trace_id=trace_id,
            )
        )
    else:
        entry.value = value
        if agent_role is not None:
            entry.agent_role = agent_role
        if trace_id:
            entry.trace_id = trace_id
    await session.flush()


async def get_all(session: AsyncSession, conversation_id: str) -> list[dict]:
    """取会话全部黑板条目（按写入顺序）。"""
    stmt = (
        select(BlackboardEntry)
        .where(BlackboardEntry.conversation_id == conversation_id)
        .order_by(BlackboardEntry.id.asc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": r.id,
            "key": r.key,
            "value": r.value,
            "agent_role": r.agent_role,
            "trace_id": r.trace_id,
        }
        for r in rows
    ]


async def get_since(
    session: AsyncSession, conversation_id: str, after_id: int
) -> list[dict]:
    """取 id > after_id 的黑板条目（差量注入，省 token）。"""
    stmt = (
        select(BlackboardEntry)
        .where(
            BlackboardEntry.conversation_id == conversation_id,
            BlackboardEntry.id > after_id,
        )
        .order_by(BlackboardEntry.id.asc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [
        {"id": r.id, "key": r.key, "value": r.value, "agent_role": r.agent_role}
        for r in rows
    ]
