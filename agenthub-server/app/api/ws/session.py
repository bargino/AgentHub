"""会话域 WebSocket 端点。

协议：
- 客户端 -> 服务端: {"action": "subscribe"|"unsubscribe"|"send_message"|"pong", "payload": {...}}
- 服务端 -> 客户端: WSEvent.to_payload() JSON（{"type", "conversationId", "data"}）+ 心跳 {"type": "ping"}

事件流向：业务服务 -> EventBus -> ConnectionManager.dispatch -> 订阅了该会话的连接。
本模块不直连 adapter；用户消息交给可插拔 IMessageHandler（阶段三替换为编排引擎）。
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.ws.manager import get_connection_manager
from app.core import run_registry
from app.core.event_bus import get_event_bus
from app.core.message_handler import get_message_handler
from app.db.engine import get_session_factory
from app.schemas import WSEvent
from app.services import message as message_service

logger = logging.getLogger(__name__)

router = APIRouter()

HEARTBEAT_INTERVAL = 30

_bus_bridged = False

# 持有 fire-and-forget 任务的强引用，防止被垃圾回收
_background_tasks: set[asyncio.Task[None]] = set()


def _ensure_bus_bridge() -> None:
    """把 ConnectionManager.dispatch 注册为 EventBus 订阅者（模块级 flag 防重复注册）。"""
    global _bus_bridged
    if _bus_bridged:
        return
    get_event_bus().subscribe(get_connection_manager().dispatch)
    _bus_bridged = True


def _on_task_done(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if not task.cancelled() and task.exception() is not None:
        logger.error("Background task failed", exc_info=task.exception())


@router.websocket("/ws/session")
async def session_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    _ensure_bus_bridge()

    manager = get_connection_manager()
    manager.connect(websocket)

    async def heartbeat() -> None:
        while True:
            try:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                await websocket.send_json({"type": "ping"})
            except Exception:
                break

    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send_error(websocket, "Invalid JSON")
                continue

            action = msg.get("action", "") if isinstance(msg, dict) else ""
            payload = msg.get("payload") if isinstance(msg, dict) else None
            if not isinstance(payload, dict):
                payload = {}

            if action == "pong":
                continue

            elif action == "subscribe":
                conversation_id = payload.get("conversationId")
                if conversation_id:
                    manager.subscribe(websocket, conversation_id)

            elif action == "unsubscribe":
                conversation_id = payload.get("conversationId")
                if conversation_id:
                    manager.unsubscribe(websocket, conversation_id)

            elif action == "send_message":
                try:
                    await handle_send_message(payload)
                except Exception:
                    logger.exception("send_message failed")
                    await _send_error(
                        websocket,
                        "Failed to process message",
                        payload.get("conversationId") or "",
                    )

            else:
                await _send_error(websocket, f"Unknown action: {action}")

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception:
        logger.exception("WebSocket error")
    finally:
        heartbeat_task.cancel()
        manager.disconnect(websocket)


async def handle_send_message(payload: dict[str, Any]) -> None:
    conversation_id = payload.get("conversationId")
    content = (payload.get("content") or "").strip()
    target_agent = payload.get("targetAgent")
    if not conversation_id or not content:
        return

    # 1. 持久化用户消息（message_service 内部经 EventBus 广播 message.completed）
    async with get_session_factory()() as session:
        async with session.begin():
            await message_service.append_message(
                session, conversation_id, type="user", content=content
            )

    # 2. 交给可插拔消息处理器；句柄注册到 run_registry 供 /stop 取消
    handler = get_message_handler()
    task = asyncio.create_task(handler.handle(conversation_id, content, target_agent))
    _background_tasks.add(task)
    task.add_done_callback(_on_task_done)
    run_registry.register(conversation_id, task)


async def _send_error(websocket: WebSocket, message: str, conversation_id: str = "") -> None:
    event = WSEvent(type="error", conversation_id=conversation_id, data={"error": message})
    try:
        await websocket.send_json(event.to_payload())
    except Exception:
        logger.warning("Failed to send error event to client")
