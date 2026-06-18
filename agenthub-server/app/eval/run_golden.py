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


async def _run(offline: bool, threshold: float) -> int:
    cases = build_golden_set()
    if offline:
        scorer = _offline_scorer
    else:
        _bootstrap_registry()
        from app.eval.harness import llm_judge

        scorer = llm_judge

    report = await run_eval(cases, scorer)
    expect = {c.name: c.expect_pass for c in cases}

    # 逐例打印
    print(f"{'CASE':<28} {'EXPECT':<7} {'SCORE':<6} {'PASSED':<7} OK")
    matches = 0
    pos_total = pos_pass = neg_total = neg_caught = 0
    for cr in report.cases:
        exp = expect.get(cr.name, True)
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

    total = report.total
    accuracy = matches / total if total else 0.0
    print("-" * 64)
    print(f"accuracy      = {accuracy:.0%}  ({matches}/{total})")
    if pos_total:
        print(f"positive_pass = {pos_pass / pos_total:.0%}  ({pos_pass}/{pos_total})")
    if neg_total:
        print(f"negative_caught = {neg_caught / neg_total:.0%}  ({neg_caught}/{neg_total})")
    print(f"mode = {'offline-stub' if offline else 'llm-judge'}  threshold = {threshold:.0%}")

    ok = accuracy >= threshold
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


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
        "--threshold", type=float, default=0.8, help="accuracy 门禁阈值（默认 0.8）"
    )
    args = ap.parse_args()
    sys.exit(asyncio.run(_run(args.offline, args.threshold)))


if __name__ == "__main__":
    main()
