from __future__ import annotations

import asyncio
import importlib.metadata
import logging
from typing import Any, AsyncIterator

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    SystemMessage,
)

from app.adapters.base import (
    AdapterContext,
    ICodeAdapter,
    UnifiedApprovalMode,
    UnifiedEvent,
)
from app.adapters.claude_code.hooks import build_hooks
from app.adapters.claude_code.message_converter import convert_message
from app.config import LocalMCPConfig, load_mcp_servers

logger = logging.getLogger(__name__)

PERMISSION_MODE_MAP: dict[UnifiedApprovalMode, str] = {
    UnifiedApprovalMode.AUTO: "auto",
    UnifiedApprovalMode.REVIEW_EDITS: "acceptEdits",
    UnifiedApprovalMode.DENY_ALL: "dontAsk",
}


class ClaudeCodeAdapter(ICodeAdapter):
    def __init__(self, config: dict[str, Any] | None = None):
        self._config = config or {}
        self._client: ClaudeSDKClient | None = None
        self._pending_approvals: dict[str, asyncio.Event] = {}
        self._approval_decisions: dict[str, bool] = {}
        self._session_id: str | None = None
        self._event_callbacks: list = []

    @property
    def name(self) -> str:
        return "claude-code"

    async def health_check(self) -> bool:
        try:
            import claude_agent_sdk  # noqa: F401

            return True
        except ImportError:
            return False

    def get_version(self) -> str | None:
        try:
            return importlib.metadata.version("claude-agent-sdk")
        except importlib.metadata.PackageNotFoundError:
            return None

    async def execute(self, ctx: AdapterContext) -> AsyncIterator[UnifiedEvent]:
        self._pending_approvals.clear()
        self._approval_decisions.clear()

        permission_mode = PERMISSION_MODE_MAP.get(ctx.approval_mode, "acceptEdits")

        collected_events: list[UnifiedEvent] = []

        def on_hook_event(event: UnifiedEvent) -> None:
            collected_events.append(event)

        # 所有审批模式（含 AUTO）都装安全 hook：白名单硬拦截 + 路径围栏始终生效
        hooks = build_hooks(
            ctx.approval_mode,
            on_hook_event,
            self._pending_approvals,
            self._approval_decisions,
            workspace_path=ctx.workspace_path,
        )

        # per-agent 供应商：经子进程 env 注入（SDK 与继承环境合并），
        # 不写 ~/.claude 全局配置，未配置时走本地登录态
        env: dict[str, str] = {}
        provider = ctx.provider or {}
        if provider.get("base_url"):
            env["ANTHROPIC_BASE_URL"] = provider["base_url"]
        if provider.get("auth_token"):
            env["ANTHROPIC_AUTH_TOKEN"] = provider["auth_token"]

        # 设置来源（user=~/.claude 全局规则与 skills；project=workspace 内
        # CLAUDE.md/.claude/），SDK 默认 None 是完全隔离，由 adapters.yaml 开启
        setting_sources = self._config.get("setting_sources")
        # 会话级技能覆盖全局："off" 关闭，其余（"all"/列表）直接生效
        skills = self._config.get("skills")
        if ctx.skills is not None:
            skills = None if ctx.skills == "off" else ctx.skills
        # MCP 配置：优先用 context_builder 解析的 per-agent 集合，未限定则回退全局
        # （config/mcp.yaml）。local -> stdio，remote -> http 直传 SDK
        mcp_source = ctx.mcp_servers if ctx.mcp_servers is not None else load_mcp_servers()
        mcp_servers: dict[str, dict[str, Any]] = {}
        for name, cfg in mcp_source.items():
            if isinstance(cfg, LocalMCPConfig):
                entry: dict[str, Any] = {"type": "stdio", "command": cfg.command}
                if cfg.args:
                    entry["args"] = cfg.args
                if cfg.env:
                    entry["env"] = cfg.env
            else:
                entry = {"type": "http", "url": cfg.url}
                if cfg.headers:
                    entry["headers"] = cfg.headers
            mcp_servers[name] = entry

        allowed_tools = list(
            ctx.allowed_tools
            or self._config.get(
                "default_allowed_tools",
                ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
            )
        )
        # MCP 工具按 server 维度放行（mcp__<name> 前缀通配）
        allowed_tools += [f"mcp__{name}" for name in mcp_servers]

        options = ClaudeAgentOptions(
            allowed_tools=allowed_tools,
            permission_mode=permission_mode,
            model=ctx.model or self._config.get("default_model"),
            resume=ctx.session_id,
            hooks=hooks,
            cwd=ctx.workspace_path,
            env=env,
            setting_sources=setting_sources,
            skills=skills,
            mcp_servers=mcp_servers,
        )

        yield UnifiedEvent(type="started", data={}, adapter=self.name)

        try:
            async with ClaudeSDKClient(options=options) as client:
                self._client = client
                await client.query(ctx.instructions)

                async for message in client.receive_response():
                    if isinstance(message, SystemMessage):
                        subtype = getattr(message, "subtype", "")
                        if subtype == "init":
                            data = getattr(message, "data", {})
                            if isinstance(data, dict):
                                self._session_id = data.get("session_id")

                    events = convert_message(message)
                    for event in events:
                        yield event

                    while collected_events:
                        yield collected_events.pop(0)

        except Exception as e:
            logger.exception("Claude Code execution error")
            yield UnifiedEvent(
                type="error",
                data={"error": str(e), "error_type": type(e).__name__},
                adapter=self.name,
            )
        finally:
            self._client = None

    async def resolve_approval(self, request_id: str, approved: bool) -> bool:
        self._approval_decisions[request_id] = approved
        event = self._pending_approvals.get(request_id)
        if event:
            event.set()
            return True
        return False

    async def interrupt(self) -> bool:
        if self._client:
            try:
                await self._client.interrupt()
                return True
            except Exception:
                logger.exception("Failed to interrupt Claude Code")
        return False
