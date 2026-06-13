"""WebSocket 连接管理器。

维护 连接 -> 订阅的 conversation_id 集合 的映射；
作为 EventBus 订阅者，将 WSEvent 按 conversation_id 分发给订阅连接。
"""

from __future__ import annotations

import logging

from fastapi import WebSocket

from app.schemas import WSEvent

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[WebSocket, set[str]] = {}

    def connect(self, ws: WebSocket) -> None:
        self.connections[ws] = set()

    def disconnect(self, ws: WebSocket) -> None:
        self.connections.pop(ws, None)

    def subscribe(self, ws: WebSocket, conversation_id: str) -> None:
        if ws in self.connections:
            self.connections[ws].add(conversation_id)

    def unsubscribe(self, ws: WebSocket, conversation_id: str) -> None:
        if ws in self.connections:
            self.connections[ws].discard(conversation_id)

    async def dispatch(self, event: WSEvent) -> None:
        """将事件发给所有订阅了该 conversation_id 的连接；发送失败的连接静默移除。"""
        payload = event.to_payload()
        dead: list[WebSocket] = []
        for ws, conv_ids in list(self.connections.items()):
            if event.conversation_id not in conv_ids:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.connections.pop(ws, None)


_manager: ConnectionManager | None = None


def get_connection_manager() -> ConnectionManager:
    global _manager
    if _manager is None:
        _manager = ConnectionManager()
    return _manager
