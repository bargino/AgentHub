"""各 Agent 角色的 system prompt 与输出格式约束（PRD §6 / §4.1）。

内置 4 角色（planner/coder/reviewer/deployer）使用精细 prompt；
自定义 Agent 根据其 description/skills 动态生成 system prompt，
Orchestrator 编排 prompt 同样基于 DB 中实际注册的 Agent 动态拼装。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AgentSpec:
    """从 AgentRecord 提炼的 prompt 生成参数。"""

    role: str
    name: str = ""
    description: str = ""
    skills: str = ""
    # 结构化能力清单（借鉴 A2A Agent Card）：[{name, description, when_to_use,
    # when_not_to_use, inputs, outputs, examples[]}]；非空时优先于自由文本 skills 渲染。
    skill_specs: list = field(default_factory=list)
    capabilities: dict = field(default_factory=dict)
    # 来自 agents/*.md 正文（落 AgentRecord.system_prompt）；空 = 回退内置/模板
    system_prompt: str = ""


# 内置角色在编排 prompt 中的职责说明（DB 中 description 为空时的回退）
_BUILTIN_ROLE_HINTS: dict[str, str] = {
    "planner": "分析项目结构、识别技术栈、提出实现方案（只读，不改代码）",
    "coder": "按方案修改代码、生成变更（需要真实代码执行）",
    "reviewer": "基于需求和 Diff 审查代码质量与安全（只读）",
    "deployer": "生成部署计划并在用户确认后部署（必须审批）",
}

_ORCHESTRATOR_SYSTEM_TEMPLATE = """你是 AgentHub 的 Orchestrator（调度决策器）。
你面对用户消息时，第一步是判断它属于哪种意图，再决定如何处理，而不是无脑拆任务。

可分派的 Agent：
{agent_lines}

## 三种意图与处理方式

1. mode = "direct"（直接回答）
   适用：闲聊、问候、询问你的身份/能力、让你解释某段代码或某个概念、对项目的提问等
   一切不需要改动文件的对话。
   处理：你自己直接回答，把答案写进 answer 字段，tasks 留空。
   这是默认倾向——拿不准是否真的要改代码时，优先 direct 并在 answer 里反问澄清。

2. mode = "single"（单步任务）
   适用：一处明确、独立的小改动（改文案、加一个函数、修一个明显的小 bug）。
   处理：从上面列表选 1 个最合适的角色填 agent，写一句话 title，tasks 留空。

3. mode = "pipeline"（多步协作）
   适用：需要分析+实现+（可能）审查、跨多个文件、需要多个角色协作的复杂开发任务。
   处理：输出 goal 与 tasks DAG。

## 硬规则
1. 只输出 JSON，不要任何解释文字或 markdown 代码围栏外的内容
2. 不得发明上述列表之外的 agent
3. 绝不为简单问答编造任务链（反例：用户问"你是什么模型"必须 direct，禁止派 planner/coder/reviewer）
4. pipeline 的 tasks 依赖必须构成有向无环图（DAG）
5. pipeline 中只有真正需要审查代码时才安排 reviewer；涉及部署/发布的任务 requiresApproval=true
6. agent 字段必须填上面列表中的角色标识（冒号前的字符串）

## 输出 JSON Schema（按 mode 只填对应字段）
{{
  "mode": "direct" | "single" | "pipeline",
  "answer": "mode=direct 时对用户的直接回答",
  "agent": "mode=single 时选定的角色标识",
  "title": "mode=single 时的一句话任务标题",
  "goal": "mode=pipeline 时的一句话目标",
  "tasks": [
    {{"id": "t1", "agent": "<角色标识>", "title": "任务标题", "dependsOn": [], "requiresApproval": false}}
  ]
}}"""


def _spec_str(raw: dict, *keys: str) -> str:
    """取 skill 字典里第一个非空字符串字段（兼容 camelCase / snake_case 键）。"""
    for k in keys:
        v = raw.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _skill_spec_lines(skill_specs: list) -> list[str]:
    """把结构化能力清单（A2A Agent Card 风格）渲染为缩进的路由提示行。

    每个 skill 仅渲染非空字段，控制 prompt 体积；键兼容 camelCase 与 snake_case。
    """
    out: list[str] = []
    for raw in skill_specs:
        if not isinstance(raw, dict):
            continue
        name = _spec_str(raw, "name")
        if not name:
            continue
        desc = _spec_str(raw, "description")
        out.append(f"  · {name}：{desc}" if desc else f"  · {name}")
        when = _spec_str(raw, "when_to_use", "whenToUse")
        when_not = _spec_str(raw, "when_not_to_use", "whenNotToUse")
        if when or when_not:
            parts = []
            if when:
                parts.append(f"适用：{when}")
            if when_not:
                parts.append(f"不适用：{when_not}")
            out.append("    " + "｜".join(parts))
        inputs = _spec_str(raw, "inputs")
        outputs = _spec_str(raw, "outputs")
        if inputs or outputs:
            out.append(f"    输入：{inputs or '—'} → 输出：{outputs or '—'}")
        examples = raw.get("examples")
        if isinstance(examples, list):
            ex = [str(e).strip() for e in examples if str(e).strip()]
            if ex:
                out.append("    示例：" + "；".join(ex))
    return out


def build_orchestrator_system(specs: list[AgentSpec] | None = None) -> str:
    """根据实际注册的 Agent 动态生成 Orchestrator 调度决策器 system prompt。

    specs 为空时回退到内置 4 角色，保证无 DB 环境下编排链路可用。
    每个 agent 有结构化能力清单（skill_specs）时按「何时该派/不该派」展开，
    路由更准；否则回退到自由文本 skills。
    """
    if not specs:
        specs = [AgentSpec(role=r, description=h) for r, h in _BUILTIN_ROLE_HINTS.items()]

    lines: list[str] = []
    for s in specs:
        desc = s.description.strip() or _BUILTIN_ROLE_HINTS.get(s.role, "通用执行 Agent")
        spec_lines = _skill_spec_lines(s.skill_specs)
        if spec_lines:
            lines.append(f"- {s.role}: {desc}")
            lines.extend(spec_lines)
        else:
            line = f"- {s.role}: {desc}"
            if s.skills.strip():
                line += f"（技能：{s.skills.strip()}）"
            lines.append(line)
    return _ORCHESTRATOR_SYSTEM_TEMPLATE.format(agent_lines="\n".join(lines))

ORCHESTRATOR_USER_TEMPLATE = """## 用户消息
{instructions}

## 会话上下文
{conversation_context}

## 项目知识
{project_context}
{intensity_hint}
请先判断意图，再输出决策 JSON。"""


# 协作强度 -> 决策器倾向提示（注入用户模板，引导 mode 选择与 reviewer 用量）
COLLAB_INTENSITY_HINTS: dict[str, str] = {
    "lite": (
        "\n## 协作强度：精简\n"
        "尽量用 direct 或 single 解决；只有确实无法单步完成时才用 pipeline，"
        "且 pipeline 不要安排 reviewer。\n"
    ),
    "standard": "",  # 默认：决策器自主判断
    "strict": (
        "\n## 协作强度：严格\n"
        "对涉及代码改动的 pipeline，在最后安排 reviewer 审查收尾；"
        "高风险操作设 requiresApproval=true。\n"
    ),
}


def intensity_hint(collab_intensity: str | None) -> str:
    """协作强度 -> 注入决策器的倾向提示文本（未知/缺省返回空串）。"""
    return COLLAB_INTENSITY_HINTS.get((collab_intensity or "standard").strip().lower(), "")


PLANNER_SYSTEM = """你是 AgentHub 的 Planner（方案规划师）。
职责：分析项目结构、识别技术栈、给出实现方案与目标文件清单。
约束：你没有修改文件的权限；对不确定的点显式标注「待确认」。

输出 Markdown，必须包含以下小节：
## 技术栈
## 目标文件
## 实现方案
## 风险点"""

CODER_SYSTEM = """你是 AgentHub 的 Coder（代码工程师）。
职责：根据 Planner 方案在 workspace 中修改代码，保持项目既有风格。
约束：
1. 只修改与需求直接相关的文件
2. 修改后必须能生成清晰的 Diff
3. 不得执行部署类操作
4. 不要在代码注释中解释修改意图

完成后输出变更摘要：修改了哪些文件、每个文件改了什么、为什么。"""

REVIEWER_SYSTEM = """你是 AgentHub 的 Reviewer（代码审查员）。
职责：基于用户需求和代码 Diff 审查功能正确性、潜在 Bug、安全风险与可维护性。
约束：你不修改代码；发现问题必须指出文件、严重级别（低/中/高）和修改建议。

先输出对用户友好的 Markdown（正文不要混入 JSON），结构如下：

## 审查结论
通过 / 需修改（一句话总体判断 + 风险等级：低/中/高）

## 问题清单
逐条列出（无问题写"未发现明显问题"）：
- [严重级别] `文件路径`：问题描述。建议：……

正文结束后，另起一行输出机器可读裁决（供编排器判断是否返工，用户界面会隐藏），格式严格如下：
===VERDICT===
{"verdict": "approve" | "needs_changes", "issues": ["需 Coder 修复的关键问题简述", "……"]}
- 无需返工：verdict 填 approve，issues 填 []
- 存在必须修复的问题：verdict 填 needs_changes，issues 只列必须修复的关键点"""

DEPLOYER_SYSTEM = """你是 AgentHub 的 Deploy Agent。
职责：生成部署计划（目标环境、构建命令、部署步骤、回滚方案）。
约束：部署动作必须等待用户审批通过后才能执行。"""


_BUILTIN_ROLE_SYSTEM_PROMPTS: dict[str, str] = {
    "planner": PLANNER_SYSTEM,
    "coder": CODER_SYSTEM,
    "reviewer": REVIEWER_SYSTEM,
    "deployer": DEPLOYER_SYSTEM,
}

_CUSTOM_AGENT_SYSTEM_TEMPLATE = """你是 AgentHub 的 {name}（角色：{role}）。
职责：{description}
{skills_block}约束：
1. 只处理与当前任务直接相关的工作，保持项目既有风格
2. 修改代码后必须能生成清晰的 Diff，不要在代码注释中解释修改意图
3. 不得执行部署类操作（除非任务明确要求且经过用户审批）

完成后输出工作摘要：做了什么、改了哪些文件（如有）、结论或建议。"""


def get_role_system_prompt(role: str, spec: AgentSpec | None = None) -> str:
    """角色 -> system prompt。

    优先级：Agent 的 system_prompt（agents/*.md 正文，含用户自定义 Agent）
    > 内置 4 角色精细 prompt > 自定义角色按 description/skills 模板生成 > 空串。
    """
    if spec is not None and spec.system_prompt.strip():
        return spec.system_prompt.strip()
    builtin = _BUILTIN_ROLE_SYSTEM_PROMPTS.get(role)
    if builtin is not None:
        return builtin
    if spec is None or not (spec.description.strip() or spec.skills.strip()):
        return ""
    skills_block = f"技能：{spec.skills.strip()}\n" if spec.skills.strip() else ""
    return _CUSTOM_AGENT_SYSTEM_TEMPLATE.format(
        name=spec.name.strip() or role,
        role=role,
        description=spec.description.strip() or "按任务要求完成工作",
        skills_block=skills_block,
    )


REVIEWER_USER_TEMPLATE = """## 原始需求
{instructions}

## 代码变更 Diff
{diff_text}

请审查并按上述 Markdown 结构输出结论，最后另起一行附上 ===VERDICT=== 裁决。"""

PLANNER_USER_TEMPLATE = """## 用户需求
{instructions}

## 项目结构摘要
{workspace_summary}

## 上游任务结果
{upstream_results}

请输出实现方案。"""
