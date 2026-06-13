"""需求 -> 结构化任务计划（PRD §3.1 / §6.1）。

调用 LLM 生成 {goal, tasks[]} JSON；LLM 不可用时回退到规则模板，
保证无 API Key 环境（Mock 演示）下编排链路依然完整。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

from app.orchestrator.prompts import (
    AgentSpec,
    ORCHESTRATOR_USER_TEMPLATE,
    build_orchestrator_system,
    intensity_hint,
)

logger = logging.getLogger(__name__)

# 决策 JSON 解析失败重试次数（LLM 偶发格式坏，重试比直接降级单步更稳）
_DECISION_MAX_ATTEMPTS = 2


async def _execute_decision(adapter, ctx) -> str:
    """执行一次决策调用，返回原始文本（completed.result 优先，否则 thinking 累积）。"""
    full_text: list[str] = []
    async for event in adapter.execute(ctx):
        if event.type == "thinking":
            text = str(event.data.get("text", ""))
            if text:
                full_text.append(text)
        elif event.type == "completed":
            result = str(event.data.get("result", ""))
            if result:
                full_text = [result]
            break
        elif event.type == "error":
            break
    return "".join(full_text)


async def _get_agent_specs(member_ids: list[str] | None = None) -> list[AgentSpec]:
    """从 DB 动态获取可参与 agent 的 prompt 生成参数（排除 orchestrator）。

    member_ids 非空时限定会话群成员（群聊模式）；空 = 全部启用 agent。
    """
    try:
        from sqlalchemy import select
        from app.db.engine import get_session_factory
        from app.db.models import AgentRecord
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(AgentRecord).where(
                AgentRecord.role != "orchestrator",
                AgentRecord.enabled.is_(True),
            )
            if member_ids:
                stmt = stmt.where(AgentRecord.id.in_(member_ids))
            result = await session.execute(stmt)
            specs = [
                AgentSpec(
                    role=r.role,
                    name=r.name or "",
                    description=r.description or "",
                    skills=r.skills or "",
                    capabilities=r.capabilities or {},
                    system_prompt=r.system_prompt or "",
                )
                for r in result.scalars().all()
            ]
            return specs
    except Exception:
        return []


async def _get_orchestrator_adapter_pref() -> str:
    """读取 Orchestrator 在 DB 中指定的适配器偏好（未指定返回空串）。"""
    try:
        from sqlalchemy import select
        from app.db.engine import get_session_factory
        from app.db.models import AgentRecord
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(AgentRecord.adapter_type).where(AgentRecord.role == "orchestrator")
            )
            row = result.first()
            return (row[0] or "") if row else ""
    except Exception:
        return ""


@dataclass
class PlannedTask:
    id: str
    agent: str
    title: str
    depends_on: list[str] = field(default_factory=list)
    requires_approval: bool = False


@dataclass
class TaskPlan:
    goal: str
    tasks: list[PlannedTask]


@dataclass
class Decision:
    """调度决策器输出：意图分流结果。

    - mode=direct：Orchestrator 直接回答，answer 为答复正文，plan 为 None
    - mode=single：派 1 个 agent 执行，plan 含单任务，不发任务计划消息
    - mode=pipeline：多步协作，plan 含 DAG，发任务计划消息
    """

    mode: str
    answer: str = ""
    plan: TaskPlan | None = None


def _extract_json(raw: str) -> dict | None:
    """从 LLM 文本提取 JSON 对象（容忍 markdown 代码围栏）。"""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _parse_tasks(raw_tasks: object, goal: str, valid_agents: set[str]) -> TaskPlan | None:
    """校验并构建 DAG 任务计划（依赖完整性 + 无环）。"""
    if not goal or not isinstance(raw_tasks, list) or not raw_tasks:
        return None

    tasks: list[PlannedTask] = []
    seen_ids: set[str] = set()
    for item in raw_tasks:
        if not isinstance(item, dict):
            return None
        tid = str(item.get("id", "")).strip()
        agent = str(item.get("agent", "")).strip().lower()
        title = str(item.get("title", "")).strip()
        if not tid or tid in seen_ids or agent not in valid_agents or not title:
            return None
        deps = item.get("dependsOn") or []
        if not isinstance(deps, list):
            return None
        tasks.append(
            PlannedTask(
                id=tid,
                agent=agent,
                title=title,
                depends_on=[str(d) for d in deps],
                requires_approval=bool(item.get("requiresApproval", False))
                or agent == "deployer",  # 部署强制审批
            )
        )
        seen_ids.add(tid)

    # 依赖引用完整性 + 无环校验（拓扑排序）
    for t in tasks:
        for dep in t.depends_on:
            if dep not in seen_ids:
                return None
    if not _is_dag(tasks):
        return None

    return TaskPlan(goal=goal, tasks=tasks)


def _parse_decision(raw: str, valid_agents: set[str]) -> Decision | None:
    """解析调度决策器输出为 Decision（无法识别返回 None，由调用方回退）。"""
    data = _extract_json(raw)
    if data is None:
        return None
    mode = str(data.get("mode", "")).strip().lower()

    if mode == "direct":
        answer = str(data.get("answer", "")).strip()
        if not answer:
            return None
        return Decision(mode="direct", answer=answer)

    if mode == "single":
        agent = str(data.get("agent", "")).strip().lower()
        title = str(data.get("title", "")).strip()
        if agent not in valid_agents or not title:
            return None
        plan = TaskPlan(
            goal=title,
            tasks=[
                PlannedTask(
                    id="t1",
                    agent=agent,
                    title=title,
                    depends_on=[],
                    requires_approval=agent == "deployer",
                )
            ],
        )
        return Decision(mode="single", plan=plan)

    if mode == "pipeline":
        goal = str(data.get("goal", "")).strip()
        plan = _parse_tasks(data.get("tasks"), goal, valid_agents)
        if plan is None:
            return None
        return Decision(mode="pipeline", plan=plan)

    return None


def _is_dag(tasks: list[PlannedTask]) -> bool:
    indegree = {t.id: len(t.depends_on) for t in tasks}
    children: dict[str, list[str]] = {t.id: [] for t in tasks}
    for t in tasks:
        for dep in t.depends_on:
            children[dep].append(t.id)
    queue = [tid for tid, d in indegree.items() if d == 0]
    visited = 0
    while queue:
        node = queue.pop()
        visited += 1
        for child in children[node]:
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    return visited == len(tasks)


def _fallback_decision(instructions: str, valid_agents: set[str] | None = None) -> Decision:
    """决策器不可用 / 解析失败时的规则回退：单步任务（不再无脑三段链）。

    无法判定意图时，选一个可执行角色直接处理（优先 coder），
    比拆 planner->coder->reviewer 三段链省 token，且仍能动手。
    """
    goal = instructions.strip()[:80] or "执行任务"
    roles = valid_agents or {"planner", "coder", "reviewer", "deployer"}
    agent = next(
        (r for r in ("coder", "planner", "reviewer") if r in roles),
        sorted(roles)[0] if roles else "coder",
    )
    plan = TaskPlan(
        goal=goal,
        tasks=[
            PlannedTask(
                id="t1",
                agent=agent,
                title=f"执行任务：{goal}",
                depends_on=[],
                requires_approval=agent == "deployer",
            )
        ],
    )
    return Decision(mode="single", plan=plan)


async def decide(
    instructions: str,
    *,
    conversation_context: str = "",
    project_context: str = "",
    member_ids: list[str] | None = None,
    collab_intensity: str | None = None,
) -> Decision:
    """意图分流决策（member_ids 非空时只在会话群成员中分派）。

    一次 LLM 调用同时完成"判意图 + 简单情况直接出答案"：
    - direct：Orchestrator 直接回答，0 个下游任务
    - single：派 1 个 agent 执行
    - pipeline：DAG 多步协作
    collab_intensity（lite/standard/strict）作为倾向提示注入决策器。
    决策器不可用或解析失败时回退到单步任务（_fallback_decision）。
    """
    specs = await _get_agent_specs(member_ids)
    valid_agents = (
        {s.role for s in specs} if specs else {"planner", "coder", "reviewer", "deployer"}
    )

    try:
        from app.core.registry import get_global_registry

        registry = get_global_registry()
        from app.orchestrator.agent_router import PLANNING_PRIORITY

        # Orchestrator 在 DB 指定了适配器偏好时优先使用，其余按规划优先级探测
        # （claude-code -> codex；排除 mock：mock 假文本必然解析失败，直接走规则回退）
        pref = await _get_orchestrator_adapter_pref()
        candidates = ([pref] if pref else []) + [n for n in PLANNING_PRIORITY if n != pref]

        for adapter_name in candidates:
            adapter = registry.get(adapter_name)
            if adapter is None:
                continue
            try:
                if not await adapter.health_check():
                    continue
            except Exception:
                continue

            from app.adapters.base import AdapterContext, UnifiedApprovalMode, UnifiedSandboxLevel

            decision_prompt = build_orchestrator_system(specs) + "\n\n" + ORCHESTRATOR_USER_TEMPLATE.format(
                instructions=instructions,
                conversation_context=conversation_context or "（无）",
                project_context=project_context or "（无）",
                intensity_hint=intensity_hint(collab_intensity),
            )
            ctx = AdapterContext(
                instructions=decision_prompt,
                workspace_path=".",
                approval_mode=UnifiedApprovalMode.AUTO,
                sandbox_level=UnifiedSandboxLevel.READ_ONLY,
            )
            # JSON 解析失败重试：LLM 偶发格式坏，同一适配器重试比直接降级单步更稳
            for attempt in range(_DECISION_MAX_ATTEMPTS):
                raw = await _execute_decision(adapter, ctx)
                if not raw:
                    break
                decision = _parse_decision(raw, valid_agents)
                if decision:
                    return decision
                logger.warning(
                    "Decision parse failed (attempt %d/%d): %s",
                    attempt + 1, _DECISION_MAX_ATTEMPTS, raw[:200],
                )
            break
    except Exception:
        logger.warning("Decision routing failed, using fallback", exc_info=True)

    return _fallback_decision(instructions, valid_agents)
