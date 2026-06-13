from __future__ import annotations

from fastapi import APIRouter, Request

from app.adapters.schemas import AdapterStatus, HealthResponse
from app.core.registry import AdapterRegistry

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request) -> HealthResponse:
    registry: AdapterRegistry = request.app.state.registry
    results = await registry.health_check_all()

    adapters = []
    for name, available in results.items():
        adapter = registry.get(name)
        version = None
        if adapter and hasattr(adapter, "get_version"):
            version = adapter.get_version()
        adapters.append(AdapterStatus(name=name, available=available, version=version))

    return HealthResponse(status="ok", adapters=adapters)


@router.get("/adapters")
async def list_adapters(request: Request) -> dict:
    registry: AdapterRegistry = request.app.state.registry
    return {"adapters": registry.list_adapters()}
