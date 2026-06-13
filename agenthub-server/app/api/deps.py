from __future__ import annotations

from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session_factory


async def get_db() -> AsyncIterator[AsyncSession]:
    """请求级数据库会话（事务自动提交/回滚）。"""
    async with get_session_factory()() as session:
        async with session.begin():
            yield session
