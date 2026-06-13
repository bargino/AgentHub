"""Agent 角色 -> 适配器路由。

优先路由到本地 SDK 适配器（claude-code / codex），通过 SDK 健康检查
动态判定可用性。DB AgentRecord 可指定偏好，否则按探测顺序自动选择；
真实 SDK 均不可用时回退到 mock 适配器，保证无 API Key 环境链路完整。
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import ICodeAdapter
from app.core.registry import AdapterRegistry
from app.db.models import AgentRecord

logger = logging.getLogger(__name__)

# 适配器探测优先级（按本地 SDK 可用性逐个检测；mock 恒可用、置于末位兜底）
ADAPTER_PRIORITY: list[str] = ["claude-code", "codex", "mock"]

# 纯文本 LLM 任务（任务规划 / 摘要压缩）的探测优先级：
# 显式排除 mock——mock 的固定演示文本会污染摘要/计划数据。
PLANNING_PRIORITY: list[str] = ["claude-code", "codex"]


async def resolve_adapter(
    session: AsyncSession,
    registry: AdapterRegistry,
    agent_role: str,
    member_ids: list[str] | None = None,
) -> tuple[ICodeAdapter, str]:
    """返回 (适配器实例, 适配器名)。

    优先级：DB AgentRecord.adapter_type -> 真实 SDK 探测（claude-code ->
    codex）-> mock 兜底。member_ids 非空时同 role 多记录优先取会话群成员
    （群聊模式：决定该会话实际生效的适配器偏好 / 模型 / 供应商）。
    """
    # 1. 尝试 DB 中用户指定的适配器偏好（群成员优先，查不到回退全局）
    record = None
    if member_ids:
        result = await session.execute(
            select(AgentRecord).where(
                AgentRecord.role == agent_role, AgentRecord.id.in_(member_ids)
            )
        )
        record = result.scalars().first()
    if record is None:
        result = await session.execute(select(AgentRecord).where(AgentRecord.role == agent_role))
        record = result.scalars().first()
    if record and record.enabled and record.adapter_type:
        adapter = registry.get(record.adapter_type)
        if adapter is not None:
            try:
                if await adapter.health_check():
                    return adapter, record.adapter_type
            except Exception:
                logger.warning(
                    "Preferred adapter %s health check failed for role %s",
                    record.adapter_type, agent_role, exc_info=True,
                )

    # 2. 按优先级探测（claude-code -> codex -> mock 兜底）
    for adapter_name in ADAPTER_PRIORITY:
        adapter = registry.get(adapter_name)
        if adapter is None:
            continue
        try:
            if await adapter.health_check():
                return adapter, adapter_name
        except Exception:
            logger.debug("Adapter %s unavailable", adapter_name, exc_info=True)

    raise RuntimeError(
        f"没有可用的 Agent 适配器（角色: {agent_role}）。"
        "请确保已安装 claude-agent-sdk 或 openai-codex 并完成登录。"
    )
