"""f3：验收 golden set 跑分入口（基线 + 回归门禁）。

用法（在 agenthub-server 下）：
    python -m app.eval.run_golden --offline   # 无成本：确定性桩 judge，验证 harness 管线
    python -m app.eval.run_golden             # 真 LLM：复用 #6 轻模型 judge 跑真实通过率

指标：
- accuracy        judge 判定与标注 expect_pass 的一致率（核心质量门禁信号）
- positive_pass   正样本（应通过）的通过率
- negative_caught 负样本（应拦下）被门禁拦下的比例

退出码：accuracy ≥ 阈值（默认 0.8）→ 0；否则 1（可做 CI 门禁）。
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.eval.golden_set import build_golden_set
from app.eval.harness import GoldenCase, JudgeResult, run_eval


async def _offline_scorer(case: GoldenCase) -> JudgeResult:
    """确定性桩 judge：按标注给分（正样本 5、负样本 1），仅验证管线、零 LLM 成本。"""
    return JudgeResult(
        score=5 if case.expect_pass else 1,
        reason="offline-stub（按标注判分，非真实评判）",
    )


def _bootstrap_registry() -> None:
    """real-LLM 模式自举：复刻 app.main:lifespan 的适配器注册。

    standalone 跑 `python -m app.eval.run_golden` 不触发 FastAPI lifespan，全局 registry 为空，
    llm_judge 会拿不到适配器而回退 score=0。此处幂等初始化（已初始化则跳过）。
    """
    from app.config import load_adapters_config
    from app.core.registry import (
        AdapterRegistry,
        get_global_registry,
        set_global_registry,
    )

    try:
        get_global_registry()
        return  # 已由别处初始化
    except RuntimeError:
        pass
    registry = AdapterRegistry()
    registry.load_from_config(load_adapters_config())
    set_global_registry(registry)


def _check_verdict_parser() -> list[str]:
    """#1 离线确定性自检：覆盖运行时 reviewer 的裁决解析 parse_review_verdict（无需 LLM）。

    把代表性 reviewer 原始输出喂进生产解析器，断言 verdict / issues 行为正确；
    返回失败项列表（空=全过）。
    """
    from app.orchestrator.review import parse_review_verdict

    samples: list[tuple[str, str, bool]] = [
        # (reviewer 原始输出, 期望 verdict, 期望 issues 非空)
        (
            '## 审查结论\n通过\n===VERDICT===\n{"verdict": "approve", "issues": []}',
            "approve",
            False,
        ),
        (
            '## 审查结论\n需修改\n===VERDICT===\n'
            '{"verdict": "needs_changes", "issues": ["缺少 total 字段"]}',
            "needs_changes",
            True,
        ),
        ("纯文本无裁决 marker", "approve", False),  # fail-open 到 approve
        ("===VERDICT===\n{坏 JSON", "approve", False),  # 解析失败 fail-open
    ]
    fails: list[str] = []
    for raw, exp_verdict, exp_issues in samples:
        verdict, issues = parse_review_verdict(raw)
        if verdict != exp_verdict:
            fails.append(f"verdict 期望 {exp_verdict} 实得 {verdict}（{raw[:24]}…）")
        if bool(issues) != exp_issues:
            fails.append(f"issues 期望非空={exp_issues} 实得 {issues}（{raw[:24]}…）")
    return fails


async def _run(offline: bool, reviewer: bool, threshold: float) -> int:
    # #1 深层：每次先离线确定性自检生产 reviewer 的裁决解析（parse_review_verdict）
    parser_fails = _check_verdict_parser()
    print("verdict-parser self-check:", "PASS" if not parser_fails else "FAIL")
    for f in parser_fails:
        print(f"  - {f}")

    cases = build_golden_set()
    if offline:
        scorer = _offline_scorer
        mode = "offline-stub"
    elif reviewer:
        _bootstrap_registry()
        from app.eval.harness import reviewer_scorer

        scorer = reviewer_scorer
        mode = "reviewer(production)"
    else:
        _bootstrap_registry()
        from app.eval.harness import llm_judge

        scorer = llm_judge
        mode = "llm-judge"

    report = await run_eval(cases, scorer)
    expect = {c.name: c.expect_pass for c in cases}

    # 逐例打印（judge 不可用的例子标 N/A，不计入准确率）
    print(f"{'CASE':<28} {'EXPECT':<7} {'SCORE':<6} {'PASSED':<7} OK")
    matches = conclusive = inconclusive = 0
    pos_total = pos_pass = neg_total = neg_caught = 0
    for cr in report.cases:
        exp = expect.get(cr.name, True)
        if not cr.judge_available:
            inconclusive += 1
            print(
                f"{cr.name:<28} {('pass' if exp else 'fail'):<7} "
                f"{'-':<6} {'N/A':<7} ?  {cr.quality_reason}（judge 不可用，不计准确率）"
            )
            continue
        conclusive += 1
        ok = cr.passed == exp  # judge 与标注一致
        matches += int(ok)
        if exp:
            pos_total += 1
            pos_pass += int(cr.passed)
        else:
            neg_total += 1
            neg_caught += int(not cr.passed)
        flag = "✓" if ok else "✗"
        print(
            f"{cr.name:<28} {('pass' if exp else 'fail'):<7} "
            f"{cr.quality_score:<6} {str(cr.passed):<7} {flag}  {cr.quality_reason}"
        )

    accuracy = matches / conclusive if conclusive else 0.0
    print("-" * 64)
    print(f"accuracy      = {accuracy:.0%}  ({matches}/{conclusive} 可判定)")
    if pos_total:
        print(f"positive_pass = {pos_pass / pos_total:.0%}  ({pos_pass}/{pos_total})")
    if neg_total:
        print(f"negative_caught = {neg_caught / neg_total:.0%}  ({neg_caught}/{neg_total})")
    if inconclusive:
        print(f"inconclusive  = {inconclusive}  (judge 不可用，已排除；real 模式视为失败)")
    print(f"mode = {mode}  threshold = {threshold:.0%}")

    # #4 趋势留存：每次跑分追加一行历史
    _append_history(
        mode, accuracy, matches, conclusive, inconclusive,
        pos_pass, pos_total, neg_caught, neg_total,
    )

    # judge 不可用 = 评测无结论：real 模式直接判失败；裁决解析自检失败也判失败
    ok = accuracy >= threshold and inconclusive == 0 and not parser_fails
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def _append_history(
    mode: str,
    accuracy: float,
    matches: int,
    conclusive: int,
    inconclusive: int,
    pos_pass: int,
    pos_total: int,
    neg_caught: int,
    neg_total: int,
) -> None:
    """#4 把本次跑分结果追加到 .eval_history.jsonl（趋势留存）；写失败只告警不阻塞。"""
    import json
    from datetime import datetime, timezone
    from pathlib import Path

    record = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "mode": mode,
        "accuracy": round(accuracy, 4),
        "matches": matches,
        "conclusive": conclusive,
        "inconclusive": inconclusive,
        "positive_pass": f"{pos_pass}/{pos_total}",
        "negative_caught": f"{neg_caught}/{neg_total}",
    }
    try:
        path = Path(__file__).resolve().parent / ".eval_history.jsonl"
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(f"history -> {path}")
    except OSError:
        pass


def main() -> None:
    # Windows 默认控制台是 GBK，输出 ✓/中文 reason 会 UnicodeEncodeError；强制 UTF-8 输出
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="验收 golden set 跑分")
    ap.add_argument(
        "--offline", action="store_true", help="用确定性桩 judge（零 LLM 成本，验证管线）"
    )
    ap.add_argument(
        "--reviewer",
        action="store_true",
        help="生产口径：跑真实 reviewer（同 prompt + parse_review_verdict）而非独立 judge",
    )
    ap.add_argument(
        "--threshold", type=float, default=0.8, help="accuracy 门禁阈值（默认 0.8）"
    )
    args = ap.parse_args()
    sys.exit(asyncio.run(_run(args.offline, args.reviewer, args.threshold)))


if __name__ == "__main__":
    main()
