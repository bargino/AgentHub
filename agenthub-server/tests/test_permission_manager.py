"""permission_manager 单测：组合权限判定 + 路径围栏（executor 风险升级的策略源）。

纯函数，无 DB/SDK。与 test_command_whitelist（命令三级）/ test_approval_policy（审批模式）
互补：本文件锁定 ActionType 静态策略、RUN_COMMAND 三级→决策/风险映射、路径越界覆盖优先级。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.security.permission_manager import (
    ActionType,
    PermissionDecision,
    check_permission,
    is_path_inside_workspace,
)


def test_run_command_allowed() -> None:
    r = check_permission(ActionType.RUN_COMMAND, command="npm install")
    assert r.decision == PermissionDecision.ALLOW_WITH_LOG
    assert r.risk_level == "low"


def test_run_command_needs_approval() -> None:
    r = check_permission(ActionType.RUN_COMMAND, command="python run.py")
    assert r.decision == PermissionDecision.REQUIRE_APPROVAL
    assert r.risk_level == "medium"


def test_run_command_blocked() -> None:
    r = check_permission(ActionType.RUN_COMMAND, command="rm -rf /")
    assert r.decision == PermissionDecision.DENY
    assert r.risk_level == "high"


def test_run_command_missing_command_denied() -> None:
    r = check_permission(ActionType.RUN_COMMAND, command=None)
    assert r.decision == PermissionDecision.DENY
    assert r.risk_level == "high"


@pytest.mark.parametrize(
    "action,decision,risk",
    [
        (ActionType.READ_FILE, PermissionDecision.ALLOW, "low"),
        (ActionType.WRITE_FILE, PermissionDecision.ALLOW_WITH_LOG, "low"),
        (ActionType.DELETE_FILE, PermissionDecision.REQUIRE_APPROVAL, "high"),
        (ActionType.INSTALL_DEPENDENCY, PermissionDecision.REQUIRE_APPROVAL, "medium"),
        (ActionType.APPLY_DIFF, PermissionDecision.REQUIRE_APPROVAL, "medium"),
        (ActionType.DEPLOY, PermissionDecision.REQUIRE_APPROVAL, "high"),
        (ActionType.ACCESS_SECRET, PermissionDecision.DENY, "high"),
    ],
)
def test_static_policy(action: ActionType, decision: PermissionDecision, risk: str) -> None:
    r = check_permission(action)
    assert r.decision == decision
    assert r.risk_level == risk


def test_path_outside_workspace_denies_even_read(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    outside = str(tmp_path / "evil.txt")  # 在 ws 之外
    r = check_permission(ActionType.READ_FILE, path=outside, workspace_root=str(ws))
    assert r.decision == PermissionDecision.DENY
    assert r.risk_level == "high"  # 越界覆盖动作本身的 allow


def test_path_inside_workspace_uses_static_policy(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    inside = str(ws / "a.py")
    r = check_permission(ActionType.READ_FILE, path=inside, workspace_root=str(ws))
    assert r.decision == PermissionDecision.ALLOW


def test_is_path_inside_true(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    assert is_path_inside_workspace(str(ws / "sub" / "f.py"), str(ws)) is True


def test_is_path_inside_root_itself(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    assert is_path_inside_workspace(str(ws), str(ws)) is True


def test_is_path_outside_sibling(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    assert is_path_inside_workspace(str(tmp_path / "other" / "f.py"), str(ws)) is False
