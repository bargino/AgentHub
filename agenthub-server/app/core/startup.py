"""服务启动自愈（对应审计 A1-步骤1）。

server 崩溃 / 重启后，承载编排的 asyncio 协程全部消失，但 DB 里的任务与会话
状态可能停留在 running / waiting_approval —— 前端表现为"AI 失踪、永久转圈"。
启动时统一把这些中断态收口为终态（任务置 failed、会话置 idle），并给受影响
会话补一条系统消息，让用户知道可以重试。先消灭"永久卡死"。
"""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.db.engine import get_session_factory
from app.db.models import Conversation, Message, Task

logger = logging.getLogger(__name__)

# 重启即视为中断的"在途"状态
_INTERRUPTED_TASK_STATES = ("running", "waiting_approval")
_INTERRUPTED_CONV_STATES = ("running", "waiting_approval")
_RECOVERY_NOTE = "服务已重启，上次运行中的任务已中断，可在任务面板重试。"


async def recover_interrupted_state() -> dict[str, int]:
    """收口上次残留的中断态，返回 {tasks, conversations} 计数（供日志 / 测试）。

    - 中断任务（running/waiting_approval）→ failed，result 补恢复说明（不覆盖已有）
    - 中断会话（running/waiting_approval）→ idle
    - 受影响会话补一条 system 消息
    幂等：再次调用时已无中断态，计数为 0、不重复补消息。
    """
    factory = get_session_factory()
    async with factory() as session:
        async with session.begin():
            stuck_tasks = list(
                (
                    await session.execute(
                        select(Task).where(Task.status.in_(_INTERRUPTED_TASK_STATES))
                    )
                )
                .scalars()
                .all()
            )
            affected_conv_ids: set[str] = {t.conversation_id for t in stuck_tasks}
            for task in stuck_tasks:
                task.status = "failed"
                if task.result is None:
                    task.result = _RECOVERY_NOTE

            stuck_convs = list(
                (
                    await session.execute(
                        select(Conversation).where(
                            Conversation.status.in_(_INTERRUPTED_CONV_STATES)
                        )
                    )
                )
                .scalars()
                .all()
            )
            for conv in stuck_convs:
                conv.status = "idle"
                affected_conv_ids.add(conv.id)

            for conv_id in affected_conv_ids:
                session.add(
                    Message(
                        conversation_id=conv_id,
                        type="system",
                        content=_RECOVERY_NOTE,
                    )
                )

    counts = {"tasks": len(stuck_tasks), "conversations": len(affected_conv_ids)}
    if counts["tasks"] or counts["conversations"]:
        logger.info(
            "启动自愈：收口中断任务 %d 个、会话 %d 个",
            counts["tasks"],
            counts["conversations"],
        )
    return counts
