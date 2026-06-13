"""Deploy 服务（PRD §4.3，V1 Mock Deploy）。

生成部署计划 -> 创建审批（必须人工确认）-> 审批通过后执行模拟部署并记录日志。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, JSON, String, Text, select
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import get_event_bus
from app.db.models import Base
from app.schemas import WSEvent

logger = logging.getLogger(__name__)


class DeploymentRecord(Base):
    __tablename__ = "deployments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    conversation_id: Mapped[str] = mapped_column(String(32), index=True)
    # planned | deploying | success | failed | rejected
    status: Mapped[str] = mapped_column(String(16), default="planned")
    plan: Mapped[dict] = mapped_column(JSON, default=dict)
    logs: Mapped[str] = mapped_column(Text, default="")
    result_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


def build_deploy_plan(project_name: str) -> dict:
    """生成 V1 模拟部署计划。"""
    return {
        "target": "mock-staging",
        "steps": [
            {"name": "构建产物", "command": "npm run build"},
            {"name": "上传构建产物", "command": "(mock) upload dist/"},
            {"name": "切换流量", "command": "(mock) switch traffic"},
        ],
        "rollback": "(mock) restore previous release",
        "project": project_name,
    }


async def create_deployment(
    session: AsyncSession, conversation_id: str, project_name: str
) -> DeploymentRecord:
    record = DeploymentRecord(
        conversation_id=conversation_id,
        status="planned",
        plan=build_deploy_plan(project_name),
    )
    session.add(record)
    await session.flush()
    return record


async def get_deployment(session: AsyncSession, deployment_id: str) -> DeploymentRecord | None:
    result = await session.execute(
        select(DeploymentRecord).where(DeploymentRecord.id == deployment_id)
    )
    return result.scalars().first()


async def execute_mock_deploy(session: AsyncSession, deployment_id: str) -> DeploymentRecord | None:
    """审批通过后执行模拟部署（逐步推进 + 日志记录 + 事件广播）。"""
    record = await get_deployment(session, deployment_id)
    if record is None or record.status not in ("planned",):
        return record

    record.status = "deploying"
    await session.flush()
    await get_event_bus().publish(
        WSEvent(
            type="deploy.started",
            conversation_id=record.conversation_id,
            data={"deploymentId": record.id, "plan": record.plan},
        )
    )

    log_lines: list[str] = []
    for step in record.plan.get("steps", []):
        await asyncio.sleep(0.5)  # 模拟执行耗时
        log_lines.append(f"[ok] {step['name']}: {step['command']}")

    record.logs = "\n".join(log_lines)
    record.status = "success"
    record.result_url = f"https://mock-staging.agenthub.local/{record.conversation_id[:8]}"
    await session.flush()

    await get_event_bus().publish(
        WSEvent(
            type="deploy.finished",
            conversation_id=record.conversation_id,
            data={
                "deploymentId": record.id,
                "status": "success",
                "resultUrl": record.result_url,
                "logs": record.logs,
            },
        )
    )
    return record


async def reject_deployment(session: AsyncSession, deployment_id: str) -> DeploymentRecord | None:
    record = await get_deployment(session, deployment_id)
    if record is None:
        return None
    record.status = "rejected"
    await session.flush()
    return record
