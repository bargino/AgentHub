"""需求 -> 结构化任务spec（PRD §3.1 / §6.1）。

调用 LLM 生成 {goal, tasks[]} JSON；LLM 不可用 / 解析失败时回退到规则模板，
保证决策器异常时编排链路依然完整。
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
    PLAN_REVISE_SYSTEM,
    PLAN_REVISE_USER_TEMPLATE,
    build_orchestrator_system,
    intensity_hint,
)

logger = logging.getLogger(__name__)

# 决策 JSON 解析失败重试次数（LLM 偶发格式坏，重试比直接降级单步更稳）
_DECISION_MAX_ATTEMPTS = 2

# #10 fan-out 封顶：单任务最多并行方案数（成本护栏，防 N 倍 LLM 调用爆炸）
_FAN_OUT_CAP = max(1, int(os.environ.get("AGENTHUB_FAN_OUT_CAP") or "3"))

# F：默认可分派角色（DB 无 agent 时的回退）——单一真相源，避免多处硬编码漂移
_DEFAULT_ROLES = ("planner", "coder", "reviewer", "deployer")

# item 1：决策自检纠偏阈值。single/direct 决策若模型自评低置信或高复杂，且本轮允许澄清，
# 则回退 clarify 让用户定夺（避免"复杂误判为单步直接执行"）。0 置信视为未给、不纠偏。
_MIN_DECISION_CONFIDENCE = max(0.0, min(1.0, float(os.environ.get("AGENTHUB_MIN_DECISION_CONFIDENCE") or "0.55")))
_HIGH_COMPLEXITY = max(1, int(os.environ.get("AGENTHUB_HIGH_COMPLEXITY") or "4"))

# item 4：规划→批判→修订。仅对高复杂度 pipeline spec跑一次自评改进（额外 1 次轻模型 LLM 调用）；
# 默认开，可用 AGENTHUB_PLAN_CRITIQUE=0 关闭。complexity 阈值与触发面用 _PLAN_CRITIQUE_COMPLEXITY。
_PLAN_CRITIQUE_ON = (os.environ.get("AGENTHUB_PLAN_CRITIQUE") or "1").strip().lower() not in ("0", "false", "off", "no")
_PLAN_CRITIQUE_COMPLEXITY = max(1, int(os.environ.get("AGENTHUB_PLAN_CRITIQUE_COMPLEXITY") or "4"))


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
class SpecTask:
    id: str
    agent: str
    title: str
    depends_on: list[str] = field(default_factory=list)
    requires_approval: bool = False
    # Phase 2：EARS 风格验收标准（"当 X，系统应 Y"），供spec落盘与 reviewer/eval 对标
    acceptance: str = ""
    # #10 >1 时该任务派 N 个 cross-model attempt 并行出方案（只读），裁决择优后单点落地
    fan_out: int = 1


@dataclass
class TaskSpec:
    goal: str
    tasks: list[SpecTask]
    # P1：非目标 / 超出范围（Out of Scope）——显式约束 agent 探索边界，落 requirements.md
    out_of_scope: list[str] = field(default_factory=list)


def analyze_spec(plan: TaskSpec) -> list[str]:
    """SDD Analyze 阶段：交叉核对 spec↔tasks 一致性，返回告警清单（空=通过）。

    只读静态核对，不修改 spec；供落盘 analyze.md 与日志提示，作为执行前「spec=评测」的轻量门禁。
    """
    if plan is None or not plan.tasks:
        return ["spec 为空：无任何任务"]
    warnings: list[str] = []
    # 1. 每个任务应有 EARS 验收，否则实现/复审无可对标基线
    missing = [t.id for t in plan.tasks if not (t.acceptance or "").strip()]
    if missing:
        warnings.append(f"缺少 EARS 验收标准的任务：{', '.join(missing)}")
    # 2. 任务标题重复（可能是冗余拆分或复制漏改）
    seen: dict[str, int] = {}
    for t in plan.tasks:
        key = t.title.strip()
        seen[key] = seen.get(key, 0) + 1
    dups = [title for title, n in seen.items() if title and n > 1]
    if dups:
        warnings.append(f"任务标题重复：{', '.join(dups)}")
    # 3. 含代码实现但无 reviewer 收尾 → 验收闭环缺口
    agents = {t.agent for t in plan.tasks}
    if "coder" in agents and "reviewer" not in agents:
        warnings.append("含代码实现任务但无 reviewer 收尾：建议补审查以闭合验收")
    return warnings


@dataclass
class Decision:
    """调度决策器输出：意图分流结果。

    - mode=direct：Orchestrator 直接回答，answer 为答复正文，spec 为 None
    - mode=single：派 1 个 agent 执行，spec 含单任务，不发任务spec消息
    - mode=pipeline：多步协作，spec 含 DAG，发任务spec消息
    - mode=clarify：先向用户澄清（question + options[] + recommended），不执行任务
    """

    mode: str
    answer: str = ""
    spec: TaskSpec | None = None
    # mode=clarify：规划期交互澄清（Phase 1a）
    question: str = ""
    options: list[str] = field(default_factory=list)
    recommended: int = -1
    # 决策自评（item 1）：confidence∈[0,1] 模型对本决策的把握；complexity∈[1,5] 任务复杂度
    # （0=未给）。供"低置信/高复杂的 single/direct 回退 clarify"的兜底纠偏。
    confidence: float = 1.0
    complexity: int = 0


def _first_json_object(text: str) -> str | None:
    """E：扫描出第一个大括号平衡的 JSON 对象子串（正确跳过字符串内的花括号/转义）。

    用于容忍 LLM 在 JSON 前后夹带说明文字（如"好的，spec如下：{...}"）。
    """
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _extract_json(raw: str) -> dict | None:
    """从 LLM 文本提取 JSON 对象（容忍 markdown 代码围栏 + 前后夹带文字）。"""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass
    # E：直解失败时，提取首个大括号平衡对象再试（抗 LLM 前后夹带说明）
    obj = _first_json_object(text)
    if obj is None:
        return None
    try:
        data = json.loads(obj)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _parse_tasks(raw_tasks: object, goal: str, valid_agents: set[str]) -> TaskSpec | None:
    """校验并构建 DAG 任务spec（依赖完整性 + 无环）。"""
    if not goal or not isinstance(raw_tasks, list) or not raw_tasks:
        return None

    tasks: list[SpecTask] = []
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
            SpecTask(
                id=tid,
                agent=agent,
                title=title,
                depends_on=[str(d) for d in deps],
                requires_approval=bool(item.get("requiresApproval", False))
                or agent == "deployer",  # 部署强制审批
                # H：折叠空白为单行，保证验收标准规整、表格安全
                acceptance=" ".join(str(item.get("acceptance", "")).split())[:500],
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

    return TaskSpec(goal=goal, tasks=tasks)


def _self_assessment(data: dict) -> tuple[float, int]:
    """item 1：解析模型自评 confidence∈[0,1] 与 complexity∈[1,5]（缺/非法→1.0/0）。"""
    try:
        conf = max(0.0, min(1.0, float(data.get("confidence"))))
    except (TypeError, ValueError):
        conf = 1.0
    try:
        cplx = max(0, min(5, int(data.get("complexity"))))
    except (TypeError, ValueError):
        cplx = 0
    return conf, cplx


def _parse_str_list(raw: object, *, max_items: int = 12, max_len: int = 200) -> list[str]:
    """解析字符串数组（容错非 list / 空项 / 超长），用于 outOfScope 等可选清单。"""
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        s = " ".join(str(item).split())[:max_len]
        if s:
            out.append(s)
        if len(out) >= max_items:
            break
    return out


def _parse_decision(raw: str, valid_agents: set[str]) -> Decision | None:
    """解析调度决策器输出为 Decision（无法识别返回 None，由调用方回退）。"""
    data = _extract_json(raw)
    if data is None:
        return None
    mode = str(data.get("mode", "")).strip().lower()
    conf, cplx = _self_assessment(data)

    if mode == "direct":
        answer = str(data.get("answer", "")).strip()
        if not answer:
            return None
        return Decision(mode="direct", answer=answer, confidence=conf, complexity=cplx)

    if mode == "clarify":
        question = str(data.get("question", "")).strip()
        raw_opts = data.get("options")
        options = (
            [str(o).strip() for o in raw_opts if str(o).strip()]
            if isinstance(raw_opts, list)
            else []
        )
        # 澄清至少要有问题 + 2 个可选项，否则视为无效决策由调用方回退
        if not question or len(options) < 2:
            return None
        options = options[:6]
        rec = data.get("recommended", -1)
        recommended = (
            rec
            if isinstance(rec, int) and not isinstance(rec, bool) and 0 <= rec < len(options)
            else -1
        )
        return Decision(
            mode="clarify", question=question, options=options, recommended=recommended,
            confidence=conf, complexity=cplx,
        )

    if mode == "single":
        agent = str(data.get("agent", "")).strip().lower()
        title = str(data.get("title", "")).strip()
        if agent not in valid_agents or not title:
            return None
        plan = TaskSpec(
            goal=title,
            tasks=[
                SpecTask(
                    id="t1",
                    agent=agent,
                    title=title,
                    depends_on=[],
                    requires_approval=agent == "deployer",
                )
            ],
        )
        return Decision(mode="single", spec=plan, confidence=conf, complexity=cplx)

    if mode == "pipeline":
        goal = str(data.get("goal", "")).strip()
        plan = _parse_tasks(data.get("tasks"), goal, valid_agents)
        if plan is None:
            return None
        plan.out_of_scope = _parse_str_list(data.get("outOfScope"))
        return Decision(mode="pipeline", spec=plan, confidence=conf, complexity=cplx)

    return None


def _is_dag(tasks: list[SpecTask]) -> bool:
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
    roles = valid_agents or set(_DEFAULT_ROLES)
    agent = next(
        (r for r in ("coder", "planner", "reviewer") if r in roles),
        sorted(roles)[0] if roles else "coder",
    )
    plan = TaskSpec(
        goal=goal,
        tasks=[
            SpecTask(
                id="t1",
                agent=agent,
                title=f"执行任务：{goal}",
                depends_on=[],
                requires_approval=agent == "deployer",
            )
        ],
    )
    return Decision(mode="single", spec=plan)


def _reconcile_low_confidence(decision: Decision, allow_clarify: bool) -> Decision:
    """item 1：single/direct 决策若模型自评低置信或高复杂 → 回退 clarify 让用户定夺。

    只在允许澄清时纠偏（否则尊重原决策，避免死循环）；pipeline 已有确认门禁、clarify 已是澄清，
    均不纠偏。confidence==0 视为模型未给自评，按"未触发"处理（仅看 complexity）。
    """
    if not allow_clarify or decision.mode not in ("single", "direct"):
        return decision
    low_conf = 0.0 < decision.confidence < _MIN_DECISION_CONFIDENCE
    high_cplx = decision.complexity >= _HIGH_COMPLEXITY
    if not (low_conf or high_cplx):
        return decision
    reason = "复杂度较高" if high_cplx else "我对直接处理的把握不足"
    options = ["按单步直接做（快）", "拆成可评审的多步spec（稳）", "我再补充一下需求细节"]
    logger.info(
        "decide 低置信纠偏：mode=%s conf=%.2f cplx=%d → clarify",
        decision.mode, decision.confidence, decision.complexity,
    )
    return Decision(
        mode="clarify",
        question=f"这个需求{reason}，你希望怎么推进？",
        options=options,
        recommended=1,
        confidence=decision.confidence,
        complexity=decision.complexity,
    )


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


async def _critique_and_revise(
    adapter, base_ctx, instructions: str, plan: TaskSpec, valid_agents: set[str]
) -> TaskSpec:
    """item 4：对高复杂度 pipeline spec做一次"批判→修订"（复用同一 adapter/凭证，1 次 LLM 调用）。

    解析失败 / 异常 / 修订非法一律保留原spec（只增不减的安全纠偏，绝不让评审拖垮规划）。
    """
    try:
        from app.adapters.base import AdapterContext, UnifiedApprovalMode, UnifiedSandboxLevel

        plan_json = json.dumps(
            {
                "goal": plan.goal,
                "tasks": [
                    {
                        "id": t.id,
                        "agent": t.agent,
                        "title": t.title,
                        "acceptance": t.acceptance,
                        "dependsOn": t.depends_on,
                        "requiresApproval": t.requires_approval,
                    }
                    for t in plan.tasks
                ],
            },
            ensure_ascii=False,
        )
        ctx = AdapterContext(
            instructions=PLAN_REVISE_USER_TEMPLATE.format(
                instructions=instructions[:2000], plan_json=plan_json
            ),
            system_prompt=PLAN_REVISE_SYSTEM
            + "\n\n可用角色：" + ", ".join(sorted(valid_agents)),
            workspace_path=".",
            approval_mode=UnifiedApprovalMode.AUTO,
            sandbox_level=UnifiedSandboxLevel.READ_ONLY,
            model=base_ctx.model,
            provider=base_ctx.provider,
        )
        raw = await _execute_decision(adapter, ctx)
        if not raw:
            return plan
        data = _extract_json(raw)
        if not data:
            return plan
        revised = _parse_tasks(
            data.get("tasks"), str(data.get("goal", "")).strip() or plan.goal, valid_agents
        )
        if revised is None:
            return plan
        # 修订 schema 不含 outOfScope：优先沿用原 spec 的非目标，避免批判环把边界丢掉
        revised.out_of_scope = _parse_str_list(data.get("outOfScope")) or plan.out_of_scope
        logger.info(
            "plan critique→revise: %d→%d tasks | %s",
            len(plan.tasks), len(revised.tasks), str(data.get("critique", ""))[:160],
        )
        return revised
    except Exception:
        logger.warning("plan critique/revise 失败，保留原spec", exc_info=True)
        return plan


async def decide(
    instructions: str,
    *,
    conversation_context: str = "",
    project_context: str = "",
    member_ids: list[str] | None = None,
    collab_intensity: str | None = None,
    allow_clarify: bool = True,
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
    valid_agents = {s.role for s in specs} if specs else set(_DEFAULT_ROLES)

    try:
        from app.core.registry import get_global_registry

        registry = get_global_registry()
        from app.orchestrator.agent_router import PLANNING_PRIORITY

        # Orchestrator 在 DB 指定了适配器偏好时优先使用，其余按规划优先级探测
        # （claude-code -> codex）
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

            # ③ 决策态瘦身：精简 agent 清单 + 宪法只取头部（路由够用）；full specs/宪法留执行态
            # ① 稳定系统前缀（orchestrator system，按 specs 稳定）→ system_prompt 享自动缓存；
            #    每轮变量（用户需求/上下文/宪法/clarify 开关）进 user 侧 instructions
            system_prefix = build_orchestrator_system(specs, slim=True)
            decision_prompt = ORCHESTRATOR_USER_TEMPLATE.format(
                instructions=instructions,
                conversation_context=conversation_context or "（无）",
                project_context=(project_context or "（无）")[:2500],
                intensity_hint=intensity_hint(collab_intensity),
            )
            if not allow_clarify:
                decision_prompt += (
                    "\n\n## 注意：本轮禁止 clarify（已达澄清上限），"
                    "必须直接输出 direct / single / pipeline。"
                )
            # 规划复用 orchestrator 凭证：用其偏好 adapter 时注入 provider/model，否则配了
            # 第三方 base_url 的 codex/claude 规划缺凭证回退本地登录态而失败 → fallback single
            use_pref = adapter_name == pref
            ctx = AdapterContext(
                instructions=decision_prompt,
                system_prompt=system_prefix,
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
                if decision and not allow_clarify and decision.mode == "clarify":
                    decision = None  # 已达澄清上限：拒绝 clarify，触发重试/回退到非 clarify
                if decision:
                    # item 1：低置信/高复杂的 single/direct 回退 clarify（allow_clarify 时）
                    decision = _reconcile_low_confidence(decision, allow_clarify)
                    # item 4：高复杂 pipeline 做一次批判→修订（失败保留原spec）
                    if (
                        decision.mode == "pipeline"
                        and decision.spec is not None
                        and _PLAN_CRITIQUE_ON
                        and decision.complexity >= _PLAN_CRITIQUE_COMPLEXITY
                    ):
                        decision.spec = await _critique_and_revise(
                            adapter, ctx, instructions, decision.spec, valid_agents
                        )
                    return decision
                logger.warning(
                    "Decision parse failed (attempt %d/%d): %s",
                    attempt + 1, _DECISION_MAX_ATTEMPTS, raw[:200],
                )
            break
    except Exception:
        logger.warning("Decision routing failed, using fallback", exc_info=True)

    return _fallback_decision(instructions, valid_agents)
