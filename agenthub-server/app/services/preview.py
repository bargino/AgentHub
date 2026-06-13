"""Preview 服务（PRD §4.2）：workspace 内启动 dev server 并返回预览地址。

仅允许白名单命令；每会话至多一个 dev server 进程；日志环形缓冲供前端拉取。
"""

from __future__ import annotations

import asyncio
import logging
import socket
from collections import deque
from dataclasses import dataclass, field

from app.core.event_bus import get_event_bus
from app.schemas import WSEvent

logger = logging.getLogger(__name__)

BASE_PORT = 5173
MAX_PORT_SCAN = 50
STARTUP_TIMEOUT = 60.0
LOG_BUFFER_SIZE = 200


@dataclass
class PreviewProcess:
    conversation_id: str
    port: int
    process: asyncio.subprocess.Process
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=LOG_BUFFER_SIZE))

    @property
    def url(self) -> str:
        return f"http://localhost:{self.port}"

    @property
    def running(self) -> bool:
        return self.process.returncode is None


class PreviewManager:
    def __init__(self) -> None:
        self._processes: dict[str, PreviewProcess] = {}

    def _find_free_port(self) -> int:
        for port in range(BASE_PORT, BASE_PORT + MAX_PORT_SCAN):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(("127.0.0.1", port)) != 0:
                    return port
        raise RuntimeError("No free port available for preview")

    async def start(self, conversation_id: str, workspace_path: str) -> PreviewProcess:
        """启动 dev server。已运行则直接返回；旧进程已退出则重启。"""
        existing = self._processes.get(conversation_id)
        if existing and existing.running:
            return existing
        if existing:
            self._processes.pop(conversation_id, None)

        port = self._find_free_port()
        # 白名单命令：npm run dev（端口通过 vite 约定参数传递）
        command = f"npm run dev -- --port {port} --strictPort"

        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=workspace_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        preview = PreviewProcess(conversation_id=conversation_id, port=port, process=proc)
        self._processes[conversation_id] = preview

        asyncio.create_task(self._pump_logs(preview))

        ready = await self._wait_ready(preview)
        if ready:
            await get_event_bus().publish(
                WSEvent(
                    type="preview.started",
                    conversation_id=conversation_id,
                    data={"previewUrl": preview.url, "port": port},
                )
            )
            return preview

        await self.stop(conversation_id)
        await get_event_bus().publish(
            WSEvent(
                type="preview.failed",
                conversation_id=conversation_id,
                data={"error": "dev server 启动超时", "logs": list(preview.logs)[-20:]},
            )
        )
        raise RuntimeError("Preview dev server failed to start")

    async def _pump_logs(self, preview: PreviewProcess) -> None:
        assert preview.process.stdout is not None
        try:
            async for raw in preview.process.stdout:
                line = raw.decode("utf-8", "replace").rstrip()
                preview.logs.append(line)
        except Exception:
            logger.debug("Log pump ended for %s", preview.conversation_id)

    async def _wait_ready(self, preview: PreviewProcess) -> bool:
        """轮询端口连通即视为就绪。"""
        deadline = asyncio.get_event_loop().time() + STARTUP_TIMEOUT
        while asyncio.get_event_loop().time() < deadline:
            if not preview.running:
                return False
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                if s.connect_ex(("127.0.0.1", preview.port)) == 0:
                    return True
            await asyncio.sleep(0.5)
        return False

    async def stop(self, conversation_id: str) -> bool:
        preview = self._processes.pop(conversation_id, None)
        if not preview:
            return False
        if preview.running:
            preview.process.kill()
            try:
                await asyncio.wait_for(preview.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                pass
        return True

    def get(self, conversation_id: str) -> PreviewProcess | None:
        return self._processes.get(conversation_id)

    def get_logs(self, conversation_id: str) -> list[str]:
        preview = self._processes.get(conversation_id)
        return list(preview.logs) if preview else []

    async def stop_all(self) -> None:
        for cid in list(self._processes):
            await self.stop(cid)


_manager: PreviewManager | None = None


def get_preview_manager() -> PreviewManager:
    global _manager
    if _manager is None:
        _manager = PreviewManager()
    return _manager
