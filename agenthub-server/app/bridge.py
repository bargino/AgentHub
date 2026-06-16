"""AgentHub stdio 桥（融合路线 A：去掉 HTTP server / 端口 / CORS / WebSocket）。

Electron 主进程 spawn ``python -m app.bridge``，与本进程通过 stdin/stdout 交换
按行分隔的 JSON（NDJSON）帧，取代原先的「本地 HTTP 服务 + WebSocket」：

渲染层 -> 桥（stdin）
    {"id": "<n>", "kind": "request",
     "method": "GET|POST|PATCH|DELETE", "path": "/api/v1/...", "body": <json|null>}
    {"id": "<n>", "kind": "send_message", "payload": {...}}

桥 -> 渲染层（stdout）
    {"kind": "ready"}
    {"id": "<n>", "kind": "response", "status": <int>, "body": <json|null>}
    {"kind": "event", "event": <WSEvent.to_payload()>}   # 替代 WebSocket 推送

请求经**进程内 ASGI 派发**到现有 FastAPI 路由（无 socket / 无端口 / 无 CORS），
事件由 EventBus 订阅者写入 stdout。stdout 仅承载协议帧，所有日志走 stderr。
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import threading
from typing import Any

# stdout 只跑协议帧：日志一律走 stderr，避免污染通道
logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger("agenthub.bridge")

# Windows 控制台默认编码可能是 GBK，会破坏含中文的 JSON 帧；强制 UTF-8
for _stream in (sys.stdin, sys.stdout):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except Exception:  # pragma: no cover - 老解释器或非常规流
        pass

import httpx

from app.config import load_adapters_config
from app.core.event_bus import get_event_bus
from app.core.message_handler import set_message_handler
from app.core.registry import AdapterRegistry, set_global_registry
from app.core.startup import recover_interrupted_state
from app.db.engine import dispose_engine, init_database
from app.main import create_app
from app.orchestrator.engine import OrchestratorEngine
from app.schemas import WSEvent
from app.services.preview import get_preview_manager


def _write_frame(frame: dict[str, Any]) -> None:
    """整行写出一帧 JSON。asyncio 单线程内 write+flush 之间无 await，天然原子。"""
    sys.stdout.write(json.dumps(frame, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


async def _on_event(event: WSEvent) -> None:
    """EventBus 订阅者：把业务事件转成 stdout 事件帧（替代 ConnectionManager 推送）。"""
    _write_frame({"kind": "event", "event": event.to_payload()})


async def _startup(app: Any) -> None:
    """复刻 app.main:lifespan 的启动序列（ASGITransport 不触发 lifespan，手动跑）。"""
    await init_database()
    try:
        await recover_interrupted_state()
    except Exception:
        logger.warning("启动自愈失败（已跳过，不阻断启动）", exc_info=True)

    registry = AdapterRegistry()
    registry.load_from_config(load_adapters_config())
    app.state.registry = registry  # health 路由读取 request.app.state.registry
    set_global_registry(registry)

    set_message_handler(OrchestratorEngine())
    logger.info("AgentHub bridge started: adapters=%s", registry.list_adapters())


async def _handle(client: httpx.AsyncClient, frame: dict[str, Any]) -> None:
    frame_id = frame.get("id")
    kind = frame.get("kind")
    try:
        if kind == "send_message":
            # 复用原 WebSocket 的发送逻辑（持久化用户消息 + 派发可插拔消息处理器）
            from app.api.ws.session import handle_send_message

            await handle_send_message(frame.get("payload") or {})
            _write_frame(
                {"id": frame_id, "kind": "response", "status": 200, "body": {"ok": True}}
            )
            return

        method = str(frame.get("method", "GET")).upper()
        path = frame.get("path") or "/"
        body = frame.get("body")
        resp = await client.request(
            method, path, json=body if body is not None else None
        )
        text = resp.text
        parsed = json.loads(text) if text else None
        _write_frame(
            {"id": frame_id, "kind": "response", "status": resp.status_code, "body": parsed}
        )
    except Exception as exc:  # 单帧失败不拖垮整条通道
        logger.exception("bridge 处理请求失败")
        _write_frame(
            {"id": frame_id, "kind": "response", "status": 500, "body": {"error": str(exc)}}
        )


def _spawn_stdin_reader(loop: asyncio.AbstractEventLoop, queue: "asyncio.Queue[str | None]") -> None:
    """在独立线程阻塞读 stdin（Windows 管道 + Proactor 下最稳），逐行投递到事件循环。"""

    def reader() -> None:
        for line in sys.stdin:
            loop.call_soon_threadsafe(queue.put_nowait, line)
        loop.call_soon_threadsafe(queue.put_nowait, None)  # EOF：父进程已关闭管道

    threading.Thread(target=reader, name="bridge-stdin", daemon=True).start()


async def main() -> None:
    app = create_app()
    await _startup(app)
    get_event_bus().subscribe(_on_event)

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://agenthub.bridge", timeout=None
    ) as client:
        _write_frame({"kind": "ready"})

        loop = asyncio.get_running_loop()
        queue: "asyncio.Queue[str | None]" = asyncio.Queue()
        _spawn_stdin_reader(loop, queue)

        pending: set[asyncio.Task[None]] = set()
        while True:
            line = await queue.get()
            if line is None:
                break
            line = line.strip()
            if not line:
                continue
            try:
                frame = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("丢弃非法 JSON 帧")
                continue
            task = asyncio.create_task(_handle(client, frame))
            pending.add(task)
            task.add_done_callback(pending.discard)

    # stdin 关闭 = 父进程退出：清理子进程与数据库连接
    await get_preview_manager().stop_all()
    await dispose_engine()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
