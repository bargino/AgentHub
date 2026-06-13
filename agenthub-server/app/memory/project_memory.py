"""长期记忆：项目级知识。

持久化项目结构摘要 / 技术栈 / 历史决策（key-value，按 workspace 维度），
存储于 SQLite，跨会话共享。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text, select
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Base


class ProjectKnowledge(Base):
    """项目级长期记忆条目。"""

    __tablename__ = "project_knowledge"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_name: Mapped[str] = mapped_column(String(200), index=True)
    # tech_stack | structure_summary | conventions | decision | conversation_summary
    category: Mapped[str] = mapped_column(String(32))
    key: Mapped[str] = mapped_column(String(200))
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


async def remember(
    session: AsyncSession,
    project_name: str,
    category: str,
    key: str,
    value: str | dict | list,
) -> None:
    """写入或更新一条项目知识（upsert 语义）。"""
    text_value = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    result = await session.execute(
        select(ProjectKnowledge)
        .where(ProjectKnowledge.project_name == project_name)
        .where(ProjectKnowledge.category == category)
        .where(ProjectKnowledge.key == key)
    )
    row = result.scalars().first()
    if row:
        row.value = text_value
    else:
        session.add(
            ProjectKnowledge(
                project_name=project_name, category=category, key=key, value=text_value
            )
        )
    await session.flush()


async def recall(
    session: AsyncSession, project_name: str, category: str | None = None
) -> dict[str, str]:
    """读取项目知识（key -> value）。"""
    stmt = select(ProjectKnowledge).where(ProjectKnowledge.project_name == project_name)
    if category:
        stmt = stmt.where(ProjectKnowledge.category == category)
    result = await session.execute(stmt)
    return {row.key: row.value for row in result.scalars()}


async def render_project_context(session: AsyncSession, project_name: str) -> str:
    """渲染项目记忆为提示词文本块。

    会话摘要（conversation_summary）按会话维度由 summary.get_conversation_summary
    单独注入，此处排除，避免 A 会话摘要泄漏进 B 会话上下文。
    """
    result = await session.execute(
        select(ProjectKnowledge)
        .where(ProjectKnowledge.project_name == project_name)
        .where(ProjectKnowledge.category != "conversation_summary")
    )
    knowledge = {row.key: row.value for row in result.scalars()}
    if not knowledge:
        return ""
    lines = [f"## 项目知识（{project_name}）"]
    for key, value in knowledge.items():
        snippet = value[:500]
        lines.append(f"- {key}: {snippet}")
    return "\n".join(lines)
