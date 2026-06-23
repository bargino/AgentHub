"""execute_plan 调度算法单测：就绪并行 / 依赖顺序 / 级联取消 / 断点续跑 / 幽灵 pending / 返回计数。

隔离边界：仅 monkeypatch `_execute_ready_task`（单任务运行器，独立单元）以受控成功/失败驱动
调度并探测并发；**被测核心 = execute_plan 的拓扑调度逻辑本身（不被 mock）**。DB 用临时文件
SQLite（跨连接共享，避开 :memory: 多连接各自独立的坑），任务状态机走真实 task_service。
"""

from __future__ import annotations

import asyncio

import pytest

from app.db.engine import dispose_engine, get_session_factory, init_database
from app.orchestrator import task_executor as te
from app.orchestrator.task_executor import ExecutionState, execute_plan
from app.orchestrator.task_planner import PlannedTask, TaskPlan
from app.services import task as task_service

_CID = "conv-1"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    """临时文件 SQLite 引擎：建表后 yield，结束 dispose 还原全局单例。"""
    url = f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("AGENTHUB_DATABASE_URL", url)
    await dispose_engine()  # 清掉可能指向真实库的全局单例
    await init_database()
    try:
        yield
    finally:
        await dispose_engine()


def _p(tid: str, deps: list[str] | None = None, agent: str = "coder") -> PlannedTask:
    return PlannedTask(id=tid, agent=agent, title=f"task {tid}", depends_on=deps or [])


class _Recorder:
    """记录任务执行顺序与峰值并发（验证 gather 真并行）。"""

    def __init__(self) -> None:
        self.executed: list[str] = []
        self.active = 0
        self.max_active = 0

    def start(self, tid: str) -> None:
        self.executed.append(tid)
        self.active += 1
        self.max_active = max(self.max_active, self.active)

    def end(self) -> None:
        self.active -= 1


def _fake_runner(rec: _Recorder, results: dict[str, bool] | None = None):
    """受控 _execute_ready_task 替身：记录调用/并发，按 id 返回成功或失败（默认成功）。"""
    table = results or {}

    async def fake(state: ExecutionState, planned: PlannedTask, role_labels: dict) -> bool:
        rec.start(planned.id)
        try:
            await asyncio.sleep(0.01)  # 让并行就绪任务有交错窗口，峰值并发才可观测
        finally:
            rec.end()
        return bool(table.get(planned.id, True))

    return fake


async def _seed(plan: TaskPlan) -> dict[str, str]:
    """按 plan 在 DB 落库任务，返回 planned.id -> db task id。"""
    factory = get_session_factory()
    id_map: dict[str, str] = {}
    async with factory() as session, session.begin():
        for t in plan.tasks:
            outs = await task_service.create_tasks(
                session,
                _CID,
                [{"title": t.title, "agent_role": t.agent, "depends_on": t.depends_on}],
            )
            id_map[t.id] = outs[0].id
    return id_map


def _state(id_map: dict[str, str]) -> ExecutionState:
    return ExecutionState(
        conversation_id=_CID,
        project_name="proj",
        workspace_path="",
        user_instructions="do it",
        id_map=id_map,
    )


async def _status(db_id: str) -> str | None:
    factory = get_session_factory()
    async with factory() as session:
        out = await task_service.get_task(session, db_id)
    return out.status if out else None


async def _force_success(db_id: str) -> None:
    """把任务推进到 success（断点续跑前置：pending->running->success 合法迁移）。"""
    factory = get_session_factory()
    async with factory() as session, session.begin():
        await task_service.update_task_status(session, db_id, "running")
        await task_service.update_task_status(session, db_id, "success")


# ---- 就绪并行 ----


async def test_independent_tasks_run_in_parallel(db, monkeypatch) -> None:
    plan = TaskPlan(goal="g", tasks=[_p("a"), _p("b")])
    id_map = await _seed(plan)
    rec = _Recorder()
    monkeypatch.setattr(te, "_execute_ready_task", _fake_runner(rec))

    ok, bad = await execute_plan(_state(id_map), plan)

    assert (ok, bad) == (2, 0)
    assert set(rec.executed) == {"a", "b"}
    assert rec.max_active == 2  # 两个无依赖任务同批并行


# ---- 依赖顺序（线性链串行） ----


async def test_linear_chain_runs_in_order(db, monkeypatch) -> None:
    plan = TaskPlan(goal="g", tasks=[_p("a"), _p("b", ["a"]), _p("c", ["b"])])
    id_map = await _seed(plan)
    rec = _Recorder()
    monkeypatch.setattr(te, "_execute_ready_task", _fake_runner(rec))

    ok, bad = await execute_plan(_state(id_map), plan)

    assert (ok, bad) == (3, 0)
    assert rec.executed == ["a", "b", "c"]
    assert rec.max_active == 1  # 链式依赖逐个执行，无并行


# ---- 钻石 DAG：中间层并行，汇聚点等齐 ----


async def test_diamond_dag_parallel_middle(db, monkeypatch) -> None:
    plan = TaskPlan(
        goal="g",
        tasks=[_p("a"), _p("b", ["a"]), _p("c", ["a"]), _p("d", ["b", "c"])],
    )
    id_map = await _seed(plan)
    rec = _Recorder()
    monkeypatch.setattr(te, "_execute_ready_task", _fake_runner(rec))

    ok, bad = await execute_plan(_state(id_map), plan)

    assert (ok, bad) == (4, 0)
    assert rec.executed[0] == "a"
    assert rec.executed[-1] == "d"
    assert set(rec.executed[1:3]) == {"b", "c"}
    assert rec.max_active == 2  # b、c 同批并行；a、d 各自独占


# ---- 级联取消：上游失败 → 下游链全部 cancelled ----


async def test_cascade_cancel_on_upstream_failure(db, monkeypatch) -> None:
    plan = TaskPlan(goal="g", tasks=[_p("a"), _p("b", ["a"]), _p("c", ["b"])])
    id_map = await _seed(plan)
    rec = _Recorder()
    monkeypatch.setattr(te, "_execute_ready_task", _fake_runner(rec, {"a": False}))

    ok, bad = await execute_plan(_state(id_map), plan)

    assert (ok, bad) == (0, 3)  # a 失败 + b、c 级联取消
    assert rec.executed == ["a"]  # 下游从未执行
    assert await _status(id_map["b"]) == "cancelled"
    assert await _status(id_map["c"]) == "cancelled"


# ---- 断点续跑：DB 已 success 的任务跳过不重跑 ----


async def test_breakpoint_resume_skips_completed(db, monkeypatch) -> None:
    plan = TaskPlan(goal="g", tasks=[_p("a"), _p("b", ["a"])])
    id_map = await _seed(plan)
    await _force_success(id_map["a"])  # 模拟上一轮 a 已完成
    rec = _Recorder()
    monkeypatch.setattr(te, "_execute_ready_task", _fake_runner(rec))

    ok, bad = await execute_plan(_state(id_map), plan)

    assert (ok, bad) == (2, 0)  # a 计为已完成，b 本轮执行
    assert rec.executed == ["b"]  # a 未被重跑
    assert await _status(id_map["a"]) == "success"


# ---- 幽灵 pending 兜底：依赖永不就绪 → stranded 取消，不挂起 ----


async def test_ghost_pending_stranded_cancelled(db, monkeypatch) -> None:
    # b 依赖一个不存在的 id（DAG 校验后正常不达，此处测调度防御路径）
    plan = TaskPlan(goal="g", tasks=[_p("a"), _p("b", ["ghost"])])
    id_map = await _seed(plan)
    rec = _Recorder()
    monkeypatch.setattr(te, "_execute_ready_task", _fake_runner(rec))

    ok, bad = await asyncio.wait_for(execute_plan(_state(id_map), plan), timeout=5)

    assert (ok, bad) == (1, 1)
    assert rec.executed == ["a"]
    assert await _status(id_map["b"]) == "cancelled"


# ---- 返回计数：独立任务一成一败 ----


async def test_returns_mixed_success_fail_counts(db, monkeypatch) -> None:
    plan = TaskPlan(goal="g", tasks=[_p("a"), _p("b")])
    id_map = await _seed(plan)
    rec = _Recorder()
    monkeypatch.setattr(te, "_execute_ready_task", _fake_runner(rec, {"b": False}))

    ok, bad = await execute_plan(_state(id_map), plan)

    assert (ok, bad) == (1, 1)
    assert set(rec.executed) == {"a", "b"}  # 独立任务都执行（b 自身失败，非级联）
