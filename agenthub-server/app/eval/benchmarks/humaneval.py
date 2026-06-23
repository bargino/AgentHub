"""HumanEval / HumanEval+ 基准 runner（单 agent / 模型基线）。

HumanEval+ 测「单函数补全」——给函数签名+docstring 补函数体，用扩充单测判 pass@1。
它测的是**底座模型**而非多 Agent 编排（DAG/harness/复审都用不到），故定位为
「单 agent 基线 + 适配器/解析稳定性冒烟」，多 Agent 主评测请用 SWE-bench Lite
（见 swebench.py）。

三段式（数据 → 解题 → 判分），每段都有离线零依赖路径：
- load_problems(source="sample")：内置样本，离线冒烟
- load_problems(source="evalplus")：真实 HumanEval+（需 `pip install evalplus`）
- stub_solver：直接用 canonical 解，验证「生成→执行→判分」管线（零模型成本）
- adapter_solve_all：用 AgentHub 适配器真实生成（需装 SDK + 凭证）

判分在**隔离子进程 + 超时**内执行候选代码（STRICT：不污染宿主、可中断、可隔离）；
离线冒烟只跑可信 canonical 解。
"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

# ── 数据模型 ────────────────────────────────────────────────────────────


@dataclass
class Problem:
    """一道 HumanEval(+) 题：签名+docstring（prompt）+ 入口函数名 + check 测试。"""

    task_id: str
    prompt: str
    entry_point: str
    test: str
    canonical_solution: str = ""


@dataclass
class CaseResult:
    task_id: str
    passed: bool
    error: str = ""


@dataclass
class BenchReport:
    results: list[CaseResult] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def pass_at_1(self) -> float:
        return self.passed / self.total if self.results else 0.0


Solver = Callable[[Problem], str]


# ── 数据加载 ────────────────────────────────────────────────────────────

# 内置样本（离线冒烟用；题面取自 HumanEval 公开样式，附最小 check）。
_SAMPLE: list[Problem] = [
    Problem(
        task_id="sample/0",
        prompt='def add(a: int, b: int) -> int:\n    """返回 a 与 b 的和。"""\n',
        entry_point="add",
        test=(
            "def check(candidate):\n"
            "    assert candidate(2, 3) == 5\n"
            "    assert candidate(-1, 1) == 0\n"
            "    assert candidate(0, 0) == 0\n"
        ),
        canonical_solution="    return a + b\n",
    ),
    Problem(
        task_id="sample/1",
        prompt=(
            "def has_close_elements(numbers, threshold):\n"
            '    """列表中是否存在两个元素差的绝对值小于 threshold。"""\n'
        ),
        entry_point="has_close_elements",
        test=(
            "def check(candidate):\n"
            "    assert candidate([1.0, 2.0, 3.0], 0.5) is False\n"
            "    assert candidate([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3) is True\n"
        ),
        canonical_solution=(
            "    for i in range(len(numbers)):\n"
            "        for j in range(i + 1, len(numbers)):\n"
            "            if abs(numbers[i] - numbers[j]) < threshold:\n"
            "                return True\n"
            "    return False\n"
        ),
    ),
]


def load_problems(source: str = "sample", limit: int | None = None) -> list[Problem]:
    """加载题集。source=sample（离线内置）/ evalplus（真实 HumanEval+，需装 evalplus）。"""
    if source == "sample":
        probs = list(_SAMPLE)
    elif source == "evalplus":
        probs = _load_evalplus()
    else:
        raise ValueError(f"未知 source：{source}（支持 sample / evalplus）")
    if limit is not None and limit > 0:
        probs = probs[:limit]
    return probs


def _load_evalplus() -> list[Problem]:
    try:
        from evalplus.data import get_human_eval_plus
    except ImportError as e:
        raise RuntimeError(
            "未安装 evalplus：先 `pip install evalplus`，或用 source='sample' 离线冒烟。"
        ) from e
    out: list[Problem] = []
    for task_id, p in get_human_eval_plus().items():
        out.append(
            Problem(
                task_id=task_id,
                prompt=p["prompt"],
                entry_point=p["entry_point"],
                test=p["test"],
                canonical_solution=p.get("canonical_solution", ""),
            )
        )
    return out


# ── 解题（solver）────────────────────────────────────────────────────────


def stub_solver(problem: Problem) -> str:
    """桩解题：直接拼 canonical 解，验证「生成→执行→判分」管线（零模型成本）。"""
    return problem.prompt + problem.canonical_solution


_CODE_FENCE_RE = re.compile(r"```(?:python)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_code(raw: str) -> str:
    """从模型回复里抽出代码：优先取 ```python 代码块，否则原样返回。"""
    m = _CODE_FENCE_RE.search(raw or "")
    return (m.group(1) if m else (raw or "")).strip()


# ── 判分（隔离子进程执行）─────────────────────────────────────────────────

_RUNNER_TEMPLATE = "{program}\n\n{test}\n\ncheck({entry_point})\nprint('__OK__')\n"


def score_one(problem: Problem, completion: str, timeout: float = 10.0) -> CaseResult:
    """隔离子进程内执行 候选+check，returncode==0 且打印 __OK__ 才算通过。

    超时/异常即判失败，stderr 截断作 error；不污染宿主进程。
    """
    has_def = f"def {problem.entry_point}" in completion
    program = completion if has_def else problem.prompt + completion
    script = _RUNNER_TEMPLATE.format(
        program=program, test=problem.test, entry_point=problem.entry_point
    )
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "cand.py"
        f.write_text(script, encoding="utf-8")
        try:
            r = subprocess.run(
                [sys.executable, str(f)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return CaseResult(problem.task_id, False, "timeout")
    if r.returncode == 0 and "__OK__" in (r.stdout or ""):
        return CaseResult(problem.task_id, True)
    return CaseResult(problem.task_id, False, (r.stderr or r.stdout or "").strip()[:200])


# ── 编排：跑分 ──────────────────────────────────────────────────────────


def run(problems: list[Problem], solver: Solver, timeout: float = 10.0) -> BenchReport:
    """同步跑分：逐题 solver 生成 → score_one 判分，汇总 pass@1。"""
    report = BenchReport()
    for p in problems:
        try:
            completion = solver(p)
        except Exception as e:  # noqa: BLE001
            report.results.append(CaseResult(p.task_id, False, f"solver 失败：{e}"[:200]))
            continue
        report.results.append(score_one(p, completion, timeout))
    return report


_SOLVE_PROMPT = (
    "请补全下面的 Python 函数，只输出完整函数实现（含签名），放在 ```python 代码块里，"
    "不要解释、不要写测试。\n\n{prompt}"
)


async def adapter_solve_all(
    problems: list[Problem],
    adapter_name: str,
    model: str | None = None,
    timeout: float = 10.0,
) -> BenchReport:
    """真实模式：用 AgentHub 适配器逐题生成（READ_ONLY 只读，不落盘），再判分。

    需全局 registry 已注册该适配器且健康（凭证可用）；否则抛错由调用方处理。
    """
    from app.adapters.base import (
        AdapterContext,
        UnifiedApprovalMode,
        UnifiedSandboxLevel,
    )
    from app.core.registry import get_global_registry

    adapter = get_global_registry().get(adapter_name)
    if adapter is None:
        raise RuntimeError(f"适配器未注册：{adapter_name}")
    if not await adapter.health_check():
        raise RuntimeError(f"适配器健康检查失败（凭证/可用性）：{adapter_name}")

    report = BenchReport()
    for p in problems:
        ctx = AdapterContext(
            instructions=_SOLVE_PROMPT.format(prompt=p.prompt),
            workspace_path=".",
            approval_mode=UnifiedApprovalMode.AUTO,
            sandbox_level=UnifiedSandboxLevel.READ_ONLY,
            model=model or getattr(adapter, "light_model", None),
        )
        parts: list[str] = []
        result_text = ""
        try:
            async for event in adapter.execute(ctx):
                if event.type == "completed":
                    result_text = str(event.data.get("result", "")) or "".join(parts)
                    break
                if event.type == "thinking":
                    t = str(event.data.get("text", ""))
                    if t:
                        parts.append(t)
                elif event.type == "error":
                    break
        except Exception as e:  # noqa: BLE001
            report.results.append(CaseResult(p.task_id, False, f"adapter 失败：{e}"[:200]))
            continue
        completion = extract_code(result_text or "".join(parts))
        report.results.append(score_one(p, completion, timeout))
    return report
