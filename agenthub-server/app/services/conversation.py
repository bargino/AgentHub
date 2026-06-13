"""Conversation 业务服务。

模块级 async 函数：接收 AsyncSession（事务由调用方管理），返回 Pydantic Out 模型。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import get_event_bus
from app.db.models import Conversation, Message
from app.schemas import (
    ConversationCreate,
    ConversationOut,
    ConversationUpdate,
    WSEvent,
    fmt_time,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_out(
    conv: Conversation, last_message: str = "", last_time: str = ""
) -> ConversationOut:
    return ConversationOut(
        id=conv.id,
        title=conv.title,
        project_name=conv.project_name,
        project_path=conv.project_path,
        status=conv.status,
        last_message=last_message,
        last_time=last_time,
        pinned=bool(conv.pinned),
        archived=bool(conv.archived),
        member_agent_ids=conv.member_agent_ids or [],
        rules=conv.rules or "",
        settings=conv.settings or {},
    )


async def _latest_message(session: AsyncSession, conversation_id: str) -> Message | None:
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


async def create_conversation(
    session: AsyncSession, data: ConversationCreate
) -> ConversationOut:
    conv = Conversation(
        title=data.title,
        project_name=data.project_name,
        project_path=data.project_path,
        member_agent_ids=data.member_agent_ids,
        rules=data.rules,
        settings=data.settings,
    )
    session.add(conv)
    await session.flush()
    return _to_out(conv)


async def list_conversations(
    session: AsyncSession, include_archived: bool = False
) -> list[ConversationOut]:
    last_content = (
        select(Message.content)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.created_at.desc())
        .limit(1)
        .scalar_subquery()
    )
    last_created = (
        select(Message.created_at)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.created_at.desc())
        .limit(1)
        .scalar_subquery()
    )
    stmt = select(Conversation, last_content, last_created)
    if not include_archived:
        stmt = stmt.where(Conversation.archived.is_(False))
    stmt = stmt.order_by(Conversation.pinned.desc(), Conversation.updated_at.desc())
    rows = (await session.execute(stmt)).all()
    return [
        _to_out(conv, last_message=content or "", last_time=fmt_time(created))
        for conv, content, created in rows
    ]


async def get_conversation(
    session: AsyncSession, conversation_id: str
) -> ConversationOut | None:
    conv = await session.get(Conversation, conversation_id)
    if conv is None:
        return None
    latest = await _latest_message(session, conversation_id)
    return _to_out(
        conv,
        last_message=latest.content if latest else "",
        last_time=fmt_time(latest.created_at) if latest else "",
    )


async def update_conversation(
    session: AsyncSession, conversation_id: str, data: ConversationUpdate
) -> ConversationOut | None:
    """生命周期操作：重命名 / 置顶 / 归档（None 字段不变），并广播更新事件。"""
    conv = await session.get(Conversation, conversation_id)
    if conv is None:
        return None
    if data.title is not None:
        conv.title = data.title
    if data.pinned is not None:
        conv.pinned = data.pinned
    if data.archived is not None:
        conv.archived = data.archived
    if data.member_agent_ids is not None:
        conv.member_agent_ids = data.member_agent_ids
    if data.rules is not None:
        conv.rules = data.rules
    if data.settings is not None:
        conv.settings = data.settings
    conv.updated_at = _now()
    await session.flush()

    out = await get_conversation(session, conversation_id)
    if out is not None:
        await get_event_bus().publish(
            WSEvent(
                type="conversation.updated",
                conversation_id=conversation_id,
                data={"conversation": out.model_dump(by_alias=True)},
            )
        )
    return out


async def update_status(session: AsyncSession, conversation_id: str, status: str) -> None:
    conv = await session.get(Conversation, conversation_id)
    if conv is None:
        return
    conv.status = status
    conv.updated_at = _now()
    await session.flush()

    out = await get_conversation(session, conversation_id)
    if out is None:
        return
    await get_event_bus().publish(
        WSEvent(
            type="conversation.updated",
            conversation_id=conversation_id,
            data={"conversation": out.model_dump(by_alias=True)},
        )
    )
