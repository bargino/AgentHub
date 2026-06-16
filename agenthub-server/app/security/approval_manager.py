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
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.registry import AdapterRegistry

logger = logging.getLogger(__name__)


@dataclass
class PendingApproval:
    approval_id: str  # DB Approval.id
    adapter_name: str  # 适配器名（registry key）
    request_id: str  # 适配器域审批请求 ID
    conversation_id: str


class ResolveOutcome(str, Enum):
    """resolve() 结果，供调用方区分「正常解除」「无需回传」「无法解除」三类。"""

    RESOLVED = "resolved"  # 已成功把决策回传 adapter，Agent 解除阻塞
    NO_BINDING = "no_binding"  # 纯业务审批（无 adapter request_id），无需回传
    ADAPTER_UNAVAILABLE = "adapter_unavailable"  # 绑定了 adapter 但无法解除（重启/超时/已结束）


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

    async def resolve(
        self,
        approval_id: str,
        approved: bool,
        registry: AdapterRegistry,
        *,
        fallback: PendingApproval | None = None,
    ) -> ResolveOutcome:
        """回传用户决策给适配器。

        内存映射未命中时回退 DB 持久化的 fallback（进程重启后仍能定位 adapter/request），
        据此区分三种结果：纯业务审批（无绑定）/ 已解除 / 绑定存在但无法解除。
        """
        pending = self.pop(approval_id) or fallback
        if pending is None or not pending.request_id:
            # 无 adapter 绑定 = 纯业务审批（如规划期 deployer 审批），无需回传
            return ResolveOutcome.NO_BINDING
        adapter = registry.get(pending.adapter_name) if pending.adapter_name else None
        if not adapter:
            logger.warning(
                "Adapter %s unavailable for approval %s", pending.adapter_name, approval_id
            )
            return ResolveOutcome.ADAPTER_UNAVAILABLE
        ok = await adapter.resolve_approval(pending.request_id, approved)
        logger.info(
            "Approval %s -> adapter=%s request=%s approved=%s ok=%s",
            approval_id, pending.adapter_name, pending.request_id, approved, ok,
        )
        # adapter 返回 False = 在途审批请求已不在（重启/超时/已结束），无法真正解除
        return ResolveOutcome.RESOLVED if ok else ResolveOutcome.ADAPTER_UNAVAILABLE


_coordinator: ApprovalCoordinator | None = None


def get_approval_coordinator() -> ApprovalCoordinator:
    global _coordinator
    if _coordinator is None:
        _coordinator = ApprovalCoordinator()
    return _coordinator
