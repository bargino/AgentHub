from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def get_data_dir() -> Path:
    """AgentHub 数据目录，可通过 AGENTHUB_DATA_DIR 环境变量覆盖（测试用）。"""
    custom = os.environ.get("AGENTHUB_DATA_DIR")
    base = Path(custom) if custom else Path.home() / ".agenthub"
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_database_url() -> str:
    # 优先环境变量（支持 Postgres 等生产库，如 postgresql+asyncpg://user:pw@host/db）；
    # 未配置回退本地 SQLite 开发库
    custom = os.environ.get("AGENTHUB_DATABASE_URL")
    if custom:
        return custom
    db_path = get_data_dir() / "data.db"
    return f"sqlite+aiosqlite:///{db_path}"


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _enable_sqlite_wal(engine: AsyncEngine) -> None:
    """SQLite 连接级 PRAGMA（仅 SQLite 生效，对每个新连接执行）：

    - journal_mode=WAL：读写并发（读不阻塞写、写不阻塞读），缓解高频事件写
    - busy_timeout=10000：写锁竞争时等待 10s 而非立刻 SQLITE_BUSY 丢事件
    - synchronous=NORMAL：WAL 下的安全/吞吐平衡点（崩溃不损坏库）

    内存库（sqlite+aiosqlite://）不支持 WAL，PRAGMA 静默保持 memory，不报错。
    """

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _record):  # type: ignore[no-untyped-def]
        cursor = dbapi_conn.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=10000")
            cursor.execute("PRAGMA synchronous=NORMAL")
        finally:
            cursor.close()


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        url = get_database_url()
        _engine = create_async_engine(url, echo=False)
        if url.startswith("sqlite"):
            _enable_sqlite_wal(_engine)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _session_factory


# SQLite create_all 不会给已有表补列，新增字段在此登记做轻量迁移
_SQLITE_COLUMN_MIGRATIONS: dict[str, list[tuple[str, str]]] = {
    "conversations": [
        ("pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("archived", "INTEGER NOT NULL DEFAULT 0"),
        ("member_agent_ids", "JSON NOT NULL DEFAULT '[]'"),
        ("rules", "TEXT NOT NULL DEFAULT ''"),
        ("settings", "JSON NOT NULL DEFAULT '{}'"),
    ],
    "agents": [
        ("model", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("provider_config", "JSON NOT NULL DEFAULT '{}'"),
        ("system_prompt", "TEXT NOT NULL DEFAULT ''"),
        ("context_window", "INTEGER"),
        ("skill_specs", "JSON NOT NULL DEFAULT '[]'"),
    ],
    "messages": [
        ("meta", "JSON NOT NULL DEFAULT '{}'"),
    ],
    "approvals": [
        ("agent_role", "VARCHAR(32)"),
        ("agent_name", "VARCHAR(64)"),
        ("adapter_name", "VARCHAR(32)"),
        ("diff_id", "VARCHAR(32)"),
    ],
    "tasks": [
        # Phase 2。Postgres 等生产库需走正式迁移（Alembic）：
        #   ALTER TABLE tasks ADD COLUMN acceptance TEXT NOT NULL DEFAULT '';
        ("acceptance", "TEXT NOT NULL DEFAULT ''"),
    ],
}


async def init_database() -> None:
    """启动时建表（开发阶段使用 create_all，无迁移工具）+ 缺列补齐。"""
    from sqlalchemy import text

    from app.db.models import Base

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 缺列补齐仅针对 SQLite 开发库；Postgres 等生产库用正式迁移工具（Alembic）
        if engine.dialect.name != "sqlite":
            return
        for table, columns in _SQLITE_COLUMN_MIGRATIONS.items():
            rows = await conn.execute(text(f"PRAGMA table_info({table})"))
            existing = {row[1] for row in rows}
            for name, ddl in columns:
                if name not in existing:
                    await conn.execute(
                        text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
                    )


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
