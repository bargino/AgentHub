"""codex 命令审批白名单前置判定单测（_whitelist_precheck 纯函数）。

被测核心 = 命令审批三级前置（ALLOWED 自动放行 / BLOCKED 自动拦截 / 其余交人工）。
不依赖 openai-codex SDK（adapter.py 模块级不导入 SDK），与 test_command_whitelist 互补。
"""

from __future__ import annotations

from app.adapters.codex.adapter import _APPROVAL_METHOD_COMMAND, _whitelist_precheck

_FILE_CHANGE = "item/fileChange/requestApproval"


def test_allowed_command_auto_accept() -> None:
    out = _whitelist_precheck(_APPROVAL_METHOD_COMMAND, "npm install", enabled=True)
    assert out is not None
    assert out[0] == "accept"


def test_blocked_command_auto_decline() -> None:
    out = _whitelist_precheck(_APPROVAL_METHOD_COMMAND, "rm -rf /", enabled=True)
    assert out is not None
    assert out[0] == "decline"
    assert out[1]  # 附拦截原因


def test_needs_approval_command_returns_none() -> None:
    assert _whitelist_precheck(_APPROVAL_METHOD_COMMAND, "python run.py", enabled=True) is None


def test_non_command_method_returns_none() -> None:
    assert _whitelist_precheck(_FILE_CHANGE, "rm -rf /", enabled=True) is None


def test_disabled_precheck_returns_none() -> None:
    # 关闭白名单前置 → 本函数不决策（交审批模式/人工），契约层面返回 None
    assert _whitelist_precheck(_APPROVAL_METHOD_COMMAND, "rm -rf /", enabled=False) is None


def test_empty_command_returns_none() -> None:
    assert _whitelist_precheck(_APPROVAL_METHOD_COMMAND, "", enabled=True) is None
    assert _whitelist_precheck(_APPROVAL_METHOD_COMMAND, None, enabled=True) is None
