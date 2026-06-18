"""业务层 API 契约（REST + WebSocket 共用）。

所有输出模型序列化为 camelCase JSON，与前端 TypeScript 类型直接对齐。
适配器层契约见 app/adapters/schemas.py（两个域不混用）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ---------------- 域类型 ----------------

MessageType = Literal["user", "agent", "thinking", "system", "tool", "approval", "error"]
TaskStatus = Literal["pending", "running", "waiting_approval", "success", "failed", "cancelled"]
AgentRole = Literal["orchestrator", "planner", "coder", "reviewer", "deployer", "preview"]
# 为保持向后兼容，允许任意字符串的角色
AgentRoleAny = str
RiskLevel = Literal["low", "medium", "high"]
ConversationStatus = Literal["idle", "running", "waiting_approval", "archived"]
ApprovalStatus = Literal["pending", "approved", "rejected"]


def fmt_time(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone().strftime("%H:%M")


# ---------------- 输出模型 ----------------


class ConversationOut(CamelModel):
    id: str
    title: str
    project_name: str = ""
    project_path: Optional[str] = None
    status: ConversationStatus = "idle"
    last_message: str = ""
    last_time: str = ""
    unread: int = 0
    pinned: bool = False
    archived: bool = False
    # 群聊成员（AgentRecord.id），空 = 全员
    member_agent_ids: list[str] = Field(default_factory=list)
    # 群规则（注入该会话所有任务指令）
    rules: str = ""
    # 会话级设置 {"skills": "all" | [技能名] | "off"}
    settings: dict[str, Any] = Field(default_factory=dict)


class MessageOut(CamelModel):
    id: str
    conversation_id: str
    type: MessageType
    content: str = ""
    agent_role: Optional[AgentRole] = None
    agent_name: Optional[str] = None
    task_id: Optional[str] = None
    timestamp: str = ""
    streaming: bool = False
    tool_name: Optional[str] = None
    tool_status: Optional[Literal["running", "success", "failed"]] = None
    # 命令 {exitCode, durationMs, cwd}；思考 {thinkingMs}
    meta: dict[str, Any] = Field(default_factory=dict)


class TaskOut(CamelModel):
    id: str
    conversation_id: str
    title: str
    agent_role: AgentRole
    status: TaskStatus = "pending"
    depends_on: list[str] = Field(default_factory=list)
    acceptance: str = ""
    result: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class DiffFileOut(CamelModel):
    filename: str
    additions: int = 0
    deletions: int = 0
    old_content: str = ""
    new_content: str = ""


class DiffOut(CamelModel):
    id: str
    conversation_id: str
    task_id: Optional[str] = None
    agent_id: Optional[str] = None
    summary: str = ""
    files: list[DiffFileOut] = Field(default_factory=list)
    status: ApprovalStatus = "pending"


class ApprovalOut(CamelModel):
    id: str
    conversation_id: str
    task_id: Optional[str] = None
    # 发起审批的 Agent（前端按 Agent 分组、各组独立提交）
    agent_role: Optional[AgentRole] = None
    agent_name: Optional[str] = None
    action_type: Literal["apply_diff", "run_command", "install_dependency", "deploy"]
    summary: str = ""
    risk_level: RiskLevel = "low"
    status: ApprovalStatus = "pending"
    # 关联的代码变更 Diff（apply_diff 审批联动展示对应 diff；其它动作为 None）
    diff_id: Optional[str] = None


class ProviderConfig(CamelModel):
    """Agent 独立 API 供应商配置（均可选，空 = 走本地 SDK 登录态）。"""

    base_url: str = ""
    auth_token: str = ""


class SkillSpec(CamelModel):
    """结构化能力条目（借鉴 A2A Agent Card 的 skill 描述）。

    供 Orchestrator 路由时按「何时该派 / 不该派」结构化选 agent，
    比自由文本 description 更可机读、路由更准。除 name 外均可缺省。
    """

    name: str
    description: str = ""
    when_to_use: str = ""
    when_not_to_use: str = ""
    inputs: str = ""
    outputs: str = ""
    examples: list[str] = Field(default_factory=list)


class AgentOut(CamelModel):
    id: str
    name: str
    role: str = Field(..., description="Agent 角色标识，如 orchestrator/planner/coder/reviewer/deployer")
    description: str = ""
    skills: str = ""
    skill_specs: list[SkillSpec] = Field(default_factory=list)
    system_prompt: str = ""
    group: str = ""
    adapter_type: str = ""
    model: str = ""
    context_window: Optional[int] = None
    provider_config: ProviderConfig = Field(default_factory=ProviderConfig)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


# ---------------- 输入模型 ----------------


class ConversationCreate(CamelModel):
    title: str
    project_name: str = ""
    project_path: Optional[str] = None
    member_agent_ids: list[str] = Field(default_factory=list)
    rules: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)


class ConversationUpdate(CamelModel):
    """会话生命周期与群设置操作（字段省略表示不变）。"""

    title: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    member_agent_ids: Optional[list[str]] = None
    rules: Optional[str] = None
    settings: Optional[dict[str, Any]] = None


class AttachmentIn(CamelModel):
    """用户消息多模态附件（参照 MiMo-Code FilePart）。

    url 为 base64 data URL（data:<mime>;base64,...，前端贴图/上传产生）；
    后端解码落盘后以统一 ref {type,mime,path,filename} 存入消息 meta 并透传 adapter。
    """

    type: Literal["image"] = "image"
    url: str
    filename: Optional[str] = None


class MessageCreate(CamelModel):
    content: str
    target_agent: Optional[AgentRole] = None
    attachments: list[AttachmentIn] = Field(default_factory=list)


class AgentCreate(CamelModel):
    name: str
    role: str
    description: str = ""
    skills: str = ""
    skill_specs: list[SkillSpec] = Field(default_factory=list)
    system_prompt: str = ""
    group: str = ""
    adapter_type: str = ""
    model: str = ""
    context_window: Optional[int] = None
    provider_config: ProviderConfig = Field(default_factory=ProviderConfig)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class AgentUpdate(CamelModel):
    name: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    skills: Optional[str] = None
    skill_specs: Optional[list[SkillSpec]] = None
    system_prompt: Optional[str] = None
    group: Optional[str] = None
    adapter_type: Optional[str] = None
    model: Optional[str] = None
    context_window: Optional[int] = None
    provider_config: Optional[ProviderConfig] = None
    capabilities: Optional[dict[str, Any]] = None
    enabled: Optional[bool] = None


class ApprovalDecisionIn(CamelModel):
    approved: bool
    reason: Optional[str] = None


class RollbackIn(CamelModel):
    """回退对话：删除该消息（含）之后的全部消息。"""

    message_id: str


class PlanReviseIn(CamelModel):
    """A：计划修改门禁——用户对待确认计划的修改意见。"""

    feedback: str


class PlanFileOut(CamelModel):
    """item 2：计划文件元信息（Spec Kit 三件套 + 合并版）。"""

    name: str
    path: str
    size: int
    mtime: str


class PlanFileWrite(CamelModel):
    """item 2：计划文件级逐条编辑写入。"""

    path: str
    content: str


class ContextUsageOut(CamelModel):
    """会话上下文用量（基于最近一次真实 token 计量）。"""

    used_tokens: int = 0
    window_tokens: int = 0
    pressure_level: int = 0


# ---------------- WebSocket 协议 ----------------
# 客户端 -> 服务端: {"action": str, "payload": {...}}
# 服务端 -> 客户端: {"type": str, "conversationId": str, "data": {...}}

WSEventType = Literal[
    "message.delta",
    "message.completed",
    "tool.started",
    "tool.finished",
    "file.changed",
    "diff.generated",
    "approval.required",
    "approval.resolved",
    "approval.resolve_failed",
    "task.status.changed",
    "conversation.updated",
    "preview.started",
    "preview.failed",
    "deploy.started",
    "deploy.finished",
    "error",
]


class WSEvent(CamelModel):
    type: WSEventType
    conversation_id: str
    data: dict[str, Any] = Field(default_factory=dict)

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)
