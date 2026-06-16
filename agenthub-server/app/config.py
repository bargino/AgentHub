from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class AppSettings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8642
    debug: bool = False
    # 写型任务成功后是否自动提交（推进基线）；默认仅 git add 暂存，避免意外推进基线
    auto_commit_on_task: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


_settings: AppSettings | None = None


def get_settings() -> AppSettings:
    global _settings
    if _settings is None:
        _settings = AppSettings()
    return _settings


def load_adapters_config() -> dict[str, Any]:
    config_path = Path(__file__).parent.parent / "config" / "adapters.yaml"
    if not config_path.exists():
        return {"adapters": {}}
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {"adapters": {}}


class LocalMCPConfig(BaseModel):
    """stdio 子进程型 MCP 服务器（字段对齐标准 mcp.json）。"""

    type: Literal["local"] = "local"
    command: str = Field(min_length=1)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    timeout: int = Field(default=5000, ge=1000, le=600_000)


class RemoteMCPConfig(BaseModel):
    """远程 HTTP（Streamable HTTP/SSE）型 MCP 服务器。"""

    type: Literal["remote"]
    url: str = Field(min_length=1)
    headers: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    timeout: int = Field(default=5000, ge=1000, le=600_000)


MCPServerConfig = LocalMCPConfig | RemoteMCPConfig


def parse_mcp_servers(data: dict[str, Any] | None) -> dict[str, MCPServerConfig]:
    """mcp.yaml 顶层 dict -> 校验后的 {name: MCPServerConfig}。

    缺 type 字段按 local 解析（兼容既有 command/args/env 简化格式）；
    单条校验失败仅告警跳过，不阻断其余服务器加载；enabled=false 的过滤。
    """
    servers = (data or {}).get("mcp_servers") or {}
    if not isinstance(servers, dict):
        logger.warning("mcp.yaml 的 mcp_servers 不是映射，已忽略全部 MCP 配置")
        return {}

    result: dict[str, MCPServerConfig] = {}
    for name, cfg in servers.items():
        if not isinstance(cfg, dict):
            logger.warning("MCP server %s 配置不是映射，已跳过", name)
            continue
        model: type[MCPServerConfig] = (
            RemoteMCPConfig if cfg.get("type") == "remote" else LocalMCPConfig
        )
        try:
            parsed = model(**cfg)
        except ValidationError as exc:
            logger.warning("MCP server %s 配置非法，已跳过：%s", name, exc)
            continue
        if not parsed.enabled:
            continue
        result[name] = parsed
    return result


def load_mcp_servers() -> dict[str, MCPServerConfig]:
    """统一 MCP 服务器配置（config/mcp.yaml）；文件缺失或为空返回 {}。"""
    config_path = Path(__file__).parent.parent / "config" / "mcp.yaml"
    if not config_path.exists():
        return {}
    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return parse_mcp_servers(data)


def resolve_mcp_servers(allow: list[str] | None) -> dict[str, MCPServerConfig] | None:
    """按 agent 允许清单过滤全局 MCP（per-agent MCP 下发）。

    - allow=None：返回 None —— 调用方（adapter）回退全局全集，向后兼容
    - allow=[...]：仅返回清单内且存在的 server（清单为空 = 该 agent 无 MCP）
    """
    if allow is None:
        return None
    allowed = set(allow)
    return {name: cfg for name, cfg in load_mcp_servers().items() if name in allowed}
