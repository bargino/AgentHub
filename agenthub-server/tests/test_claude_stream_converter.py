"""claude-code message_converter 流式增量转换单测。

验证 include_partial_messages 下 SDK 下发的 StreamEvent（content_block_delta）
被转为增量 text_delta / thinking（is_delta=True），其余流事件忽略；
AssistantMessage 整块路径保持不变（无 is_delta），由 executor 在 delta_mode 下去重。
"""

from __future__ import annotations

from claude_agent_sdk import AssistantMessage, StreamEvent, TextBlock, ThinkingBlock

from app.adapters.claude_code.message_converter import convert_message


def _stream(event: dict) -> StreamEvent:
    return StreamEvent(uuid="u", session_id="s", event=event)


def test_text_delta_becomes_incremental_text_delta() -> None:
    evs = convert_message(
        _stream(
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "Hel"},
            }
        )
    )
    assert len(evs) == 1
    assert evs[0].type == "text_delta"
    assert evs[0].data == {"text": "Hel", "is_delta": True}


def test_thinking_delta_becomes_incremental_thinking() -> None:
    evs = convert_message(
        _stream(
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": "hmm"},
            }
        )
    )
    assert len(evs) == 1
    assert evs[0].type == "thinking"
    assert evs[0].data["text"] == "hmm"
    assert evs[0].data["is_delta"] is True


def test_non_content_block_delta_events_ignored() -> None:
    raws = [
        {"type": "message_start", "message": {}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {}},
        {"type": "message_stop"},
        # 工具入参增量与签名增量不入正文/思考通道
        {
            "type": "content_block_delta",
            "index": 1,
            "delta": {"type": "input_json_delta", "partial_json": "{"},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "signature_delta", "signature": "x"},
        },
    ]
    for raw in raws:
        assert convert_message(_stream(raw)) == [], raw


def test_empty_text_delta_ignored() -> None:
    assert (
        convert_message(
            _stream(
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": ""},
                }
            )
        )
        == []
    )


def test_assistant_message_textblock_still_full_block() -> None:
    """整块兜底不变：AssistantMessage 的 TextBlock 仍转整块 text_delta（无 is_delta）。"""
    evs = convert_message(
        AssistantMessage(content=[TextBlock(text="full answer")], model="claude")
    )
    text_events = [e for e in evs if e.type == "text_delta"]
    assert len(text_events) == 1
    assert text_events[0].data["text"] == "full answer"
    assert not text_events[0].data.get("is_delta")


def test_assistant_message_thinkingblock_still_full_block() -> None:
    evs = convert_message(
        AssistantMessage(
            content=[ThinkingBlock(thinking="full think", signature="sig")],
            model="claude",
        )
    )
    think_events = [e for e in evs if e.type == "thinking"]
    assert len(think_events) == 1
    assert think_events[0].data["text"] == "full think"
    assert not think_events[0].data.get("is_delta")
