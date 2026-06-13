"""短期记忆：会话消息滑动窗口。

为 Agent 构建对话上下文，预算按字符数控制（粗略对应 token）。
字符预算按执行模型的上下文窗口动态换算（window_profile），
窗口条数恒为 WINDOW_MAX_MESSAGES，与 summary 压缩边界共口径。
超出窗口的旧消息由 summary.compress_if_needed 滚动压缩为摘要，
摘要经 context_builder 作为前缀注入。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Message

# 窗口口径（get_recent_window 默认值与 summary 压缩边界共用，保证无盲区）
WINDOW_MAX_MESSAGES = 30
WINDOW_CHAR_BUDGET = 12000
# 单条消息进入上下文的截断上限，防止一条超长消息占满全部预算
PER_MESSAGE_LIMIT = 4000

# 参与上下文/压缩的消息类型（统一口径）
CONTEXT_MESSAGE_TYPES = ["user", "agent", "system", "error"]

# ---------------- 模型上下文窗口 -> 记忆预算 ----------------

# 模型名前缀（小写）-> 上下文窗口 token 数；未命中走保守默认
_MODEL_WINDOW_TOKENS: list[tuple[str, int]] = [
    ("claude", 200_000),
    ("gpt-5", 400_000),
    ("gpt-4.1", 1_000_000),
    ("gpt-4o", 128_000),
    ("o3", 200_000),
    ("o4", 200_000),
    ("gemini", 1_000_000),
    ("deepseek", 128_000),
    ("kimi", 256_000),
    ("moonshot", 256_000),
    ("qwen", 256_000),
    ("glm", 128_000),
]
DEFAULT_WINDOW_TOKENS = 128_000

# 会话记忆最多占模型窗口的比例（其余留给指令/项目记忆/工具输出/模型输出）
_CONTEXT_RATIO = 0.15
# 中文为主的保守换算：1 token ~= 2 字符
_CHARS_PER_TOKEN = 2
_BUDGET_MIN = WINDOW_CHAR_BUDGET
_BUDGET_MAX = 64_000


@dataclass(frozen=True)
class WindowProfile:
    """按模型上下文窗口换算出的记忆预算。"""

    window_tokens: int
    char_budget: int
    per_message_limit: int


def model_window_tokens(model: str | None) -> int:
    """模型名 -> 上下文窗口 token 数（前缀匹配，未知/未指定走保守默认）。"""
    if model:
        name = model.strip().lower()
        for prefix, tokens in _MODEL_WINDOW_TOKENS:
            if name.startswith(prefix):
                return tokens
    return DEFAULT_WINDOW_TOKENS


def resolve_window_tokens(model: str | None, override: int | None = None) -> int:
    """有效上下文窗口：显式 override（自定义模型手填）优先，否则按 model 名查表。"""
    if override and override > 0:
        return override
    return model_window_tokens(model)


def window_profile(
    model: str | None, pressure: int = 0, window_override: int | None = None
) -> WindowProfile:
    """按执行模型动态换算记忆预算；窗口条数恒定，预算随模型窗口伸缩。

    window_override：显式上下文窗口（自定义模型手填），优先于按 model 查表。
    pressure：上下文压力等级 0-3（token_meter.get_pressure），压力越高
    预算缩得越小（×1.0 / 0.75 / 0.5 / 0.35），给指令与工具输出留余量。
    """
    from app.memory.token_meter import budget_scale

    tokens = resolve_window_tokens(model, window_override)
    budget = int(tokens * _CONTEXT_RATIO * _CHARS_PER_TOKEN)
    budget = max(_BUDGET_MIN, min(budget, _BUDGET_MAX))
    budget = int(budget * budget_scale(pressure))
    per_message = max(PER_MESSAGE_LIMIT, budget // 8)
    return WindowProfile(
        window_tokens=tokens,
        char_budget=budget,
        per_message_limit=per_message,
    )


@dataclass
class MemoryEntry:
    role: str  # user | assistant | system
    content: str


def soft_trim(text: str, limit: int) -> str:
    """超限文本头尾保留软修剪（借鉴 MiMo-Code 软 prune，替代直接截尾）。

    头部保留约 60%（任务说明/需求通常在前），尾部保留约 30%（结论在后），
    中间替换为省略标记；limit 过小时退化为直接截断。
    """
    if len(text) <= limit:
        return text
    head_len = int(limit * 0.6)
    tail_len = int(limit * 0.3)
    if head_len <= 0 or tail_len <= 0:
        return text[:limit]
    omitted = len(text) - head_len - tail_len
    return f"{text[:head_len]}\n…[中间省略 {omitted} 字符]…\n{text[-tail_len:]}"


def _to_entry(msg: Message, per_message_limit: int = PER_MESSAGE_LIMIT) -> MemoryEntry:
    if msg.type == "user":
        return MemoryEntry(role="user", content=soft_trim(msg.content, per_message_limit))
    prefix = f"[{msg.agent_name or msg.agent_role or 'agent'}] " if msg.type == "agent" else f"[{msg.type}] "
    return MemoryEntry(role="assistant", content=soft_trim(prefix + msg.content, per_message_limit))


async def get_recent_window(
    session: AsyncSession,
    conversation_id: str,
    *,
    max_messages: int = WINDOW_MAX_MESSAGES,
    char_budget: int = WINDOW_CHAR_BUDGET,
    per_message_limit: int = PER_MESSAGE_LIMIT,
    since: datetime | None = None,
) -> list[MemoryEntry]:
    """取最近 N 条消息（时间正序返回），按字符预算从新到旧裁剪。

    since 非空时只取该时间之后的增量消息（SDK session resume 场景：
    底层会话已有该 agent 自身历史，只补水位后其它参与方的新消息）。
    """
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.type.in_(CONTEXT_MESSAGE_TYPES))
    )
    if since is not None:
        stmt = stmt.where(Message.created_at > since)
    result = await session.execute(
        stmt.order_by(Message.created_at.desc()).limit(max_messages)
    )
    rows = list(result.scalars())

    entries: list[MemoryEntry] = []
    used = 0
    for msg in rows:  # 从最新往旧累积
        entry = _to_entry(msg, per_message_limit)
        cost = len(entry.content)
        if used + cost > char_budget and entries:
            break
        entries.append(entry)
        used += cost

    entries.reverse()  # 恢复时间正序
    return entries


async def get_overflow_messages(
    session: AsyncSession,
    conversation_id: str,
    *,
    window_size: int = WINDOW_MAX_MESSAGES,
    batch_limit: int = 40,
) -> list[MemoryEntry]:
    """取滑动窗口之外最近的一批旧消息（时间正序），供滚动压缩消费。

    更早的积压由后续轮次继续追平（每轮编排收口都会触发压缩）。
    """
    result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.type.in_(CONTEXT_MESSAGE_TYPES))
        .order_by(Message.created_at.desc())
        .offset(window_size)
        .limit(batch_limit)
    )
    rows = list(result.scalars())
    rows.reverse()
    return [_to_entry(m) for m in rows]


def render_window(entries: list[MemoryEntry]) -> str:
    """渲染为提示词文本块。"""
    lines = []
    for e in entries:
        speaker = "用户" if e.role == "user" else "助手"
        lines.append(f"{speaker}: {e.content}")
    return "\n".join(lines)


async def min_member_window(
    session: AsyncSession, member_ids: list[str] | None = None
) -> int:
    """群成员中最小的有效上下文窗口（群级压缩 / 余量展示的保守基准：
    保证连最小窗口成员都不溢出）。member_ids 空 = 全员 enabled agent；
    无可用成员回退 DEFAULT_WINDOW_TOKENS。
    """
    from app.db.models import AgentRecord

    stmt = select(AgentRecord.model, AgentRecord.context_window).where(
        AgentRecord.enabled.is_(True)
    )
    if member_ids:
        stmt = stmt.where(AgentRecord.id.in_(member_ids))
    rows = (await session.execute(stmt)).all()
    windows = [resolve_window_tokens(model, cw) for model, cw in rows]
    return min(windows) if windows else DEFAULT_WINDOW_TOKENS
