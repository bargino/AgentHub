"""Preview 服务（PRD §4.2）：workspace 内启动 dev server 并返回预览地址。

仅允许白名单命令；每会话至多一个 dev server 进程；日志环形缓冲供前端拉取。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from app.core.event_bus import get_event_bus
from app.schemas import WSEvent

logger = logging.getLogger(__name__)

BASE_PORT = 5173
MAX_PORT_SCAN = 50
# 端口就绪等待上限（秒），可经环境变量 PREVIEW_STARTUP_TIMEOUT 覆盖
STARTUP_TIMEOUT = float(os.environ.get("PREVIEW_STARTUP_TIMEOUT", "60"))
LOG_BUFFER_SIZE = 200

# 启动级致命信号：命中即判定 dev server 不会再正常起来，提前结束等待、避免耗满超时。
# 仅收“启动失败”类信号，刻意不含 Vite 应用级报错（如 [vite] Internal server error），
# 因为那类情况 dev server 仍会照常监听端口、应判成功。
_FATAL_LOG_SIGNALS = (
    "EADDRINUSE",          # 端口被占用
    "npm ERR!",            # npm 启动失败
    "ELIFECYCLE",          # npm 脚本异常退出
    "Cannot find module",  # Node 缺模块
    "is not recognized",   # Windows 英文 cmd：命令不存在
    "不是内部或外部命令",   # Windows 中文 cmd：命令不存在
    "command not found",   # POSIX shell：命令不存在
)

# 可识别的 Python web 入口文件（按优先级）
_PY_ENTRIES = ("app.py", "main.py", "wsgi.py", "server.py", "run.py")


@dataclass
class PreviewProcess:
    conversation_id: str
    port: int
    process: asyncio.subprocess.Process
    project_type: str = "node"
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=LOG_BUFFER_SIZE))

    @property
    def url(self) -> str:
        return f"http://localhost:{self.port}"

    @property
    def running(self) -> bool:
        return self.process.returncode is None


def detect_command(workspace: Path, port: int) -> tuple[str, str]:
    """识别项目类型并返回 (启动命令, project_type)。

    支持：vite/Node(package.json 含 dev/start)、Django(manage.py)、Flask(含 Flask 的入口)、
    纯静态(index.html)、通用 Python 入口(经 PORT 环境变量兜底)。识别失败 raise RuntimeError。
    端口均通过命令行/环境变量显式指定，保证 _wait_ready 轮询的端口与实际监听一致。
    """
    pkg = workspace / "package.json"
    if pkg.is_file():
        try:
            scripts = json.loads(pkg.read_text("utf-8", errors="replace")).get("scripts", {})
        except (OSError, json.JSONDecodeError):
            scripts = {}
        if "dev" in scripts:
            return f"npm run dev -- --port {port} --strictPort", "node"
        if "start" in scripts:
            return f"npm start -- --port {port}", "node"

    if (workspace / "manage.py").is_file():
        return f"python manage.py runserver 127.0.0.1:{port}", "django"

    for entry in _PY_ENTRIES:
        f = workspace / entry
        if not f.is_file():
            continue
        try:
            text = f.read_text("utf-8", errors="replace")
        except OSError:
            text = ""
        if "Flask" in text or "flask" in text:
            return f"python -m flask --app {entry[:-3]} run --host 127.0.0.1 --port {port}", "flask"
        # 通用 Python 入口：端口靠 PORT 环境变量兜底（许多框架支持）
        return f"python {entry}", "python"

    if (workspace / "index.html").is_file():
        return f"python -m http.server {port} --bind 127.0.0.1", "static"

    raise RuntimeError("无法识别项目类型：未找到 package.json(dev/start) / manage.py / app.py / index.html")


def _is_port_open(port: int, host: str = "localhost", timeout: float = 0.5) -> bool:
    """端口在 host 解析到的任一地址族（IPv4/IPv6）上可连即视为开放。

    与浏览器打开 http://localhost:{port} 的解析行为保持一致：Windows 上 localhost
    通常优先解析为 IPv6 ::1，Vite（默认 host=localhost）会绑到 ::1；若探针只连
    IPv4 127.0.0.1，会永远连不上、误判“进程在跑但端口未就绪”而触发启动超时。
    因此逐个地址族尝试连接，任一成功即视为就绪。
    """
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        infos = [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", port))]
    for family, socktype, proto, _canon, sockaddr in infos:
        try:
            with socket.socket(family, socktype, proto) as s:
                s.settimeout(timeout)
                if s.connect_ex(sockaddr) == 0:
                    return True
        except OSError:
            continue
    return False


def _scan_fatal_log(logs: Iterable[str]) -> str | None:
    """扫描日志，命中任一启动级致命信号则返回该信号文本，否则返回 None。"""
    for line in logs:
        for sig in _FATAL_LOG_SIGNALS:
            if sig in line:
                return sig
    return None


class PreviewManager:
    def __init__(self) -> None:
        self._processes: dict[str, PreviewProcess] = {}

    def _find_free_port(self) -> int:
        # 跨 IPv4/IPv6 判断占用：避免某端口仅在 ::1 上被占用却被误判为空闲，
        # 随后 dev server 因 --strictPort 绑定冲突而启动失败。
        for port in range(BASE_PORT, BASE_PORT + MAX_PORT_SCAN):
            if not _is_port_open(port, timeout=0.2):
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
        command, project_type = detect_command(Path(workspace_path), port)

        # 端口环境变量兜底：通用 Python / 部分框架读取 PORT/FLASK_RUN_PORT
        env = {**os.environ, "PORT": str(port), "FLASK_RUN_PORT": str(port)}
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=workspace_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        preview = PreviewProcess(
            conversation_id=conversation_id, port=port, process=proc, project_type=project_type
        )
        self._processes[conversation_id] = preview

        asyncio.create_task(self._pump_logs(preview))

        ready = await self._wait_ready(preview)
        if ready:
            await get_event_bus().publish(
                WSEvent(
                    type="preview.started",
                    conversation_id=conversation_id,
                    data={"previewUrl": preview.url, "port": port, "projectType": project_type},
                )
            )
            return preview

        # 必须在 stop() 杀进程前读取 returncode：kill 后 returncode 一律非 None，无法再区分
        # "进程已自行退出（依赖缺失/启动命令报错，秒崩）" 与 "端口始终未就绪（真超时）"。
        exit_code = preview.process.returncode
        logs_tail = list(preview.logs)[-20:]
        fatal_signal = _scan_fatal_log(preview.logs)
        await self.stop(conversation_id)
        if exit_code is not None:
            error_msg = (
                f"dev server 进程启动后退出（exit code={exit_code}），"
                "通常是依赖缺失或启动命令报错，请查看下方日志"
            )
        elif fatal_signal is not None:
            error_msg = (
                f"dev server 启动失败：日志命中致命信号「{fatal_signal}」"
                "（已提前结束等待，未耗满超时），请查看下方日志"
            )
        else:
            error_msg = (
                f"dev server 启动超时：{int(STARTUP_TIMEOUT)}s 内端口 {port} 未就绪"
                "（进程仍在运行但未监听该端口）"
            )
        await get_event_bus().publish(
            WSEvent(
                type="preview.failed",
                conversation_id=conversation_id,
                data={"error": error_msg, "logs": logs_tail},
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
        """轮询端口连通即视为就绪（跨 IPv4/IPv6）。

        提前失败的两种情况，避免无谓地耗满 STARTUP_TIMEOUT：
        - 进程已退出（returncode 非 None）；
        - 进程还活着但日志已命中启动级致命信号（_FATAL_LOG_SIGNALS）。
        端口连通优先于致命信号判定：只要端口起来了就算成功。
        """
        deadline = asyncio.get_event_loop().time() + STARTUP_TIMEOUT
        while asyncio.get_event_loop().time() < deadline:
            if not preview.running:
                return False
            if _is_port_open(preview.port):
                return True
            if _scan_fatal_log(preview.logs) is not None:
                return False
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
