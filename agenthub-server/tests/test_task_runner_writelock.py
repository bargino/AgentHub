"""TaskRunner 写锁并发模型单测：写任务串行、只读任务并行（execute_plan 并发安全关键）。

驱动 run() 走到写锁分支：monkeypatch 其协作者（resolve_adapter_candidates / build_context /
get_upstream_results）+ FakeAdapter(ICodeAdapter) 记录峰值并发。被测核心 = run() 内
sandbox_level 决定是否持 write_lock 的逻辑（不 mock）。
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.adapters.base import AdapterContext, UnifiedEvent, UnifiedSandboxLevel
from app.db.engine import dispose_engine, get_session_factory, init_database
from app.orchestrator import task_executor as te
from app.orchestrator.task_executor import ExecutionState, TaskRunner
from app.orchestrator.task_planner import PlannedTask
from app.services import task as task_service

_CID = "conv-wl"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("AGENTHUB_DATABASE_URL", url)
    await dispose_engine()
    await init_database()
    try:
        yield
    finally:
        await dispose_engine()


class _Probe:
    """记录 execute 期间的峰值并发。"""

    def __init__(self) -> None:
        self.active = 0
        self.max_active = 0

    def enter(self) -> None:
        self.active += 1
        self.max_active = max(self.max_active, self.active)

    def exit(self) -> None:
        self.active -= 1


class _FakeAdapter:
    def __init__(self, probe: _Probe) -> None:
        self._probe = probe

    @property
    def name(self) -> str:
        return "fake"

    async def health_check(self) -> bool:
        return True

    async def execute(self, ctx: Any):
        self._probe.enter()
        try:
            await asyncio.sleep(0.02)  # 制造并发窗口
            yield UnifiedEvent(type="completed", data={"result": "ok"}, adapter="fake")
        finally:
            self._probe.exit()

    async def resolve_approval(self, request_id: str, approved: bool) -> bool:
        return True

    async def interrupt(self, execution_tag: str | None = None) -> bool:
        return True


def _wire(monkeypatch, sandbox: UnifiedSandboxLevel, probe: _Probe) -> None:
    """把 run() 的重协作者替换为受控替身，仅保留写锁分支这一被测逻辑。"""

    async def fake_candidates(session, registry, role, member_ids=None):
        return [(_FakeAdapter(probe), "fake")]

    async def fake_build_context(session, **kwargs):
        return AdapterContext(instructions="x", workspace_path="", sandbox_level=sandbox)

    async def fake_upstream(session, conversation_id, ids):
        return []

    # run() 把 get_global_registry() 作为实参传给 resolve_adapter_candidates，调用前即求值，
    # 故须一并替身（fake_candidates 忽略该参数）
    monkeypatch.setattr(te, "get_global_registry", lambda: object())
    monkeypatch.setattr(te, "resolve_adapter_candidates", fake_candidates)
    monkeypatch.setattr(te, "build_context", fake_build_context)
    monkeypatch.setattr(te.task_memory, "get_upstream_results", fake_upstream)


async def _seed_two() -> dict[str, str]:
    factory = get_session_factory()
    id_map: dict[str, str] = {}
    async with factory() as session, session.begin():
        for tid in ("t1", "t2"):
            outs = await task_service.create_tasks(
                session, _CID, [{"title": tid, "agent_role": "coder", "depends_on": []}]
            )
            id_map[tid] = outs[0].id
    return id_map


async def _run_two(id_map: dict[str, str]) -> None:
    state = ExecutionState(
        conversation_id=_CID, project_name="p", workspace_path="",
        user_instructions="x", id_map=id_map,
    )
    labels = {"coder": "Coder"}
    r1 = TaskRunner(state, PlannedTask(id="t1", agent="coder", title="a"), labels)
    r2 = TaskRunner(state, PlannedTask(id="t2", agent="coder", title="b"), labels)
    results = await asyncio.gather(r1.run(), r2.run())
    assert all(results)  # 两任务都成功


async def test_write_tasks_serialized_by_write_lock(db, monkeypatch) -> None:
    probe = _Probe()
    _wire(monkeypatch, UnifiedSandboxLevel.WORKSPACE_WRITE, probe)
    id_map = await _seed_two()

    await _run_two(id_map)

    assert probe.max_active == 1  # 写任务持 write_lock，串行执行（防并行写互相覆盖）


async def test_readonly_tasks_run_in_parallel(db, monkeypatch) -> None:
    probe = _Probe()
    _wire(monkeypatch, UnifiedSandboxLevel.READ_ONLY, probe)
    id_map = await _seed_two()

    await _run_two(id_map)

    assert probe.max_active == 2  # 只读任务不持锁，保留并行收益
