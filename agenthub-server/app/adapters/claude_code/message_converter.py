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
