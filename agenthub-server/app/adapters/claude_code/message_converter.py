from __future__ import annotations

from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
)

from app.adapters.base import UnifiedEvent

ADAPTER_NAME = "claude-code"


def _line_count(text: str) -> int:
    """文本行数（末尾无换行也算一行）。"""
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def _tool_use_to_diff(tool_name: str, tool_input: Any) -> UnifiedEvent | None:
    """Write/Edit 工具写入 -> diff_update（供前端代码变更面板展示）。

    claude SDK 不提供 turn 级 diff（不同于 codex 的 turn/diff/updated），故从工具入参
    提取变更：Write 为新建/覆盖（全量 content），Edit 为片段替换（old/new_string）。
    MultiEdit 等其它工具暂不转（需多段或全文，留待 git diff 方案）。
    """
    if not isinstance(tool_input, dict):
        return None
    path = tool_input.get("file_path") or tool_input.get("path")
    if not path:
        return None
    if tool_name == "Write":
        old, new = "", str(tool_input.get("content", ""))
    elif tool_name == "Edit":
        old, new = str(tool_input.get("old_string", "")), str(tool_input.get("new_string", ""))
    else:
        return None
    return UnifiedEvent(
        type="diff_update",
        data={
            "summary": f"{tool_name} {path}",
            "files": [
                {
                    "filename": str(path),
                    "additions": _line_count(new),
                    "deletions": _line_count(old),
                    "oldContent": old,
                    "newContent": new,
                }
            ],
        },
        adapter=ADAPTER_NAME,
    )


def convert_message(message: Any) -> list[UnifiedEvent]:
    events: list[UnifiedEvent] = []

    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock):
                # 正文走 text_delta 通道，与思考分流（前端分轨渲染/折叠）
                events.append(
                    UnifiedEvent(
                        type="text_delta",
                        data={"text": block.text},
                        adapter=ADAPTER_NAME,
                    )
                )
            elif isinstance(block, ThinkingBlock):
                events.append(
                    UnifiedEvent(
                        type="thinking",
                        data={"text": block.thinking, "is_thinking": True},
                        adapter=ADAPTER_NAME,
                    )
                )
            elif isinstance(block, ToolUseBlock):
                events.append(
                    UnifiedEvent(
                        type="tool_call",
                        data={
                            "tool_id": block.id,
                            "tool_name": block.name,
                            "tool_input": block.input,
                        },
                        adapter=ADAPTER_NAME,
                    )
                )
                # claude SDK 无 turn 级 diff，Write/Edit 额外转 diff_update 供变更面板展示
                diff_evt = _tool_use_to_diff(block.name, block.input)
                if diff_evt is not None:
                    events.append(diff_evt)
            elif isinstance(block, ToolResultBlock):
                events.append(
                    UnifiedEvent(
                        type="file_change",
                        data={
                            "tool_use_id": block.tool_use_id,
                            "content": block.content,
                            "is_error": block.is_error or False,
                        },
                        adapter=ADAPTER_NAME,
                    )
                )

    elif isinstance(message, ResultMessage):
        events.append(
            UnifiedEvent(
                type="completed",
                data={
                    "result": message.result,
                    "cost_usd": message.total_cost_usd,
                    "session_id": getattr(message, "session_id", None),
                    "num_turns": message.num_turns,
                    "stop_reason": message.stop_reason,
                    # 真实 token 计量（input/output/cache_*），供压力分级与成本统计
                    "usage": getattr(message, "usage", None),
                },
                adapter=ADAPTER_NAME,
            )
        )

    elif isinstance(message, SystemMessage):
        events.append(
            UnifiedEvent(
                type="thinking",
                data={"system": True, "subtype": getattr(message, "subtype", "")},
                adapter=ADAPTER_NAME,
            )
        )

    return events
