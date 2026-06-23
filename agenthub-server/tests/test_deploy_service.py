"""deploy 服务单测（Epic D · 全真实，无 mock）：provider 计划/执行 + 配置错误暴露 + 后台化。

真实 provider（docker/remote）用注入式 fake runner 验证，不真跑 docker/ssh。
"""

from __future__ import annotations

import pytest

from app.db.engine import dispose_engine, get_session_factory, init_database
from app.services import deploy as deploy_service

_CID = "conv-deploy"


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


class _FakeRunner:
    def __init__(self, exit_codes: list[int] | None = None) -> None:
        self.calls: list[str] = []
        self._codes = list(exit_codes or [])

    async def __call__(self, command: str, cwd: str | None = None) -> tuple[int, str]:
        self.calls.append(command)
        code = self._codes.pop(0) if self._codes else 0
        return code, f"out:{command[:20]}"


async def _create(provider: str = "docker", config: dict | None = None) -> str:
    factory = get_session_factory()
    async with factory() as session, session.begin():
        rec = await deploy_service.create_deployment(session, _CID, "MyApp", provider, config or {})
        return rec.id


async def _get(did: str) -> tuple[str, str, str | None, str] | None:
    factory = get_session_factory()
    async with factory() as session:
        rec = await deploy_service.get_deployment(session, did)
        if rec is None:
            return None
        return rec.status, rec.provider, rec.result_url, rec.logs


async def _execute(did: str, runner=None) -> None:
    factory = get_session_factory()
    async with factory() as session, session.begin():
        await deploy_service.execute_deploy(session, did, runner=runner)


async def test_create_docker_default(db) -> None:
    status, provider, _url, _logs = await _get(await _create("docker"))  # type: ignore[misc]
    assert status == "planned"
    assert provider == "docker"


async def test_execute_docker_success(db) -> None:
    did = await _create("docker", {"result_url": "http://x"})
    runner = _FakeRunner()
    await _execute(did, runner)
    status, _provider, url, _logs = await _get(did)  # type: ignore[misc]
    assert status == "success"
    assert url == "http://x"
    assert runner.calls  # 真实命令经 runner 执行


async def test_execute_docker_failure_triggers_rollback(db) -> None:
    did = await _create("docker", {})
    runner = _FakeRunner(exit_codes=[1])  # 构建失败
    await _execute(did, runner)
    status, _provider, _url, logs = await _get(did)  # type: ignore[misc]
    assert status == "failed"
    assert "[rollback" in logs  # 失败触发回滚命令
    assert any("docker rm -f" in c for c in runner.calls)


async def test_remote_with_config_executes(db) -> None:
    did = await _create("remote", {"host": "h", "command": "deploy", "result_url": "http://r"})
    runner = _FakeRunner()
    await _execute(did, runner)
    status, provider, url, _logs = await _get(did)  # type: ignore[misc]
    assert status == "success"
    assert provider == "remote"
    assert url == "http://r"


async def test_create_remote_missing_config_raises(db) -> None:
    # 配置不足 → 抛 ValueError（暴露真实错误，不回退 mock 假成功）
    with pytest.raises(ValueError):
        await _create("remote", {})


async def test_reject_deployment(db) -> None:
    did = await _create("docker")
    factory = get_session_factory()
    async with factory() as session, session.begin():
        await deploy_service.reject_deployment(session, did)
    status, _provider, _url, _logs = await _get(did)  # type: ignore[misc]
    assert status == "rejected"


async def test_launch_deploy_runs_in_background(db) -> None:
    # 后台化：launch_deploy 自建 session 执行（注入 fake runner，不真跑 docker）
    did = await _create("docker", {"result_url": "http://bg"})
    await deploy_service.launch_deploy(did, _FakeRunner())  # 等待后台任务完成
    status, _provider, url, _logs = await _get(did)  # type: ignore[misc]
    assert status == "success"
    assert url == "http://bg"


async def test_execute_idempotent_guard(db) -> None:
    did = await _create("docker", {"result_url": "http://x"})
    await _execute(did, _FakeRunner())  # 第一次 → success
    await _execute(did, _FakeRunner())  # 第二次：非 planned → 守卫提前返回，不重复执行
    status, _provider, _url, _logs = await _get(did)  # type: ignore[misc]
    assert status == "success"
