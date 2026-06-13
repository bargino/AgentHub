"""编排加固：决策器解析校验（JSON 重试基础）、DAG 环检测、DB URL 可配置、并发限流。

运行：cd agenthub-server && python -m pytest tests/test_orchestration_hardening.py -v
"""

from __future__ import annotations

import asyncio

from app.orchestrator.task_planner import PlannedTask, _is_dag, _parse_decision

# ---------------------------------------------------------------------------
# 决策器解析校验（JSON 重试的判定基础：解析失败返回 None 才会触发重试/回退）
# ---------------------------------------------------------------------------


def test_parse_decision_rejects_bad_json() -> None:
    assert _parse_decision("not json at all", {"coder"}) is None
    assert _parse_decision("", {"coder"}) is None


def test_parse_decision_rejects_invalid_role() -> None:
    raw = '{"mode":"single","agent":"hacker","title":"x"}'
    assert _parse_decision(raw, {"coder", "planner"}) is None


def test_parse_decision_direct_ok() -> None:
    d = _parse_decision('{"mode":"direct","answer":"你好"}', {"coder"})
    assert d is not None and d.mode == "direct" and d.answer == "你好"


def test_parse_decision_pipeline_rejects_unknown_dep() -> None:
    raw = (
        '{"mode":"pipeline","goal":"g","tasks":'
        '[{"id":"t1","agent":"coder","title":"写","dependsOn":["tX"]}]}'
    )
    assert _parse_decision(raw, {"coder"}) is None


def test_parse_decision_pipeline_ok() -> None:
    raw = (
        '{"mode":"pipeline","goal":"加暗色模式","tasks":['
        '{"id":"t1","agent":"coder","title":"写代码","dependsOn":[]},'
        '{"id":"t2","agent":"reviewer","title":"审查","dependsOn":["t1"]}]}'
    )
    d = _parse_decision(raw, {"coder", "reviewer"})
    assert d is not None and d.mode == "pipeline" and d.plan is not None
    assert [t.id for t in d.plan.tasks] == ["t1", "t2"]


# ---------------------------------------------------------------------------
# DAG 环检测
# ---------------------------------------------------------------------------


def test_is_dag_detects_cycle() -> None:
    tasks = [
        PlannedTask(id="a", agent="coder", title="a", depends_on=["b"]),
        PlannedTask(id="b", agent="coder", title="b", depends_on=["a"]),
    ]
    assert _is_dag(tasks) is False


def test_is_dag_accepts_chain() -> None:
    tasks = [
        PlannedTask(id="a", agent="coder", title="a", depends_on=[]),
        PlannedTask(id="b", agent="reviewer", title="b", depends_on=["a"]),
    ]
    assert _is_dag(tasks) is True


# ---------------------------------------------------------------------------
# DB URL 可配置（支持 Postgres，不强切）
# ---------------------------------------------------------------------------


def test_database_url_uses_env(monkeypatch) -> None:
    from app.db import engine as db_engine

    monkeypatch.setenv("AGENTHUB_DATABASE_URL", "postgresql+asyncpg://u:p@h/db")
    assert db_engine.get_database_url() == "postgresql+asyncpg://u:p@h/db"


def test_database_url_defaults_sqlite(monkeypatch) -> None:
    from app.db import engine as db_engine

    monkeypatch.delenv("AGENTHUB_DATABASE_URL", raising=False)
    assert db_engine.get_database_url().startswith("sqlite+aiosqlite:///")


# ---------------------------------------------------------------------------
# 并发限流常量（SDK 子进程并发上限）
# ---------------------------------------------------------------------------


def test_concurrency_limiter_configured() -> None:
    from app.orchestrator import task_executor as te

    assert isinstance(te._agent_semaphore, asyncio.Semaphore)
    assert te._MAX_CONCURRENT_AGENTS >= 1
