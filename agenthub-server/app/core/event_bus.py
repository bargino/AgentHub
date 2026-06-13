"""进程内事件总线。

业务服务发布 WSEvent -> 总线广播给所有订阅者（当前订阅者为 WebSocket
连接管理器 ConnectionManager；AgentEvent 持久化由 task_executor 直接
写入 event_store，不经过总线）。
服务层与传输层解耦：服务不持有 WebSocket 引用，新增订阅者无需改动业务代码。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from app.schemas import WSEvent

logger = logging.getLogger(__name__)

Subscriber = Callable[[WSEvent], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self._subscribers: list[Subscriber] = []

    def subscribe(self, handler: Subscriber) -> Callable[[], None]:
        """订阅事件，返回取消订阅函数。"""
        self._subscribers.append(handler)

        def unsubscribe() -> None:
            if handler in self._subscribers:
                self._subscribers.remove(handler)

        return unsubscribe

    async def publish(self, event: WSEvent) -> None:
        if not self._subscribers:
            return
        results = await asyncio.gather(
            *(handler(event) for handler in list(self._subscribers)),
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Event subscriber failed: %s", r)


_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
