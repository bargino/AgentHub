"""HumanEval+ 跑分入口（单 agent 基线 / 管线冒烟）。

用法（在 agenthub-server 下）：
    # 离线冒烟：内置样本 + 桩解题，验证 生成→执行→判分 管线（零依赖、零成本）
    python -m app.eval.run_humaneval --offline

    # 真实：HumanEval+ 全量 + 适配器生成（需 pip install evalplus + 配好 SDK/凭证）
    python -m app.eval.run_humaneval --source evalplus --solver adapter \
        --adapter claude-code --limit 20

指标：pass@1 = 通过题数 / 总题数。
退出码：pass@1 ≥ 阈值（默认 0，仅冒烟用）→ 0；否则 1（可做 CI 门禁）。
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.eval.benchmarks import humaneval


def _print_report(report: humaneval.BenchReport, mode: str, threshold: float) -> int:
    print(f"{'TASK':<20} {'PASSED':<7} ERROR")
    for r in report.results:
        print(f"{r.task_id:<20} {str(r.passed):<7} {r.error}")
    print("-" * 56)
    print(f"pass@1 = {report.pass_at_1:.0%}  ({report.passed}/{report.total})")
    print(f"mode = {mode}  threshold = {threshold:.0%}")
    ok = report.total > 0 and report.pass_at_1 >= threshold
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main() -> None:
    # Windows GBK 控制台会对 ✓/中文 报 UnicodeEncodeError；强制 UTF-8 输出
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="HumanEval+ 跑分（pass@1）")
    ap.add_argument(
        "--offline",
        action="store_true",
        help="离线冒烟：内置样本 + 桩解题（等价 --source sample --solver stub）",
    )
    ap.add_argument(
        "--source", choices=["sample", "evalplus"], default="sample", help="题集来源"
    )
    ap.add_argument(
        "--solver", choices=["stub", "adapter"], default="stub", help="解题方式"
    )
    ap.add_argument("--adapter", default="claude-code", help="solver=adapter 时的适配器名")
    ap.add_argument("--model", default=None, help="solver=adapter 时覆盖模型")
    ap.add_argument("--limit", type=int, default=None, help="只跑前 N 题（冒烟/控成本）")
    ap.add_argument("--timeout", type=float, default=10.0, help="单题执行超时（秒）")
    ap.add_argument("--threshold", type=float, default=0.0, help="pass@1 门禁阈值")
    args = ap.parse_args()

    source = "sample" if args.offline else args.source
    solver_kind = "stub" if args.offline else args.solver

    problems = humaneval.load_problems(source=source, limit=args.limit)
    if not problems:
        print("没有题目可跑（检查 --source / --limit）")
        sys.exit(1)

    if solver_kind == "stub":
        report = humaneval.run(problems, humaneval.stub_solver, timeout=args.timeout)
        mode = f"{source}+stub"
    else:
        _bootstrap_registry()
        report = asyncio.run(
            humaneval.adapter_solve_all(
                problems, args.adapter, model=args.model, timeout=args.timeout
            )
        )
        mode = f"{source}+adapter({args.adapter})"

    sys.exit(_print_report(report, mode, args.threshold))


def _bootstrap_registry() -> None:
    """adapter 模式自举：复刻 lifespan 的适配器注册（standalone 跑不触发 FastAPI）。"""
    from app.config import load_adapters_config
    from app.core.registry import (
        AdapterRegistry,
        get_global_registry,
        set_global_registry,
    )

    try:
        get_global_registry()
        return
    except RuntimeError:
        pass
    registry = AdapterRegistry()
    registry.load_from_config(load_adapters_config())
    set_global_registry(registry)


if __name__ == "__main__":
    main()
