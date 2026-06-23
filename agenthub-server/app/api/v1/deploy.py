from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas import ApprovalDecisionIn
from app.services import conversation as conversation_service
from app.services import deploy as deploy_service

router = APIRouter()


class DeploymentCreateIn(BaseModel):
    """部署创建入参（Epic D）：选择 provider + 其配置；不传则默认 docker（真实）。"""

    provider: str = "docker"
    config: dict = Field(default_factory=dict)


def _to_dict(record) -> dict:
    return {
        "id": record.id,
        "conversationId": record.conversation_id,
        "status": record.status,
        "provider": record.provider,
        "plan": record.plan,
        "logs": record.logs,
        "resultUrl": record.result_url,
    }


@router.post("/conversations/{conversation_id}/deployments")
async def create_deployment(
    conversation_id: str,
    body: DeploymentCreateIn | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conv = await conversation_service.get_conversation(db, conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    payload = body or DeploymentCreateIn()
    try:
        record = await deploy_service.create_deployment(
            db,
            conversation_id,
            conv.project_name or conv.title,
            provider=payload.provider,
            config=payload.config,
        )
    except ValueError as exc:
        # 配置不足（如 remote 缺 host/command）→ 暴露真实错误，不回退假成功
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_dict(record)


@router.post("/deployments/{deployment_id}/approve")
async def approve_deployment(
    deployment_id: str, decision: ApprovalDecisionIn, db: AsyncSession = Depends(get_db)
) -> dict:
    if not decision.approved:
        record = await deploy_service.reject_deployment(db, deployment_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Deployment not found")
        return _to_dict(record)

    record = await deploy_service.get_deployment(db, deployment_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    # 长部署后台化：仅 planned 启动后台执行，approve 立即返回（不阻塞请求）；
    # 非 planned 幂等返回当前态。进度经 deploy.started/finished WS 事件与 GET 跟踪。
    if record.status == "planned":
        deploy_service.launch_deploy(deployment_id)
    return _to_dict(record)


@router.get("/deployments/{deployment_id}")
async def get_deployment(deployment_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    record = await deploy_service.get_deployment(db, deployment_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return _to_dict(record)
