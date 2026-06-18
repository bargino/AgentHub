from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Conversation(Base):
    """项目会话（PRD §9.1）。"""

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200))
    project_name: Mapped[str] = mapped_column(String(200), default="")
    project_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # idle | running | waiting_approval | archived
    status: Mapped[str] = mapped_column(String(32), default="idle")
    workspace_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 会话组织维度（借鉴 CodexMonitor thread 生命周期）：置顶 / 归档，与运行态 status 正交
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    # 群聊成员（AgentRecord.id 列表）；空 = 全员可见（兼容旧会话）
    member_agent_ids: Mapped[list] = mapped_column(JSON, default=list)
    # 群规则：注入该会话所有任务指令，优先级高于全局/项目规则
    rules: Mapped[str] = mapped_column(Text, default="")
    # 会话级设置 {"skills": "all" | [技能名] | "off"}；缺省跟随全局
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class Message(Base):
    """会话消息（用户 / Agent / 系统 / 工具 / 审批 / 错误）。"""

    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_conversation_created", "conversation_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("conversations.id", ondelete="CASCADE")
    )
    # user | agent | thinking | system | tool | approval | error
    type: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    # orchestrator | planner | coder | reviewer | preview | deployer
    agent_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    agent_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # running | success | failed
    tool_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 扩展元数据：命令 {exit_code, duration_ms, cwd}；思考 {thinking_ms}
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AgentRecord(Base):
    """可用 Agent 注册表。role 不再 unique，允许多个同角色 Agent。"""

    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(32))
    description: Mapped[str] = mapped_column(Text, default="")
    skills: Mapped[str] = mapped_column(Text, default="")
    # 结构化能力清单（借鉴 A2A Agent Card）：[{name, description, whenToUse,
    # whenNotToUse, inputs, outputs, examples[]}]，供 Orchestrator 路由时按结构化
    # 触发条件选 agent；空 = 回退自由文本 skills。
    skill_specs: Mapped[list] = mapped_column(JSON, default=list)
    # 角色系统提示词（来源：agents/*.md 正文；空 = 回退 prompts.py 内置/模板）
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    group: Mapped[str] = mapped_column(String(64), default="")
    # claude-code | codex（运行时通过 SDK 健康检查动态探测）
    adapter_type: Mapped[str] = mapped_column(String(32), default="")
    # 指定模型名（空 = SDK 默认 / 本地登录态默认模型）
    model: Mapped[str] = mapped_column(String(100), default="")
    # 自定义上下文窗口 token 数（空 = 按 model 名查表，未知回退 DEFAULT 128k）；
    # 决定该 agent 记忆注入预算与压力分级，codex 执行器透传为 model_context_window
    context_window: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 独立 API 供应商配置 {base_url, auth_token}（空 = 本地 SDK 登录态），
    # 经 SDK 子进程 env / config_overrides 注入，per-agent 隔离、不碰全局配置文件
    provider_config: Mapped[dict] = mapped_column(JSON, default=dict)
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Task(Base):
    """编排任务节点（DAG）。"""

    __tablename__ = "tasks"
    __table_args__ = (Index("ix_tasks_conversation", "conversation_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("conversations.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    agent_role: Mapped[str] = mapped_column(String(32))
    # pending | running | waiting_approval | success | failed | cancelled
    status: Mapped[str] = mapped_column(String(32), default="pending")
    depends_on: Mapped[list] = mapped_column(JSON, default=list)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    # Phase 2：EARS 验收标准（"当 X，系统应 Y"），来自 planner，供计划 / reviewer / eval 对标
    acceptance: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AgentSessionRecord(Base):
    """Agent SDK 会话延续映射（同会话同角色同适配器复用底层 SDK session）。

    completed 事件携带的 session_id（claude）/ thread_id（codex）在任务成功后
    upsert 入表；任务失败时清除，防止坏 session 被反复 resume。
    last_message_at 为上次任务收口时间水位，resume 时会话历史只注入水位
    之后的增量消息（SDK 内部已有该 agent 自身历史）。
    """

    __tablename__ = "agent_sessions"
    __table_args__ = (
        Index(
            "ix_agent_sessions_conv_role_adapter",
            "conversation_id", "agent_role", "adapter",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("conversations.id", ondelete="CASCADE")
    )
    agent_role: Mapped[str] = mapped_column(String(32))
    adapter: Mapped[str] = mapped_column(String(32))
    session_id: Mapped[str] = mapped_column(String(128))
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class AgentEventRecord(Base):
    """AgentEvent 持久化（可观测性 / 回放）。"""

    __tablename__ = "agent_events"
    __table_args__ = (
        Index("ix_agent_events_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(32))
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    agent_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class BlackboardEntry(Base):
    """会话级多 Agent 共享黑板（#10：方案/结论/共享事实，按主题 upsert）。

    并行多方案各 attempt 写 proposal:<task>:<i>，裁决写 decision:<task>；
    下游经 context_builder 注入共享黑板。(conversation_id, key) 唯一，按主题 upsert。
    """

    __tablename__ = "blackboard"
    __table_args__ = (
        Index("ix_blackboard_conv_key", "conversation_id", "key", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("conversations.id", ondelete="CASCADE")
    )
    key: Mapped[str] = mapped_column(String(200))
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    agent_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # #7 串联本轮请求，便于按 trace 回看黑板写入
    trace_id: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class Workspace(Base):
    """会话隔离工作区。"""

    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(String(32), unique=True)
    project_name: Mapped[str] = mapped_column(String(200), default="")
    path: Mapped[str] = mapped_column(String(500))
    branch_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # active | archived
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DiffRecord(Base):
    """代码变更 Diff（含审批状态）。"""

    __tablename__ = "diffs"
    __table_args__ = (Index("ix_diffs_conversation", "conversation_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(String(32))
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    agent_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    workspace_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    # files: [{filename, additions, deletions, old_content, new_content}]
    files: Mapped[list] = mapped_column(JSON, default=list)
    # pending | approved | rejected
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Approval(Base):
    """高风险动作审批记录。"""

    __tablename__ = "approvals"
    __table_args__ = (Index("ix_approvals_conversation", "conversation_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(String(32))
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 发起审批的 Agent（用于前端按 Agent 分组、各组独立提交）
    agent_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    agent_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # apply_diff | run_command | install_dependency | deploy
    action_type: Mapped[str] = mapped_column(String(32))
    summary: Mapped[str] = mapped_column(Text, default="")
    # low | medium | high
    risk_level: Mapped[str] = mapped_column(String(16), default="low")
    # pending | approved | rejected
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # 适配器层审批请求 ID（用于回传决策给 adapter）
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 发起审批的适配器名（registry key）：持久化以便进程重启后仍能回传决策给 adapter，
    # 避免「内存协调器映射丢失 -> UI 显示已通过但 agent 实际被拒/挂起」的静默分叉
    adapter_name: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 关联的代码变更 Diff（apply_diff 审批指向对应 DiffRecord，供前端审查界面联动展示）
    diff_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
