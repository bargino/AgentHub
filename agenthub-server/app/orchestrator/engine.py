"""Orchestrator 编排引擎（PRD §3 核心业务流程）。

实现 IMessageHandler：接收用户消息 -> 任务规划 -> DAG 执行 -> 状态收口。
@agent 直接路由时跳过规划，单任务执行。
"""

from __future__ import annotations

import logging
import os
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
                    content,
                    conversation_context=conv_context,
                    project_context="",
                    member_ids=member_ids,
                    collab_intensity=collab_intensity,
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
                            }
                            for t in plan.tasks
                        ],
                    )
                    if decision.mode == "pipeline":
                        # 多步协作才展示任务计划（头像气泡，会话流内可见）
                        plan_lines = [f"**任务计划**：{plan.goal}", ""]
                        for i, t in enumerate(plan.tasks, 1):
                            dep = f"（依赖 {', '.join(t.depends_on)}）" if t.depends_on else ""
                            plan_lines.append(f"{i}. {t.title} `@{t.agent}`{dep}")
                        await message_service.append_message(
                            session,
                            conversation_id,
                            type="agent",
                            content="\n".join(plan_lines),
                            agent_role="orchestrator",
                            agent_name="Orchestrator",
                        )

            # planned id -> DB id（create_tasks 返回顺序与传入一致）
            id_map = {planned.id: db_task.id for planned, db_task in zip(plan.tasks, created)}

            # 回填 depends_on 为真实 DB id（前端据此连边渲染 DAG）
            async with factory() as session:
                async with session.begin():
                    await task_service.resolve_dependencies(session, id_map)

            # #7 规划阶段埋点（补 decide 阶段缺失的 record_event，含 trace_id）
            await _record_planning(factory, conversation_id, trace_id, decision.mode, len(plan.tasks))

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
            done_count, failed_count = await execute_plan(state, plan)

            # 执行收口：仅 pipeline 发 Orchestrator 汇总（single 单任务结果已自证，不加噪音）
            total = len(plan.tasks)
            if decision.mode == "pipeline":
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
            if decision.mode == "pipeline":
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
            if decision.mode in ("single", "pipeline"):
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
            if decision.mode in ("single", "pipeline") and plan is not None:
                try:
                    statuses = await _collect_task_statuses(factory, plan, id_map)
                    success_n = sum(1 for _, s in statuses if s == "success")
                    progress_log.append_progress(
                        workspace_path,
                        goal=plan.goal or content,
                        task_lines=statuses,
                        conclusion=f"{success_n}/{len(statuses)} 任务成功",
                    )
                except Exception:
                    logger.warning("progress.md 收口写入失败", exc_info=True)

            # 5. 滚动压缩溢出滑动窗口的旧会话历史（独立事务，失败不影响主链路）。
            # 压力等级取自本轮真实 token 计量：压力高时压缩边界前移（窗口减半）
            try:
                async with factory() as session:
                    async with session.begin():
                        # 群级压缩基准取群成员最小窗口（保守：连最小窗口 agent
                        # 都不溢出）；压力按会话级（最近任意 agent 占用）判断
                        base_window = await conversation_memory.min_member_window(
                            session, member_ids
                        )
                        pressure = await token_meter.get_pressure(
                            session, conversation_id, base_window,
                        )
                        await summary.compress_if_needed(
                            session, project_name, conversation_id,
                            pressure=pressure,
                        )
            except Exception:
                logger.warning("Conversation summary compression failed", exc_info=True)

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
