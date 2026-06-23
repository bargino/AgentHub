"""Agent 供应商配置（按适配器分组）的归一化、解析与本地配置扫描。

provider_config 规范形状（按适配器分组）：
    {"claude-code": {"mode": "default|custom", "base_url": "", "auth_token": ""},
     "codex":       {"mode": "default|custom", "base_url": "", "auth_token": ""}}

- mode=default：不注入凭据，走本地 CLI 登录态；base_url/auth_token 仅用于回显扫描结果。
- mode=custom：注入用户填写的 base_url/auth_token。

向后兼容旧的扁平结构 {base_url, auth_token}：归到该 agent 的 adapter_type 槽，
无 mode 时按「有任一凭据=custom，否则 default」推断，老数据行为不变。
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

ADAPTER_KEYS: tuple[str, ...] = ("claude-code", "codex")


def _empty_entry() -> dict[str, str]:
    return {"mode": "default", "base_url": "", "auth_token": "", "model": ""}


def _coerce_entry(raw: Any) -> dict[str, str]:
    """单个适配器条目归一化为 {mode, base_url, auth_token, model}（mode 缺省按凭据推断）。

    model 与该适配器的供应商绑定保存，避免切换适配器后模型名混乱、访问到供应商不存在的模型。
    """
    if not isinstance(raw, dict):
        return _empty_entry()
    base_url = str(raw.get("base_url") or "").strip()
    auth_token = str(raw.get("auth_token") or "").strip()
    model = str(raw.get("model") or "").strip()
    mode = str(raw.get("mode") or "").strip().lower()
    if mode not in ("default", "custom"):
        mode = "custom" if (base_url or auth_token) else "default"
    return {"mode": mode, "base_url": base_url, "auth_token": auth_token, "model": model}


def normalize_provider_config(
    raw: Any, *, legacy_adapter: str = "", legacy_model: str = ""
) -> dict[str, dict[str, str]]:
    """把任意历史形状归一化为「按适配器分组」的完整 map（两个适配器键都在）。

    legacy_model：旧的顶层 AgentRecord.model（与供应商分离的单一模型名），归并到
    legacy_adapter 槽（仅当该槽无 model 时），保证老数据模型名不丢、行为不变。
    """
    out: dict[str, dict[str, str]] = {k: _empty_entry() for k in ADAPTER_KEYS}
    legacy_model = str(legacy_model or "").strip()

    def _seed_legacy_model(slot: str) -> None:
        if legacy_model and slot in ADAPTER_KEYS and not out[slot]["model"]:
            out[slot]["model"] = legacy_model

    if not isinstance(raw, dict) or not raw:
        _seed_legacy_model(legacy_adapter)
        return out
    # 已是按适配器分组
    if any(k in raw for k in ADAPTER_KEYS):
        for k in ADAPTER_KEYS:
            out[k] = _coerce_entry(raw.get(k))
        _seed_legacy_model(legacy_adapter)
        return out
    # 旧扁平结构：归到 legacy_adapter 槽（缺省给首个适配器）
    if "base_url" in raw or "auth_token" in raw or "mode" in raw or "model" in raw:
        target = legacy_adapter if legacy_adapter in ADAPTER_KEYS else ADAPTER_KEYS[0]
        out[target] = _coerce_entry(raw)
        _seed_legacy_model(target)
    else:
        _seed_legacy_model(legacy_adapter)
    return out


def resolve_provider(
    raw: Any, adapter: str, *, legacy_adapter: str = ""
) -> dict[str, str] | None:
    """解析某适配器实际生效的注入 provider。

    default 模式返回 None（不注入，走本地登录态）；custom 模式返回非空的
    {base_url?, auth_token?}（均空时也返回 None）。
    """
    cfg = normalize_provider_config(raw, legacy_adapter=legacy_adapter or adapter)
    entry = cfg.get(adapter) or _empty_entry()
    if entry.get("mode") != "custom":
        return None
    cleaned = {
        key: val
        for key, val in (
            ("base_url", entry.get("base_url", "")),
            ("auth_token", entry.get("auth_token", "")),
        )
        if isinstance(val, str) and val.strip()
    }
    return cleaned or None


def resolve_model(
    raw: Any, adapter: str, *, legacy_adapter: str = "", legacy_model: str = ""
) -> str | None:
    """解析某适配器实际生效的模型名（与该适配器供应商绑定）。空 = 走 SDK 默认模型。"""
    cfg = normalize_provider_config(
        raw, legacy_adapter=legacy_adapter or adapter, legacy_model=legacy_model
    )
    entry = cfg.get(adapter) or _empty_entry()
    model = str(entry.get("model") or "").strip()
    return model or None


# ---------------- 本地配置扫描（供「默认」模式回显检测结果） ----------------


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or (Path.home() / ".codex"))


def scan_codex() -> dict[str, Any]:
    """扫描本地 codex 配置：~/.codex/config.toml（provider/base_url/model）+ auth.json。"""
    home = _codex_home()
    cfg_path = home / "config.toml"
    auth_path = home / "auth.json"
    result: dict[str, Any] = {
        "adapter": "codex",
        "detected": False,
        "base_url": "",
        "model": "",
        "auth_source": "",
        "config_path": str(cfg_path),
    }
    if cfg_path.is_file():
        try:
            import tomllib  # Python 3.11+ 标准库

            data = tomllib.loads(cfg_path.read_text(encoding="utf-8"))
            result["detected"] = True
            result["model"] = str(data.get("model") or "")
            prov_name = str(data.get("model_provider") or "")
            providers = data.get("model_providers") or {}
            if prov_name and isinstance(providers, dict):
                entry = providers.get(prov_name) or {}
                if isinstance(entry, dict):
                    result["base_url"] = str(entry.get("base_url") or "")
        except Exception:
            logger.debug("scan codex config.toml failed", exc_info=True)
    if auth_path.is_file():
        try:
            adata = json.loads(auth_path.read_text(encoding="utf-8"))
            if isinstance(adata, dict):
                if adata.get("OPENAI_API_KEY"):
                    result["auth_source"] = "api_key"
                elif adata.get("tokens") or adata.get("id_token"):
                    result["auth_source"] = "chatgpt_login"
                result["detected"] = True
        except Exception:
            logger.debug("scan codex auth.json failed", exc_info=True)
    if not result["auth_source"] and os.environ.get("OPENAI_API_KEY"):
        result["auth_source"] = "env"
        result["detected"] = True
    return result


def scan_claude() -> dict[str, Any]:
    """扫描本地 claude-code 配置：ANTHROPIC_* env + ~/.claude/settings.json + 登录凭据。"""
    home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or (Path.home() / ".claude"))
    settings_path = home / "settings.json"
    creds_path = home / ".credentials.json"
    result: dict[str, Any] = {
        "adapter": "claude-code",
        "detected": False,
        "base_url": "",
        "model": "",
        "auth_source": "",
        "config_path": str(settings_path),
    }
    env_base = os.environ.get("ANTHROPIC_BASE_URL") or ""
    env_token = os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_API_KEY") or ""
    if env_base:
        result["base_url"] = env_base
        result["detected"] = True
    if env_token:
        result["auth_source"] = "env"
        result["detected"] = True
    if settings_path.is_file():
        try:
            data = json.loads(settings_path.read_text(encoding="utf-8"))
            env = (data.get("env") if isinstance(data, dict) else None) or {}
            if isinstance(env, dict):
                if not result["base_url"] and env.get("ANTHROPIC_BASE_URL"):
                    result["base_url"] = str(env["ANTHROPIC_BASE_URL"])
                if not result["auth_source"] and (
                    env.get("ANTHROPIC_AUTH_TOKEN") or env.get("ANTHROPIC_API_KEY")
                ):
                    result["auth_source"] = "settings"
            result["detected"] = True
        except Exception:
            logger.debug("scan claude settings.json failed", exc_info=True)
    if not result["auth_source"] and creds_path.is_file():
        result["auth_source"] = "cli_login"
        result["detected"] = True
    return result


def scan_provider(adapter: str) -> dict[str, Any]:
    """按适配器名扫描本地配置（codex / claude-code，其余回退 claude）。"""
    if adapter == "codex":
        return scan_codex()
    return scan_claude()
