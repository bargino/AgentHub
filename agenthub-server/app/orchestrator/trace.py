"""请求级 trace 聚合与最小回放断言（#7 tracing / #11a replay assertion）。

#7：engine.handle 为每轮请求生成 trace_id，贯穿规划事件（orchestration.planned）
与各任务事件（payload.traceId）。summarize_trace 按 trace 聚合 token / 工具耗时 /
事件分布，供成本核算与卡点定位；token 字段复用 token_meter.normalize_usage 标准化
（兼容 Claude 蛇形 / Codex 驼峰两套口径），全程不引入任何 SDK。

#11a：在 trace 之上做轻量回放断言（无需 golden set），校验「规划→任务→收口」关键
事件是否齐全、任务状态机迁移是否合法（started 必达终态 completed/error）、有无僵尸
running 或孤儿终态。复用 event_store 事件流，零依赖，一次回归即可发现编排链路断裂。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.memory import token_meter
from app.services import event_store

# 规划阶段埋点事件类型（engine._record_planning 写入，无 task_id）
PLANNING_EVENT = "orchestration.planned"
# 任务终态事件（started 之后必达其一，否则视为僵尸 running）
_TERMINAL_EVENTS = frozenset({"completed", "error"})


def filter_by_trace(events: list[dict], trace_id: str) -> list[dict]:
    """取出归属指定 trace 的事件（payload.traceId 匹配）。"""
    return [e for e in events if (e.get("payload") or {}).get("traceId") == trace_id]


@dataclass
class TraceSummary:
    """一次请求（trace）的聚合视图：token / 工具耗时 / 事件分布。"""

    trace_id: str
    mode: str = ""  # direct / single / pipeline（取自规划事件）
    task_count: int = 0  # 规划阶段声明的任务数
    event_count: int = 0
    event_types: dict[str, int] = field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    total_tokens: int = 0
    tool_calls: int = 0
    tool_duration_ms: int = 0
    error_count: int = 0


def summarize_trace(events: list[dict], trace_id: str) -> TraceSummary:
    """按 trace 聚合 token / 工具耗时 / 事件分布（#7）。

    - token：completed 事件 payload.usage 经 normalize_usage 标准化后累加
    - 工具耗时：tool_call 事件 payload.duration_ms 累加（Codex 提供，Claude 可能缺省）
    - mode / task_count：取规划事件（orchestration.planned）
    """
    scoped = filter_by_trace(events, trace_id)
    s = TraceSummary(trace_id=trace_id, event_count=len(scoped))
    for e in scoped:
        et = e.get("event_type") or ""
        s.event_types[et] = s.event_types.get(et, 0) + 1
        payload = e.get("payload") or {}
        if et == PLANNING_EVENT:
            s.mode = payload.get("mode") or s.mode
            tc = payload.get("taskCount")
            if isinstance(tc, int):
                s.task_count = tc
        elif et == "completed":
            usage = token_meter.normalize_usage(payload.get("usage"))
            if usage:
                s.input_tokens += usage["input_tokens"]
                s.output_tokens += usage["output_tokens"]
                s.cache_read_tokens += usage["cache_read_tokens"]
                s.cache_write_tokens += usage["cache_write_tokens"]
                s.total_tokens += usage["total_tokens"]
        elif et == "tool_call":
            s.tool_calls += 1
            d = payload.get("duration_ms")
            if isinstance(d, (int, float)) and d >= 0:
                s.tool_duration_ms += int(d)
        elif et == "error":
            s.error_count += 1
    return s


@dataclass
class ReplayReport:
    """回放断言结果：ok=链路完整，issues=发现的链路断裂明细。"""

    ok: bool
    issues: list[str] = field(default_factory=list)
    task_count: int = 0  # 出现任务事件的 task_id 数
    has_planning: bool = False


def replay_assert(events: list[dict], trace_id: str | None = None) -> ReplayReport:
    """最小回放断言（#11a）：校验编排链路完整性，返回结构化报告（不抛异常）。

    断言项：
    1. 存在规划事件（orchestration.planned）→ 链路有起点
    2. 每个有 started 的任务必达终态 → 无僵尸 running
    3. 无孤儿终态（completed/error 但无 started）→ 状态机迁移合法

    trace_id 非空时只校验该 trace；为 None 时校验全部传入事件。
    """
    scoped = filter_by_trace(events, trace_id) if trace_id is not None else list(events)
    issues: list[str] = []

    has_planning = any(e.get("event_type") == PLANNING_EVENT for e in scoped)
    if not has_planning:
        issues.append("缺规划事件 orchestration.planned：编排链路无起点")

    started: set[str] = set()
    terminal: set[str] = set()
    for e in scoped:
        tid = e.get("task_id")
        if not tid:
            continue
        et = e.get("event_type") or ""
        if et == "started":
            started.add(tid)
        elif et in _TERMINAL_EVENTS:
            terminal.add(tid)

    for tid in sorted(started - terminal):
        issues.append(f"任务 {tid} 有 started 但无终态：僵尸 running")
    for tid in sorted(terminal - started):
        issues.append(f"任务 {tid} 有终态但无 started：孤儿事件（非法状态迁移）")

    return ReplayReport(
        ok=not issues,
        issues=issues,
        task_count=len(started | terminal),
        has_planning=has_planning,
    )


async def get_trace_summary(
    session: AsyncSession, conversation_id: str, trace_id: str
) -> TraceSummary:
    """查询入口（#7）：取会话事件流并按 trace 聚合。薄包装，逻辑见 summarize_trace。"""
    events = await event_store.list_events(session, conversation_id)
    return summarize_trace(events, trace_id)
