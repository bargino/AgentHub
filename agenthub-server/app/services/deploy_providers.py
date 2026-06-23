"""可插拔部署 Provider（Epic D · 全真实，无 mock）：本地 docker / 远程服务器。

设计要点（实际使用导向，便于排查真实场景）：
- 默认 `docker`（真实执行；已移除 mock 桩，不再有假成功路径）。
- provider 命令经注入式 `runner`（默认真实子进程，带超时）执行，由部署审批门控
  （deployer 任务强制 requires_approval + /deployments/{id}/approve 人工放行）。
  部署命令属「用户批准的基础设施操作」，与 agent 任意工具调用是不同信任域，不走 command_whitelist。
- 缺必要配置 → build_plan 抛 ValueError，由上层暴露为真实错误（不再静默回退/假成功）。
- 命令以字符串承载（plan/前端友好）；真实执行用 shell，配置视为用户自有（单机桌面信任边界）。
"""

from __future__ import annotations

import asyncio
import logging
import re
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

# 单步部署命令超时（秒）：防止卡死的部署步骤永久挂起
_DEPLOY_STEP_TIMEOUT_S = 600

# (command, cwd) -> (exit_code, output)
CommandRunner = Callable[[str, "str | None"], Awaitable["tuple[int, str]"]]

EmitLog = Callable[[str], None]


def _slug(name: str) -> str:
    """项目名 -> 安全的 docker tag 片段（小写字母数字与 - _ .），兜底 app。"""
    s = re.sub(r"[^a-z0-9_.-]+", "-", (name or "").strip().lower()).strip("-")
    return s or "app"


async def run_subprocess(command: str, cwd: str | None = None) -> tuple[int, str]:
    """真实部署命令执行：异步 shell + 超时 + 合并 stdout/stderr。"""
    proc = await asyncio.create_subprocess_shell(
        command,
        cwd=cwd or None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(
            proc.communicate(), timeout=_DEPLOY_STEP_TIMEOUT_S
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, f"步骤超时（>{_DEPLOY_STEP_TIMEOUT_S}s）"
    return int(proc.returncode or 0), (out or b"").decode("utf-8", "replace")


class DeployProvider(ABC):
    name: str = "base"

    @abstractmethod
    def build_plan(self, project_name: str, config: dict[str, Any]) -> dict[str, Any]:
        """构建部署计划 {target, steps:[{name, command}], rollback, project, config}。"""

    @abstractmethod
    async def execute(
        self, plan: dict[str, Any], *, runner: CommandRunner, emit_log: EmitLog | None = None
    ) -> tuple[str, str | None, str]:
        """执行计划，返回 (status, result_url, logs)。status ∈ success | failed。"""


async def _run_steps(
    plan: dict[str, Any], runner: CommandRunner, emit_log: EmitLog | None
) -> tuple[str, str]:
    """逐步执行真实 provider 的命令；任一步非零退出即失败并停止。"""
    cwd = (plan.get("config") or {}).get("cwd")
    lines: list[str] = []

    def _log(line: str) -> None:
        lines.append(line)
        if emit_log is not None:
            emit_log(line)

    for step in plan.get("steps", []):
        command = str(step.get("command", ""))
        code, out = await runner(command, cwd)
        tag = "ok" if code == 0 else "fail"
        _log(f"[{tag}] {step.get('name', command)}: {out.strip()[:1000]}")
        if code != 0:
            return "failed", "\n".join(lines)
    return "success", "\n".join(lines)


class DockerDeployProvider(DeployProvider):
    name = "docker"

    def build_plan(self, project_name: str, config: dict[str, Any]) -> dict[str, Any]:
        cfg = config or {}
        image = str(cfg.get("image") or f"{_slug(project_name)}:latest")
        context = str(cfg.get("context") or ".")
        port = str(cfg.get("port") or "8080")
        container = str(cfg.get("container") or _slug(project_name))
        return {
            "target": f"docker:{image}",
            "steps": [
                {"name": "构建镜像", "command": f"docker build -t {image} {context}"},
                {"name": "停止旧容器", "command": f"docker rm -f {container}"},
                {
                    "name": "运行容器",
                    "command": f"docker run -d --name {container} -p {port}:{port} {image}",
                },
            ],
            "rollback": f"docker rm -f {container}",
            "project": project_name,
            "config": {"cwd": cfg.get("cwd"), "result_url": cfg.get("result_url")},
        }

    async def execute(
        self, plan: dict[str, Any], *, runner: CommandRunner, emit_log: EmitLog | None = None
    ) -> tuple[str, str | None, str]:
        status, logs = await _run_steps(plan, runner, emit_log)
        result_url = (plan.get("config") or {}).get("result_url") if status == "success" else None
        return status, result_url, logs


class RemoteServerDeployProvider(DeployProvider):
    """远程服务器部署：步骤命令来自用户配置（config.steps 或 host+command 模板）。"""

    name = "remote"

    def build_plan(self, project_name: str, config: dict[str, Any]) -> dict[str, Any]:
        cfg = config or {}
        steps = cfg.get("steps")
        if isinstance(steps, list) and steps:
            norm_steps = [
                {"name": str(s.get("name", "部署步骤")), "command": str(s.get("command", ""))}
                for s in steps
                if isinstance(s, dict) and s.get("command")
            ]
        else:
            host = str(cfg.get("host") or "").strip()
            command = str(cfg.get("command") or "").strip()
            if not host or not command:
                raise ValueError("remote provider 需配置 host + command（或 steps 列表）")
            user = str(cfg.get("user") or "deploy")
            norm_steps = [
                {"name": "远程部署", "command": f"ssh {user}@{host} {command}"}
            ]
        if not norm_steps:
            raise ValueError("remote provider 未提供有效部署步骤")
        return {
            "target": f"remote:{cfg.get('host', 'custom')}",
            "steps": norm_steps,
            "rollback": str(cfg.get("rollback") or "（请在远端执行回滚脚本）"),
            "project": project_name,
            "config": {"cwd": cfg.get("cwd"), "result_url": cfg.get("result_url")},
        }

    async def execute(
        self, plan: dict[str, Any], *, runner: CommandRunner, emit_log: EmitLog | None = None
    ) -> tuple[str, str | None, str]:
        status, logs = await _run_steps(plan, runner, emit_log)
        result_url = (plan.get("config") or {}).get("result_url") if status == "success" else None
        return status, result_url, logs


_PROVIDERS: dict[str, DeployProvider] = {
    p.name: p for p in (DockerDeployProvider(), RemoteServerDeployProvider())
}


def available_providers() -> list[str]:
    return list(_PROVIDERS)


def get_provider(name: str | None) -> DeployProvider:
    """按名取 provider；未知/空 → docker（真实默认，已移除 mock 桩）。"""
    return _PROVIDERS.get((name or "docker").strip().lower(), _PROVIDERS["docker"])
