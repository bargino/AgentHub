"""调度决策器单元测试：意图分流解析（direct/single/pipeline）与规则回退。

运行：cd agenthub-server && python -m pytest tests/test_planner.py -v
"""

from __future__ import annotations

from app.orchestrator.task_planner import (
    Decision,
    _fallback_decision,
    _parse_decision,
)

VALID = {"planner", "coder", "reviewer", "deployer"}


# ---------------------------------------------------------------------------
# _parse_decision：direct（直接回答）
# ---------------------------------------------------------------------------


def test_parse_direct() -> None:
    raw = '{"mode": "direct", "answer": "我是 Claude。"}'
    d = _parse_decision(raw, VALID)
    assert d is not None
    assert d.mode == "direct"
    assert d.answer == "我是 Claude。"
    assert d.plan is None


def test_parse_direct_with_code_fence() -> None:
    raw = '```json\n{"mode": "direct", "answer": "这是一个 React 项目"}\n```'
    d = _parse_decision(raw, VALID)
    assert d is not None
    assert d.mode == "direct"
    assert d.answer == "这是一个 React 项目"


def test_parse_direct_empty_answer_rejected() -> None:
    # direct 无 answer 无法回答，判为非法，交由调用方回退
    assert _parse_decision('{"mode": "direct", "answer": ""}', VALID) is None


# ---------------------------------------------------------------------------
# _parse_decision：single（单步任务）
# ---------------------------------------------------------------------------


def test_parse_single() -> None:
    raw = '{"mode": "single", "agent": "coder", "title": "把首页标题改成 X"}'
    d = _parse_decision(raw, VALID)
    assert d is not None
    assert d.mode == "single"
    assert d.plan is not None
    assert len(d.plan.tasks) == 1
    t = d.plan.tasks[0]
    assert t.agent == "coder"
    assert t.depends_on == []
    assert t.requires_approval is False


def test_parse_single_deployer_forces_approval() -> None:
    raw = '{"mode": "single", "agent": "deployer", "title": "部署到测试环境"}'
    d = _parse_decision(raw, VALID)
    assert d is not None
    assert d.plan is not None
    assert d.plan.tasks[0].requires_approval is True


def test_parse_single_unknown_agent_rejected() -> None:
    assert _parse_decision('{"mode": "single", "agent": "ghost", "title": "x"}', VALID) is None


def test_parse_single_missing_title_rejected() -> None:
    assert _parse_decision('{"mode": "single", "agent": "coder", "title": ""}', VALID) is None


def test_parse_single_respects_member_scope() -> None:
    # agent 不在群成员有效角色内 -> 拒绝
    assert _parse_decision(
        '{"mode": "single", "agent": "coder", "title": "x"}', {"reviewer"}
    ) is None


# ---------------------------------------------------------------------------
# _parse_decision：pipeline（多步 DAG）
# ---------------------------------------------------------------------------


def test_parse_pipeline_dag() -> None:
    raw = """{
      "mode": "pipeline",
      "goal": "实现登录模块",
      "tasks": [
        {"id": "t1", "agent": "planner", "title": "规划", "dependsOn": []},
        {"id": "t2", "agent": "coder", "title": "实现", "dependsOn": ["t1"]},
        {"id": "t3", "agent": "reviewer", "title": "审查", "dependsOn": ["t2"]}
      ]
    }"""
    d = _parse_decision(raw, VALID)
    assert d is not None
    assert d.mode == "pipeline"
    assert d.plan is not None
    assert [t.id for t in d.plan.tasks] == ["t1", "t2", "t3"]
    assert d.plan.tasks[1].depends_on == ["t1"]


def test_parse_pipeline_cycle_rejected() -> None:
    raw = """{
      "mode": "pipeline",
      "goal": "环",
      "tasks": [
        {"id": "t1", "agent": "coder", "title": "a", "dependsOn": ["t2"]},
        {"id": "t2", "agent": "coder", "title": "b", "dependsOn": ["t1"]}
      ]
    }"""
    assert _parse_decision(raw, VALID) is None


def test_parse_pipeline_dangling_dependency_rejected() -> None:
    raw = """{
      "mode": "pipeline",
      "goal": "悬空依赖",
      "tasks": [
        {"id": "t1", "agent": "coder", "title": "a", "dependsOn": ["t9"]}
      ]
    }"""
    assert _parse_decision(raw, VALID) is None


def test_parse_pipeline_empty_tasks_rejected() -> None:
    assert _parse_decision('{"mode": "pipeline", "goal": "x", "tasks": []}', VALID) is None


# ---------------------------------------------------------------------------
# _parse_decision：非法输入
# ---------------------------------------------------------------------------


def test_parse_invalid_json() -> None:
    assert _parse_decision("not json at all", VALID) is None


def test_parse_unknown_mode() -> None:
    assert _parse_decision('{"mode": "magic", "answer": "x"}', VALID) is None


def test_parse_missing_mode() -> None:
    assert _parse_decision('{"answer": "x"}', VALID) is None


# ---------------------------------------------------------------------------
# _fallback_decision：决策器不可用时回退单步任务（不再三段链）
# ---------------------------------------------------------------------------


def test_fallback_is_single_not_three_stage() -> None:
    d = _fallback_decision("随便做点什么", VALID)
    assert isinstance(d, Decision)
    assert d.mode == "single"
    assert d.plan is not None
    assert len(d.plan.tasks) == 1  # 关键：不再无脑 planner->coder->reviewer


def test_fallback_prefers_coder() -> None:
    d = _fallback_decision("改个东西", VALID)
    assert d.plan is not None
    assert d.plan.tasks[0].agent == "coder"


def test_fallback_picks_available_role_when_no_coder() -> None:
    d = _fallback_decision("分析一下", {"reviewer"})
    assert d.plan is not None
    assert d.plan.tasks[0].agent == "reviewer"
