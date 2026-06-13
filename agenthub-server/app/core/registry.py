from __future__ import annotations

import importlib
import logging
from typing import Any

from app.adapters.base import ICodeAdapter

logger = logging.getLogger(__name__)


class AdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, ICodeAdapter] = {}

    def register(self, adapter: ICodeAdapter) -> None:
        self._adapters[adapter.name] = adapter
        logger.info("Registered adapter: %s", adapter.name)

    def get(self, name: str) -> ICodeAdapter | None:
        return self._adapters.get(name)

    def list_adapters(self) -> list[str]:
        return list(self._adapters.keys())

    def load_from_config(self, config: dict[str, Any]) -> None:
        adapters_cfg = config.get("adapters", {})

        for adapter_name, adapter_info in adapters_cfg.items():
            if not adapter_info.get("enabled", True):
                logger.info("Adapter %s is disabled, skipping", adapter_name)
                continue

            module_path = adapter_info.get("module", "")
            class_name = adapter_info.get("class", "")
            adapter_config = adapter_info.get("config", {})

            try:
                module = importlib.import_module(module_path)
                adapter_cls = getattr(module, class_name)
                adapter_instance = adapter_cls(config=adapter_config)
                self.register(adapter_instance)
            except Exception:
                logger.exception(
                    "Failed to load adapter %s from %s.%s",
                    adapter_name,
                    module_path,
                    class_name,
                )

    async def health_check_all(self) -> dict[str, bool]:
        results: dict[str, bool] = {}
        for name, adapter in self._adapters.items():
            try:
                results[name] = await adapter.health_check()
            except Exception:
                results[name] = False
        return results


_global_registry: AdapterRegistry | None = None


def set_global_registry(registry: AdapterRegistry) -> None:
    """lifespan 启动时注册，供编排引擎等非请求上下文访问。"""
    global _global_registry
    _global_registry = registry


def get_global_registry() -> AdapterRegistry:
    if _global_registry is None:
        raise RuntimeError("AdapterRegistry not initialized yet")
    return _global_registry
