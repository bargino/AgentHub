"""Orchestrator 编排引擎（PRD §3 核心业务流程）。

实现 IMessageHandler：接收用户消息 -> 任务规划 -> DAG 执行 -> 状态收口。
@agent 直接路由时跳过规划，单任务执行。
"""

from __future__ import annotations

import logging
from typing import Optional

from app.core.message_handler import IMessageHandler
from app.db.engine import get_session_factory
from app.memory import conversation_memory, project_memory, summary, token_meter
from app.orchestrator.task_executor import ExecutionState, execute_plan
from app.orchestrator.task_planner import Decision, PlannedTask, TaskPlan, decide
from app.services import conversation as conversation_service
from app.services import message as message_service
from app.services import task as task_service
from app.services import workspace as workspace_service

logger = logging.getLogger(__name__)


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


class OrchestratorEngine(IMessageHandler):
    async def handle(
        self, conversation_id: str, content: str, target_agent: Optional[str]
    ) -> None:
        factory = get_session_factory()
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
                    proj_context = await project_memory.render_project_context(
                        session, project_name
                    )
                decision = await decide(
                    content,
                    conversation_context=conv_context,
                    project_context=proj_context,
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
