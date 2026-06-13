"""Agent SDK 会话延续映射服务（resume 接线）。

task_executor 在任务完成时 upsert (conversation, agent_role, adapter) ->
session_id 映射；下次同会话同角色同适配器的任务通过 AdapterContext.session_id
resume 底层 SDK session（claude --resume / codex thread_resume），
SDK 内部历史得以延续，AgentHub 只需注入水位之后的增量上下文。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentSessionRecord


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def get_agent_session(
    session: AsyncSession,
    conversation_id: str,
    agent_role: str,
    adapter: str,
) -> AgentSessionRecord | None:
    """查询可 resume 的 SDK session 映射（无记录返回 None，走冷启动）。"""
    result = await session.execute(
        select(AgentSessionRecord)
        .where(AgentSessionRecord.conversation_id == conversation_id)
        .where(AgentSessionRecord.agent_role == agent_role)
        .where(AgentSessionRecord.adapter == adapter)
    )
    return result.scalars().first()


async def upsert_agent_session(
    session: AsyncSession,
    conversation_id: str,
    agent_role: str,
    adapter: str,
    session_id: str,
) -> None:
    """任务成功收口：写入/刷新 session 映射与消息时间水位。"""
    record = await get_agent_session(session, conversation_id, agent_role, adapter)
    now = _now()
    if record is not None:
        record.session_id = session_id
        record.last_message_at = now
    else:
        session.add(
            AgentSessionRecord(
                conversation_id=conversation_id,
                agent_role=agent_role,
                adapter=adapter,
                session_id=session_id,
                last_message_at=now,
            )
        )
    await session.flush()


async def clear_agent_session(
    session: AsyncSession,
    conversation_id: str,
    agent_role: str,
    adapter: str,
) -> None:
    """任务失败收口：清除映射，下次该角色冷启动（防止坏 session 反复 resume）。"""
    await session.execute(
        delete(AgentSessionRecord)
        .where(AgentSessionRecord.conversation_id == conversation_id)
        .where(AgentSessionRecord.agent_role == agent_role)
        .where(AgentSessionRecord.adapter == adapter)
    )
    await session.flush()
