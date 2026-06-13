"""用户消息处理器接口（可插拔）。

WebSocket 层只依赖 IMessageHandler 抽象；阶段二用 EchoMessageHandler 验证链路，
阶段三通过 set_message_handler 替换为 Orchestrator 引擎实现。
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Optional

from app.db.engine import get_session_factory
from app.services import message as message_service

logger = logging.getLogger(__name__)


class IMessageHandler(ABC):
    """用户消息处理器。阶段三由 Orchestrator 引擎实现替换。"""

    @abstractmethod
    async def handle(
        self, conversation_id: str, content: str, target_agent: Optional[str]
    ) -> None: ...


class EchoMessageHandler(IMessageHandler):
    """阶段二的临时实现：模拟一个 Agent 回复，验证 WS 链路。"""

    async def handle(
        self, conversation_id: str, content: str, target_agent: Optional[str]
    ) -> None:
        await asyncio.sleep(0.6)  # 模拟思考延迟
        role = target_agent or "orchestrator"
        reply = (
            f"已收到指令：{content[:50]}...\n\n"
            "后端链路已打通，编排引擎将在阶段三接入。"
        )
        try:
            async with get_session_factory()() as session:
                async with session.begin():
                    await message_service.append_message(
                        session,
                        conversation_id,
                        type="agent",
                        content=reply,
                        agent_role=role,
                        agent_name=role.capitalize(),
                    )
        except Exception:
            logger.exception("EchoMessageHandler failed for conversation %s", conversation_id)


_handler: IMessageHandler | None = None


def get_message_handler() -> IMessageHandler:
    global _handler
    if _handler is None:
        _handler = EchoMessageHandler()
    return _handler


def set_message_handler(handler: IMessageHandler) -> None:
    global _handler
    _handler = handler
