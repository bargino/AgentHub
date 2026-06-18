"""LLM 驱动的上下文压缩摘要 + 项目记忆沉淀。

会话历史超出滑动窗口时，由编排引擎收口阶段调用 compress_if_needed，
将窗口外旧消息与既往摘要滚动压缩为一段新摘要，存入 project_memory
（category="conversation_summary"，key=conversation_id），
经 context_builder / engine 作为前缀注入后续上下文。

同一次蒸馏同时产出两类记忆：①会话滚动摘要（compaction 层，category=conversation_summary，
key=conversation_id）；②项目级长期记忆（tech_stack / conventions / decision），经
===MEMORY=== 双产出由 parse_summary_output 解析后写入 project_memory，再由
render_project_context 跨会话注入规划器与执行 Agent 上下文；与 #9a 文档记忆
（AGENTHUB.md / progress.md）互补。LLM 不可用时回退到简单截断（不产出项目事实）。
"""

from __future__ import annotations

import json
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.memory import project_memory
from app.memory.conversation_memory import MemoryEntry, get_overflow_messages

logger = logging.getLogger(__name__)

SUMMARY_CATEGORY = "conversation_summary"

# 记忆条目分隔标记与可沉淀类目（structure_summary 属于工作区扫描，不在对话沉淀范围）
MEMORY_MARKER = "===MEMORY==="
_MEMORY_CATEGORIES = {"tech_stack", "conventions", "decision"}
# 单轮最多沉淀条数 / 单条 value 长度上限（render_project_context 注入时截 500）
_MEMORY_MAX_ITEMS = 5
_MEMORY_VALUE_LIMIT = 500

# 结构化滚动摘要模板（借鉴 MiMo-Code compaction.txt：锚定模板压缩，
# 比自由文本摘要信息损失更小；与既往摘要滚动合并形成会话 checkpoint）
SUMMARY_PROMPT = """请将以下对话历史（含可能存在的既往摘要）压缩为结构化摘要，\
总长不超过 800 字。严格按以下模板输出，无内容的段落写"（无）"：

### 目标
用户的核心需求与最终目标（1-2 句）

### 约束与偏好
用户明确提出的要求、限制、技术选型偏好

### 关键发现
执行过程中确认的重要事实、结论、问题根因

### 已完成
已完成的关键动作及其结果（合并同类项）

### 待办与未解决
尚未完成的事项、遗留问题、下一步计划

### 相关文件
涉及的关键文件/目录路径（仅列高频或核心项）

对话历史：
{history}

先输出上面的结构化摘要模板正文。随后，仅当本段对话中确认了\
**跨会话仍然有用的耐久项目事实**（技术栈/架构、稳定的项目约定、重要且不易改变的决策），\
再另起一行追加一个记忆块（无则整块省略，不要输出标记）：
===MEMORY===
[{{"category": "tech_stack", "key": "简短标识", "value": "事实内容"}}]
记忆块要求：
- category 只能是 tech_stack、conventions、decision 之一；
- 只记跨会话耐久、稳定的事实，不记一次性临时状态、本轮待办或会话进度；
- 最多 5 条，每条 value ≤ 200 字，整体必须是合法 JSON 数组；
- 没有值得长期保留的事实就省略整个记忆块。
摘要模板正文与记忆块之外，不要任何其它解释或前缀。"""


def parse_summary_output(raw: str) -> tuple[str, list[dict[str, str]]]:
    """LLM 双产出 -> (摘要正文, 合法记忆条目)。

    分隔标记后的 JSON 解析失败或格式非法时只丢弃记忆条目，不影响摘要主链路。
    """
    text = raw.strip()
    if MEMORY_MARKER not in text:
        return text, []
    summary_part, _, memory_part = text.partition(MEMORY_MARKER)
    items: list[dict[str, str]] = []
    try:
        # 容忍 LLM 输出 ```json 围栏
        payload = memory_part.strip().strip("`").removeprefix("json").strip()
        parsed = json.loads(payload)
        if isinstance(parsed, list):
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                category = str(item.get("category", "")).strip()
                key = str(item.get("key", "")).strip()
                value = str(item.get("value", "")).strip()
                if category in _MEMORY_CATEGORIES and key and value:
                    items.append(
                        {"category": category, "key": key[:200], "value": value[:_MEMORY_VALUE_LIMIT]}
                    )
                if len(items) >= _MEMORY_MAX_ITEMS:
                    break
    except (json.JSONDecodeError, ValueError):
        logger.debug("Memory items JSON parse failed, dropped", exc_info=True)
    return summary_part.strip(), items


async def summarize_entries(entries: list[MemoryEntry]) -> tuple[str, list[dict[str, str]]]:
    """压缩消息列表为 (摘要, 项目记忆条目)。LLM 可用时生成，否则回退为首尾截断。"""
    history = "\n".join(f"{e.role}: {e.content}" for e in entries)

    try:
        from app.adapters.base import AdapterContext, UnifiedApprovalMode, UnifiedSandboxLevel
        from app.core.registry import get_global_registry
        from app.orchestrator.agent_router import PLANNING_PRIORITY

        registry = get_global_registry()
        for adapter_name in PLANNING_PRIORITY:
            adapter = registry.get(adapter_name)
            if adapter is None:
                continue
            try:
                if not await adapter.health_check():
                    continue
            except Exception:
                continue

            ctx = AdapterContext(
                instructions=SUMMARY_PROMPT.format(history=history[:8000]),
                workspace_path=".",
                approval_mode=UnifiedApprovalMode.AUTO,
                sandbox_level=UnifiedSandboxLevel.READ_ONLY,
                model=adapter.light_model,  # #6 摘要走轻模型（未配置则回退默认）
            )
            full_text: list[str] = []
            async for event in adapter.execute(ctx):
                if event.type == "thinking":
                    text = str(event.data.get("text", ""))
                    if text:
                        full_text.append(text)
                elif event.type == "completed":
                    result = str(event.data.get("result", ""))
                    if result:
                        return parse_summary_output(result)
                    break
                elif event.type == "error":
                    break
            if full_text:
                return parse_summary_output("".join(full_text))
            break
    except Exception:
        logger.warning("LLM summary failed, falling back to truncation", exc_info=True)

    # 回退：保留首条用户需求 + 最近两条（无记忆条目产出）
    parts: list[str] = []
    if entries:
        parts.append(f"初始需求: {entries[0].content[:200]}")
        for e in entries[-2:]:
            parts.append(f"{e.role}: {e.content[:150]}")
    return "\n".join(parts), []


async def get_conversation_summary(
    session: AsyncSession, project_name: str, conversation_id: str
) -> str:
    """读取当前会话的滚动摘要（尚未压缩过时返回空串）。"""
    data = await project_memory.recall(session, project_name, category=SUMMARY_CATEGORY)
    return data.get(conversation_id, "")


async def compress_if_needed(
    session: AsyncSession,
    project_name: str,
    conversation_id: str,
    *,
    pressure: int = 0,
) -> bool:
    """会话历史溢出滑动窗口时，滚动压缩窗口外旧消息到长期记忆。

    输入 = 既往摘要 + 窗口外最近一批旧消息，输出覆盖写回同一 key，
    形成滚动摘要。无溢出时不动作，返回 False。

    pressure ≥ 2（上下文压力高，见 token_meter）时压缩边界前移：
    滑动窗口减半，让更多近期消息提前进入摘要，给下轮上下文腾出空间。
    """
    from app.memory.conversation_memory import WINDOW_MAX_MESSAGES

    window_size = WINDOW_MAX_MESSAGES // 2 if pressure >= 2 else WINDOW_MAX_MESSAGES
    overflow = await get_overflow_messages(
        session, conversation_id, window_size=window_size
    )
    if not overflow:
        return False

    old_summary = await get_conversation_summary(session, project_name, conversation_id)
    entries = list(overflow)
    if old_summary:
        entries.insert(0, MemoryEntry(role="system", content=f"[既往摘要] {old_summary}"))

    # 同一次蒸馏双产出：会话滚动摘要（compaction 层）+ ④ 项目级长期记忆
    # （tech_stack/conventions/decision），后者跨会话注入规划器与执行 Agent。
    summary, memory_items = await summarize_entries(entries)
    await project_memory.remember(
        session,
        project_name,
        category=SUMMARY_CATEGORY,
        key=conversation_id,
        value=summary,
    )
    for item in memory_items:
        await project_memory.remember(
            session,
            project_name,
            category=item["category"],
            key=item["key"],
            value=item["value"],
        )
    return True
