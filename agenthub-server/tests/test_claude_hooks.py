"""Claude guard_hook 安全单测：路径围栏 / BLOCKED 硬拦截 / 模式分级 / 审批超时默认拒。

guard_hook 是 Claude 适配器的 PreToolUse 安全闸门（被测核心，不 mock）；真实复用
command_whitelist 与 is_path_inside_workspace。依赖 claude_agent_sdk（仅本地 agent 环境装，
CI base 不装）→ 用 importorskip 优雅跳过，避免 CI collection 报错。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("claude_agent_sdk")

from app.adapters.base import UnifiedApprovalMode, UnifiedEvent  # noqa: E402
from app.adapters.claude_code import hooks as cc_hooks  # noqa: E402
from app.adapters.claude_code.hooks import build_hooks  # noqa: E402


def _make_guard(
    mode: UnifiedApprovalMode,
    on_event,
    pending: dict[str, asyncio.Event],
    decisions: dict[str, bool],
    ws: str,
):
    """从 build_hooks 返回结构中取出 PreToolUse 的 guard_hook 闭包。"""
    hooks_map = build_hooks(mode, on_event, pending, decisions, workspace_path=ws)
    return hooks_map["PreToolUse"][0].hooks[0]


def _is_deny(result: dict[str, Any]) -> bool:
    spec = result.get("hookSpecificOutput") if isinstance(result, dict) else None
    return bool(spec) and spec.get("permissionDecision") == "deny"


def _bash(cmd: str) -> dict[str, Any]:
    return {"tool_name": "Bash", "tool_input": {"command": cmd}}


# ---- BLOCKED 硬拦截：所有模式（含 AUTO）都不放行 ----


async def test_blocked_command_denied_even_in_auto(tmp_path: Path) -> None:
    events: list[UnifiedEvent] = []
    guard = _make_guard(UnifiedApprovalMode.AUTO, events.append, {}, {}, str(tmp_path))

    res = await guard(_bash("rm -rf /"), "u1", None)

    assert _is_deny(res)  # AUTO 不能绕过 BLOCKED
    assert any(e.type == "tool_call" and e.data.get("status") == "blocked" for e in events)


async def test_allowed_command_passes_in_auto(tmp_path: Path) -> None:
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert await guard(_bash("npm install"), "u1", None) == {}


async def test_deny_all_blocks_even_whitelisted(tmp_path: Path) -> None:
    guard = _make_guard(UnifiedApprovalMode.DENY_ALL, lambda e: None, {}, {}, str(tmp_path))
    assert _is_deny(await guard(_bash("npm install"), "u1", None))


# ---- 路径围栏：workspace 外的文件读写一律拒 ----


async def test_write_outside_workspace_denied(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    outside = str(tmp_path / "evil.py")  # 在 ws 之外
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(ws))

    res = await guard(
        {"tool_name": "Write", "tool_input": {"file_path": outside, "content": "x"}},
        "u1",
        None,
    )
    assert _is_deny(res)


async def test_read_outside_workspace_denied(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    outside = str(tmp_path / "secret.txt")
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(ws))

    res = await guard(
        {"tool_name": "Read", "tool_input": {"file_path": outside}}, "u1", None
    )
    assert _is_deny(res)


async def test_read_inside_workspace_allowed(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    inside = str(ws / "a.py")
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(ws))

    res = await guard({"tool_name": "Read", "tool_input": {"file_path": inside}}, "u1", None)
    assert res == {}


# ---- REVIEW_EDITS 分级 ----


async def test_review_edits_whitelisted_command_no_approval(tmp_path: Path) -> None:
    events: list[UnifiedEvent] = []
    guard = _make_guard(
        UnifiedApprovalMode.REVIEW_EDITS, events.append, {}, {}, str(tmp_path)
    )

    res = await guard(_bash("git status"), "u1", None)

    assert res == {}  # 白名单命令直接放行
    assert not any(e.type == "approval_request" for e in events)


async def test_review_edits_nonwhitelist_approval_granted(tmp_path: Path) -> None:
    events: list[UnifiedEvent] = []
    pending: dict[str, asyncio.Event] = {}
    decisions: dict[str, bool] = {}
    guard = _make_guard(
        UnifiedApprovalMode.REVIEW_EDITS, events.append, pending, decisions, str(tmp_path)
    )

    task = asyncio.create_task(guard(_bash("python run.py"), "u8", None))

    async def _await_request() -> UnifiedEvent:
        while True:
            req = next((e for e in events if e.type == "approval_request"), None)
            if req is not None:
                return req
            await asyncio.sleep(0.01)

    req = await asyncio.wait_for(_await_request(), timeout=2)
    rid = str(req.data["request_id"])
    decisions[rid] = True
    pending[rid].set()  # 模拟用户批准

    assert await asyncio.wait_for(task, timeout=2) == {}


async def test_review_edits_approval_timeout_denies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 关键安全属性：审批超时必须默认拒绝（不静默放行）
    monkeypatch.setattr(cc_hooks, "APPROVAL_TIMEOUT_SECONDS", 0.05)
    guard = _make_guard(
        UnifiedApprovalMode.REVIEW_EDITS, lambda e: None, {}, {}, str(tmp_path)
    )

    res = await guard(_bash("python run.py"), "u9", None)

    assert _is_deny(res)


# ---- Epic C：AUTO 严格模式 + MCP 工具围栏 ----


def _mcp(tool: str) -> dict[str, Any]:
    return {"tool_name": tool, "tool_input": {}}


def test_hook_matcher_includes_mcp() -> None:
    assert "mcp" in cc_hooks.HOOK_MATCHER  # MCP 工具纳入 PreToolUse 围栏


async def test_auto_strict_nonwhitelist_command_requires_approval(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 默认 AUTO_STRICT 开：非白名单命令在 AUTO 下也走审批（超时→拒，证非静默放行）
    monkeypatch.setattr(cc_hooks, "APPROVAL_TIMEOUT_SECONDS", 0.05)
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert _is_deny(await guard(_bash("python run.py"), "u1", None))


async def test_auto_strict_allowed_command_still_passes(tmp_path: Path) -> None:
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert await guard(_bash("git status"), "u1", None) == {}  # 白名单仍自动放行


async def test_auto_nonstrict_nonwhitelist_command_allowed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGENTHUB_AUTO_STRICT", "0")  # 关闭严格 → 恢复原全自动
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert await guard(_bash("python run.py"), "u1", None) == {}


async def test_mcp_readonly_allowed_in_auto(tmp_path: Path) -> None:
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert await guard(_mcp("mcp__db__list_tables"), "u1", None) == {}  # 只读 MCP 放行


async def test_mcp_write_requires_approval_in_auto_strict(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cc_hooks, "APPROVAL_TIMEOUT_SECONDS", 0.05)
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert _is_deny(await guard(_mcp("mcp__db__delete_rows"), "u1", None))  # 写类 MCP 走审批


async def test_mcp_write_denied_in_deny_all(tmp_path: Path) -> None:
    guard = _make_guard(UnifiedApprovalMode.DENY_ALL, lambda e: None, {}, {}, str(tmp_path))
    assert _is_deny(await guard(_mcp("mcp__db__delete_rows"), "u1", None))


async def test_mcp_write_approval_granted_in_review(tmp_path: Path) -> None:
    events: list[UnifiedEvent] = []
    pending: dict[str, asyncio.Event] = {}
    decisions: dict[str, bool] = {}
    guard = _make_guard(
        UnifiedApprovalMode.REVIEW_EDITS, events.append, pending, decisions, str(tmp_path)
    )
    task = asyncio.create_task(guard(_mcp("mcp__fs__write_file"), "um", None))

    async def _await_request() -> UnifiedEvent:
        while True:
            req = next((e for e in events if e.type == "approval_request"), None)
            if req is not None:
                return req
            await asyncio.sleep(0.01)

    req = await asyncio.wait_for(_await_request(), timeout=2)
    rid = str(req.data["request_id"])
    decisions[rid] = True
    pending[rid].set()
    assert await asyncio.wait_for(task, timeout=2) == {}


# ---- MCP 能力清单化：显式写/只读清单优先于启发式 ----


async def test_mcp_explicit_readonly_list_allows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 名无只读动词（启发式判为写），但显式只读清单放行
    monkeypatch.setenv("AGENTHUB_MCP_READONLY_TOOLS", "mcp__custom__sync_state")
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert await guard(_mcp("mcp__custom__sync_state"), "u1", None) == {}


async def test_mcp_explicit_write_list_overrides_readonly_verb(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 名含 get（启发式只读），但显式写清单强制审批（保守优先，超时→拒）
    monkeypatch.setenv("AGENTHUB_MCP_WRITE_TOOLS", "mcp__db__get_secret")
    monkeypatch.setattr(cc_hooks, "APPROVAL_TIMEOUT_SECONDS", 0.05)
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert _is_deny(await guard(_mcp("mcp__db__get_secret"), "u1", None))


async def test_mcp_readonly_glob_pattern_allows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGENTHUB_MCP_READONLY_TOOLS", "mcp__report__*")
    guard = _make_guard(UnifiedApprovalMode.AUTO, lambda e: None, {}, {}, str(tmp_path))
    assert await guard(_mcp("mcp__report__generate"), "u1", None) == {}
