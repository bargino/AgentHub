"""Orchestrator 编排引擎（PRD §3 核心业务流程）。

实现 IMessageHandler：接收用户消息 -> 任务规划 -> DAG 执行 -> 状态收口。
@agent 直接路由时跳过规划，单任务执行。
"""

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from typing import Optional

from app.core.message_handler import IMessageHandler
from app.db.engine import get_session_factory
from app.memory import conversation_memory, progress_log, summary, token_meter
from app.orchestrator.task_executor import ExecutionState, execute_plan
from app.orchestrator.task_planner import Decision, PlannedTask, TaskPlan, decide
from app.services import conversation as conversation_service
from app.services import event_store
from app.services import message as message_service
from app.services import task as task_service
from app.services import workspace as workspace_service

logger = logging.getLogger(__name__)

# #1-B 失败重规划封顶轮数（防无限重规划）；0 = 关闭重规划。
_MAX_REPLAN_ATTEMPTS = max(0, int(os.environ.get("AGENTHUB_MAX_REPLAN_ATTEMPTS") or "1"))

# Phase 1b 计划确认门禁：pipeline 计划等用户批准期间的内存暂存
# （conversation_id -> (ExecutionState, TaskPlan, collab_intensity, created_monotonic)）。
# D：加 TTL 防内存泄漏/久挂；内存丢失（重启）时由 _reconstruct_pending 从 DB pending 任务重建。
_PENDING_PLANS: dict[str, tuple["ExecutionState", "TaskPlan", "str | None", float]] = {}
# D：pending 计划存活上限（秒），超时视为失效并取消其任务
_PENDING_TTL_S = max(60, int(os.environ.get("AGENTHUB_PENDING_PLAN_TTL_S") or "1800"))

# Phase 1a 澄清轮数上限（防模型反复 clarify 打断用户）；0 = 禁用 clarify。
# 在最近 _CLARIFY_WINDOW 条消息内已澄清达上限时，本轮禁止再 clarify（强制出计划）。
_MAX_CLARIFY_ROUNDS = max(0, int(os.environ.get("AGENTHUB_MAX_CLARIFY_ROUNDS") or "1"))
_CLARIFY_WINDOW = 8


async def _recent_clarify_count(factory, conversation_id: str) -> int:
    """统计最近 _CLARIFY_WINDOW 条消息内 orchestrator 发出的 clarify 轮数。

    用「近窗口」而非「全会话」计数：能拦住一次需求里的反复澄清，又不会在长会话后
    永久禁用澄清（真有进展后窗口自然滚出旧 clarify）。
    """
    from sqlalchemy import select

    from app.db.models import Message

    async with factory() as session:
        rows = (
            await session.execute(
                select(Message.meta)
                .where(Message.conversation_id == conversation_id)
                .where(Message.type == "agent")
                .order_by(Message.created_at.desc())
                .limit(_CLARIFY_WINDOW)
            )
        ).all()
    return sum(1 for (meta,) in rows if isinstance(meta, dict) and meta.get("clarify"))


# ② 启发式快路径：高置信社交/问候短消息（免 LLM 直接 direct）
_GREETING_RE = re.compile(
    r"^(你好|您好|hi|hello|hey|嗨|哈喽|在吗|在不在|早|早上好|中午好|下午好|晚上好"
    r"|谢谢|多谢|感谢|thanks|thank you|thx|ok|okay|好的|好嘞|收到|辛苦了|👍|👌)"
    r"[\s!！。.~、,，]*$",
    re.IGNORECASE,
)


def _fast_path_decision(content: str) -> "Decision | None":
    """② 启发式快路径：高置信社交/问候短消息直接 direct（免 decide 的 LLM 调用）。

    只命中极短且明确的社交语；拿不准一律返回 None，回退完整 decide，绝不误伤真实任务。
    """
    text = (content or "").strip()
    if len(text) <= 12 and _GREETING_RE.match(text):
        return Decision(
            mode="direct",
            answer="你好，我在 👋 说说你想做什么，我可以直接帮你做，或先拆成任务计划。",
        )
    return None


async def _reconstruct_pending(factory, conversation_id: str):
    """D：内存丢失（重启）时，从 DB 的 pending 任务重建待执行计划上下文。

    任务本身已持久化在 DB；这里从 Conversation/Workspace/Task/最近 user 消息重建
    ExecutionState + TaskPlan（PlannedTask.id 直接用 db_id，id_map 取恒等），供
    resume/revise 在无内存暂存时仍能批准执行。无可重建数据时返回 None。
    """
    from sqlalchemy import select

    from app.db.models import Conversation, Message, Task, Workspace

    async with factory() as session:
        conv = await session.get(Conversation, conversation_id)
        if conv is None:
            return None
        ws = (
            await session.execute(
                select(Workspace).where(Workspace.conversation_id == conversation_id)
            )
        ).scalars().first()
        if ws is None:
            return None
        rows = (
            await session.execute(
                select(Task)
                .where(Task.conversation_id == conversation_id, Task.status == "pending")
                .order_by(Task.created_at)
            )
        ).scalars().all()
        if not rows:
            return None
        umsg = (
            await session.execute(
                select(Message.content)
                .where(Message.conversation_id == conversation_id, Message.type == "user")
                .order_by(Message.created_at.desc())
                .limit(1)
            )
        ).first()
        user_instructions = (umsg[0] if umsg else None) or conv.title or ""
        tasks = [
            PlannedTask(
                id=t.id,
                agent=t.agent_role,
                title=t.title,
                depends_on=list(t.depends_on or []),
                requires_approval=t.requires_approval,
                acceptance=t.acceptance or "",
            )
            for t in rows
        ]
        plan = TaskPlan(goal=conv.title or user_instructions[:80], tasks=tasks)
        id_map = {t.id: t.id for t in rows}
        state = ExecutionState(
            conversation_id=conversation_id,
            project_name=conv.project_name or conv.title,
            workspace_path=ws.path,
            user_instructions=user_instructions,
            id_map=id_map,
            member_agent_ids=list(conv.member_agent_ids or []),
            conv_rules=conv.rules or "",
            conv_skills=(conv.settings or {}).get("skills"),
            trace_id=uuid.uuid4().hex,
        )
        collab_intensity = (conv.settings or {}).get("collab_intensity")
    return state, plan, collab_intensity


async def _take_pending(factory, conversation_id: str):
    """取出待执行计划：优先内存（TTL 内有效）；过期则取消其任务并视为无；
    内存无则从 DB 重建。返回 (state, plan, collab_intensity) 或 None。"""
    p = _PENDING_PLANS.pop(conversation_id, None)
    if p is not None:
        state, plan, collab_intensity, created = p
        if time.monotonic() - created <= _PENDING_TTL_S:
            return state, plan, collab_intensity
        async with factory() as session:
            async with session.begin():
                for db_id in state.id_map.values():
                    await task_service.update_task_status(
                        session, db_id, "cancelled", result="计划确认超时，已失效"
                    )
        return None
    return await _reconstruct_pending(factory, conversation_id)


def _sweep_expired_pending() -> None:
    """D：清除内存中已过 TTL 的暂存条目（防无界增长）；其 DB 任务由 _take_pending 兜底取消。"""
    now = time.monotonic()
    for cid in [k for k, v in _PENDING_PLANS.items() if now - v[3] > _PENDING_TTL_S]:
        _PENDING_PLANS.pop(cid, None)


async def _record_planning(factory, conversation_id: str, trace_id: str, mode: str, task_count: int) -> None:
    """#7 规划阶段埋点：补 decide() 阶段缺失的 record_event，串入本轮 trace_id。"""
    try:
        async with factory() as session:
            async with session.begin():
                await event_store.record_event(
                    session,
                    conversation_id,
                    "orchestration.planned",
                    {"traceId": trace_id, "mode": mode, "taskCount": task_count},
                    agent_role="orchestrator",
                )
    except Exception:
        logger.warning("规划阶段事件记录失败", exc_info=True)


async def _get_known_roles(factory, member_ids: list[str] | None = None) -> set[str]:
    """从 DB 动态获取可参与的 agent role（排除 orchestrator）。

    member_ids 非空时限定会话群成员（群聊模式）；空 = 全员。
    """
    from sqlalchemy import select
    from app.db.models import AgentRecord
    async with factory() as session:
        stmt = select(AgentRecord.role).where(AgentRecord.role != "orchestrator")
        if member_ids:
            stmt = stmt.where(AgentRecord.id.in_(member_ids))
        result = await session.execute(stmt)
        return {row[0] for row in result.all()}


async def _run_review_loop(
    factory,
    *,
    conversation_id: str,
    project_name: str,
    workspace_path: str,
    user_instructions: str,
    plan: TaskPlan,
    id_map: dict[str, str],
    member_ids: list[str],
    conv_rules: str,
    conv_skills,
    trace_id: str = "",
) -> None:
    """evaluator-optimizer 回环（对齐 Anthropic Building Effective Agents）。

    Reviewer 判 needs_changes 时生成「修复→复审」迷你计划回灌，循环至 approve 或达
    迭代上限。对无 reviewer / 首轮 approve 的计划是 no-op（现有行为零改变）。
    """
    from app.orchestrator.review import (
        MAX_REVIEW_ITERATIONS,
        VERDICT_NEEDS_CHANGES,
        compose_fix_instructions,
        last_reviewer_task,
    )

    if MAX_REVIEW_ITERATIONS <= 0:
        return
    reviewer = last_reviewer_task(plan)
    if reviewer is None:
        return
    review_db_id = id_map.get(reviewer.id)

    iteration = 0
    while iteration < MAX_REVIEW_ITERATIONS:
        async with factory() as session:
            meta = (
                await message_service.get_latest_agent_meta(session, review_db_id)
                if review_db_id
                else {}
            )
        verdict_info = meta.get("reviewVerdict") or {}
        if verdict_info.get("verdict") != VERDICT_NEEDS_CHANGES:
            return
        issues = verdict_info.get("issues") or []
        iteration += 1

        fix_instructions = compose_fix_instructions(user_instructions, issues)
        fix_plan = TaskPlan(
            goal=f"修复审查问题（第 {iteration} 轮）",
            tasks=[
                PlannedTask(id="fix", agent="coder", title=f"修复审查问题（第 {iteration} 轮）", depends_on=[]),
                PlannedTask(id="rev", agent="reviewer", title=f"复审（第 {iteration} 轮）", depends_on=["fix"]),
            ],
        )
        async with factory() as session:
            async with session.begin():
                await message_service.append_message(
                    session,
                    conversation_id,
                    type="agent",
                    content=f"代码审查未通过，开始第 {iteration} 轮修复并复审。",
                    agent_role="orchestrator",
                    agent_name="Orchestrator",
                )
                created = await task_service.create_tasks(
                    session,
                    conversation_id,
                    [
                        {
                            "title": t.title,
                            "agent_role": t.agent,
                            "depends_on": t.depends_on,
                            "requires_approval": False,
                            "acceptance": t.acceptance,
                        }
                        for t in fix_plan.tasks
                    ],
                )
        fix_id_map = {p.id: c.id for p, c in zip(fix_plan.tasks, created)}
        async with factory() as session:
            async with session.begin():
                await task_service.resolve_dependencies(session, fix_id_map)
        state = ExecutionState(
            conversation_id=conversation_id,
            project_name=project_name,
            workspace_path=workspace_path,
            user_instructions=fix_instructions,
            id_map=fix_id_map,
            member_agent_ids=member_ids,
            conv_rules=conv_rules,
            conv_skills=conv_skills,
            trace_id=trace_id,
        )
        await execute_plan(state, fix_plan)
        review_db_id = fix_id_map.get("rev")

    # 达到迭代上限仍未通过：留一条提示，避免静默收尾
    async with factory() as session:
        meta = (
            await message_service.get_latest_agent_meta(session, review_db_id)
            if review_db_id
            else {}
        )
    if (meta.get("reviewVerdict") or {}).get("verdict") == VERDICT_NEEDS_CHANGES:
        async with factory() as session:
            async with session.begin():
                await message_service.append_message(
                    session,
                    conversation_id,
                    type="agent",
                    content=f"已达返工上限（{MAX_REVIEW_ITERATIONS} 轮），仍有审查问题待人工处理。",
                    agent_role="orchestrator",
                    agent_name="Orchestrator",
                )


async def _collect_failed_tasks(factory, plan: TaskPlan, id_map: dict[str, str]) -> list[tuple[str, str]]:
    """收集计划中状态为 failed 的任务 (标题, 失败原因)；不含级联 cancelled。"""
    out: list[tuple[str, str]] = []
    async with factory() as session:
        for planned in plan.tasks:
            db_id = id_map.get(planned.id)
            if not db_id:
                continue
            t = await task_service.get_task(session, db_id)
            if t is not None and t.status == "failed":
                out.append((planned.title, t.result or ""))
    return out


async def _collect_task_statuses(factory, plan: TaskPlan, id_map: dict[str, str]) -> list[tuple[str, str]]:
    """收集计划中各任务 (标题, 最终状态)，供 #9a 进展记忆写入。"""
    out: list[tuple[str, str]] = []
    async with factory() as session:
        for planned in plan.tasks:
            db_id = id_map.get(planned.id)
            if not db_id:
                continue
            t = await task_service.get_task(session, db_id)
            out.append((planned.title, t.status if t is not None else "unknown"))
    return out


async def _run_failure_replan(
    factory,
    *,
    conversation_id: str,
    project_name: str,
    workspace_path: str,
    user_instructions: str,
    plan: TaskPlan,
    id_map: dict[str, str],
    member_ids: list[str],
    collab_intensity,
    conv_rules: str,
    conv_skills,
    trace_id: str = "",
) -> None:
    """#1-B 失败重规划（对齐 orchestrator-workers 动态分解）。

    主计划存在 failed 任务时，把失败原因喂回 decide() 做局部重规划并执行，封顶
    _MAX_REPLAN_ATTEMPTS 轮。无失败时 no-op（现有行为零改变）。
    """
    from app.orchestrator.task_planner import compose_replan_instructions

    if _MAX_REPLAN_ATTEMPTS <= 0:
        return
    cur_plan, cur_id_map = plan, id_map
    attempt = 0
    while attempt < _MAX_REPLAN_ATTEMPTS:
        failed = await _collect_failed_tasks(factory, cur_plan, cur_id_map)
        if not failed:
            return
        attempt += 1
        replan_instructions = compose_replan_instructions(user_instructions, failed)

        async with factory() as session:
            window = await conversation_memory.get_recent_window(
                session, conversation_id, max_messages=10
            )
            conv_context = conversation_memory.render_window(window)
            summary_text = await summary.get_conversation_summary(
                session, project_name, conversation_id
            )
            if summary_text:
                conv_context = f"[早期对话摘要]\n{summary_text}\n\n{conv_context}"

        decision = await decide(
            replan_instructions,
            conversation_context=conv_context,
            project_context="",
            member_ids=member_ids,
            collab_intensity=collab_intensity,
        )

        async with factory() as session:
            async with session.begin():
                await message_service.append_message(
                    session,
                    conversation_id,
                    type="agent",
                    content=f"检测到任务失败，正在尝试自动重规划修复（第 {attempt} 次）…",
                    agent_role="orchestrator",
                    agent_name="Orchestrator",
                )

        if decision.mode == "direct":
            async with factory() as session:
                async with session.begin():
                    await message_service.append_message(
                        session,
                        conversation_id,
                        type="agent",
                        content=decision.answer,
                        agent_role="orchestrator",
                        agent_name="Orchestrator",
                    )
            return
        recovery_plan = decision.plan
        if recovery_plan is None or not recovery_plan.tasks:
            return
        async with factory() as session:
            async with session.begin():
                created = await task_service.create_tasks(
                    session,
                    conversation_id,
                    [
                        {
                            "title": t.title,
                            "agent_role": t.agent,
                            "depends_on": t.depends_on,
                            "requires_approval": t.requires_approval,
                            "acceptance": t.acceptance,
                        }
                        for t in recovery_plan.tasks
                    ],
                )
        rec_id_map = {p.id: c.id for p, c in zip(recovery_plan.tasks, created)}
        async with factory() as session:
            async with session.begin():
                await task_service.resolve_dependencies(session, rec_id_map)
        state = ExecutionState(
            conversation_id=conversation_id,
            project_name=project_name,
            workspace_path=workspace_path,
            user_instructions=replan_instructions,
            id_map=rec_id_map,
            member_agent_ids=member_ids,
            conv_rules=conv_rules,
            conv_skills=conv_skills,
            trace_id=trace_id,
        )
        await execute_plan(state, recovery_plan)
        cur_plan, cur_id_map = recovery_plan, rec_id_map


async def rerun_task(conversation_id: str, task_id: str) -> None:
    """重试单个 failed/cancelled 任务：重建执行上下文并以单任务计划重新调度执行。

    由 REST /tasks/{id}/retry 以后台任务方式拉起，弥补"仅改状态不执行"的缺陷：
    复用 handle() 的会话/工作区准备逻辑，构造仅含该任务的 TaskPlan（依赖置空，
    上游已完成），交给 execute_plan 真正重新跑一遍。
    """
    factory = get_session_factory()
    trace_id = uuid.uuid4().hex
    project_name = ""
    workspace_path = ""
    title = ""
    agent_role = ""
    member_ids: list[str] = []
    conv_rules = ""
    conv_skills: object = None
    try:
        async with factory() as session:
            async with session.begin():
                conv = await conversation_service.get_conversation(session, conversation_id)
                if conv is None:
                    logger.warning("Conversation %s not found (rerun)", conversation_id)
                    return
                task = await task_service.get_task(session, task_id)
                if task is None or task.conversation_id != conversation_id:
                    logger.warning("Task %s not found for rerun", task_id)
                    return
                project_name = conv.project_name or conv.title
                member_ids = list(conv.member_agent_ids or [])
                conv_rules = conv.rules or ""
                conv_skills = (conv.settings or {}).get("skills")
                title = task.title
                agent_role = task.agent_role
                await conversation_service.update_status(session, conversation_id, "running")
                ws = await workspace_service.ensure_workspace(
                    session, conversation_id, project_name,
                    source_project=conv.project_path,
                )
                workspace_path = ws.path
                # 置回 pending：清上一轮执行痕迹（execute_plan 再置 running）
                await task_service.update_task_status(session, task_id, "pending")

        plan = TaskPlan(
            goal=f"重试任务：{title}",
            tasks=[PlannedTask(id="retry", agent=agent_role, title=title, depends_on=[])],
        )
        state = ExecutionState(
            conversation_id=conversation_id,
            project_name=project_name,
            workspace_path=workspace_path,
            user_instructions=title,
            id_map={"retry": task_id},
            member_agent_ids=member_ids,
            conv_rules=conv_rules,
            conv_skills=conv_skills,
            trace_id=trace_id,
        )
        await execute_plan(state, plan)
    except Exception:
        logger.exception("Task rerun failed for %s", task_id)
    finally:
        try:
            async with factory() as session:
                async with session.begin():
                    await conversation_service.update_status(session, conversation_id, "idle")
        except Exception:
            logger.warning("Failed to reset conversation status (rerun)", exc_info=True)


async def _execute_and_finalize(
    factory,
    state: "ExecutionState",
    plan: TaskPlan,
    collab_intensity: str | None,
    mode: str,
) -> None:
    """执行 DAG + 收口 + 复审回环 + 失败重规划 + 进展记忆 + 滚动压缩。

    供 handle()（single 立即执行）与 resume_plan()（pipeline 经计划确认门禁批准后执行）共用。
    """
    conversation_id = state.conversation_id
    project_name = state.project_name
    workspace_path = state.workspace_path
    content = state.user_instructions
    id_map = state.id_map
    member_ids = state.member_agent_ids
    conv_rules = state.conv_rules
    conv_skills = state.conv_skills
    trace_id = state.trace_id

    # 4. 执行 DAG
    done_count, failed_count = await execute_plan(state, plan)

    # 执行收口：仅 pipeline 发 Orchestrator 汇总（single 单任务结果已自证，不加噪音）
    total = len(plan.tasks)
    if mode == "pipeline":
        if failed_count:
            summary_line = f"任务执行完成：{done_count}/{total} 成功，{failed_count} 个失败或取消，可在任务面板查看详情或重试。"
        else:
            summary_line = f"全部 {total} 个任务执行完成。"
        async with factory() as session:
            async with session.begin():
                await message_service.append_message(
                    session,
                    conversation_id,
                    type="agent",
                    content=summary_line,
                    agent_role="orchestrator",
                    agent_name="Orchestrator",
                )

    # 4b. evaluator-optimizer 回环：Reviewer 判 needs_changes 则回灌 Coder 修复（封顶迭代）
    if mode == "pipeline":
        await _run_review_loop(
            factory,
            conversation_id=conversation_id,
            project_name=project_name,
            workspace_path=workspace_path,
            user_instructions=content,
            plan=plan,
            id_map=id_map,
            member_ids=member_ids,
            conv_rules=conv_rules,
            conv_skills=conv_skills,
            trace_id=trace_id,
        )

    # 4c. #1-B 失败重规划：主计划有 failed 任务则把失败原因喂回 decide() 局部重规划（封顶）
    if mode in ("single", "pipeline"):
        await _run_failure_replan(
            factory,
            conversation_id=conversation_id,
            project_name=project_name,
            workspace_path=workspace_path,
            user_instructions=content,
            plan=plan,
            id_map=id_map,
            member_ids=member_ids,
            collab_intensity=collab_intensity,
            conv_rules=conv_rules,
            conv_skills=conv_skills,
            trace_id=trace_id,
        )

    # 4d. #9a 文档记忆：本轮进展（消毒后）追加写入 .agenthub/progress.md（跨会话续接）
    if mode in ("single", "pipeline") and plan is not None:
        try:
            statuses = await _collect_task_statuses(factory, plan, id_map)
            success_n = sum(1 for _, s in statuses if s == "success")
            progress_log.append_progress(
                workspace_path,
                goal=plan.goal or content,
                task_lines=statuses,
                conclusion=f"{success_n}/{len(statuses)} 任务成功",
            )
            # C：把执行结果回写 spec（活文档）；仅 pipeline 有 spec 文件
            if mode == "pipeline":
                from app.services import spec_store

                spec_store.append_outcome(workspace_path, conversation_id, trace_id, statuses)
        except Exception:
            logger.warning("progress.md 收口写入失败", exc_info=True)

    # 5. 滚动压缩溢出滑动窗口的旧会话历史（独立事务，失败不影响主链路）
    try:
        async with factory() as session:
            async with session.begin():
                base_window = await conversation_memory.min_member_window(session, member_ids)
                pressure = await token_meter.get_pressure(
                    session, conversation_id, base_window,
                )
                await summary.compress_if_needed(
                    session, project_name, conversation_id, pressure=pressure,
                )
    except Exception:
        logger.warning("Conversation summary compression failed", exc_info=True)


async def resume_plan(conversation_id: str, approved: bool) -> bool:
    """计划确认门禁的恢复入口（Phase 1b）：批准则执行暂存的 pipeline 计划，否则取消。

    返回 True 表示找到并处理了暂存计划；False 表示无暂存（已执行 / 已过期 / 进程重启丢失），
    此时给用户一条提示，便于重发需求。
    """
    factory = get_session_factory()
    taken = await _take_pending(factory, conversation_id)
    if taken is None:
        async with factory() as session:
            async with session.begin():
                await message_service.append_message(
                    session,
                    conversation_id,
                    type="system",
                    content="该任务计划已失效（可能已执行或服务重启），请重新发送需求。",
                )
        return False

    state, plan, collab_intensity = taken

    if not approved:
        async with factory() as session:
            async with session.begin():
                for db_id in state.id_map.values():
                    await task_service.update_task_status(
                        session, db_id, "cancelled", result="用户取消了任务计划"
                    )
                await message_service.append_message(
                    session,
                    conversation_id,
                    type="agent",
                    content="已取消该任务计划。",
                    agent_role="orchestrator",
                    agent_name="Orchestrator",
                )
                await conversation_service.update_status(session, conversation_id, "idle")
        return True

    try:
        async with factory() as session:
            async with session.begin():
                await conversation_service.update_status(session, conversation_id, "running")
        await _execute_and_finalize(factory, state, plan, collab_intensity, "pipeline")
    except Exception:
        logger.exception("resume_plan 执行失败：%s", conversation_id)
    finally:
        try:
            async with factory() as session:
                async with session.begin():
                    await conversation_service.update_status(session, conversation_id, "idle")
        except Exception:
            logger.warning("Failed to reset conversation status", exc_info=True)
    return True


async def revise_plan(conversation_id: str, feedback: str) -> bool:
    """A：计划修改入口——取消旧未确认计划，把用户修改意见并入原需求重新规划（再次走门禁）。

    返回 True 表示找到暂存并已触发重规划；False 表示无暂存（已执行/过期/重启）。
    """
    factory = get_session_factory()
    taken = await _take_pending(factory, conversation_id)
    if taken is None:
        async with factory() as session:
            async with session.begin():
                await message_service.append_message(
                    session,
                    conversation_id,
                    type="system",
                    content="该任务计划已失效（可能已执行或服务重启），请重新发送需求。",
                )
        return False

    state, _plan, _ci = taken
    async with factory() as session:
        async with session.begin():
            for db_id in state.id_map.values():
                await task_service.update_task_status(
                    session, db_id, "cancelled", result="计划按用户修改意见重做"
                )

    original = state.user_instructions or ""
    revised = (
        f"{original}\n\n## 用户对上一版计划的修改意见（请据此重新规划）\n{feedback.strip()}"
    )
    from app.core.message_handler import get_message_handler

    await get_message_handler().handle(conversation_id, revised, None)
    return True


class OrchestratorEngine(IMessageHandler):
    async def handle(
        self, conversation_id: str, content: str, target_agent: Optional[str]
    ) -> None:
        factory = get_session_factory()
        trace_id = uuid.uuid4().hex  # #7 本轮请求 trace，贯穿规划与各任务事件
        try:
            # 1. 会话置为 running + 确保 workspace 存在
            async with factory() as session:
                async with session.begin():
                    conv = await conversation_service.get_conversation(session, conversation_id)
                    if conv is None:
                        logger.warning("Conversation %s not found", conversation_id)
                        return
                    project_name = conv.project_name or conv.title
                    # 群聊配置：成员限定 / 群规则 / 会话级技能 / 协作强度
                    member_ids = list(conv.member_agent_ids or [])
                    conv_rules = conv.rules or ""
                    conv_skills = (conv.settings or {}).get("skills")
                    collab_intensity = (conv.settings or {}).get("collab_intensity")
                    await conversation_service.update_status(session, conversation_id, "running")
                    ws = await workspace_service.ensure_workspace(
                        session, conversation_id, project_name,
                        source_project=conv.project_path,
                    )
                    workspace_path = ws.path

            # 2. 意图分流：@直达跳过决策器；其余走决策器（direct/single/pipeline）
            known_roles = await _get_known_roles(factory, member_ids)
            if target_agent and target_agent in known_roles:
                decision = Decision(
                    mode="single",
                    plan=TaskPlan(
                        goal=content[:80],
                        tasks=[
                            PlannedTask(
                                id="t1",
                                agent=target_agent,
                                title=f"@{target_agent}: {content[:60]}",
                                depends_on=[],
                                requires_approval=target_agent == "deployer",
                            )
                        ],
                    ),
                )
            else:
                # ② 启发式快路径：高置信社交/问候消息免 LLM；拿不准回退完整 decide
                decision = _fast_path_decision(content)
                if decision is None:
                    async with factory() as session:
                        window = await conversation_memory.get_recent_window(
                            session, conversation_id, max_messages=10
                        )
                        conv_context = conversation_memory.render_window(window)
                        summary_text = await summary.get_conversation_summary(
                            session, project_name, conversation_id
                        )
                        if summary_text:
                            conv_context = f"[早期对话摘要]\n{summary_text}\n\n{conv_context}"
                    # Phase 4：把项目宪法（AGENTHUB.md + 全局规则）喂给规划器，使计划对齐宪法
                    from app.orchestrator.context_builder import load_custom_rules

                    constitution = load_custom_rules(workspace_path)
                    # Phase 1a 澄清轮数上限：近窗口已达上限则本轮禁止再 clarify（强制出计划）
                    allow_clarify = (
                        await _recent_clarify_count(factory, conversation_id)
                    ) < _MAX_CLARIFY_ROUNDS
                    decision = await decide(
                        content,
                        conversation_context=conv_context,
                        project_context=constitution,
                        member_ids=member_ids,
                        collab_intensity=collab_intensity,
                        allow_clarify=allow_clarify,
                    )

            # 3a. direct：Orchestrator 直接回答，0 个下游任务（问答/闲聊一次出结果）
            if decision.mode == "direct":
                async with factory() as session:
                    async with session.begin():
                        await message_service.append_message(
                            session,
                            conversation_id,
                            type="agent",
                            content=decision.answer,
                            agent_role="orchestrator",
                            agent_name="Orchestrator",
                        )
                await _record_planning(factory, conversation_id, trace_id, "direct", 0)
                return

            # 3a-2. clarify（Phase 1a 规划期澄清）：发"问题 + 候选项"给用户，不执行任何任务。
            # 选项随消息 meta.clarify 下发，前端渲染为快捷按钮；用户的选择作为下一条消息
            # 重新进入 decide()，天然复用逐消息处理，无需挂起/恢复。
            if decision.mode == "clarify":
                async with factory() as session:
                    async with session.begin():
                        await message_service.append_message(
                            session,
                            conversation_id,
                            type="agent",
                            content=decision.question,
                            agent_role="orchestrator",
                            agent_name="Orchestrator",
                            meta={
                                "clarify": {
                                    "question": decision.question,
                                    "options": decision.options,
                                    "recommended": decision.recommended,
                                }
                            },
                        )
                await _record_planning(factory, conversation_id, trace_id, "clarify", 0)
                return

            # 3b. single/pipeline：落任务；仅 pipeline 发任务计划消息（single 直接执行）
            plan = decision.plan
            if plan is None or not plan.tasks:
                return
            async with factory() as session:
                async with session.begin():
                    created = await task_service.create_tasks(
                        session,
                        conversation_id,
                        [
                            {
                                "title": t.title,
                                "agent_role": t.agent,
                                "depends_on": t.depends_on,
                                "requires_approval": t.requires_approval,
                                "acceptance": t.acceptance,
                            }
                            for t in plan.tasks
                        ],
                    )

            # planned id -> DB id（create_tasks 返回顺序与传入一致）
            id_map = {planned.id: db_task.id for planned, db_task in zip(plan.tasks, created)}

            # 回填 depends_on 为真实 DB id（前端据此连边渲染 DAG）
            async with factory() as session:
                async with session.begin():
                    await task_service.resolve_dependencies(session, id_map)

            # #7 规划阶段埋点（补 decide 阶段缺失的 record_event，含 trace_id）
            await _record_planning(factory, conversation_id, trace_id, decision.mode, len(plan.tasks))

            # Phase 0 规格落盘：仅 pipeline（复杂多步）写可评审的 spec 文档（SDD 第一类 artifact）
            if decision.mode == "pipeline":
                from app.services import spec_store

                spec_store.write_spec(
                    workspace_path,
                    plan,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    instructions=content,
                )
                # item 2：同时落 Spec Kit 三件套（requirements/design/tasks.md）供文件级评审/逐条编辑
                spec_store.write_spec_triplet(
                    workspace_path,
                    plan,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    instructions=content,
                )

            # 4. 执行 DAG
            state = ExecutionState(
                conversation_id=conversation_id,
                project_name=project_name,
                workspace_path=workspace_path,
                user_instructions=content,
                id_map=id_map,
                member_agent_ids=member_ids,
                conv_rules=conv_rules,
                conv_skills=conv_skills,
                trace_id=trace_id,
            )
            # Phase 1b 计划确认门禁：pipeline 不立即执行——暂存计划 + 发"计划+待确认"卡片 + return；
            # 用户经 POST /conversations/{id}/plan/confirm 批准后由 resume_plan 执行；single 直接执行。
            if decision.mode == "pipeline":
                _sweep_expired_pending()  # D：顺带清理其它会话已过期的暂存条目
                # 覆盖前清理上一份未确认计划的 pending 任务，避免孤儿（用户门禁期重发需求时）
                stale = _PENDING_PLANS.pop(conversation_id, None)
                if stale is not None:
                    async with factory() as session:
                        async with session.begin():
                            for db_id in stale[0].id_map.values():
                                await task_service.update_task_status(
                                    session, db_id, "cancelled", result="计划被新需求取代"
                                )
                _PENDING_PLANS[conversation_id] = (state, plan, collab_intensity, time.monotonic())
                # 计划详情 + 确认按钮合并为一条消息（meta.planConfirm 驱动前端按钮）
                plan_lines = [f"**任务计划**：{plan.goal}", ""]
                for i, t in enumerate(plan.tasks, 1):
                    dep = f"（依赖 {', '.join(t.depends_on)}）" if t.depends_on else ""
                    plan_lines.append(f"{i}. {t.title} `@{t.agent}`{dep}")
                plan_lines += ["", "请确认后执行。"]
                async with factory() as session:
                    async with session.begin():
                        await message_service.append_message(
                            session,
                            conversation_id,
                            type="agent",
                            content="\n".join(plan_lines),
                            agent_role="orchestrator",
                            agent_name="Orchestrator",
                            meta={
                                "planConfirm": {
                                    "goal": plan.goal,
                                    "taskCount": len(plan.tasks),
                                }
                            },
                        )
                return

            await _execute_and_finalize(factory, state, plan, collab_intensity, decision.mode)

        except Exception:
            logger.exception("Orchestrator engine failed for conversation %s", conversation_id)
        finally:
            # 6. 会话状态收口
            try:
                async with factory() as session:
                    async with session.begin():
                        await conversation_service.update_status(session, conversation_id, "idle")
            except Exception:
                logger.warning("Failed to reset conversation status", exc_info=True)
