"""app/services/provider.py 单测：按适配器分组归一化、provider 解析、本地配置扫描。"""

from __future__ import annotations

import json

from app.services.provider import (
    ADAPTER_KEYS,
    normalize_provider_config,
    resolve_model,
    resolve_provider,
    scan_claude,
    scan_codex,
    scan_provider,
)


# ---- normalize：旧扁平结构归到 legacy_adapter 槽，另一适配器为 default ----


def test_normalize_legacy_flat_custom_goes_to_legacy_adapter() -> None:
    n = normalize_provider_config(
        {"base_url": "https://x", "auth_token": "sk-1"}, legacy_adapter="codex"
    )
    assert set(n.keys()) == set(ADAPTER_KEYS)
    assert n["codex"] == {
        "mode": "custom",
        "base_url": "https://x",
        "auth_token": "sk-1",
        "model": "",
    }
    assert n["claude-code"] == {"mode": "default", "base_url": "", "auth_token": "", "model": ""}


def test_normalize_empty_gives_both_default() -> None:
    n = normalize_provider_config({}, legacy_adapter="claude-code")
    assert n["codex"]["mode"] == "default"
    assert n["claude-code"]["mode"] == "default"


def test_normalize_per_adapter_passthrough_and_mode_inference() -> None:
    raw = {
        "claude-code": {"base_url": "https://c", "auth_token": "t"},  # 无 mode -> custom
        "codex": {"mode": "default", "base_url": "ignored-display", "auth_token": ""},
    }
    n = normalize_provider_config(raw)
    assert n["claude-code"]["mode"] == "custom"
    assert n["codex"]["mode"] == "default"


# ---- resolve：default 不注入(None)，custom 注入清洗后的凭据 ----


def test_resolve_default_returns_none() -> None:
    raw = {"codex": {"mode": "default", "base_url": "https://x", "auth_token": "k"}}
    assert resolve_provider(raw, "codex") is None


def test_resolve_custom_returns_cleaned() -> None:
    raw = {"codex": {"mode": "custom", "base_url": "https://x ", "auth_token": " k"}}
    assert resolve_provider(raw, "codex") == {"base_url": "https://x", "auth_token": "k"}


def test_resolve_custom_all_empty_returns_none() -> None:
    raw = {"codex": {"mode": "custom", "base_url": "  ", "auth_token": ""}}
    assert resolve_provider(raw, "codex") is None


def test_resolve_legacy_flat_for_its_adapter_only() -> None:
    leg = {"base_url": "https://x", "auth_token": "sk-1"}
    assert resolve_provider(leg, "codex", legacy_adapter="codex") == {
        "base_url": "https://x",
        "auth_token": "sk-1",
    }
    # 另一个适配器槽为 default -> 不注入
    assert resolve_provider(leg, "claude-code", legacy_adapter="codex") is None


# ---- model：与供应商按适配器绑定 ----


def test_model_per_adapter_stored_and_resolved() -> None:
    raw = {
        "claude-code": {"mode": "custom", "base_url": "https://c", "model": "claude-x"},
        "codex": {"mode": "default", "model": "gpt-x"},
    }
    n = normalize_provider_config(raw)
    assert n["claude-code"]["model"] == "claude-x"
    assert n["codex"]["model"] == "gpt-x"
    assert resolve_model(raw, "claude-code") == "claude-x"
    assert resolve_model(raw, "codex") == "gpt-x"


def test_legacy_top_level_model_seeded_into_adapter_slot() -> None:
    # 旧数据：provider_config 为空 + 顶层 model -> 归到 legacy_adapter 槽
    n = normalize_provider_config({}, legacy_adapter="codex", legacy_model="gpt-5-codex")
    assert n["codex"]["model"] == "gpt-5-codex"
    assert n["claude-code"]["model"] == ""
    assert resolve_model({}, "codex", legacy_adapter="codex", legacy_model="gpt-5-codex") == "gpt-5-codex"
    # 另一适配器无模型 -> None（走 SDK 默认）
    assert resolve_model({}, "claude-code", legacy_adapter="codex", legacy_model="gpt-5-codex") is None


def test_per_adapter_model_not_overridden_by_legacy() -> None:
    raw = {"codex": {"mode": "default", "model": "gpt-keep"}}
    n = normalize_provider_config(raw, legacy_adapter="codex", legacy_model="gpt-legacy")
    assert n["codex"]["model"] == "gpt-keep"  # 槽内已有 model，不被 legacy 覆盖


# ---- scan：结构稳定 + 能读到临时配置 ----


def test_scan_provider_shape() -> None:
    for adapter in ("codex", "claude-code"):
        out = scan_provider(adapter)
        assert set(out.keys()) == {
            "adapter",
            "detected",
            "base_url",
            "model",
            "auth_source",
            "config_path",
        }
        assert out["adapter"] == adapter


def test_scan_codex_reads_local_config(tmp_path, monkeypatch) -> None:
    home = tmp_path / ".codex"
    home.mkdir()
    (home / "config.toml").write_text(
        'model = "gpt-5-codex"\n'
        'model_provider = "myprov"\n'
        "[model_providers.myprov]\n"
        'base_url = "https://api.example.com/v1"\n',
        encoding="utf-8",
    )
    (home / "auth.json").write_text(json.dumps({"OPENAI_API_KEY": "sk-xxx"}), encoding="utf-8")
    monkeypatch.setenv("CODEX_HOME", str(home))
    out = scan_codex()
    assert out["detected"] is True
    assert out["base_url"] == "https://api.example.com/v1"
    assert out["model"] == "gpt-5-codex"
    assert out["auth_source"] == "api_key"


def test_scan_claude_reads_env(monkeypatch) -> None:
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://anthropic.example.com")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok")
    out = scan_claude()
    assert out["detected"] is True
    assert out["base_url"] == "https://anthropic.example.com"
    assert out["auth_source"] == "env"
