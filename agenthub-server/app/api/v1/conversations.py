from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core import run_registry
from app.memory import conversation_memory, token_meter
from app.schemas import (
    ApprovalDecisionIn,
    ApprovalOut,
    ContextUsageOut,
    ConversationCreate,
    ConversationOut,
    ConversationUpdate,
    DiffOut,
    MessageOut,
    PlanReviseIn,
    RollbackIn,
    SpecFileOut,
    SpecFileWrite,
    TaskOut,
)
from app.services import approval as approval_service
from app.services import conversation as conversation_service
from app.services import diff as diff_service
from app.services import message as message_service
from app.services import task as task_service
from app.services import workspace as workspace_service

router = APIRouter()


@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(
    data: ConversationCreate, db: AsyncSession = Depends(get_db)
) -> ConversationOut:
    return await conversation_service.create_conversation(db, data)


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    include_archived: bool = False, db: AsyncSession = Depends(get_db)
) -> list[ConversationOut]:
    return await conversation_service.list_conversations(
        db, include_archived=include_archived
    )


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> ConversationOut:
    conv = await conversation_service.get_conversation(db, conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def update_conversation(
    conversation_id: str,
    data: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    """会话生命周期操作：重命名 / 置顶 / 归档（恢复传 archived=false）。"""
    conv = await conversation_service.update_conversation(db, conversation_id, data)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> dict:
    """永久删除会话：级联清理消息/任务/事件/diff/审批/workspace；运行中先停止。

    与归档不同（归档软隐藏、保留数据、可恢复），删除不可恢复。
    """
    run_registry.cancel(conversation_id)
    deleted = await conversation_service.delete_conversation(db, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: str,
    limit: int = 100,
    before: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    """游标分页：默认最新 limit 条；before=消息 id 时取其之前的 limit 条。"""
    return await message_service.list_messages(
        db, conversation_id, limit=min(max(limit, 1), 500), before_id=before
    )


@router.post("/conversations/{conversation_id}/stop")
async def stop_conversation(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> dict:
    """停止本轮执行：取消编排任务句柄并收口（未结任务置 cancelled、会话回 idle）。"""
    cancelled = run_registry.cancel(conversation_id)
    if cancelled:
        tasks = await task_service.list_tasks(db, conversation_id)
        for t in tasks:
            if t.status in ("running", "pending", "waiting_approval"):
                await task_service.update_task_status(db, t.id, "cancelled")
        await conversation_service.update_status(db, conversation_id, "idle")
        await message_service.append_message(
            db, conversation_id, type="system", content="已停止本轮执行"
        )
    return {"stopped": cancelled}


@router.post("/conversations/{conversation_id}/rollback")
async def rollback_conversation(
    conversation_id: str, data: RollbackIn, db: AsyncSession = Depends(get_db)
) -> dict:
    """回退对话：删除指定消息（含）之后的全部消息；运行中则先停止。"""
    run_registry.cancel(conversation_id)
    deleted = await message_service.delete_messages_from(db, conversation_id, data.message_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Message not found in conversation")
    await conversation_service.update_status(db, conversation_id, "idle")
    return {"deleted": deleted}


@router.post("/conversations/{conversation_id}/plan/confirm")
async def confirm_plan(conversation_id: str, data: ApprovalDecisionIn) -> dict:
    """计划确认门禁（Phase 1b）：批准则后台执行暂存的 pipeline 计划，拒绝则取消该计划。

    执行较长，故以后台任务跑 resume_plan 并注册到 run_registry（供 /stop 取消），
    立即返回；结果经 WebSocket 事件推送前端。
    """
    from app.orchestrator.engine import resume_plan

    task = asyncio.create_task(resume_plan(conversation_id, data.approved))
    run_registry.register(conversation_id, task)
    return {"ok": True, "approved": data.approved}


@router.post("/conversations/{conversation_id}/plan/revise")
async def revise_plan_endpoint(conversation_id: str, data: PlanReviseIn) -> dict:
    """A：计划修改门禁——按用户意见取消旧计划并重新规划（后台），结果经 WS 推送。"""
    from app.orchestrator.engine import revise_plan

    task = asyncio.create_task(revise_plan(conversation_id, data.feedback))
    run_registry.register(conversation_id, task)
    return {"ok": True}


@router.get("/conversations/{conversation_id}/specs", response_model=list[SpecFileOut])
async def list_specs(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> list[SpecFileOut]:
    """item 2：列出该会话的规格文件（Spec Kit 三件套 + 合并版），供前端评审 / 逐条编辑。

    工作区尚未创建（会话还没真正执行过 pipeline）时返回空列表，而非报错。
    """
    from app.services import spec_store

    ws = await workspace_service.get_workspace(db, conversation_id)
    if ws is None:
        return []
    return [SpecFileOut(**it) for it in spec_store.list_spec_files(ws.path, conversation_id)]


@router.get("/conversations/{conversation_id}/specs/file")
async def get_spec_file(
    conversation_id: str, path: str, db: AsyncSession = Depends(get_db)
) -> dict:
    """item 2：读取单个规格文件内容（路径限定在 specs 根内，越界 / 非 .md 一律拒绝）。"""
    from app.services import spec_store

    ws = await workspace_service.get_workspace(db, conversation_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    content = spec_store.read_spec_file(ws.path, path)
    if content is None:
        raise HTTPException(status_code=404, detail="Spec file not found")
    return {"path": path, "content": content}


@router.patch("/conversations/{conversation_id}/specs/file")
async def save_spec_file(
    conversation_id: str, data: SpecFileWrite, db: AsyncSession = Depends(get_db)
) -> dict:
    """item 2：保存单个规格文件（文件级逐条编辑落盘；路径限定在 specs 根内，防穿越）。

    用 PATCH 而非 PUT：前端 stdio 桥仅支持 GET/POST/PATCH/DELETE（见 services/http.ts）。
    """
    from app.services import spec_store

    ws = await workspace_service.get_workspace(db, conversation_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not spec_store.write_spec_file(ws.path, data.path, data.content):
        raise HTTPException(status_code=400, detail="Invalid spec path")
    return {"ok": True, "path": data.path}


@router.get(
    "/conversations/{conversation_id}/context", response_model=ContextUsageOut
)
async def get_context_usage(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> ContextUsageOut:
    """上下文用量：最近一次真实执行的输入侧 token 占窗口比例。

    窗口取会话成员中的最小有效窗口（保守基准，与群级压缩同口径），
    保证展示的占比对最严格成员不偏乐观。
    """
    conv = await conversation_service.get_conversation(db, conversation_id)
    member_ids = list(conv.member_agent_ids or []) if conv else []
    window = await conversation_memory.min_member_window(db, member_ids)
    usage = await token_meter.get_last_usage(db, conversation_id)
    used = token_meter.context_tokens(usage) if usage else 0
    return ContextUsageOut(
        used_tokens=used,
        window_tokens=window,
        pressure_level=token_meter.pressure_level(used, window),
    )


@router.get("/conversations/{conversation_id}/tasks", response_model=list[TaskOut])
async def list_tasks(conversation_id: str, db: AsyncSession = Depends(get_db)) -> list[TaskOut]:
    return await task_service.list_tasks(db, conversation_id)


@router.get("/conversations/{conversation_id}/diff", response_model=DiffOut | None)
async def get_latest_diff(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> DiffOut | None:
    return await diff_service.get_latest_diff(db, conversation_id)


@router.get("/conversations/{conversation_id}/approval", response_model=ApprovalOut | None)
async def get_pending_approval(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> ApprovalOut | None:
    return await approval_service.get_pending_approval(db, conversation_id)


@router.get("/conversations/{conversation_id}/approvals", response_model=list[ApprovalOut])
async def list_pending_approvals(
    conversation_id: str, db: AsyncSession = Depends(get_db)
) -> list[ApprovalOut]:
    """会话内全部待决审批（支持多 Agent 并发、向导式逐题确认）。"""
    return await approval_service.list_pending_approvals(db, conversation_id)
