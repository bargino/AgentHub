from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.agents import router as agents_router
from app.api.v1.approvals import router as approvals_router
from app.api.v1.conversations import router as conversations_router
from app.api.v1.deploy import router as deploy_router
from app.api.v1.diffs import router as diffs_router
from app.api.v1.events import router as events_router
from app.api.v1.health import router as health_router
from app.api.v1.preview import router as preview_router
from app.api.v1.tasks import router as tasks_router
from app.api.ws.session import router as ws_router
from app.config import get_settings, load_adapters_config
from app.core.message_handler import set_message_handler
from app.core.registry import AdapterRegistry, set_global_registry
from app.core.startup import recover_interrupted_state
from app.db.engine import dispose_engine, init_database
from app.orchestrator.engine import OrchestratorEngine
from app.services.preview import get_preview_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. 数据库建表
    await init_database()

    # 1.5 启动自愈：清理上次崩溃 / 重启残留的卡死任务与会话（不阻断启动）
    try:
        await recover_interrupted_state()
    except Exception:
        logger.warning("启动自愈失败（已跳过，不阻断启动）", exc_info=True)

    # 2. 适配器注册表
    adapters_cfg = load_adapters_config()
    registry = AdapterRegistry()
    registry.load_from_config(adapters_cfg)
    app.state.registry = registry
    set_global_registry(registry)

    # 3. 编排引擎接管用户消息（替换默认 EchoMessageHandler）
    set_message_handler(OrchestratorEngine())
    logger.info("AgentHub server started: adapters=%s", registry.list_adapters())

    yield

    # 4. 清理：停止全部 dev server 子进程 + 关闭数据库
    await get_preview_manager().stop_all()
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(
        title="AgentHub Server",
        version="0.2.0",
        description="IM-style multi-agent development collaboration platform",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api_routers = [
        health_router,
        conversations_router,
        diffs_router,
        approvals_router,
        tasks_router,
        agents_router,
        preview_router,
        deploy_router,
        events_router,
    ]
    for router in api_routers:
        app.include_router(router, prefix="/api/v1")
    app.include_router(ws_router, tags=["websocket"])

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
