"""CodexAdapter -- 基于 openai-codex SDK 底层 CodexClient 的真实执行适配器。

实测依据（2026-06-10，openai-codex 0.1.0b3，脚本见 Desktop/codex-sdk-test）：
- 高层 AsyncCodex / Codex 不透传 approval_handler（且其 ApprovalMode 仅
  deny_all / auto_review 两个自动档），人工审批门控必须用底层 CodexClient
- CodexClient(config, approval_handler) 公开可用；handler 在 reader 线程同步回调，
  签名 (method, params) -> {"decision": "accept" | "decline"}，两种决策均实测生效
- 审批请求 method：item/commandExecution/requestApproval（params 含 command/cwd/reason）
  与 item/fileChange/requestApproval（params 仅 itemId 引用，diff 需查 item 缓存）
- handler 阻塞会暂停该 client 实例的整个消息流，因此每次 execute 创建独立
  CodexClient 实例（借鉴 CodexMonitor 每 workspace 独立 app-server 的隔离思路）
- wire 层 approvalPolicy 支持 untrusted/on-failure/on-request/never 四档，
  本适配器统一用 on-request + handler 决策，三种 UnifiedApprovalMode 都收敛到
  handler 行为（自动放行 / 人工门控 / 自动拒绝），语义单一且全部可审计

设计要点：
- 同步 CodexClient 跑在独立 worker 线程，事件经 asyncio.Queue 桥接回事件循环
- 命令审批前置接入 command_whitelist 三级判定：ALLOWED 自动放行、BLOCKED 自动
  拦截、NEEDS_APPROVAL 走人工审批（与 PRD §10 安全模型对齐）
- 并发隔离：运行态按 execute_id 存放，审批等待表按 request_id 隔离，
  单例 adapter 支持多任务并发 execute
"""

from __future__ import annotations

import asyncio
import importlib.metadata
import json
import logging
import os
import re
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from app.adapters.base import (
    AdapterContext,
    ICodeAdapter,
    UnifiedApprovalMode,
    UnifiedEvent,
    UnifiedSandboxLevel,
)
from app.adapters.attachments import to_codex_items
from app.adapters.codex.notification_converter import ADAPTER_NAME, convert_notification
from app.config import LocalMCPConfig, load_mcp_servers
from app.security.command_whitelist import CommandVerdict, check_command

logger = logging.getLogger(__name__)

_TOML_BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def _provider_overrides(provider: dict) -> tuple[list[str], dict[str, str]]:
    """per-agent 供应商 -> (config_overrides, env)。

    base_url 定义独立 provider（agenthub），auth_token 经 env OPENAI_API_KEY 注入；
    wire_api 默认 responses（codex 0.137+ 已废弃 chat，见 codex discussions/7782）。
    未配 base_url 返回空（走 codex 本地登录态 / 默认 provider）。
    """
    overrides: list[str] = []
    env: dict[str, str] = {}
    if not isinstance(provider, dict):
        return overrides, env
    if provider.get("auth_token"):
        env["OPENAI_API_KEY"] = str(provider["auth_token"])
    if provider.get("base_url"):
        # 剥离引号防止破坏 -c key="value" 的 TOML 字面量
        base_url = str(provider["base_url"]).replace('"', "").replace("'", "")
        wire_api = str(provider.get("wire_api") or "responses").replace('"', "").replace("'", "")
        overrides.extend([
            'model_providers.agenthub.name="AgentHub Provider"',
            f'model_providers.agenthub.base_url="{base_url}"',
            'model_providers.agenthub.env_key="OPENAI_API_KEY"',
            f'model_providers.agenthub.wire_api="{wire_api}"',
            'model_provider="agenthub"',
        ])
    return overrides, env


def _mcp_config_overrides(servers: dict[str, Any] | None = None) -> list[str]:
    """MCP -> codex 子进程 -c 配置覆盖（TOML 字面量）。

    servers 非 None 时用 per-agent 解析集合，否则回退全局 config/mcp.yaml。
    json.dumps 的字符串/数组字面量与 TOML 兼容；env 转 inline table。
    codex app-server 仅支持 stdio 型 MCP，remote 类型跳过并告警。
    """
    source = servers if servers is not None else load_mcp_servers()
    overrides: list[str] = []
    for name, cfg in source.items():
        if not _TOML_BARE_KEY.match(name):
            logger.warning("MCP server 名 %s 含非法字符（仅限字母数字_-），已跳过", name)
            continue
        if not isinstance(cfg, LocalMCPConfig):
            logger.warning("MCP server %s 为 remote 类型，codex 执行器暂不支持，已跳过", name)
            continue
        overrides.append(f"mcp_servers.{name}.command={json.dumps(cfg.command, ensure_ascii=False)}")
        if cfg.args:
            overrides.append(f"mcp_servers.{name}.args={json.dumps(cfg.args, ensure_ascii=False)}")
        if cfg.env:
            inner = ", ".join(
                f"{k} = {json.dumps(str(v), ensure_ascii=False)}"
                for k, v in cfg.env.items()
                if _TOML_BARE_KEY.match(str(k))
            )
            if inner:
                overrides.append(f"mcp_servers.{name}.env={{{inner}}}")
    return overrides

SANDBOX_WIRE: dict[UnifiedSandboxLevel, str] = {
    UnifiedSandboxLevel.READ_ONLY: "read-only",
    UnifiedSandboxLevel.WORKSPACE_WRITE: "workspace-write",
    UnifiedSandboxLevel.FULL_ACCESS: "danger-full-access",
}

_APPROVAL_METHOD_COMMAND = "item/commandExecution/requestApproval"
_APPROVAL_METHOD_FILE_CHANGE = "item/fileChange/requestApproval"


def _auto_decision_event(
    decision: str,
    source: str,
    info: dict[str, Any],
    *,
    reason: str | None = None,
    risk_level: str = "low",
) -> UnifiedEvent:
    """自动审批决策（whitelist / policy）-> 独立 approval_auto 事件。

    与人工审批分流：approval_request / approval_resolved 严格只用于人工审批且成对，
    自动决策不再产生无配对的 resolved（对齐 AG-UI policy_hold≠human_approval、
    Claude SDK can_use_tool 仅在 ask 时触发）。decision 取 "allow" | "deny"。
    """
    data: dict[str, Any] = {
        "id": uuid.uuid4().hex,
        "decision": decision,
        "approved": decision == "allow",
        "source": source,
        **info,
    }
    if reason:
        data["reason"] = reason
    return UnifiedEvent(
        type="approval_auto", data=data, adapter=ADAPTER_NAME, risk_level=risk_level
    )


@dataclass
class _PendingApproval:
    event: threading.Event = field(default_factory=threading.Event)
    decision: str = "decline"


@dataclass
class _ActiveExecution:
    client: Any = None
    thread_id: str | None = None
    turn_id: str | None = None
    pending_ids: set[str] = field(default_factory=set)


class CodexAdapter(ICodeAdapter):
    def __init__(self, config: dict[str, Any] | None = None):
        self._config = config or {}
        self._approval_timeout_s = float(self._config.get("approval_timeout_s", 600))
        self._whitelist_precheck = bool(self._config.get("whitelist_precheck", True))
        # request_id -> 等待用户决策的审批；execute_id -> 在途执行运行态
        self._pending: dict[str, _PendingApproval] = {}
        self._active: dict[str, _ActiveExecution] = {}

    @property
    def name(self) -> str:
        return ADAPTER_NAME

    async def health_check(self) -> bool:
        try:
            from openai_codex.client import CodexClient  # noqa: F401

            return True
        except ImportError:
            return False

    def get_version(self) -> str | None:
        try:
            return importlib.metadata.version("openai-codex")
        except importlib.metadata.PackageNotFoundError:
            return None

    async def execute(self, ctx: AdapterContext) -> AsyncIterator[UnifiedEvent]:
        try:
            from openai_codex.client import CodexClient, CodexConfig
        except ImportError:
            yield UnifiedEvent(
                type="error",
                data={"error": "openai-codex SDK 未安装（pip install openai-codex）"},
                adapter=self.name,
            )
            return

        loop = asyncio.get_running_loop()
        events: asyncio.Queue[UnifiedEvent | None] = asyncio.Queue()
        execute_id = uuid.uuid4().hex
        active = _ActiveExecution()
        self._active[execute_id] = active
        # item_id -> changes 摘要，fileChange 审批弹窗据此展示 diff（跨线程只读）
        file_change_items: dict[str, Any] = {}
        final_parts: list[str] = []
        # turn 级累积状态（tokenUsage 等），turn/completed 终态事件统一携带
        turn_state: dict[str, Any] = {}

        def emit(ev: UnifiedEvent | None) -> None:
            loop.call_soon_threadsafe(events.put_nowait, ev)

        auto_decision: str | None = None
        if ctx.approval_mode == UnifiedApprovalMode.AUTO:
            auto_decision = "accept"
        elif ctx.approval_mode == UnifiedApprovalMode.DENY_ALL:
            auto_decision = "decline"

        def describe_request(method: str, params: dict[str, Any]) -> dict[str, Any]:
            """审批请求 -> approval_request 事件 data（对齐 executor/前端契约）。"""
            if method == _APPROVAL_METHOD_COMMAND:
                command = str(params.get("command", "") or "")
                reason = str(params.get("reason", "") or "")
                return {
                    "action_type": "run_command",
                    "summary": reason or f"执行命令：{command[:200]}",
                    "command": command,
                    "cwd": str(params.get("cwd", "") or ""),
                }
            if method == _APPROVAL_METHOD_FILE_CHANGE:
                item_id = str(params.get("itemId", "") or "")
                changes = file_change_items.get(item_id) or []
                paths = [c.get("path", "") for c in changes]
                summary = (
                    f"应用代码补丁（{len(paths)} 个文件）：{', '.join(paths[:5])}"
                    if paths else "应用代码补丁"
                )
                return {
                    "action_type": "apply_diff",
                    "summary": summary,
                    "changes": changes,
                    "item_id": item_id,
                }
            return {"action_type": method, "summary": f"Codex 请求：{method}"}

        def approval_handler(method: str, params: dict[str, Any] | None) -> dict[str, Any]:
            info = describe_request(method, params or {})

            # 白名单三级前置判定（仅命令执行）：ALLOWED 放行 / BLOCKED 拦截。
            # 自动决策走独立 approval_auto 事件（见 _auto_decision_event），不占用
            # approval_request/approval_resolved 人工审批通道。
            if (
                self._whitelist_precheck
                and method == _APPROVAL_METHOD_COMMAND
                and info.get("command")
            ):
                result = check_command(str(info["command"]))
                if result.verdict is CommandVerdict.ALLOWED:
                    emit(_auto_decision_event("allow", "whitelist", info))
                    return {"decision": "accept"}
                if result.verdict is CommandVerdict.BLOCKED:
                    emit(_auto_decision_event(
                        "deny", "whitelist", info,
                        reason=result.reason, risk_level="high",
                    ))
                    return {"decision": "decline"}

            if auto_decision is not None:
                emit(_auto_decision_event(
                    "allow" if auto_decision == "accept" else "deny", "policy", info
                ))
                return {"decision": auto_decision}

            # 人工审批桥：阻塞 reader 线程直到 resolve_approval 或超时
            request_id = uuid.uuid4().hex
            pending = _PendingApproval()
            self._pending[request_id] = pending
            active.pending_ids.add(request_id)
            emit(UnifiedEvent(
                type="approval_request",
                data={"request_id": request_id, **info},
                adapter=self.name,
                risk_level="medium",
            ))
            resolved = pending.event.wait(self._approval_timeout_s)
            decision = pending.decision if resolved else "decline"
            self._pending.pop(request_id, None)
            active.pending_ids.discard(request_id)
            emit(UnifiedEvent(
                type="approval_resolved",
                data={
                    "request_id": request_id,
                    "approved": decision == "accept",
                    "timeout": not resolved,
                    **info,
                },
                adapter=self.name,
            ))
            return {"decision": decision}

        wire_params: dict[str, Any] = {
            "approvalPolicy": "on-request",
            "sandbox": SANDBOX_WIRE.get(ctx.sandbox_level, "workspace-write"),
            "cwd": ctx.workspace_path,
        }
        model = ctx.model or self._config.get("default_model")
        if model:
            wire_params["model"] = model

        # per-agent 供应商：auth_token 经子进程 env 注入（与继承环境合并），
        # base_url 经 config_overrides 定义独立 provider（等价 CLI -c key=value），
        # 不写 ~/.codex 全局配置；未配置时走本地登录态
        sdk_env: dict[str, str] = {}
        # codex 隔离：配置独立 CODEX_HOME 时不读用户 ~/.codex（避免桌面端 / 切换工具写的
        # config 与 SDK 内置开源 codex CLI schema 冲突）；provider 全靠 override + env 注入
        codex_home = self._config.get("codex_home")
        if codex_home:
            codex_home = os.path.expanduser(str(codex_home))
            os.makedirs(codex_home, exist_ok=True)
            sdk_env["CODEX_HOME"] = codex_home
        # MCP 经 -c 覆盖注入子进程：优先 per-agent 解析集合，未限定回退全局
        overrides: list[str] = _mcp_config_overrides(ctx.mcp_servers)
        # 有效上下文窗口透传 codex（官方 model_context_window，override when unknown），
        # 让 codex 自身 auto-compact 用对窗口，与 agenthub 记忆层口径一致
        if ctx.context_window:
            overrides.append(f"model_context_window={int(ctx.context_window)}")
        # reasoning 摘要：请求 codex 产出推理摘要（item/reasoning/summaryTextDelta 增量），
        # 供前端 ThinkingCard 展示思考过程。需模型支持 Responses 推理摘要且网关转发该事件；
        # 不支持时 codex 静默不产出（不影响正常执行）。
        overrides.append('model_reasoning_summary="auto"')
        overrides.append("model_supports_reasoning_summaries=true")
        # per-agent 供应商：base_url 定义独立 provider，auth_token 经 env 注入，wire_api 可配
        prov_overrides, prov_env = _provider_overrides(ctx.provider or {})
        overrides.extend(prov_overrides)
        sdk_env.update(prov_env)

        def worker() -> None:
            client = None
            try:
                codex_bin = self._config.get("codex_bin")
                cfg = CodexConfig(
                    codex_bin=codex_bin,
                    config_overrides=tuple(overrides),
                    env=sdk_env or None,
                )
                client = CodexClient(config=cfg, approval_handler=approval_handler)
                active.client = client
                client.start()
                client.initialize()

                if ctx.session_id:
                    resumed = client.thread_resume(ctx.session_id, wire_params)
                    thread_id = resumed.thread.id
                else:
                    started = client.thread_start(wire_params)
                    thread_id = started.thread.id
                active.thread_id = thread_id
                emit(UnifiedEvent(
                    type="started",
                    data={"thread_id": thread_id, "resumed": bool(ctx.session_id)},
                    adapter=self.name,
                ))

                # 多模态：有图片附件时 input_items=[text + localImage...]（turn_start 接
                # list[dict]，见 openai_codex._inputs），否则保持纯文本字符串
                codex_items = to_codex_items(ctx.attachments)
                if codex_items:
                    turn = client.turn_start(
                        thread_id,
                        [{"type": "text", "text": ctx.instructions}, *codex_items],
                    )
                else:
                    turn = client.turn_start(thread_id, ctx.instructions)
                turn_id = turn.turn.id
                active.turn_id = turn_id

                while True:
                    notification = client.next_turn_notification(turn_id)
                    for ev in convert_notification(
                        notification, file_change_items, final_parts, turn_state
                    ):
                        emit(ev)
                    if getattr(notification, "method", "") == "turn/completed":
                        break
            except BaseException as e:  # noqa: BLE001 -- worker 线程兜底，必须转事件
                logger.exception("Codex worker failed")
                emit(UnifiedEvent(
                    type="error",
                    data={"error": str(e), "error_type": type(e).__name__},
                    adapter=self.name,
                ))
            finally:
                if client is not None:
                    try:
                        client.close()
                    except Exception:
                        logger.warning("Codex client close failed", exc_info=True)
                emit(None)

        thread = threading.Thread(
            target=worker, daemon=True, name=f"codex-exec-{execute_id[:8]}"
        )
        thread.start()
        try:
            while True:
                ev = await events.get()
                if ev is None:
                    break
                yield ev
        finally:
            # 消费方提前退出（如任务取消）时解除 reader 线程的审批阻塞，worker 自然收尾
            for request_id in list(active.pending_ids):
                pending = self._pending.pop(request_id, None)
                if pending is not None:
                    pending.decision = "decline"
                    pending.event.set()
            self._active.pop(execute_id, None)

    async def resolve_approval(self, request_id: str, approved: bool) -> bool:
        pending = self._pending.get(request_id)
        if pending is None:
            logger.warning("Codex approval %s not found (timeout or resolved)", request_id)
            return False
        pending.decision = "accept" if approved else "decline"
        pending.event.set()
        return True

    async def interrupt(self) -> bool:
        """中断全部在途执行：先解除审批阻塞，再发 turn/interrupt。"""
        interrupted = False
        for active in list(self._active.values()):
            for request_id in list(active.pending_ids):
                pending = self._pending.get(request_id)
                if pending is not None:
                    pending.decision = "decline"
                    pending.event.set()
            client = active.client
            if client is None or not active.thread_id or not active.turn_id:
                continue
            try:
                await asyncio.to_thread(
                    client.turn_interrupt, active.thread_id, active.turn_id
                )
                interrupted = True
            except Exception:
                logger.exception("Failed to interrupt Codex turn %s", active.turn_id)
        return interrupted
