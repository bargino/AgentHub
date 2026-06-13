"""审批流协调器。

连接两个域的审批：
- 业务域：DB Approval 记录（用户在前端看到并决策）
- 适配器域：adapter.resolve_approval(request_id, approved)（解除 Agent 执行阻塞）

编排引擎在收到 adapter 的 approval_request 事件时调用 register()，
用户决策后调用 resolve() 一次性完成 DB 更新 + 适配器回传。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class PendingApproval:
    approval_id: str  # DB Approval.id
    adapter_name: str  # 适配器名（registry key）
    request_id: str  # 适配器域审批请求 ID
    conversation_id: str


class ApprovalCoordinator:
    def __init__(self) -> None:
        # approval_id -> PendingApproval
        self._pending: dict[str, PendingApproval] = {}

    def register(
        self,
        *,
        approval_id: str,
        adapter_name: str,
        request_id: str,
        conversation_id: str,
    ) -> None:
        self._pending[approval_id] = PendingApproval(
            approval_id=approval_id,
            adapter_name=adapter_name,
            request_id=request_id,
            conversation_id=conversation_id,
        )

    def get(self, approval_id: str) -> PendingApproval | None:
        return self._pending.get(approval_id)

    def pop(self, approval_id: str) -> PendingApproval | None:
        return self._pending.pop(approval_id, None)

    async def resolve(self, approval_id: str, approved: bool, registry) -> bool:
        """回传用户决策给适配器。registry: AdapterRegistry。"""
        pending = self.pop(approval_id)
        if not pending:
            logger.warning("Approval %s not found in coordinator", approval_id)
            return False
        adapter = registry.get(pending.adapter_name)
        if not adapter:
            logger.warning("Adapter %s not found for approval %s", pending.adapter_name, approval_id)
            return False
        ok = await adapter.resolve_approval(pending.request_id, approved)
        logger.info(
            "Approval %s -> adapter=%s request=%s approved=%s ok=%s",
            approval_id, pending.adapter_name, pending.request_id, approved, ok,
        )
        return ok


_coordinator: ApprovalCoordinator | None = None


def get_approval_coordinator() -> ApprovalCoordinator:
    global _coordinator
    if _coordinator is None:
        _coordinator = ApprovalCoordinator()
    return _coordinator
