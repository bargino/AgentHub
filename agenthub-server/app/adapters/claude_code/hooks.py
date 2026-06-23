"""Claude Code 安全 hook：白名单三级判定 + workspace 路径围栏 + 审批超时。

所有审批模式（含 AUTO）都装 hook：
- BLOCKED 命令 / workspace 外路径 -> 直接拒绝，不询问用户
- ALLOWED 命令 / AUTO 模式下的其余操作 -> 放行
- DENY_ALL -> 全部直接拒绝
- 其余（REVIEW_EDITS）-> 发审批请求，等待用户决定（带超时，超时默认拒绝）
"""

from __future__ import annotations

import asyncio
import fnmatch
import os
import re
from typing import Any, Callable

from claude_agent_sdk import HookMatcher

from app.adapters.base import UnifiedApprovalMode, UnifiedEvent
from app.security.command_whitelist import CommandVerdict, check_command
from app.security.permission_manager import is_path_inside_workspace

ADAPTER_NAME = "claude-code"

# 审批等待超时（秒），超时按拒绝处理，避免 event.wait() 永久阻塞
APPROVAL_TIMEOUT_SECONDS = 600

# 会修改文件的工具（需要路径围栏 + 审批）
FILE_WRITE_TOOLS = frozenset({"Edit", "MultiEdit", "Write", "NotebookEdit"})
# 只读文件工具（只做路径围栏，不审批）
FILE_READ_TOOLS = frozenset({"Read"})

# Epic C：把 mcp__* 工具纳入 PreToolUse 围栏（原 matcher 不含 → 写/执行类 MCP 绕过审批）
HOOK_MATCHER = "Read|Edit|MultiEdit|Write|NotebookEdit|Bash|mcp__.*"

# MCP 工具名启发式只读动词（保守：仅明确只读放行，其余视为写/执行需审批）
_MCP_READONLY_VERBS = (
    "read", "get", "list", "search", "fetch", "query", "describe", "view",
    "show", "find", "lookup", "info", "stat", "status", "count", "exists", "head",
)
_MCP_READONLY_RE = re.compile(
    r"(?:^|_)(" + "|".join(_MCP_READONLY_VERBS) + r")(?:_|$)", re.IGNORECASE
)


def _mcp_patterns(var: str) -> tuple[str, ...]:
    """读取逗号分隔的 MCP 工具能力清单（支持 fnmatch 通配，如 mcp__db__*）。"""
    return tuple(p.strip() for p in os.environ.get(var, "").split(",") if p.strip())


def _matches_any(tool_name: str, patterns: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatch(tool_name, p) for p in patterns)


def _is_readonly_mcp(tool_name: str) -> bool:
    """MCP 工具只读判定（能力清单优先，启发式兜底，默认保守视为写）。

    优先级（devsecops 显式 allowlist > 猜测）：
    1. 显式写清单 AGENTHUB_MCP_WRITE_TOOLS → 写（需审批，安全优先，覆盖一切）
    2. 显式只读清单 AGENTHUB_MCP_READONLY_TOOLS → 只读放行
    3. 工具名只读动词启发式（read/get/list/...）→ 只读
    4. 默认 → 写（需审批，最小权限保守默认）
    清单为逗号分隔、支持 fnmatch 通配（如 mcp__report__* / mcp__fs__read_*）。
    """
    if _matches_any(tool_name, _mcp_patterns("AGENTHUB_MCP_WRITE_TOOLS")):
        return False
    if _matches_any(tool_name, _mcp_patterns("AGENTHUB_MCP_READONLY_TOOLS")):
        return True
    leaf = tool_name.rsplit("__", 1)[-1]
    return bool(_MCP_READONLY_RE.search(leaf))


def _auto_strict_enabled() -> bool:
    """AUTO 严格模式开关（AGENTHUB_AUTO_STRICT，默认开）。

    开启时 AUTO 下非白名单写/命令降级为人工审批；设 0/false/off/no 恢复原全自动放行。
    """
    return os.environ.get("AGENTHUB_AUTO_STRICT", "1").strip().lower() not in (
        "0", "false", "off", "no",
    )


def _deny(input_data: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": input_data.get("hook_event_name", "PreToolUse"),
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def _diff_from_pairs(pairs: list[tuple[str, str]]) -> tuple[str, int, int]:
    """(old, new) 文本对 -> 极简 unified diff 体（-旧 / +新）+ (additions, deletions)。
    与 diff_service.build_files_from_changes 同口径：只需 +/- 行即可重建预览。"""
    body: list[str] = []
    additions = deletions = 0
    for old, new in pairs:
        old_lines = old.splitlines() if old else []
        new_lines = new.splitlines() if new else []
        body.extend(f"-{line}" for line in old_lines)
        body.extend(f"+{line}" for line in new_lines)
        additions += len(new_lines)
        deletions += len(old_lines)
    return "\n".join(body), additions, deletions


def _changes_from_tool_input(tool_name: str, tool_input: dict[str, Any]) -> list[dict[str, Any]]:
    """Claude 文件写工具 tool_input -> 审批可视 diff 的 changes 结构
    （[{path, diff, additions, deletions}]，对齐 codex fileChange 审批契约，
    使审查界面对 Claude 文件改动同样「审批即看 diff」）。"""
    path = str(tool_input.get("file_path") or tool_input.get("notebook_path") or "")
    if tool_name == "MultiEdit":
        pairs = [
            (str(e.get("old_string", "")), str(e.get("new_string", "")))
            for e in (tool_input.get("edits") or [])
            if isinstance(e, dict)
        ]
    elif tool_name == "Write":
        pairs = [("", str(tool_input.get("content", "")))]
    elif tool_name == "NotebookEdit":
        pairs = [("", str(tool_input.get("new_source", "")))]
    else:  # Edit
        pairs = [(str(tool_input.get("old_string", "")), str(tool_input.get("new_string", "")))]
    diff_text, additions, deletions = _diff_from_pairs(pairs)
    if not path and not diff_text:
        return []
    return [{"path": path, "diff": diff_text, "additions": additions, "deletions": deletions}]


def build_hooks(
    approval_mode: UnifiedApprovalMode,
    on_event: Callable[[UnifiedEvent], Any],
    pending_approvals: dict[str, asyncio.Event],
    approval_decisions: dict[str, bool],
    workspace_path: str | None = None,
    on_pending_register: Callable[[str], None] | None = None,
    on_pending_clear: Callable[[str], None] | None = None,
) -> dict[str, list[HookMatcher]]:
    def emit_blocked(tool_name: str, reason: str, detail: dict[str, Any]) -> None:
        on_event(
            UnifiedEvent(
                type="tool_call",
                data={"tool": tool_name, "status": "blocked", "reason": reason, **detail},
                adapter=ADAPTER_NAME,
                risk_level="high",
            )
        )

    async def request_user_approval(
        input_data: dict[str, Any],
        tool_use_id: str | None,
        tool_name: str,
        tool_input: dict[str, Any],
        reason: str,
    ) -> dict[str, Any]:
        request_id = f"cc_{tool_use_id}"
        event = asyncio.Event()
        pending_approvals[request_id] = event
        if on_pending_register is not None:
            on_pending_register(request_id)

        # 统一审批契约：文件写工具标 apply_diff 并附 changes（审查界面据此渲染内联
        # diff），命令标 run_command；不再让 executor 回退默认 run_command 而丢 diff。
        is_file_write = tool_name in FILE_WRITE_TOOLS
        if is_file_write:
            action_type = "apply_diff"
            changes = _changes_from_tool_input(tool_name, tool_input)
            file_path = str(tool_input.get("file_path") or tool_input.get("notebook_path") or "")
            summary = f"应用代码变更：{file_path}" if file_path else "应用代码变更"
        elif tool_name.startswith("mcp__"):
            # 写/执行类 MCP（Epic C）：复用命令审批通道，标注来源便于审查
            action_type = "run_command"
            changes = []
            file_path = ""
            summary = f"MCP 工具调用：{tool_name}"
        else:
            action_type = "run_command"
            changes = []
            file_path = ""
            command = str(tool_input.get("command", ""))
            summary = f"运行命令：{command}" if command else "运行命令"

        on_event(
            UnifiedEvent(
                type="approval_request",
                data={
                    "request_id": request_id,
                    "tool": tool_name,
                    "action_type": action_type,
                    "changes": changes,
                    "summary": summary,
                    "file_path": file_path,
                    "tool_input": tool_input,
                    "reason": reason,
                },
                adapter=ADAPTER_NAME,
                risk_level="medium",
            )
        )

        try:
            await asyncio.wait_for(event.wait(), timeout=APPROVAL_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            approval_decisions.setdefault(request_id, False)
        finally:
            pending_approvals.pop(request_id, None)
            if on_pending_clear is not None:
                on_pending_clear(request_id)

        if approval_decisions.get(request_id, False):
            return {}
        return _deny(input_data, "User rejected this operation (or approval timed out)")

    async def guard_hook(
        input_data: dict[str, Any],
        tool_use_id: str | None,
        context: Any,
    ) -> dict[str, Any]:
        tool_name = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input", {}) or {}

        # 1. 路径围栏：文件类工具只允许操作 workspace 内的路径
        if tool_name in FILE_WRITE_TOOLS or tool_name in FILE_READ_TOOLS:
            file_path = str(tool_input.get("file_path") or tool_input.get("notebook_path") or "")
            if workspace_path and file_path:
                if not is_path_inside_workspace(file_path, workspace_path):
                    reason = f"路径越界（workspace 外）：{file_path}"
                    emit_blocked(tool_name, reason, {"file_path": file_path})
                    return _deny(input_data, reason)

        # 只读工具过了围栏即放行
        if tool_name in FILE_READ_TOOLS:
            return {}

        # 1b. MCP 工具围栏（Epic C）：只读类放行；写/执行类继续走下方模式门控（审批/拒绝）
        if tool_name.startswith("mcp__") and _is_readonly_mcp(tool_name):
            return {}

        # 2. Bash 命令白名单三级判定（所有模式下 BLOCKED 都直接拒绝）
        command_verdict: CommandVerdict | None = None
        if tool_name == "Bash":
            command = str(tool_input.get("command", ""))
            result = check_command(command)
            command_verdict = result.verdict
            if result.verdict == CommandVerdict.BLOCKED:
                emit_blocked(tool_name, result.reason, {"command": command})
                return _deny(input_data, f"命令被安全策略拦截：{result.reason}")

        # 3. 按审批模式处置
        if approval_mode == UnifiedApprovalMode.DENY_ALL:
            reason = "DENY_ALL 模式：拒绝所有写操作与命令执行"
            emit_blocked(tool_name, reason, {})
            return _deny(input_data, reason)

        if approval_mode == UnifiedApprovalMode.AUTO:
            # AUTO 模式：危险项已在上面硬拦截。默认严格（AGENTHUB_AUTO_STRICT）下仅白名单命令
            # 自动放行，文件写 / 非白名单命令 / 写类 MCP 降级为人工审批；关闭严格则恢复原全自动。
            if not _auto_strict_enabled() or command_verdict == CommandVerdict.ALLOWED:
                return {}
            return await request_user_approval(
                input_data, tool_use_id, tool_name, tool_input,
                "AUTO 严格模式：非白名单写/命令需人工审批",
            )

        # REVIEW_EDITS：白名单内命令放行，其余进人工审批
        if command_verdict == CommandVerdict.ALLOWED:
            return {}

        if tool_name == "Bash":
            approval_reason = "非白名单命令，需人工审批"
        elif tool_name.startswith("mcp__"):
            approval_reason = "MCP 写/执行类工具，需人工审批"
        else:
            approval_reason = "文件修改操作，需人工审批"
        return await request_user_approval(
            input_data, tool_use_id, tool_name, tool_input, approval_reason
        )

    async def post_tool_log(
        input_data: dict[str, Any],
        tool_use_id: str | None,
        context: Any,
    ) -> dict[str, Any]:
        tool_name = input_data.get("tool_name", "")
        on_event(
            UnifiedEvent(
                type="tool_call",
                data={"tool": tool_name, "status": "completed", "tool_use_id": tool_use_id},
                adapter=ADAPTER_NAME,
            )
        )
        return {}

    return {
        "PreToolUse": [
            HookMatcher(matcher=HOOK_MATCHER, hooks=[guard_hook]),
        ],
        "PostToolUse": [
            HookMatcher(matcher="Edit|MultiEdit|Write|NotebookEdit", hooks=[post_tool_log]),
        ],
    }
