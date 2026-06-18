"""离线评测框架（#11b 完整 Eval：golden set + LLM judge）。

在 #11a 结构回放断言（trace.replay_assert：链路完整性）之上叠加「输出质量评判」
维度，形成 evaluator 模式的离线回归：每个 golden case 先过结构断言，再由 judge
（#6 轻模型）按 rubric 打分，汇总通过率。judge 经 scorer 注入，便于用桩替换做单测；
生产用 llm_judge 复用 PLANNING_PRIORITY 轻模型，全程零新依赖（可后续对接 promptfoo）。
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.orchestrator.trace import replay_assert

logger = logging.getLogger(__name__)


@dataclass
class GoldenCase:
    """一条评测用例：输入需求 + 质量 rubric + 被测产出（+ 可选事件流做结构断言）。"""

    name: str
    instruction: str
    rubric: str
    actual_output: str = ""
    events: list[dict] = field(default_factory=list)
    trace_id: str | None = None
    pass_threshold: int = 3  # 质量达标分数线（1-5）
    expect_pass: bool = True  # f3 golden 标注：该样本是否「应当通过」（含负样本=应被门禁拦下）


@dataclass
class JudgeResult:
    score: int  # 1-5；0 表示评判不可用
    reason: str = ""


@dataclass
class CaseReport:
    name: str
    structural_ok: bool
    structural_issues: list[str]
    quality_score: int
    quality_reason: str
    passed: bool


@dataclass
class EvalReport:
    """评测汇总：逐例报告 + 通过率（供回归门禁 / 报表）。"""

    cases: list[CaseReport] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.cases)

    @property
    def passed(self) -> int:
        return sum(1 for c in self.cases if c.passed)

    @property
    def pass_rate(self) -> float:
        return self.passed / self.total if self.cases else 0.0


# 质量评分函数签名：给定用例 -> 评分结果（生产=llm_judge，单测=桩）
Scorer = Callable[["GoldenCase"], Awaitable["JudgeResult"]]


def rubric_from_acceptance(criteria: list[str]) -> str:
    """把任务的 EARS 验收标准拼成 judge rubric（Phase 3：计划=评测，计划即评测标准）。

    供从计划 / Task.acceptance 构造 GoldenCase.rubric，使离线评测与运行时复审同口径。
    无验收标准时回退到按需求评估，不编造标准。
    """
    items = [c.strip() for c in criteria if c and c.strip()]
    if not items:
        return "按原始需求评估输出是否正确、完整、可用。"
    lines = ["逐条核对以下验收标准，全部满足才算通过："]
    lines.extend(f"- {c}" for c in items)
    return "\n".join(lines)


async def run_eval(cases: list[GoldenCase], scorer: Scorer) -> EvalReport:
    """跑 golden set：每例先结构断言（#11a），再质量评分（judge），汇总通过率。

    通过条件：结构断言无 issue 且质量分 ≥ 用例阈值。结构断言仅在用例带 events 时执行
    （无 events 视为结构合格，只评质量）。
    """
    report = EvalReport()
    for case in cases:
        if case.events:
            r = replay_assert(case.events, case.trace_id)
            structural_ok, issues = r.ok, list(r.issues)
        else:
            structural_ok, issues = True, []

        jr = await scorer(case)
        passed = structural_ok and jr.score >= case.pass_threshold
        report.cases.append(
            CaseReport(
                name=case.name,
                structural_ok=structural_ok,
                structural_issues=issues,
                quality_score=jr.score,
                quality_reason=jr.reason,
                passed=passed,
            )
        )
    return report


JUDGE_PROMPT = """你是严格的代码评审。请依据「评分标准」对「实际输出」打分。
评分为 1-5 的整数（1=完全不满足，5=完全满足）。

评分标准：
{rubric}

实际输出：
{actual}

只输出一行 JSON，不要任何额外文字：{{"score": <1-5 整数>, "reason": "<不超过 40 字理由>"}}"""


def _parse_judge_output(raw: str) -> JudgeResult:
    """解析 judge 的 JSON 输出 -> JudgeResult；解析失败回退 score=0。"""
    text = (raw or "").strip().strip("`").removeprefix("json").strip()
    # 容忍前后包裹文字：截取第一个 { 到最后一个 }
    lo, hi = text.find("{"), text.rfind("}")
    if lo != -1 and hi != -1 and hi > lo:
        text = text[lo : hi + 1]
    try:
        data = json.loads(text)
        score = max(0, min(5, int(data.get("score", 0))))
        return JudgeResult(score=score, reason=str(data.get("reason", "")).strip()[:200])
    except (json.JSONDecodeError, ValueError, TypeError):
        logger.debug("judge 输出解析失败，回退 score=0", exc_info=True)
        return JudgeResult(score=0, reason="评判输出解析失败")


async def llm_judge(case: GoldenCase) -> JudgeResult:
    """生产 scorer：用 #6 轻模型按 rubric 给 actual_output 打分（复用 PLANNING_PRIORITY）。

    LLM 不可用 / 解析失败时回退 score=0（该例不计通过），不抛异常。
    """
    try:
        from app.adapters.base import (
            AdapterContext,
            UnifiedApprovalMode,
            UnifiedSandboxLevel,
        )
        from app.core.registry import get_global_registry
        from app.orchestrator.agent_router import PLANNING_PRIORITY

        registry = get_global_registry()
        for adapter_name in PLANNING_PRIORITY:
            adapter = registry.get(adapter_name)
            if adapter is None:
                continue
            try:
                if not await adapter.health_check():
                    continue
            except Exception:
                continue

            ctx = AdapterContext(
                instructions=JUDGE_PROMPT.format(
                    rubric=case.rubric[:2000], actual=case.actual_output[:6000]
                ),
                workspace_path=".",
                approval_mode=UnifiedApprovalMode.AUTO,
                sandbox_level=UnifiedSandboxLevel.READ_ONLY,
                model=adapter.light_model,  # #6 judge 走轻模型
            )
            parts: list[str] = []
            async for event in adapter.execute(ctx):
                if event.type == "completed":
                    return _parse_judge_output(
                        str(event.data.get("result", "")) or "".join(parts)
                    )
                if event.type == "thinking":
                    t = str(event.data.get("text", ""))
                    if t:
                        parts.append(t)
                elif event.type == "error":
                    break
            if parts:
                return _parse_judge_output("".join(parts))
            break
    except Exception:
        logger.warning("llm_judge 失败，回退 score=0", exc_info=True)
    return JudgeResult(score=0, reason="judge 不可用")
