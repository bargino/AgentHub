"""可插拔部署 Provider 单测（mock/docker/remote）：计划构建 + 执行 + 选择/回退。

真实 provider 用注入式 fake runner 验证命令序列与成败语义，不真跑 docker/ssh。
"""

from __future__ import annotations

import pytest

from app.services.deploy_providers import (
    DockerDeployProvider,
    RemoteServerDeployProvider,
    get_provider,
)


class _FakeRunner:
    def __init__(self, exit_codes: list[int] | None = None) -> None:
        self.calls: list[str] = []
        self._codes = list(exit_codes or [])

    async def __call__(self, command: str, cwd: str | None = None) -> tuple[int, str]:
        self.calls.append(command)
        code = self._codes.pop(0) if self._codes else 0
        return code, f"out:{command[:20]}"


# ---- 选择 / 回退 ----


def test_get_provider_known() -> None:
    assert get_provider("docker").name == "docker"
    assert get_provider("remote").name == "remote"


def test_get_provider_unknown_defaults_to_docker() -> None:
    assert get_provider("nope").name == "docker"
    assert get_provider(None).name == "docker"
    assert get_provider("mock").name == "docker"  # mock 已移除 → 回真实默认 docker


# ---- docker ----


def test_docker_build_plan_commands() -> None:
    p = DockerDeployProvider()
    plan = p.build_plan("My App", {"port": "9000"})
    cmds = [s["command"] for s in plan["steps"]]
    assert any(c.startswith("docker build -t my-app:latest") for c in cmds)
    assert any("docker run -d" in c and "9000:9000" in c for c in cmds)


async def test_docker_execute_runs_steps_via_runner() -> None:
    p = DockerDeployProvider()
    plan = p.build_plan("app", {"result_url": "http://x"})
    runner = _FakeRunner()
    status, url, logs = await p.execute(plan, runner=runner)
    assert status == "success"
    assert url == "http://x"
    assert len(runner.calls) == len(plan["steps"])


async def test_docker_execute_stops_on_failure() -> None:
    p = DockerDeployProvider()
    plan = p.build_plan("app", {})
    runner = _FakeRunner(exit_codes=[1])  # 第一步失败
    status, url, logs = await p.execute(plan, runner=runner)
    assert status == "failed"
    assert url is None
    assert len(runner.calls) == 1  # 失败即停，不跑后续
    assert "[fail]" in logs


# ---- remote ----


def test_remote_build_plan_from_steps() -> None:
    p = RemoteServerDeployProvider()
    plan = p.build_plan("app", {"steps": [{"name": "推送", "command": "rsync a b"}]})
    assert plan["steps"][0]["command"] == "rsync a b"


def test_remote_build_plan_from_host_command() -> None:
    p = RemoteServerDeployProvider()
    plan = p.build_plan("app", {"host": "1.2.3.4", "user": "ops", "command": "bash deploy.sh"})
    assert "ssh ops@1.2.3.4 bash deploy.sh" in plan["steps"][0]["command"]


def test_remote_build_plan_missing_config_raises() -> None:
    p = RemoteServerDeployProvider()
    with pytest.raises(ValueError):
        p.build_plan("app", {})


async def test_remote_execute_via_runner() -> None:
    p = RemoteServerDeployProvider()
    plan = p.build_plan("app", {"command": "deploy", "host": "h", "result_url": "http://r"})
    runner = _FakeRunner()
    status, url, logs = await p.execute(plan, runner=runner)
    assert status == "success"
    assert url == "http://r"
    assert runner.calls == ["ssh deploy@h deploy"]
