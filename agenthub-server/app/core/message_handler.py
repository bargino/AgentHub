"""用户消息处理器接口（可插拔）。

WebSocket / bridge 层只依赖 IMessageHandler 抽象；启动时由 main.py / bridge.py 经
set_message_handler 注入真实 OrchestratorEngine。未注入时 get_message_handler 惰性回退到
真实编排引擎（不再有 echo 桩），保证全链路真实、便于排查实际场景问题。
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class IMessageHandler(ABC):
    """用户消息处理器抽象；由 OrchestratorEngine 实现。"""

    @abstractmethod
    async def handle(
        self, conversation_id: str, content: str, target_agent: str | None
    ) -> None: ...


_handler: IMessageHandler | None = None


def get_message_handler() -> IMessageHandler:
    global _handler
    if _handler is None:
        # 惰性回退到真实编排引擎（函数内导入避免与 engine 的顶层循环依赖）
        from app.orchestrator.engine import OrchestratorEngine

        _handler = OrchestratorEngine()
    return _handler


def set_message_handler(handler: IMessageHandler) -> None:
    global _handler
    _handler = handler
