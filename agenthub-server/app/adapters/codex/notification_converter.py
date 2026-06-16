"""Codex app-server 通知 -> UnifiedEvent 转换。

基于 openai-codex 0.1.0b3 实测结论（2026-06-10，见 Desktop/codex-sdk-test）：
- turn 事件流元素是 Notification(method, payload)，必须按 method 字符串分发，
  而非 payload 类型名（payload 可能是 UnknownNotification 兜底）
- item/started 与 item/completed 的 payload.item 是 ThreadItem 联合类型（RootModel），
  按 item.type 字段分流 commandExecution / fileChange / agentMessage 等
- fileChange 审批请求 params 不含 diff 内容，diff 详情在 item/started 的
  FileChangeThreadItem.changes（path/kind/diff）中，由 adapter 缓存供审批弹窗使用
- turn/diff/updated 提供全 turn 聚合 unified diff，独立于审批通道
"""

from __future__ import annotations

import logging
from typing import Any

from app.adapters.base import UnifiedEvent

logger = logging.getLogger(__name__)

ADAPTER_NAME = "codex"

_OUTPUT_TRUNCATE = 2000


def _unwrap_item(payload: Any) -> Any:
    """ThreadItem 是 pydantic RootModel 联合，取 .root 拿到具体类型。"""
    item = getattr(payload, "item", None)
    return getattr(item, "root", item)


def _diff_stats(diff_text: str) -> tuple[int, int]:
    additions = 0
    deletions = 0
    for line in diff_text.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            additions += 1
        elif line.startswith("-") and not line.startswith("---"):
            deletions += 1
    return additions, deletions


def _parse_unified_diff(diff_text: str) -> list[dict[str, Any]]:
    """git unified diff -> [DiffFileOut dict]（filename/additions/deletions/old/newContent）。

    codex turn/diff/updated 只给聚合 unified diff（无结构化 files），前端变更面板需
    per-file old/new 内容。在 hunk 范围内重建：上下文行入两侧，- 行入 old，+ 行入 new；
    新建文件（--- /dev/null）old="";删除文件（+++ /dev/null）new=""。hunk 外未变内容
    无法从 unified diff 还原（格式固有限制），但足以驱动 side-by-side 变更展示。
    """
    files: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    old_lines: list[str] = []
    new_lines: list[str] = []

    def _flush() -> None:
        nonlocal cur, old_lines, new_lines
        if cur is not None and cur.get("filename"):
            cur["oldContent"] = "\n".join(old_lines)
            cur["newContent"] = "\n".join(new_lines)
            files.append(cur)
        cur = None
        old_lines = []
        new_lines = []

    for line in diff_text.splitlines():
        if line.startswith("diff --git"):
            _flush()
            cur = {"filename": "", "additions": 0, "deletions": 0}
            continue
        if cur is None:
            continue
        if line.startswith("+++ "):
            path = line[4:].strip()
            if path != "/dev/null":
                cur["filename"] = path[2:] if path.startswith("b/") else path
        elif line.startswith("--- "):
            if not cur["filename"]:
                path = line[4:].strip()
                if path != "/dev/null":
                    cur["filename"] = path[2:] if path.startswith("a/") else path
        elif line.startswith("@@"):
            continue
        elif line.startswith("+"):
            new_lines.append(line[1:])
            cur["additions"] += 1
        elif line.startswith("-"):
            old_lines.append(line[1:])
            cur["deletions"] += 1
        elif line.startswith(" "):
            old_lines.append(line[1:])
            new_lines.append(line[1:])
    _flush()
    return files


def _file_changes_payload(item: Any) -> list[dict[str, Any]]:
    """FileChangeThreadItem.changes -> [{path, kind, diff, additions, deletions}]"""
    changes: list[dict[str, Any]] = []
    for change in getattr(item, "changes", None) or []:
        diff_text = str(getattr(change, "diff", "") or "")
        additions, deletions = _diff_stats(diff_text)
        kind = getattr(change, "kind", "")
        changes.append({
            "path": str(getattr(change, "path", "")),
            "kind": getattr(kind, "value", None) or str(kind),
            "diff": diff_text,
            "additions": additions,
            "deletions": deletions,
        })
    return changes


def _command_event(item: Any, *, phase: str) -> UnifiedEvent:
    command = str(getattr(item, "command", "") or "")
    cwd = getattr(item, "cwd", "")
    cwd = getattr(cwd, "root", cwd)  # cwd 是 RootModel 包装的路径字符串
    data: dict[str, Any] = {
        "tool_name": "shell",
        "status": phase,
        "summary": command[:300],
        "tool_input": command[:500],
        "cwd": str(cwd or ""),
        "item_id": str(getattr(item, "id", "") or ""),
    }
    if phase != "running":
        exit_code = getattr(item, "exit_code", None)
        data["exit_code"] = exit_code
        data["status"] = "success" if exit_code == 0 else "failed"
        data["duration_ms"] = getattr(item, "duration_ms", None)
        output = str(getattr(item, "aggregated_output", "") or "")
        if output:
            data["output"] = output[:_OUTPUT_TRUNCATE]
    return UnifiedEvent(type="tool_call", data=data, adapter=ADAPTER_NAME)


def _extract_token_usage(payload: Any) -> dict[str, Any] | None:
    """tokenUsage 通知 payload -> 平铺 dict（字段名保持 SDK 原样，驼峰）。

    实测 payload 结构可能是 {usage: {...}} 包装或平铺，宽松提取数值字段。
    """
    for candidate in (getattr(payload, "usage", None), payload):
        if candidate is None:
            continue
        data = candidate if isinstance(candidate, dict) else getattr(candidate, "__dict__", None)
        if not isinstance(data, dict):
            continue
        usage = {k: v for k, v in data.items() if isinstance(v, (int, float))}
        if usage:
            return usage
    return None


def convert_notification(
    notification: Any,
    file_change_items: dict[str, Any],
    final_parts: list[str],
    turn_state: dict[str, Any] | None = None,
) -> list[UnifiedEvent]:
    """单条 turn 通知转换为 0..n 个 UnifiedEvent。

    file_change_items: item_id -> changes 摘要缓存（审批 handler 跨线程读取）
    final_parts: agentMessage 增量累积（turn/completed 时作为最终回复）
    turn_state: turn 级累积状态（tokenUsage 等），turn/completed 时并入终态事件
    """
    method = str(getattr(notification, "method", "") or "")
    payload = getattr(notification, "payload", None)
    state = turn_state if turn_state is not None else {}

    # token 计量通知（如 thread/tokenUsage/updated）：缓存最新值，终态统一携带
    if "tokenusage" in method.lower():
        usage = _extract_token_usage(payload)
        if usage:
            state["usage"] = usage
        return []

    if method == "item/agentMessage/delta":
        delta = str(getattr(payload, "delta", "") or "")
        if not delta:
            return []
        final_parts.append(delta)
        # 正文走 text_delta 通道（is_delta 走字符拼接）
        return [UnifiedEvent(
            type="text_delta",
            data={"text": delta, "is_delta": True},
            adapter=ADAPTER_NAME,
        )]

    # reasoning 增量：codex 方法为 item/reasoning/summaryTextDelta / item/reasoning/textDelta
    # （驼峰 Delta 结尾，payload.delta 为推理文本增量）；转 thinking 通道，前端 ThinkingCard
    # 折叠展示。注意不能用 endswith("/delta") 判定——codex 用驼峰 ...Delta，会漏接。
    if "reasoning" in method and method.lower().endswith("delta"):
        delta = str(getattr(payload, "delta", "") or "")
        if not delta:
            return []
        return [UnifiedEvent(
            type="thinking",
            data={"text": delta, "is_thinking": True, "is_delta": True},
            adapter=ADAPTER_NAME,
        )]

    if method == "item/started":
        item = _unwrap_item(payload)
        item_type = str(getattr(item, "type", "") or "")
        if item_type == "commandExecution":
            return [_command_event(item, phase="running")]
        if item_type == "fileChange":
            changes = _file_changes_payload(item)
            item_id = str(getattr(item, "id", "") or "")
            if item_id:
                file_change_items[item_id] = changes
        return []

    if method == "item/completed":
        item = _unwrap_item(payload)
        item_type = str(getattr(item, "type", "") or "")
        if item_type == "commandExecution":
            return [_command_event(item, phase="completed")]
        if item_type == "fileChange":
            changes = _file_changes_payload(item)
            item_id = str(getattr(item, "id", "") or "")
            if item_id:
                file_change_items[item_id] = changes
            if not changes:
                return []
            status = getattr(item, "status", "")
            return [UnifiedEvent(
                type="file_change",
                data={
                    "path": changes[0]["path"],
                    "change_type": changes[0]["kind"],
                    "changes": changes,
                    "status": getattr(status, "value", None) or str(status),
                    "item_id": item_id,
                },
                adapter=ADAPTER_NAME,
            )]
        return []

    if method == "turn/diff/updated":
        diff_text = str(getattr(payload, "diff", "") or "")
        if not diff_text:
            return []
        additions, deletions = _diff_stats(diff_text)
        return [UnifiedEvent(
            type="diff_update",
            data={
                "summary": f"代码变更（+{additions}/-{deletions}）",
                "files": _parse_unified_diff(diff_text),
                "unified_diff": diff_text,
                "additions": additions,
                "deletions": deletions,
            },
            adapter=ADAPTER_NAME,
        )]

    if method == "turn/completed":
        turn = getattr(payload, "turn", None)
        status = getattr(turn, "status", None)
        status_value = getattr(status, "value", None) or str(status or "")
        result_text = "".join(final_parts)
        if status_value == "failed":
            error = getattr(turn, "error", None)
            message = str(getattr(error, "message", "") or "turn failed")
            return [UnifiedEvent(
                type="error",
                data={"error": message, "turn_id": str(getattr(turn, "id", "") or "")},
                adapter=ADAPTER_NAME,
            )]
        return [UnifiedEvent(
            type="completed",
            data={
                "result": result_text,
                "full_text": result_text,
                "status": status_value,
                "interrupted": status_value == "interrupted",
                "turn_id": str(getattr(turn, "id", "") or ""),
                "usage": state.get("usage"),
            },
            adapter=ADAPTER_NAME,
        )]

    if method == "error":
        # ErrorNotification: {error: TurnError, will_retry: bool, ...}
        # will_retry=True 表示 SDK 正在自动重连重试（如 503）——属瞬时错误，
        # 走 transient_error ephemeral 通道（不落消息、不污染上下文）；恢复后前端自清。
        # will_retry=False 才是真正失败，走 error（落库 + 失败任务）。
        err = getattr(payload, "error", None)
        reason = str(
            getattr(err, "message", "")
            or getattr(err, "additional_details", "")
            or getattr(payload, "message", "")
            or "模型调用错误"
        )
        if bool(getattr(payload, "will_retry", False)):
            return [UnifiedEvent(
                type="transient_error",
                data={"error": reason, "will_retry": True},
                adapter=ADAPTER_NAME,
            )]
        return [UnifiedEvent(
            type="error",
            data={"error": reason},
            adapter=ADAPTER_NAME,
        )]

    # plan 等其余通知：不进业务流（event store 由 executor 统一落）
    return []
