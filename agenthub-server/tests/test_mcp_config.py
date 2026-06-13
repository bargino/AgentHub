"""MCP 统一抽象层（方案二）：Schema 校验、类型分派、消费方映射、per-agent 下发。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import LocalMCPConfig, RemoteMCPConfig, parse_mcp_servers


def test_parse_local_without_type_defaults_to_local():
    """缺 type 字段按 local 解析，兼容既有 command/args/env 简化格式。"""
    parsed = parse_mcp_servers(
        {
            "mcp_servers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
                    "env": {"HTTP_PROXY": "http://127.0.0.1:7890"},
                }
            }
        }
    )
    assert set(parsed) == {"filesystem"}
    cfg = parsed["filesystem"]
    assert isinstance(cfg, LocalMCPConfig)
    assert cfg.command == "npx"
    assert cfg.args[0] == "-y"
    assert cfg.env["HTTP_PROXY"] == "http://127.0.0.1:7890"
    assert cfg.enabled is True
    assert cfg.timeout == 5000


def test_parse_remote():
    parsed = parse_mcp_servers(
        {
            "mcp_servers": {
                "github": {
                    "type": "remote",
                    "url": "https://api.githubcopilot.com/mcp/",
                    "headers": {"Authorization": "Bearer x"},
                    "timeout": 10000,
                }
            }
        }
    )
    cfg = parsed["github"]
    assert isinstance(cfg, RemoteMCPConfig)
    assert cfg.url.startswith("https://")
    assert cfg.headers["Authorization"] == "Bearer x"
    assert cfg.timeout == 10000


def test_invalid_entries_skipped_without_raising():
    """单条非法（缺 command / 缺 url / timeout 越界 / 非映射）跳过，不阻断其余条目。"""
    parsed = parse_mcp_servers(
        {
            "mcp_servers": {
                "no-command": {"args": ["x"]},
                "no-url": {"type": "remote"},
                "bad-timeout": {"command": "npx", "timeout": 10},
                "not-a-map": "npx",
                "good": {"command": "uvx", "args": ["mcp-server-fetch"]},
            }
        }
    )
    assert set(parsed) == {"good"}


def test_disabled_filtered_out():
    parsed = parse_mcp_servers(
        {
            "mcp_servers": {
                "off": {"command": "npx", "enabled": False},
                "on": {"command": "npx"},
            }
        }
    )
    assert set(parsed) == {"on"}


def test_empty_and_malformed_top_level():
    assert parse_mcp_servers(None) == {}
    assert parse_mcp_servers({}) == {}
    assert parse_mcp_servers({"mcp_servers": None}) == {}
    assert parse_mcp_servers({"mcp_servers": ["not", "a", "map"]}) == {}


def test_codex_overrides_local_only(monkeypatch):
    """codex 侧：local 生成 TOML 覆盖，remote 跳过。"""
    from app.adapters.codex import adapter as codex_adapter

    servers = {
        "fs": LocalMCPConfig(command="npx", args=["-y", "server-fs"], env={"K": "v"}),
        "gh": RemoteMCPConfig(type="remote", url="https://example.com/mcp"),
    }
    monkeypatch.setattr(codex_adapter, "load_mcp_servers", lambda: servers)
    overrides = codex_adapter._mcp_config_overrides()
    joined = "\n".join(overrides)
    assert 'mcp_servers.fs.command="npx"' in joined
    assert 'mcp_servers.fs.args=["-y", "server-fs"]' in joined
    assert 'mcp_servers.fs.env={K = "v"}' in joined
    assert "gh" not in joined


# ---------------------------------------------------------------------------
# per-agent MCP 下发（批7）：resolve_mcp_servers 过滤 + context_builder 端到端
# ---------------------------------------------------------------------------


def test_resolve_mcp_servers_none_falls_back() -> None:
    """allow=None → None：调用方回退全局全集（向后兼容）。"""
    from app import config as cfg

    assert cfg.resolve_mcp_servers(None) is None


def test_resolve_mcp_servers_filters_by_allowlist(monkeypatch) -> None:
    from app import config as cfg

    servers = {
        "fs": LocalMCPConfig(command="npx"),
        "gh": RemoteMCPConfig(type="remote", url="https://x/mcp"),
    }
    monkeypatch.setattr(cfg, "load_mcp_servers", lambda: servers)
    assert set(cfg.resolve_mcp_servers(["fs"])) == {"fs"}
    assert cfg.resolve_mcp_servers([]) == {}  # 空清单 = 该 agent 无 MCP
    assert cfg.resolve_mcp_servers(["ghost"]) == {}  # 不存在的名字忽略


def test_codex_overrides_uses_per_agent_servers() -> None:
    """传入 per-agent servers 时只覆盖这些，不读全局。"""
    from app.adapters.codex import adapter as codex_adapter

    servers = {"fs": LocalMCPConfig(command="uvx", args=["server-fs"])}
    joined = "\n".join(codex_adapter._mcp_config_overrides(servers))
    assert 'mcp_servers.fs.command="uvx"' in joined


@pytest.mark.asyncio
async def test_build_context_resolves_per_agent_mcp(monkeypatch, tmp_path) -> None:
    """capabilities.mcp_servers=["fs"] → ctx.mcp_servers 只含 fs（端到端）。"""
    from app import config as cfg
    from app.db.models import AgentRecord, Base
    from app.orchestrator import context_builder as cb
    from app.orchestrator.task_planner import PlannedTask

    servers = {
        "fs": LocalMCPConfig(command="npx"),
        "gh": RemoteMCPConfig(type="remote", url="https://x/mcp"),
    }
    monkeypatch.setattr(cfg, "load_mcp_servers", lambda: servers)

    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        async with session.begin():
            session.add(
                AgentRecord(
                    id="a1", name="Coder", role="coder",
                    capabilities={"write": True, "mcp_servers": ["fs"]},
                )
            )
        ctx = await cb.build_context(
            session,
            conversation_id="c1",
            project_name="p",
            workspace_path=str(tmp_path),
            task=PlannedTask(id="t1", agent="coder", title="x"),
            user_instructions="hi",
            upstream_results={},
        )
    await engine.dispose()
    assert ctx.mcp_servers is not None
    assert set(ctx.mcp_servers) == {"fs"}


@pytest.mark.asyncio
async def test_build_context_no_allowlist_means_global(monkeypatch, tmp_path) -> None:
    """无 capabilities.mcp_servers → ctx.mcp_servers=None（adapter 回退全局）。"""
    from app.db.models import AgentRecord, Base
    from app.orchestrator import context_builder as cb
    from app.orchestrator.task_planner import PlannedTask

    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        async with session.begin():
            session.add(
                AgentRecord(id="a2", name="Coder", role="coder", capabilities={"write": True})
            )
        ctx = await cb.build_context(
            session,
            conversation_id="c1",
            project_name="p",
            workspace_path=str(tmp_path),
            task=PlannedTask(id="t1", agent="coder", title="x"),
            user_instructions="hi",
            upstream_results={},
        )
    await engine.dispose()
    assert ctx.mcp_servers is None
