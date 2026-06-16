"""Message 业务服务。

模块级 async 函数：接收 AsyncSession（事务由调用方管理），返回 Pydantic Out 模型。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import get_event_bus
from app.db.models import Conversation, Message
from app.schemas import MessageOut, WSEvent, fmt_time


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_out(message: Message) -> MessageOut:
    return MessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        type=message.type,
        content=message.content,
        agent_role=message.agent_role,
        agent_name=message.agent_name,
        task_id=message.task_id,
        timestamp=fmt_time(message.created_at),
        tool_name=message.tool_name,
        tool_status=message.tool_status,
        meta=dict(message.meta or {}),
    )


async def append_message(
    session: AsyncSession,
    conversation_id: str,
    *,
    type: str,
    content: str = "",
    agent_role: str | None = None,
    agent_name: str | None = None,
    task_id: str | None = None,
    tool_name: str | None = None,
    tool_status: str | None = None,
    message_id: str | None = None,
    meta: dict | None = None,
) -> MessageOut:
    message = Message(
        conversation_id=conversation_id,
        type=type,
        content=content,
        agent_role=agent_role,
        agent_name=agent_name,
        task_id=task_id,
        tool_name=tool_name,
        tool_status=tool_status,
        meta=meta or {},
    )
    if message_id:
        # 流式消息：delta 阶段已用此 ID 推送，落库复用使前端 upsert 去重
        message.id = message_id
    session.add(message)

    conversation = await session.get(Conversation, conversation_id)
    if conversation is not None:
        conversation.updated_at = _now()

    await session.flush()

    out = _to_out(message)
    await get_event_bus().publish(
        WSEvent(
            type="message.completed",
            conversation_id=conversation_id,
            data={"message": out.model_dump(by_alias=True)},
        )
    )
    return out


async def update_tool_message(
    session: AsyncSession,
    message_id: str,
    *,
    tool_status: str,
    content_append: str = "",
    meta: dict | None = None,
) -> MessageOut | None:
    """更新工具消息的执行状态（可追加输出与元数据），并广播给前端按 id upsert。

    消息不存在时返回 None（容错：running 阶段落库失败等场景）。
    """
    message = await session.get(Message, message_id)
    if message is None:
        return None
    message.tool_status = tool_status
    if content_append:
        merged = f"{message.content}\n{content_append}" if message.content else content_append
        message.content = merged[:2500]
    if meta:
        message.meta = {**(message.meta or {}), **meta}
    await session.flush()

    out = _to_out(message)
    await get_event_bus().publish(
        WSEvent(
            type="message.completed",
            conversation_id=message.conversation_id,
            data={"message": out.model_dump(by_alias=True)},
        )
    )
    return out


async def delete_messages_from(
    session: AsyncSession, conversation_id: str, message_id: str
) -> int:
    """回退对话：删除锚点消息及其之后的所有消息（按 created_at），返回删除数。

    锚点不存在或不属于该会话返回 0（不删任何东西）。
    """
    anchor = await session.get(Message, message_id)
    if anchor is None or anchor.conversation_id != conversation_id:
        return 0
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.created_at >= anchor.created_at)
    )
    doomed = (await session.execute(stmt)).scalars().all()
    for m in doomed:
        await session.delete(m)

    conversation = await session.get(Conversation, conversation_id)
    if conversation is not None:
        conversation.updated_at = _now()
    await session.flush()
    return len(doomed)


async def get_latest_agent_meta(session: AsyncSession, task_id: str) -> dict:
    """取某任务最新一条 agent 消息的 meta（无则空 dict）。

    供编排器读取 Reviewer 写入的 meta["reviewVerdict"]，驱动 evaluator-optimizer 回环。
    """
    stmt = (
        select(Message.meta)
        .where(Message.task_id == task_id, Message.type == "agent")
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    row = (await session.execute(stmt)).first()
    return dict(row[0]) if row and row[0] else {}


async def get_latest_user_attachments(
    session: AsyncSession, conversation_id: str
) -> list[dict]:
    """取最近一条 user 消息 meta.attachments（统一附件 ref 列表）；无则空。

    多模态：context_builder 据此把当轮用户图片注入各任务 AdapterContext。replan/review
    阶段不新增 user 消息，故"最近 user 消息"始终是触发本轮的原始消息，天然覆盖回环。
    """
    stmt = (
        select(Message.meta)
        .where(Message.conversation_id == conversation_id, Message.type == "user")
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    row = (await session.execute(stmt)).first()
    meta = dict(row[0]) if row and row[0] else {}
    atts = meta.get("attachments")
    return atts if isinstance(atts, list) else []


async def list_messages(
    session: AsyncSession,
    conversation_id: str,
    limit: int = 100,
    before_id: str | None = None,
) -> list[MessageOut]:
    """游标分页：默认取最新 limit 条；before_id 取该消息之前的 limit 条（升序返回）。"""
    stmt = select(Message).where(Message.conversation_id == conversation_id)
    if before_id:
        anchor = await session.get(Message, before_id)
        if anchor is not None:
            stmt = stmt.where(Message.created_at < anchor.created_at)
    stmt = stmt.order_by(Message.created_at.desc()).limit(limit)
    messages = (await session.execute(stmt)).scalars().all()
    return [_to_out(m) for m in reversed(messages)]
