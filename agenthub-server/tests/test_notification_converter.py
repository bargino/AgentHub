"""codex notification_converter 单测：SDK 通知 -> UnifiedEvent 转换（B-5 converter）。

用 SimpleNamespace 伪造 notification/payload/item（不依赖 openai-codex SDK），逐 method
锁定事件映射：增量正文/推理、命令起止、文件变更、聚合 diff、turn 终态、瞬时 vs 真错。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from app.adapters.codex.notification_converter import (
    _diff_stats,
    _parse_unified_diff,
    convert_notification,
)


def _convert(
    method: str,
    payload: Any,
    *,
    files: dict[str, Any] | None = None,
    final: list[str] | None = None,
    state: dict[str, Any] | None = None,
) -> list:
    return convert_notification(
        SimpleNamespace(method=method, payload=payload),
        files if files is not None else {},
        final if final is not None else [],
        state,
    )


def test_agent_message_delta_to_text_delta() -> None:
    final: list[str] = []
    evs = _convert("item/agentMessage/delta", SimpleNamespace(delta="hi"), final=final)
    assert len(evs) == 1
    assert evs[0].type == "text_delta"
    assert evs[0].data == {"text": "hi", "is_delta": True}
    assert final == ["hi"]  # 增量累积供 turn/completed 收口


def test_agent_message_empty_delta_ignored() -> None:
    assert _convert("item/agentMessage/delta", SimpleNamespace(delta="")) == []


def test_reasoning_delta_to_thinking() -> None:
    evs = _convert("item/reasoning/summaryTextDelta", SimpleNamespace(delta="ponder"))
    assert len(evs) == 1
    assert evs[0].type == "thinking"
    assert evs[0].data["text"] == "ponder"


def test_token_usage_cached_into_state() -> None:
    state: dict[str, Any] = {}
    evs = _convert(
        "thread/tokenUsage/updated",
        SimpleNamespace(usage={"inputTokens": 10, "outputTokens": 5}),
        state=state,
    )
    assert evs == []
    assert state["usage"] == {"inputTokens": 10, "outputTokens": 5}


def test_command_started_running() -> None:
    item = SimpleNamespace(type="commandExecution", command="npm test", cwd="/ws", id="c1")
    evs = _convert("item/started", SimpleNamespace(item=item))
    assert len(evs) == 1
    assert evs[0].type == "tool_call"
    assert evs[0].data["status"] == "running"
    assert evs[0].data["tool_name"] == "shell"


def test_command_completed_success() -> None:
    item = SimpleNamespace(
        type="commandExecution", command="npm test", cwd="/ws", id="c1",
        exit_code=0, duration_ms=120, aggregated_output="ok",
    )
    evs = _convert("item/completed", SimpleNamespace(item=item))
    assert evs[0].data["status"] == "success"
    assert evs[0].data["exit_code"] == 0
    assert evs[0].data["output"] == "ok"


def test_command_completed_failure() -> None:
    item = SimpleNamespace(
        type="commandExecution", command="bad", cwd="/ws", id="c1",
        exit_code=1, duration_ms=5, aggregated_output="err",
    )
    evs = _convert("item/completed", SimpleNamespace(item=item))
    assert evs[0].data["status"] == "failed"


def test_file_change_started_caches_changes() -> None:
    change = SimpleNamespace(diff="+a\n-b", kind="modify", path="x.py")
    item = SimpleNamespace(type="fileChange", id="f1", changes=[change])
    files: dict[str, Any] = {}
    evs = _convert("item/started", SimpleNamespace(item=item), files=files)
    assert evs == []  # 起始仅缓存，供审批弹窗读取
    assert files["f1"][0]["path"] == "x.py"


def test_file_change_completed_emits_event() -> None:
    change = SimpleNamespace(diff="+a", kind="add", path="x.py")
    item = SimpleNamespace(
        type="fileChange", id="f2", changes=[change],
        status=SimpleNamespace(value="completed"),
    )
    evs = _convert("item/completed", SimpleNamespace(item=item))
    assert len(evs) == 1
    assert evs[0].type == "file_change"
    assert evs[0].data["path"] == "x.py"
    assert evs[0].data["status"] == "completed"


_DIFF = """diff --git a/x.py b/x.py
--- a/x.py
+++ b/x.py
@@ -1 +1 @@
-old
+new"""


def test_turn_diff_updated() -> None:
    evs = _convert("turn/diff/updated", SimpleNamespace(diff=_DIFF))
    assert len(evs) == 1
    assert evs[0].type == "diff_update"
    assert evs[0].data["additions"] == 1
    assert evs[0].data["deletions"] == 1
    files = evs[0].data["files"]
    assert files[0]["filename"] == "x.py"
    assert files[0]["oldContent"] == "old"
    assert files[0]["newContent"] == "new"


def test_turn_completed_success() -> None:
    turn = SimpleNamespace(status=SimpleNamespace(value="completed"), id="t1", error=None)
    evs = _convert(
        "turn/completed", SimpleNamespace(turn=turn), final=["a", "b"], state={"usage": {"x": 1}}
    )
    assert len(evs) == 1
    assert evs[0].type == "completed"
    assert evs[0].data["result"] == "ab"
    assert evs[0].data["usage"] == {"x": 1}


def test_turn_completed_failed_to_error() -> None:
    turn = SimpleNamespace(
        status=SimpleNamespace(value="failed"), id="t1",
        error=SimpleNamespace(message="boom"),
    )
    evs = _convert("turn/completed", SimpleNamespace(turn=turn))
    assert len(evs) == 1
    assert evs[0].type == "error"
    assert evs[0].data["error"] == "boom"


def test_error_will_retry_is_transient() -> None:
    payload = SimpleNamespace(error=SimpleNamespace(message="503"), will_retry=True)
    evs = _convert("error", payload)
    assert len(evs) == 1
    assert evs[0].type == "transient_error"


def test_error_no_retry_is_error() -> None:
    payload = SimpleNamespace(error=SimpleNamespace(message="fatal"), will_retry=False)
    evs = _convert("error", payload)
    assert evs[0].type == "error"
    assert evs[0].data["error"] == "fatal"


def test_unknown_method_ignored() -> None:
    assert _convert("plan/whatever", SimpleNamespace()) == []


def test_diff_stats_excludes_headers() -> None:
    add, dele = _diff_stats("+new\n-old\n+++ b/x\n--- a/x\n ctx")
    assert (add, dele) == (1, 1)


def test_parse_unified_diff_two_files_new_file_old_empty() -> None:
    diff = (
        "diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-a\n+b\n"
        "diff --git a/y.py b/y.py\n--- /dev/null\n+++ b/y.py\n@@ -0,0 +1 @@\n+new"
    )
    files = _parse_unified_diff(diff)
    assert [f["filename"] for f in files] == ["x.py", "y.py"]
    assert files[1]["oldContent"] == ""  # 新建文件 old 为空
