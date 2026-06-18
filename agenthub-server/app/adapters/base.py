from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Literal, Optional


class UnifiedApprovalMode(str, Enum):
    AUTO = "auto"
    REVIEW_EDITS = "review_edits"
    DENY_ALL = "deny_all"


class UnifiedSandboxLevel(str, Enum):
    READ_ONLY = "read_only"
    WORKSPACE_WRITE = "workspace_write"
    FULL_ACCESS = "full_access"


EventType = Literal[
    "started",
    "thinking",
    "text_delta",
    "tool_call",
    "approval_request",
    "approval_resolved",
    "approval_auto",
    "diff_update",
    "file_change",
    "completed",
    "error",
    # 瞬时错误（SDK 自动重试中，will_retry）：走 ephemeral 通道，不落消息/不污染上下文
    "transient_error",
]


@dataclass
class UnifiedEvent:
    type: EventType
    data: dict[str, Any]
    adapter: str
    risk_level: str = "low"

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "data": self.data,
            "adapter": self.adapter,
            "risk_level": self.risk_level,
        }


@dataclass
class AdapterContext:
    instructions: str
    workspace_path: str
    approval_mode: UnifiedApprovalMode = UnifiedApprovalMode.REVIEW_EDITS
    sandbox_level: UnifiedSandboxLevel = UnifiedSandboxLevel.WORKSPACE_WRITE
    model: Optional[str] = None
    # 独立 API 供应商 {"base_url": str, "auth_token": str, "wire_api"?: str}
    # （None/空 = 本地 SDK 登录态）；codex 用 wire_api（默认 chat，可配 responses）。
    # 由各 adapter 映射为 SDK 子进程 env / config_overrides，实现 per-agent 隔离
    provider: Optional[dict[str, str]] = None
    # 会话级技能覆盖："all" | [技能名] | "off"（关闭）| None（跟随全局配置）
    skills: Optional[Any] = None
    allowed_tools: Optional[list[str]] = None
    session_id: Optional[str] = None
    # 该 agent 有效上下文窗口 token 数（context_builder 解析：显式配置 > 查表 > 默认）；
    # codex 透传为 model_context_window，让 CLI 自身 compact 用对窗口
    context_window: Optional[int] = None
    # 该 agent 解析后的 MCP 服务器集合（context_builder 按 capabilities.mcp_servers
    # 允许清单过滤全局配置）；None = 未限定，adapter 回退全局 load_mcp_servers()
    mcp_servers: Optional[dict[str, Any]] = None
    # 多模态附件（统一契约）：[{type:"image", mime, path, filename?}]，落盘存路径；
    # 各 adapter 转换为自身 SDK 图片输入（claude=base64 block / codex=本地路径）。
    # None/空 = 纯文本，行为与改动前完全一致。
    attachments: Optional[list[dict[str, Any]]] = None
    # ① 稳定前缀（角色系统提示 + 安全约束 + 规则/宪法）：claude 走 system_prompt preset+append
    # 享自动 prompt 缓存；codex 前置拼到 turn 内容。None = 不拆分（行为同前）。
    system_prompt: Optional[str] = None


class ICodeAdapter(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        ...

    @abstractmethod
    async def execute(
        self,
        ctx: AdapterContext,
    ) -> AsyncIterator[UnifiedEvent]:
        ...

    @abstractmethod
    async def resolve_approval(self, request_id: str, approved: bool) -> bool:
        ...

    @abstractmethod
    async def interrupt(self) -> bool:
        ...

    @property
    def light_model(self) -> str | None:
        """#6 内部轻量 LLM 任务（规划/摘要）用的小模型；None = 回退默认模型。"""
        return getattr(self, "_config", {}).get("light_model")
