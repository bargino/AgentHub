from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas import ApprovalDecisionIn
from app.services import conversation as conversation_service
from app.services import deploy as deploy_service

router = APIRouter()


def _to_dict(record) -> dict:
    return {
        "id": record.id,
        "conversationId": record.conversation_id,
        "status": record.status,
        "plan": record.plan,
        "logs": record.logs,
        "resultUrl": record.result_url,
    }


@router.post("/conversations/{conversation_id}/deployments")
async def create_deployment(conversation_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    conv = await conversation_service.get_conversation(db, conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    record = await deploy_service.create_deployment(
        db, conversation_id, conv.project_name or conv.title
    )
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

    record = await deploy_service.execute_mock_deploy(db, deployment_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return _to_dict(record)


@router.get("/deployments/{deployment_id}")
async def get_deployment(deployment_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    record = await deploy_service.get_deployment(db, deployment_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return _to_dict(record)
