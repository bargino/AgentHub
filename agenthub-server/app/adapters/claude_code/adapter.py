from __future__ import annotations

import asyncio
import importlib.metadata
import logging
import shutil
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    SystemMessage,
)

from app.adapters.base import (
    AdapterContext,
    ICodeAdapter,
    UnifiedApprovalMode,
    UnifiedEvent,
)
from app.adapters.attachments import to_claude_blocks
from app.adapters.claude_code.hooks import build_hooks
from app.adapters.claude_code.message_converter import convert_message
from app.config import LocalMCPConfig, load_mcp_servers

logger = logging.getLogger(__name__)

PERMISSION_MODE_MAP: dict[UnifiedApprovalMode, str] = {
    UnifiedApprovalMode.AUTO: "auto",
    UnifiedApprovalMode.REVIEW_EDITS: "acceptEdits",
    UnifiedApprovalMode.DENY_ALL: "dontAsk",
}


@dataclass
class _ActiveExecution:
    """单次 execute 运行态；单例 adapter 上多任务并发时按 execution_tag 隔离。"""

    tag: str
    client: ClaudeSDKClient | None = None
    session_id: str | None = None
    pending_approvals: dict[str, asyncio.Event] = field(default_factory=dict)
    approval_decisions: dict[str, bool] = field(default_factory=dict)
    pending_ids: set[str] = field(default_factory=set)


class ClaudeCodeAdapter(ICodeAdapter):
    def __init__(self, config: dict[str, Any] | None = None):
        self._config = config or {}
        self._active: dict[str, _ActiveExecution] = {}

    @property
    def name(self) -> str:
        return "claude-code"

    async def health_check(self) -> bool:
        try:
            import claude_agent_sdk  # noqa: F401
        except ImportError:
            return False
        return shutil.which("claude") is not None

    def get_version(self) -> str | None:
        try:
            return importlib.metadata.version("claude-agent-sdk")
        except importlib.metadata.PackageNotFoundError:
            return None

    def _execution_key(self, ctx: AdapterContext) -> str:
        return ctx.execution_tag or uuid.uuid4().hex

    async def execute(self, ctx: AdapterContext) -> AsyncIterator[UnifiedEvent]:
        execute_key = self._execution_key(ctx)
        active = _ActiveExecution(tag=execute_key)
        self._active[execute_key] = active

        permission_mode = PERMISSION_MODE_MAP.get(ctx.approval_mode, "acceptEdits")
        collected_events: list[UnifiedEvent] = []

        def on_hook_event(event: UnifiedEvent) -> None:
            collected_events.append(event)

        hooks = build_hooks(
            ctx.approval_mode,
            on_hook_event,
            active.pending_approvals,
            active.approval_decisions,
            workspace_path=ctx.workspace_path,
            on_pending_register=active.pending_ids.add,
            on_pending_clear=active.pending_ids.discard,
        )

        env: dict[str, str] = {}
        provider = ctx.provider or {}
        if provider.get("base_url"):
            env["ANTHROPIC_BASE_URL"] = provider["base_url"]
        if provider.get("auth_token"):
            env["ANTHROPIC_AUTH_TOKEN"] = provider["auth_token"]

        setting_sources = self._config.get("setting_sources")
        skills = self._config.get("skills")
        if ctx.skills is not None:
            skills = None if ctx.skills == "off" else ctx.skills

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
        if ctx.system_prompt:
            options.system_prompt = {
                "type": "preset",
                "preset": "claude_code",
                "append": ctx.system_prompt,
            }

        yield UnifiedEvent(type="started", data={"execution_tag": execute_key}, adapter=self.name)

        try:
            async with ClaudeSDKClient(options=options) as client:
                active.client = client
                image_blocks = to_claude_blocks(ctx.attachments)
                if image_blocks:
                    content_blocks = [{"type": "text", "text": ctx.instructions}, *image_blocks]

                    async def _attachment_stream() -> AsyncIterator[dict[str, Any]]:
                        yield {
                            "type": "user",
                            "message": {"role": "user", "content": content_blocks},
                        }

                    await client.query(_attachment_stream())
                else:
                    await client.query(ctx.instructions)

                async for message in client.receive_response():
                    if isinstance(message, SystemMessage):
                        subtype = getattr(message, "subtype", "")
                        if subtype == "init":
                            data = getattr(message, "data", {})
                            if isinstance(data, dict):
                                active.session_id = data.get("session_id")

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
            for request_id in list(active.pending_ids):
                event = active.pending_approvals.pop(request_id, None)
                if event is not None:
                    active.approval_decisions.setdefault(request_id, False)
                    event.set()
            active.client = None
            self._active.pop(execute_key, None)

    async def resolve_approval(self, request_id: str, approved: bool) -> bool:
        for active in self._active.values():
            event = active.pending_approvals.get(request_id)
            if event is not None:
                active.approval_decisions[request_id] = approved
                event.set()
                return True
        return False

    async def interrupt(self, execution_tag: str | None = None) -> bool:
        """中断在途执行；execution_tag 指定时仅取消该次 execute。"""
        targets = (
            [self._active[execution_tag]]
            if execution_tag and execution_tag in self._active
            else list(self._active.values())
        )
        interrupted = False
        for active in targets:
            for request_id in list(active.pending_ids):
                event = active.pending_approvals.get(request_id)
                if event is not None:
                    active.approval_decisions.setdefault(request_id, False)
                    event.set()
            client = active.client
            if client is None:
                continue
            try:
                await client.interrupt()
                interrupted = True
            except Exception:
                logger.exception("Failed to interrupt Claude Code (tag=%s)", active.tag)
        return interrupted
