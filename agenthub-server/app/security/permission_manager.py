"""操作权限判定（PRD §10.3）。

按动作类型给出处置策略：允许 / 允许并记录 / 需审批 / 禁止。
路径访问限制在 workspace 内。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from app.security.command_whitelist import CommandVerdict, check_command


class ActionType(str, Enum):
    READ_FILE = "read_file"
    WRITE_FILE = "write_file"
    DELETE_FILE = "delete_file"
    RUN_COMMAND = "run_command"
    INSTALL_DEPENDENCY = "install_dependency"
    APPLY_DIFF = "apply_diff"
    DEPLOY = "deploy"
    ACCESS_SECRET = "access_secret"


class PermissionDecision(str, Enum):
    ALLOW = "allow"
    ALLOW_WITH_LOG = "allow_with_log"
    REQUIRE_APPROVAL = "require_approval"
    DENY = "deny"


@dataclass
class PermissionResult:
    decision: PermissionDecision
    reason: str
    risk_level: str  # low | medium | high


# 静态策略表（PRD §10.3）
_STATIC_POLICY: dict[ActionType, PermissionResult] = {
    ActionType.READ_FILE: PermissionResult(PermissionDecision.ALLOW, "workspace 内读取默认允许", "low"),
    ActionType.WRITE_FILE: PermissionResult(
        PermissionDecision.ALLOW_WITH_LOG, "生成变更允许，应用 Diff 需确认", "low"
    ),
    ActionType.DELETE_FILE: PermissionResult(PermissionDecision.REQUIRE_APPROVAL, "删除文件必须审批", "high"),
    ActionType.INSTALL_DEPENDENCY: PermissionResult(
        PermissionDecision.REQUIRE_APPROVAL, "安装依赖建议审批", "medium"
    ),
    ActionType.APPLY_DIFF: PermissionResult(
        PermissionDecision.REQUIRE_APPROVAL, "应用代码变更需用户确认", "medium"
    ),
    ActionType.DEPLOY: PermissionResult(PermissionDecision.REQUIRE_APPROVAL, "部署必须审批", "high"),
    ActionType.ACCESS_SECRET: PermissionResult(PermissionDecision.DENY, "敏感配置默认禁止访问", "high"),
}


def is_path_inside_workspace(path: str | Path, workspace_root: str | Path) -> bool:
    try:
        resolved = Path(path).resolve()
        root = Path(workspace_root).resolve()
        return resolved == root or root in resolved.parents
    except (OSError, ValueError):
        return False


def check_permission(
    action: ActionType,
    *,
    command: str | None = None,
    path: str | None = None,
    workspace_root: str | None = None,
) -> PermissionResult:
    """组合判定：路径越界 -> DENY；命令走白名单三级判定；其余按静态策略表。"""
    if path is not None and workspace_root is not None:
        if not is_path_inside_workspace(path, workspace_root):
            return PermissionResult(
                PermissionDecision.DENY, f"路径越界（workspace 外）：{path}", "high"
            )

    if action == ActionType.RUN_COMMAND:
        if not command:
            return PermissionResult(PermissionDecision.DENY, "缺少命令内容", "high")
        result = check_command(command)
        if result.verdict == CommandVerdict.ALLOWED:
            return PermissionResult(PermissionDecision.ALLOW_WITH_LOG, result.reason, "low")
        if result.verdict == CommandVerdict.NEEDS_APPROVAL:
            return PermissionResult(PermissionDecision.REQUIRE_APPROVAL, result.reason, "medium")
        return PermissionResult(PermissionDecision.DENY, result.reason, "high")

    return _STATIC_POLICY[action]
