"""会话级运行句柄注册表：支持外部停止正在执行的编排任务。

ws 层 spawn 编排任务时按 conversation_id 注册 asyncio.Task；
REST /conversations/{id}/stop 通过 cancel() 注入取消。
同会话新任务覆盖旧句柄（用户连发场景下旧轮已结束或被新轮取代）。
"""

from __future__ import annotations

import asyncio

_running: dict[str, asyncio.Task] = {}


def register(conversation_id: str, task: asyncio.Task) -> None:
    _running[conversation_id] = task

    def _cleanup(t: asyncio.Task) -> None:
        if _running.get(conversation_id) is t:
            _running.pop(conversation_id, None)

    task.add_done_callback(_cleanup)


def cancel(conversation_id: str) -> bool:
    """取消会话当前运行任务；无运行任务或已结束返回 False。"""
    task = _running.get(conversation_id)
    if task is None or task.done():
        return False
    task.cancel()
    return True


def is_running(conversation_id: str) -> bool:
    task = _running.get(conversation_id)
    return task is not None and not task.done()
