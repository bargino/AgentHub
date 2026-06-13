"""工作记忆：当前任务链上下文。

聚合本会话的任务计划、各任务结果、最新 Diff 摘要、审批状态，
作为下游 Agent（Coder/Reviewer 等）执行时的上下文输入。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiffRecord, Task


async def build_task_context(session: AsyncSession, conversation_id: str) -> str:
    """渲染当前任务链状态为提示词文本块。"""
    result = await session.execute(
        select(Task)
        .where(Task.conversation_id == conversation_id)
        .order_by(Task.created_at.asc())
    )
    tasks = list(result.scalars())
    if not tasks:
        return ""

    lines = ["## 当前任务链"]
    for t in tasks:
        dep = f"（依赖 {', '.join(t.depends_on)}）" if t.depends_on else ""
        lines.append(f"- [{t.status}] {t.title} @{t.agent_role}{dep}")
        if t.result:
            snippet = t.result[:300].replace("\n", " ")
            lines.append(f"  结果: {snippet}")

    diff_result = await session.execute(
        select(DiffRecord)
        .where(DiffRecord.conversation_id == conversation_id)
        .order_by(DiffRecord.created_at.desc())
        .limit(1)
    )
    diff = diff_result.scalars().first()
    if diff:
        lines.append(f"## 最新代码变更（{diff.status}）")
        lines.append(f"摘要: {diff.summary}")
        for f in diff.files or []:
            lines.append(f"- {f.get('filename')} (+{f.get('additions', 0)}/-{f.get('deletions', 0)})")

    return "\n".join(lines)


async def get_upstream_results(
    session: AsyncSession, conversation_id: str, depends_on: list[str]
) -> dict[str, str]:
    """获取指定依赖任务的执行结果（任务 ID -> result）。"""
    if not depends_on:
        return {}
    result = await session.execute(
        select(Task).where(Task.id.in_(depends_on))
    )
    return {t.id: (t.result or "") for t in result.scalars()}
