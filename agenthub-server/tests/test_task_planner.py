"""task_planner 纯函数单测：DAG 校验 / JSON 提取 / 决策解析 / 回退纠偏。

仅覆盖同步纯函数，不触发 LLM / DB / SDK（decide() 的 async 路径见后续 fixture 测试）。
"""

from __future__ import annotations

import pytest

from app.orchestrator.task_planner import (
    _FAN_OUT_CAP,
    _HIGH_COMPLEXITY,
    _MIN_DECISION_CONFIDENCE,
    Decision,
    SpecTask,
    TaskSpec,
    _extract_json,
    _fallback_decision,
    _first_json_object,
    _is_dag,
    _parse_decision,
    _parse_str_list,
    _parse_tasks,
    _reconcile_low_confidence,
    _self_assessment,
    analyze_spec,
)

VALID_AGENTS = {"planner", "coder", "reviewer", "deployer"}


def _task(tid: str, deps: list[str] | None = None, agent: str = "coder") -> SpecTask:
    return SpecTask(id=tid, agent=agent, title=f"task {tid}", depends_on=deps or [])


# ---- _is_dag：拓扑可达性 ----


def test_is_dag_linear_chain_true() -> None:
    tasks = [_task("a"), _task("b", ["a"]), _task("c", ["b"])]
    assert _is_dag(tasks) is True


def test_is_dag_diamond_true() -> None:
    tasks = [_task("a"), _task("b", ["a"]), _task("c", ["a"]), _task("d", ["b", "c"])]
    assert _is_dag(tasks) is True


def test_is_dag_empty_true() -> None:
    assert _is_dag([]) is True


def test_is_dag_self_cycle_false() -> None:
    assert _is_dag([_task("a", ["a"])]) is False


def test_is_dag_two_node_cycle_false() -> None:
    assert _is_dag([_task("a", ["b"]), _task("b", ["a"])]) is False


# ---- _first_json_object：花括号配平扫描 ----


def test_first_json_object_plain() -> None:
    assert _first_json_object('{"a": 1}') == '{"a": 1}'


def test_first_json_object_with_prefix_text() -> None:
    assert _first_json_object('好的，spec如下：{"a": 1} 完成') == '{"a": 1}'


def test_first_json_object_brace_inside_string() -> None:
    raw = '{"a": "}{"}'  # 字符串内的花括号不得破坏配平
    assert _first_json_object(raw) == raw


def test_first_json_object_nested() -> None:
    raw = '{"a": {"b": 1}}'
    assert _first_json_object("x " + raw) == raw


def test_first_json_object_none_when_no_brace() -> None:
    assert _first_json_object("no json here") is None


# ---- _extract_json：围栏 + 夹带文字容忍 ----


def test_extract_json_fenced() -> None:
    assert _extract_json('```json\n{"mode": "direct"}\n```') == {"mode": "direct"}


def test_extract_json_plain() -> None:
    assert _extract_json('{"mode": "single"}') == {"mode": "single"}


def test_extract_json_with_surrounding_text() -> None:
    assert _extract_json('结果：{"mode": "direct"} ok') == {"mode": "direct"}


def test_extract_json_invalid_returns_none() -> None:
    assert _extract_json("not json") is None


def test_extract_json_top_level_array_returns_none() -> None:
    assert _extract_json("[1, 2, 3]") is None


# ---- _self_assessment：置信度/复杂度解析与 clamp ----


@pytest.mark.parametrize(
    "data,expected",
    [
        ({"confidence": 0.8, "complexity": 3}, (0.8, 3)),
        ({}, (1.0, 0)),
        ({"confidence": 5, "complexity": 9}, (1.0, 5)),
        ({"confidence": -1, "complexity": -2}, (0.0, 0)),
        ({"confidence": "x"}, (1.0, 0)),
    ],
)
def test_self_assessment(data: dict, expected: tuple[float, int]) -> None:
    assert _self_assessment(data) == expected


# ---- _parse_tasks：DAG spec构建与非法拦截 ----


def test_parse_tasks_valid_pipeline() -> None:
    raw = [
        {"id": "t1", "agent": "planner", "title": "plan"},
        {"id": "t2", "agent": "coder", "title": "code", "dependsOn": ["t1"]},
    ]
    plan = _parse_tasks(raw, "goal", VALID_AGENTS)
    assert plan is not None
    assert [t.id for t in plan.tasks] == ["t1", "t2"]
    assert plan.tasks[1].depends_on == ["t1"]


def test_parse_tasks_empty_goal_none() -> None:
    raw = [{"id": "t1", "agent": "coder", "title": "x"}]
    assert _parse_tasks(raw, "", VALID_AGENTS) is None


def test_parse_tasks_dangling_dep_none() -> None:
    raw = [{"id": "t1", "agent": "coder", "title": "x", "dependsOn": ["ghost"]}]
    assert _parse_tasks(raw, "g", VALID_AGENTS) is None


def test_parse_tasks_cycle_none() -> None:
    raw = [
        {"id": "t1", "agent": "coder", "title": "x", "dependsOn": ["t2"]},
        {"id": "t2", "agent": "coder", "title": "y", "dependsOn": ["t1"]},
    ]
    assert _parse_tasks(raw, "g", VALID_AGENTS) is None


def test_parse_tasks_invalid_agent_none() -> None:
    raw = [{"id": "t1", "agent": "ghost", "title": "x"}]
    assert _parse_tasks(raw, "g", VALID_AGENTS) is None


def test_parse_tasks_duplicate_id_none() -> None:
    raw = [
        {"id": "t1", "agent": "coder", "title": "x"},
        {"id": "t1", "agent": "coder", "title": "y"},
    ]
    assert _parse_tasks(raw, "g", VALID_AGENTS) is None


def test_parse_tasks_deployer_forces_approval() -> None:
    raw = [{"id": "t1", "agent": "deployer", "title": "ship"}]
    plan = _parse_tasks(raw, "g", VALID_AGENTS)
    assert plan is not None
    assert plan.tasks[0].requires_approval is True


def test_parse_tasks_fan_out_clamped_to_cap() -> None:
    raw = [{"id": "t1", "agent": "coder", "title": "x", "fanOut": 99}]
    plan = _parse_tasks(raw, "g", VALID_AGENTS)
    assert plan is not None
    assert plan.tasks[0].fan_out == _FAN_OUT_CAP


# ---- _parse_decision：四模式解析 ----


def test_parse_decision_direct() -> None:
    d = _parse_decision('{"mode": "direct", "answer": "hi"}', VALID_AGENTS)
    assert d is not None
    assert d.mode == "direct"
    assert d.answer == "hi"


def test_parse_decision_direct_without_answer_none() -> None:
    assert _parse_decision('{"mode": "direct", "answer": ""}', VALID_AGENTS) is None


def test_parse_decision_single_valid() -> None:
    d = _parse_decision('{"mode": "single", "agent": "coder", "title": "do"}', VALID_AGENTS)
    assert d is not None
    assert d.mode == "single"
    assert d.spec is not None
    assert d.spec.tasks[0].agent == "coder"


def test_parse_decision_single_invalid_agent_none() -> None:
    raw = '{"mode": "single", "agent": "ghost", "title": "do"}'
    assert _parse_decision(raw, VALID_AGENTS) is None


def test_parse_decision_clarify_valid() -> None:
    raw = '{"mode": "clarify", "question": "q?", "options": ["a", "b"], "recommended": 1}'
    d = _parse_decision(raw, VALID_AGENTS)
    assert d is not None
    assert d.mode == "clarify"
    assert d.options == ["a", "b"]
    assert d.recommended == 1


def test_parse_decision_clarify_too_few_options_none() -> None:
    raw = '{"mode": "clarify", "question": "q?", "options": ["only"]}'
    assert _parse_decision(raw, VALID_AGENTS) is None


def test_parse_decision_pipeline_valid() -> None:
    raw = (
        '{"mode": "pipeline", "goal": "g", "tasks": ['
        '{"id": "t1", "agent": "planner", "title": "p"},'
        '{"id": "t2", "agent": "coder", "title": "c", "dependsOn": ["t1"]}]}'
    )
    d = _parse_decision(raw, VALID_AGENTS)
    assert d is not None
    assert d.mode == "pipeline"
    assert d.spec is not None
    assert len(d.spec.tasks) == 2


def test_parse_decision_unknown_mode_none() -> None:
    assert _parse_decision('{"mode": "weird"}', VALID_AGENTS) is None


# ---- _fallback_decision：决策器不可用时的规则回退 ----


def test_fallback_decision_prefers_coder() -> None:
    d = _fallback_decision("do something", VALID_AGENTS)
    assert d.mode == "single"
    assert d.spec is not None
    assert d.spec.tasks[0].agent == "coder"


def test_fallback_decision_deployer_only_forces_approval() -> None:
    d = _fallback_decision("ship", {"deployer"})
    assert d.spec is not None
    assert d.spec.tasks[0].agent == "deployer"
    assert d.spec.tasks[0].requires_approval is True


# ---- _reconcile_low_confidence：低置信/高复杂回退 clarify（用模块常量避免 env 漂移）----


def test_reconcile_low_confidence_single_to_clarify() -> None:
    low = _MIN_DECISION_CONFIDENCE / 2  # 保证 0 < low < 阈值
    d = Decision(mode="single", confidence=low, complexity=0)
    assert _reconcile_low_confidence(d, allow_clarify=True).mode == "clarify"


def test_reconcile_high_complexity_to_clarify() -> None:
    d = Decision(mode="single", confidence=1.0, complexity=_HIGH_COMPLEXITY)
    assert _reconcile_low_confidence(d, allow_clarify=True).mode == "clarify"


def test_reconcile_not_allowed_keeps_decision() -> None:
    low = _MIN_DECISION_CONFIDENCE / 2
    d = Decision(mode="single", confidence=low, complexity=_HIGH_COMPLEXITY)
    assert _reconcile_low_confidence(d, allow_clarify=False).mode == "single"


def test_reconcile_pipeline_unchanged() -> None:
    d = Decision(mode="pipeline", confidence=_MIN_DECISION_CONFIDENCE / 2, complexity=9)
    assert _reconcile_low_confidence(d, allow_clarify=True).mode == "pipeline"


def test_reconcile_zero_confidence_not_treated_as_low() -> None:
    # confidence==0 视为模型未给自评，仅看 complexity（此处低 → 不纠偏）
    d = Decision(mode="single", confidence=0.0, complexity=0)
    assert _reconcile_low_confidence(d, allow_clarify=True).mode == "single"


# ---- analyze_spec：SDD Analyze 阶段 spec↔tasks 一致性核对 ----


def _acc_task(tid: str, agent: str, title: str, acc: str = "当X，系统应Y") -> SpecTask:
    return SpecTask(id=tid, agent=agent, title=title, acceptance=acc)


def test_analyze_spec_empty_plan() -> None:
    assert analyze_spec(TaskSpec(goal="g", tasks=[])) == ["spec 为空：无任何任务"]


def test_analyze_spec_clean_passes() -> None:
    plan = TaskSpec(
        goal="g",
        tasks=[
            _acc_task("t1", "coder", "实现登录"),
            _acc_task("t2", "reviewer", "审查登录"),
        ],
    )
    assert analyze_spec(plan) == []


def test_analyze_spec_flags_missing_acceptance() -> None:
    plan = TaskSpec(
        goal="g",
        tasks=[
            _acc_task("t1", "coder", "实现", acc=""),
            _acc_task("t2", "reviewer", "审查"),
        ],
    )
    assert any("缺少 EARS" in w for w in analyze_spec(plan))


def test_analyze_spec_flags_duplicate_titles() -> None:
    plan = TaskSpec(
        goal="g",
        tasks=[_acc_task("t1", "coder", "改"), _acc_task("t2", "reviewer", "改")],
    )
    assert any("重复" in w for w in analyze_spec(plan))


def test_analyze_spec_flags_coder_without_reviewer() -> None:
    plan = TaskSpec(goal="g", tasks=[_acc_task("t1", "coder", "实现")])
    assert any("reviewer" in w for w in analyze_spec(plan))


# ---- _parse_str_list / outOfScope（P1：非目标端到端）----


def test_parse_str_list_trims_and_drops_empty() -> None:
    assert _parse_str_list(["a", " b ", "", "  ", "c"]) == ["a", "b", "c"]


def test_parse_str_list_non_list_returns_empty() -> None:
    assert _parse_str_list("x") == []
    assert _parse_str_list(None) == []


def test_parse_str_list_caps_item_count() -> None:
    assert len(_parse_str_list([str(i) for i in range(50)])) == 12


def test_task_plan_out_of_scope_default_empty() -> None:
    assert TaskSpec(goal="g", tasks=[]).out_of_scope == []


def test_parse_decision_pipeline_parses_out_of_scope() -> None:
    raw = (
        '{"mode": "pipeline", "goal": "g", '
        '"tasks": [{"id": "t1", "agent": "coder", "title": "c"}], '
        '"outOfScope": ["不改 schema", "  ", "不动 CI"]}'
    )
    d = _parse_decision(raw, VALID_AGENTS)
    assert d is not None
    assert d.spec is not None
    assert d.spec.out_of_scope == ["不改 schema", "不动 CI"]
