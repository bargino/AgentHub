"""Deploy 服务（Epic D）：可插拔 provider（mock/docker/remote）+ 审批门控执行。

生成部署计划（按 provider）-> 创建审批（deployer 任务强制人工确认）-> 审批通过后由对应
provider 执行（mock 零副作用 / docker / remote 经注入式 runner 真实执行）-> 记录日志与结果。
真实 provider 失败时尝试执行回滚命令（非 mock 占位）。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.event_bus import get_event_bus
from app.db.engine import get_session_factory
from app.db.models import Base
from app.schemas import WSEvent
from app.services.deploy_providers import CommandRunner, get_provider, run_subprocess

logger = logging.getLogger(__name__)

# 后台部署任务引用集合（防止 asyncio.create_task 的任务被 GC 提前回收）
_bg_deploy_tasks: set[asyncio.Task] = set()


class DeploymentRecord(Base):
    __tablename__ = "deployments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    conversation_id: Mapped[str] = mapped_column(String(32), index=True)
    # planned | deploying | success | failed | rejected
    status: Mapped[str] = mapped_column(String(16), default="planned")
    plan: Mapped[dict] = mapped_column(JSON, default=dict)
    logs: Mapped[str] = mapped_column(Text, default="")
    result_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Epic D：部署目标 provider（docker/remote）；旧库经 db.engine 轻量迁移补列
    provider: Mapped[str] = mapped_column(String(32), default="docker")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


async def create_deployment(
    session: AsyncSession,
    conversation_id: str,
    project_name: str,
    provider: str = "docker",
    config: dict | None = None,
) -> DeploymentRecord:
    """按 provider 构建计划并落库；配置不足直接抛 ValueError（暴露真实错误，不回退 mock）。"""
    prov = get_provider(provider)
    plan = prov.build_plan(project_name, config or {})
    record = DeploymentRecord(
        conversation_id=conversation_id, status="planned", plan=plan, provider=prov.name
    )
    session.add(record)
    await session.flush()
    return record


async def get_deployment(session: AsyncSession, deployment_id: str) -> DeploymentRecord | None:
    result = await session.execute(
        select(DeploymentRecord).where(DeploymentRecord.id == deployment_id)
    )
    return result.scalars().first()


async def execute_deploy(
    session: AsyncSession, deployment_id: str, runner: CommandRunner | None = None
) -> DeploymentRecord | None:
    """审批通过后由 provider 执行部署（runner 可注入，默认真实子进程）。"""
    record = await get_deployment(session, deployment_id)
    if record is None or record.status != "planned":
        return record
    cmd_runner = runner or run_subprocess
    prov = get_provider(record.provider)

    record.status = "deploying"
    await session.flush()
    await get_event_bus().publish(
        WSEvent(
            type="deploy.started",
            conversation_id=record.conversation_id,
            data={"deploymentId": record.id, "plan": record.plan, "provider": record.provider},
        )
    )

    try:
        status, result_url, logs = await prov.execute(record.plan, runner=cmd_runner)
    except Exception as exc:
        logger.exception("deploy execute crashed: %s", deployment_id)
        status, result_url, logs = "failed", None, f"部署执行异常：{exc}"

    # 部署失败 → 尝试回滚命令（空/占位 "(...)" 不执行）
    if status == "failed":
        rollback = str(record.plan.get("rollback", "")).strip()
        if rollback and not rollback.startswith("("):
            cwd = (record.plan.get("config") or {}).get("cwd")
            code, out = await cmd_runner(rollback, cwd)
            tag = "ok" if code == 0 else "fail"
            logs = f"{logs}\n[rollback {tag}] {rollback}: {out.strip()[:500]}"

    record.status = status
    record.logs = logs
    record.result_url = result_url
    await session.flush()
    await get_event_bus().publish(
        WSEvent(
            type="deploy.finished",
            conversation_id=record.conversation_id,
            data={
                "deploymentId": record.id,
                "status": status,
                "resultUrl": result_url,
                "logs": logs,
            },
        )
    )
    return record


async def _run_deploy_session(
    deployment_id: str, runner: CommandRunner | None = None
) -> None:
    """后台部署：用独立 session 执行（请求 session 在响应后已关闭，须自建并自管事务）。"""
    factory = get_session_factory()
    try:
        async with factory() as session, session.begin():
            await execute_deploy(session, deployment_id, runner)
    except Exception:
        logger.exception("background deploy failed: %s", deployment_id)


def launch_deploy(
    deployment_id: str, runner: CommandRunner | None = None
) -> asyncio.Task:
    """后台启动部署（不阻塞 approve 请求）；保留 task 引用防 GC，完成后自动清理。

    幂等由 execute_deploy 的状态机守卫保证（仅 planned 会真正执行）。客户端经
    deploy.started / deploy.finished WS 事件或 GET /deployments/{id} 跟踪进度。
    """
    task = asyncio.create_task(_run_deploy_session(deployment_id, runner))
    _bg_deploy_tasks.add(task)
    task.add_done_callback(_bg_deploy_tasks.discard)
    return task


async def reject_deployment(session: AsyncSession, deployment_id: str) -> DeploymentRecord | None:
    record = await get_deployment(session, deployment_id)
    if record is None:
        return None
    record.status = "rejected"
    await session.flush()
    return record
