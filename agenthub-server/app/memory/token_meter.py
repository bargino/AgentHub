"""真实 token 计量与上下文压力分级（借鉴 MiMo-Code overflow.ts 设计）。

适配器 completed 事件携带的真实 usage（Claude SDK ResultMessage.usage /
Codex tokenUsage 通知）经 normalize_usage 标准化后落库到 agent 消息
meta["tokenUsage"]；下一轮构建上下文时以最近一次真实 input 占模型窗口
的比例计算压力等级（pressure_level），驱动记忆预算缩放与压缩力度。
"""

from __future__ import annotations

import logging
import os
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Message

logger = logging.getLogger(__name__)

# 压力分级阈值（与 MiMo-Code pressureLevel 同档：50% / 70% / 85%）
_PRESSURE_THRESHOLDS = (0.50, 0.70, 0.85)

# 缓存命中率观测开关（② 上下文工程 D 的延伸：缓存是成本最大杆，须可度量）
_CACHE_METER = os.environ.get("AGENTHUB_CACHE_METER", "1") != "0"

# 压力等级 -> 会话记忆预算缩放系数（压力越高，注入越少，给压缩留余量）
_BUDGET_SCALE = {0: 1.0, 1: 0.75, 2: 0.5, 3: 0.35}


def normalize_usage(raw: Any) -> dict[str, int] | None:
    """适配器原始 usage -> 标准化计量（无法识别返回 None）。

    兼容两种来源：
    - Claude SDK：input_tokens / output_tokens / cache_creation_input_tokens /
      cache_read_input_tokens（蛇形命名）
    - Codex tokenUsage 通知：inputTokens / cachedInputTokens / outputTokens /
      totalTokens（驼峰命名）
    """
    if not isinstance(raw, dict):
        return None

    def pick(*keys: str) -> int:
        for k in keys:
            v = raw.get(k)
            if isinstance(v, (int, float)) and v >= 0:
                return int(v)
        return 0

    input_tokens = pick("input_tokens", "inputTokens")
    output_tokens = pick("output_tokens", "outputTokens")
    cache_read = pick("cache_read_input_tokens", "cachedInputTokens", "cache_read_tokens")
    cache_write = pick("cache_creation_input_tokens", "cache_write_tokens")
    total = pick("total_tokens", "totalTokens")
    if total <= 0:
        # cache 命中部分不计入 input_tokens（Anthropic 口径），总量需要累加
        total = input_tokens + output_tokens + cache_read + cache_write
    if total <= 0:
        return None
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
        "total_tokens": total,
    }


def context_tokens(usage: dict[str, int]) -> int:
    """一次执行实际占用的上下文规模（输入侧：新输入 + cache 读写）。"""
    return (
        usage.get("input_tokens", 0)
        + usage.get("cache_read_tokens", 0)
        + usage.get("cache_write_tokens", 0)
    )


def pressure_level(used_tokens: int, window_tokens: int) -> int:
    """上下文压力等级 0-3（50% / 70% / 85% 分档）。"""
    if window_tokens <= 0 or used_tokens <= 0:
        return 0
    ratio = used_tokens / window_tokens
    for level, threshold in enumerate(_PRESSURE_THRESHOLDS):
        if ratio < threshold:
            return level
    return 3


def budget_scale(level: int) -> float:
    """压力等级 -> 记忆预算缩放系数。"""
    return _BUDGET_SCALE.get(level, 1.0)


def cache_hit_rate(usage: dict[str, int]) -> float:
    """prompt 缓存命中率 = cache_read /（新输入 + cache_read + cache_write）；无输入侧返回 0。

    衡量稳定前缀(system_prompt)缓存是否真正生效：命中率越高，重复注入的固定成本越被摊薄。
    """
    read = usage.get("cache_read_tokens", 0)
    base = usage.get("input_tokens", 0) + read + usage.get("cache_write_tokens", 0)
    return read / base if base > 0 else 0.0


def log_cache_usage(usage: dict[str, int] | None, *, agent: str, task_id: str = "") -> None:
    """打印单次执行的 prompt 缓存命中分解（[CACHE]）；usage 为空或关闭时静默。

    read=命中缓存 / write=本轮写缓存 / new=未命中新输入 / hit=命中率 / out=输出。
    命中率持续偏低 → 稳定前缀可能不稳定（每轮有变动内容混入）导致缓存失效。
    """
    if not _CACHE_METER or not usage:
        return
    read = usage.get("cache_read_tokens", 0)
    write = usage.get("cache_write_tokens", 0)
    new = usage.get("input_tokens", 0)
    if read + write + new <= 0:
        return  # 该适配器未上报缓存/输入侧（如部分 codex 通知），无可观测
    logger.info(
        "[CACHE] agent=%s task=%s read=%d write=%d new=%d hit=%.0f%% out=%d",
        agent, (task_id or "")[:8], read, write, new,
        cache_hit_rate(usage) * 100, usage.get("output_tokens", 0),
    )


async def get_last_usage(
    session: AsyncSession, conversation_id: str, agent_role: str | None = None
) -> dict[str, int] | None:
    """最近一条携带真实 tokenUsage 的 agent 消息计量（无记录返回 None）。

    agent_role 非空时只统计该角色的消息：群聊里每个 agent 窗口不同，
    须按 agent 维度算各自压力，避免拿别的 agent 的占用误判当前 agent。
    """
    stmt = (
        select(Message.meta)
        .where(Message.conversation_id == conversation_id)
        .where(Message.type == "agent")
    )
    if agent_role is not None:
        stmt = stmt.where(Message.agent_role == agent_role)
    result = await session.execute(
        stmt.order_by(Message.created_at.desc()).limit(20)
    )
    for (meta,) in result.all():
        usage = (meta or {}).get("tokenUsage")
        if isinstance(usage, dict) and usage.get("total_tokens"):
            return usage
    return None


async def get_pressure(
    session: AsyncSession,
    conversation_id: str,
    window_tokens: int,
    agent_role: str | None = None,
) -> int:
    """上下文压力等级（基于最近一次真实执行的输入侧占用）。

    agent_role 非空 = 按该 agent 维度（per-agent 压力，群聊场景）；
    空 = 会话级（取最近任意 agent，用于群级压缩的保守判断）。
    """
    usage = await get_last_usage(session, conversation_id, agent_role)
    if usage is None:
        return 0
    return pressure_level(context_tokens(usage), window_tokens)
