"""需求 -> 结构化任务计划（PRD §3.1 / §6.1）。

调用 LLM 生成 {goal, tasks[]} JSON；LLM 不可用时回退到规则模板，
保证无 API Key 环境（Mock 演示）下编排链路依然完整。
"""

from __future__ import annotations

import json
import logging
import os
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

# #10 fan-out 封顶：单任务最多并行方案数（成本护栏，防 N 倍 LLM 调用爆炸）
_FAN_OUT_CAP = max(1, int(os.environ.get("AGENTHUB_FAN_OUT_CAP") or "3"))


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
                    skill_specs=r.skill_specs or [],
                    capabilities=r.capabilities or {},
                    system_prompt=r.system_prompt or "",
                )
                for r in result.scalars().all()
            ]
            return specs
    except Exception:
        return []


async def _get_orchestrator_routing() -> tuple[str, dict[str, str], str]:
    """读取 Orchestrator 的 adapter 偏好 + provider 配置 + model（规划复用其凭证）。

    规划调用须带 orchestrator 的 provider_config（base_url/auth_token）与 model：缺 provider
    时，配了第三方 base_url 的 codex/claude 规划会回退本地登录态而失败 → fallback single，
    多步需求被误降为单任务（实测 codex 多 agent 协作失效的根因）。
    """
    try:
        from sqlalchemy import select
        from app.db.engine import get_session_factory
        from app.db.models import AgentRecord
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(
                    AgentRecord.adapter_type,
                    AgentRecord.provider_config,
                    AgentRecord.model,
                ).where(AgentRecord.role == "orchestrator")
            )
            row = result.first()
            if not row:
                return "", {}, ""
            raw_provider = row[1] or {}
            provider = {
                k: v.strip()
                for k, v in raw_provider.items()
                if isinstance(v, str) and v.strip()
            }
            return (row[0] or ""), provider, (row[2] or "")
    except Exception:
        return "", {}, ""


@dataclass
class PlannedTask:
    id: str
    agent: str
    title: str
    depends_on: list[str] = field(default_factory=list)
    requires_approval: bool = False
    # #10 >1 时该任务派 N 个 cross-model attempt 并行出方案（只读），裁决择优后单点落地
    fan_out: int = 1


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
        raw_fan = item.get("fanOut", 1)
        fan_out = (
            max(1, min(_FAN_OUT_CAP, int(raw_fan)))
            if isinstance(raw_fan, (int, float)) and not isinstance(raw_fan, bool)
            else 1
        )
        tasks.append(
            PlannedTask(
                id=tid,
                agent=agent,
                title=title,
                depends_on=[str(d) for d in deps],
                requires_approval=bool(item.get("requiresApproval", False))
                or agent == "deployer",  # 部署强制审批
                fan_out=fan_out,
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


def compose_replan_instructions(original: str, failed: list[tuple[str, str]]) -> str:
    """把失败任务清单作为局部重规划上下文喂回 decide()（orchestrator-workers 动态分解）。

    只针对失败点请求修复 / 替代方案，避免重复已成功的工作（对齐详细 delegation）。
    """
    lines = "\n".join(
        f"- {title}：{(reason or '失败原因未知')[:300]}" for title, reason in failed
    )
    return (
        f"{original}\n\n"
        "## 上一轮以下任务失败，请给出修复或替代方案（只针对失败点，不要重复已成功的工作）\n"
        f"{lines}"
    )


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
        pref, pref_provider, pref_model = await _get_orchestrator_routing()
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
            # 规划复用 orchestrator 凭证：用其偏好 adapter 时注入 provider/model，否则配了
            # 第三方 base_url 的 codex/claude 规划缺凭证回退本地登录态而失败 → fallback single
            use_pref = adapter_name == pref
            ctx = AdapterContext(
                instructions=decision_prompt,
                workspace_path=".",
                approval_mode=UnifiedApprovalMode.AUTO,
                sandbox_level=UnifiedSandboxLevel.READ_ONLY,
                # #6 规划走轻模型；未配置回退 orchestrator.model（保证第三方有权 model）
                model=adapter.light_model or (pref_model if use_pref else None),
                provider=(pref_provider if use_pref else None) or None,
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
