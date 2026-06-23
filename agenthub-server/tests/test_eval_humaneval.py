"""HumanEval+ runner 离线单测（不需 evalplus / 模型 / 网络）。"""

from __future__ import annotations

from app.eval.benchmarks import humaneval


def test_load_sample_problems():
    probs = humaneval.load_problems(source="sample")
    assert len(probs) >= 2
    p = probs[0]
    assert p.task_id and p.entry_point and p.prompt and p.test


def test_load_limit():
    assert len(humaneval.load_problems(source="sample", limit=1)) == 1


def test_stub_solver_all_pass():
    probs = humaneval.load_problems(source="sample")
    report = humaneval.run(probs, humaneval.stub_solver)
    assert report.total == len(probs)
    assert report.passed == report.total
    assert report.pass_at_1 == 1.0


def test_wrong_completion_fails():
    prob = humaneval.load_problems(source="sample", limit=1)[0]  # add(a,b)
    wrong = prob.prompt + "    return a - b\n"  # 实现成相减
    res = humaneval.score_one(prob, wrong)
    assert res.passed is False
    assert res.error


def test_score_accepts_body_only_completion():
    prob = humaneval.load_problems(source="sample", limit=1)[0]
    res = humaneval.score_one(prob, "    return a + b\n")  # 只给函数体
    assert res.passed is True


def test_extract_code_from_fence():
    raw = "解释...\n```python\ndef add(a, b):\n    return a + b\n```\n收尾"
    code = humaneval.extract_code(raw)
    assert code.startswith("def add")
    assert "return a + b" in code
    assert "```" not in code


def test_timeout_is_failure():
    prob = humaneval.Problem(
        task_id="loop",
        prompt="def f():\n",
        entry_point="f",
        test="def check(candidate):\n    candidate()\n",
        canonical_solution="    while True:\n        pass\n",
    )
    res = humaneval.score_one(prob, prob.prompt + prob.canonical_solution, timeout=2.0)
    assert res.passed is False
    assert res.error == "timeout"
