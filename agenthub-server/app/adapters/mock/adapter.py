"""Mock 适配器：无 API Key 环境下的全链路演示与冒烟执行器。

不调用任何外部 LLM / SDK，按固定节奏流式产出
started -> thinking -> tool_call -> diff_update -> approval_request -> completed
事件序列，驱动编排引擎、EventBus、Diff、审批的完整链路。

路由策略见 agent_router.ADAPTER_PRIORITY：mock 位于末位，
仅在 claude-code / codex 均不可用（或 DB 显式指定 adapter_type=mock）时被选中。
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, AsyncIterator, Optional

from app.adapters.base import (
    AdapterContext,
    ICodeAdapter,
    UnifiedApprovalMode,
    UnifiedEvent,
    UnifiedSandboxLevel,
)


class MockAdapter(ICodeAdapter):
    def __init__(self, config: dict[str, Any] | None = None) -> None:
        cfg = config or {}
        # 审批等待超时（秒），超时按拒绝处理（对齐 codex adapter 的 approval_timeout_s 语义）
        self._approval_timeout_s = float(cfg.get("approval_timeout_s", 120))
        # 事件之间的模拟流式间隔（秒）
        self._step_delay_s = float(cfg.get("step_delay_s", 0.05))
        # request_id -> 审批决策 Future
        self._pending: dict[str, asyncio.Future[bool]] = {}
        self._interrupted = False

    @property
    def name(self) -> str:
        return "mock"

    async def health_check(self) -> bool:
        return True

    def get_version(self) -> Optional[str]:
        return "builtin"

    async def execute(self, ctx: AdapterContext) -> AsyncIterator[UnifiedEvent]:
        self._interrupted = False
        delay = self._step_delay_s

        yield self._evt("started", {"instructions": ctx.instructions[:200]})
        await asyncio.sleep(delay)

        for part in ("正在分析任务需求…", "已定位相关模块，准备执行。"):
            if self._interrupted:
                yield self._evt("completed", {"result": "已中断", "cancelled": True})
                return
            yield self._evt("thinking", {"text": part, "is_delta": True})
            await asyncio.sleep(delay)

        yield self._evt(
            "tool_call",
            {"tool_name": "Read", "tool_input": ctx.workspace_path, "status": "success"},
        )
        await asyncio.sleep(delay)

        if ctx.sandbox_level != UnifiedSandboxLevel.READ_ONLY:
            yield self._evt(
                "diff_update",
                {
                    "summary": "Mock 演示变更",
                    "files": [
                        {
                            "filename": "demo/mock_change.txt",
                            "additions": 1,
                            "deletions": 0,
                            "oldContent": "",
                            "newContent": "mock change\n",
                        }
                    ],
                },
            )
            await asyncio.sleep(delay)

            if ctx.approval_mode == UnifiedApprovalMode.REVIEW_EDITS:
                request_id = uuid.uuid4().hex
                fut: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
                self._pending[request_id] = fut
                yield self._evt(
                    "approval_request",
                    {
                        "request_id": request_id,
                        "action_type": "apply_edits",
                        "summary": "应用 Mock 演示变更",
                    },
                    risk="medium",
                )
                try:
                    approved = await asyncio.wait_for(fut, timeout=self._approval_timeout_s)
                except asyncio.TimeoutError:
                    approved = False
                finally:
                    self._pending.pop(request_id, None)
                yield self._evt(
                    "approval_resolved",
                    {"request_id": request_id, "approved": approved},
                )
                await asyncio.sleep(delay)
                if not approved:
                    yield self._evt("completed", {"result": "审批被拒绝，未应用变更。"})
                    return

        if self._interrupted:
            yield self._evt("completed", {"result": "已中断", "cancelled": True})
            return

        yield self._evt("completed", {"result": "Mock 执行完成：任务已按演示流程处理。"})

    async def resolve_approval(self, request_id: str, approved: bool) -> bool:
        fut = self._pending.get(request_id)
        if fut is None or fut.done():
            return False
        fut.set_result(approved)
        return True

    async def interrupt(self) -> bool:
        self._interrupted = True
        for fut in self._pending.values():
            if not fut.done():
                fut.set_result(False)
        return True

    def _evt(self, etype: Any, data: dict[str, Any], risk: str = "low") -> UnifiedEvent:
        return UnifiedEvent(type=etype, data=data, adapter=self.name, risk_level=risk)
