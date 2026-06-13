"""业务服务层。

每个 service 为模块级 async 函数集合：接收 AsyncSession（事务由调用方管理），
返回 Pydantic Out 模型；需要广播实时事件的函数内部走 EventBus。
"""

from __future__ import annotations

from app.services import approval, conversation, diff, event_store, message, task

__all__ = [
    "approval",
    "conversation",
    "diff",
    "event_store",
    "message",
    "task",
]
