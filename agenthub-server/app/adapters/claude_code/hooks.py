"""Claude Code 安全 hook：白名单三级判定 + workspace 路径围栏 + 审批超时。

所有审批模式（含 AUTO）都装 hook：
- BLOCKED 命令 / workspace 外路径 -> 直接拒绝，不询问用户
- ALLOWED 命令 / AUTO 模式下的其余操作 -> 放行
- DENY_ALL -> 全部直接拒绝
- 其余（REVIEW_EDITS）-> 发审批请求，等待用户决定（带超时，超时默认拒绝）
"""

from __future__ import annotations

import asyncio
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

HOOK_MATCHER = "Read|Edit|MultiEdit|Write|NotebookEdit|Bash"


def _deny(input_data: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": input_data.get("hook_event_name", "PreToolUse"),
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def build_hooks(
    approval_mode: UnifiedApprovalMode,
    on_event: Callable[[UnifiedEvent], Any],
    pending_approvals: dict[str, asyncio.Event],
    approval_decisions: dict[str, bool],
    workspace_path: str | None = None,
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

        on_event(
            UnifiedEvent(
                type="approval_request",
                data={
                    "request_id": request_id,
                    "tool": tool_name,
                    "file_path": tool_input.get("file_path", ""),
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
            # AUTO 模式自动放行（危险项已在上面硬拦截）
            return {}

        # REVIEW_EDITS：白名单内命令放行，其余进人工审批
        if command_verdict == CommandVerdict.ALLOWED:
            return {}

        approval_reason = (
            "非白名单命令，需人工审批" if tool_name == "Bash" else "文件修改操作，需人工审批"
        )
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
