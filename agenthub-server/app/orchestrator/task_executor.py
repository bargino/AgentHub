"""任务 DAG 执行器（PRD §6.1 / §7.4 Agent Gateway）。

拓扑调度 + 并行执行就绪任务；消费适配器 UnifiedEvent 流，
转换为业务域写入（消息 / Diff / 审批 / 事件存储），经 EventBus 实时推送前端。
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.base import UnifiedEvent, UnifiedSandboxLevel
from app.core.event_bus import get_event_bus
from app.core.registry import get_global_registry
from app.db.engine import get_session_factory
from app.memory import task_memory, token_meter
from app.orchestrator.agent_router import resolve_adapter
from app.orchestrator.context_builder import build_context
from app.orchestrator.task_planner import PlannedTask, TaskPlan
from app.schemas import WSEvent
from app.security.approval_manager import get_approval_coordinator
from app.services import agent_session as agent_session_service
from app.services import approval as approval_service
from app.services import diff as diff_service
from app.services import event_store
from app.services import message as message_service
from app.services import task as task_service

logger = logging.getLogger(__name__)

# 全局并发限流：同时活跃的 adapter 执行数上限（防 SDK 子进程爆 / 资源耗尽）
_MAX_CONCURRENT_AGENTS = max(1, int(os.environ.get("AGENTHUB_MAX_CONCURRENT_AGENTS") or "4"))
_agent_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_AGENTS)
# 单任务执行总超时（秒）；0 = 不限（默认，避免误杀正常长任务）。>0 时超时 interrupt 回收
_AGENT_TIMEOUT_S = float(os.environ.get("AGENTHUB_AGENT_TIMEOUT_S") or "0")


async def _get_role_labels() -> dict[str, str]:
    """从 DB 动态获取 role->name 映射，回退到默认值。"""
    try:
        from sqlalchemy import select
        from app.db.models import AgentRecord
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(select(AgentRecord.role, AgentRecord.name))
            labels = {row[0]: row[1] for row in result.all()}
            return labels if labels else _DEFAULT_ROLE_LABELS
    except Exception:
        return _DEFAULT_ROLE_LABELS


_DEFAULT_ROLE_LABELS: dict[str, str] = {
    "planner": "Planner",
    "coder": "Coder",
    "reviewer": "Reviewer",
    "deployer": "Deployer",
}

_cached_role_labels: dict[str, str] | None = None


@dataclass
class ExecutionState:
    conversation_id: str
    project_name: str
    workspace_path: str
    user_instructions: str
    # planned task id -> DB task id
    id_map: dict[str, str]
    # 群聊成员（AgentRecord.id）；空 = 全员
    member_agent_ids: list[str] = field(default_factory=list)
    # 群规则（注入任务指令）与会话级技能覆盖（"all" | [技能名] | "off" | None）
    conv_rules: str = ""
    conv_skills: Any = None
    # 会话级 workspace 写锁：写型任务串行，避免并行 coder 互相覆盖同一文件；
    # 只读任务（planner/reviewer）不持锁，仍并行
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def _session_factory() -> async_sessionmaker[AsyncSession]:
    return get_session_factory()


async def _publish_delta(
    conversation_id: str, message_id: str, content: str, agent_role: str,
    role_labels: dict[str, str] | None = None,
    kind: str = "answer",
) -> None:
    """流式增量直接走 EventBus（不落库，最终全文由 message.completed 落库）。

    kind: answer=正文 / thinking=思考过程，前端分轨渲染。
    """
    labels = role_labels or _DEFAULT_ROLE_LABELS
    await get_event_bus().publish(
        WSEvent(
            type="message.delta",
            conversation_id=conversation_id,
            data={
                "messageId": message_id,
                "content": content,
                "agentRole": agent_role,
                "agentName": labels.get(agent_role, agent_role.capitalize()),
                "kind": kind,
            },
        )
    )


class TaskRunner:
    """单任务执行：路由适配器 -> 构建上下文 -> 消费事件流 -> 业务域转换。"""

    def __init__(self, state: ExecutionState, planned: PlannedTask, role_labels: dict[str, str] | None = None):
        self.state = state
        self.planned = planned
        self.db_task_id = state.id_map[planned.id]
        self.agent_role = planned.agent
        self.role_labels = role_labels or _DEFAULT_ROLE_LABELS
        self.message_id = uuid.uuid4().hex
        self.text_parts: list[str] = []
        # 思考通道：独立累积 + 独立消息 id，遇到正文/工具时收口落库（支持多段思考）
        self.thinking_parts: list[str] = []
        self.thinking_message_id = uuid.uuid4().hex
        self.thinking_started: float | None = None
        # 字符级流式（codex delta）用 "" 拼接；消息级整块（claude）用换行拼接
        self.delta_mode = False
        # 适配器工具调用 id（tool_id/item_id/tool_use_id）-> 已落库消息 id，
        # 用于工具完成事件回写同一条消息的状态，而不是另落新卡片
        self.tool_msg_ids: dict[str, str] = {}
        # 仍处于 running 的工具消息 id 集合（终态统一收口兜底）
        self.running_tool_msgs: set[str] = set()
        # 可 resume 的 SDK session id：claude 取 completed.session_id，
        # codex 取 started.thread_id（completed 不带），任务成功后入表
        self.sdk_session_id: str | None = None
        # run() 路由适配器后回填；早期失败（路由/建上下文阶段）时保持空串
        self.adapter_name: str = ""

    async def run(self) -> bool:
        """返回任务是否成功。"""
        cid = self.state.conversation_id
        factory = _session_factory()

        async with factory() as session:
            async with session.begin():
                await task_service.update_task_status(session, self.db_task_id, "running")
                adapter, adapter_name = await resolve_adapter(
                    session, get_global_registry(), self.agent_role,
                    member_ids=self.state.member_agent_ids,
                )
                upstream_db_ids = [
                    self.state.id_map[dep]
                    for dep in self.planned.depends_on
                    if dep in self.state.id_map
                ]
                upstream = await task_memory.get_upstream_results(session, cid, upstream_db_ids)
                ctx = await build_context(
                    session,
                    conversation_id=cid,
                    project_name=self.state.project_name,
                    workspace_path=self.state.workspace_path,
                    task=self.planned,
                    user_instructions=self.state.user_instructions,
                    upstream_results=upstream,
                    member_ids=self.state.member_agent_ids,
                    conv_rules=self.state.conv_rules,
                    conv_skills=self.state.conv_skills,
                    adapter_name=adapter_name,
                )

        self.adapter_name = adapter_name
        # 写型任务（非只读沙箱）串行持锁：会话级单 workspace 下避免并行写覆盖；
        # 只读任务不持锁，保留并行收益
        if ctx.sandbox_level == UnifiedSandboxLevel.READ_ONLY:
            return await self._consume(adapter, ctx)
        async with self.state.write_lock:
            return await self._consume(adapter, ctx)

    async def _consume(self, adapter: Any, ctx: Any) -> bool:
        """消费适配器事件流（全局并发限流 + 可选总超时），返回任务是否成功。"""
        try:
            async with _agent_semaphore:
                if _AGENT_TIMEOUT_S > 0:
                    return await asyncio.wait_for(
                        self._drain(adapter, ctx), timeout=_AGENT_TIMEOUT_S
                    )
                return await self._drain(adapter, ctx)
        except asyncio.TimeoutError:
            logger.warning("Task %s timed out after %ss", self.db_task_id, _AGENT_TIMEOUT_S)
            try:
                await adapter.interrupt()
            except Exception:
                logger.debug("interrupt after timeout failed", exc_info=True)
            await self._fail(f"执行超时（>{_AGENT_TIMEOUT_S}s）")
            return False
        except Exception as e:
            logger.exception("Task %s execution crashed", self.db_task_id)
            await self._fail(f"执行异常：{e}")
            return False

    async def _drain(self, adapter: Any, ctx: Any) -> bool:
        """逐个消费事件流，返回是否成功。"""
        success = False
        async for event in adapter.execute(ctx):
            done = await self._handle_event(event)
            if done is not None:
                success = done
        return success

    async def _handle_event(self, event: UnifiedEvent) -> bool | None:
        """转换单个适配器事件。返回 None=继续，True/False=终态。"""
        cid = self.state.conversation_id
        factory = _session_factory()

        # 全量事件入 EventStore（独立短事务，失败不阻断主流程）
        try:
            async with factory() as session:
                async with session.begin():
                    await event_store.record_event(
                        session, cid, event.type, event.data,
                        task_id=self.db_task_id, agent_role=self.agent_role,
                    )
        except Exception:
            logger.warning("Event store write failed", exc_info=True)

        if event.type == "started":
            # codex thread_id 在 started 事件携带（completed 不带），缓存供 resume 入表
            thread_id = event.data.get("thread_id")
            if thread_id:
                self.sdk_session_id = str(thread_id)
            return None

        if event.type == "thinking":
            text = str(event.data.get("text", ""))
            if text:
                if self.thinking_started is None:
                    self.thinking_started = asyncio.get_event_loop().time()
                if event.data.get("is_delta"):
                    self.delta_mode = True
                self.thinking_parts.append(text)
                joined = self._join(self.thinking_parts)
                await _publish_delta(
                    cid, self.thinking_message_id, joined, self.agent_role,
                    self.role_labels, kind="thinking",
                )
            return None

        if event.type == "text_delta":
            # 正文到达 = 当前思考段结束，先收口思考再推正文
            await self._flush_thinking()
            text = str(event.data.get("text", ""))
            if text:
                if event.data.get("is_delta"):
                    self.delta_mode = True
                self.text_parts.append(text)
                joined = self._join(self.text_parts)
                await _publish_delta(
                    cid, self.message_id, joined, self.agent_role,
                    self.role_labels, kind="answer",
                )
            return None

        if event.type == "tool_call":
            await self._flush_thinking()
            status = str(event.data.get("status", "") or "running")
            tool_key = str(event.data.get("tool_id") or event.data.get("item_id") or "")
            tool_name = str(event.data.get("tool_name", "tool"))

            # 命令执行元数据（codex 提供 exit_code/duration_ms/cwd）
            tool_meta: dict[str, Any] = {}
            if event.data.get("exit_code") is not None:
                tool_meta["exitCode"] = event.data["exit_code"]
            if event.data.get("duration_ms") is not None:
                tool_meta["durationMs"] = event.data["duration_ms"]
            if event.data.get("cwd"):
                tool_meta["cwd"] = str(event.data["cwd"])

            # 完成阶段（codex item/completed）：回写同一条 running 卡片，而非另落新卡
            if status in ("success", "failed") and tool_key in self.tool_msg_ids:
                msg_id = self.tool_msg_ids.pop(tool_key)
                output = str(event.data.get("output", "") or "")
                async with factory() as session:
                    async with session.begin():
                        await message_service.update_tool_message(
                            session, msg_id, tool_status=status,
                            content_append=output, meta=tool_meta or None,
                        )
                self.running_tool_msgs.discard(msg_id)
                return None

            tool_status = status if status in ("success", "failed") else "running"
            async with factory() as session:
                async with session.begin():
                    out = await message_service.append_message(
                        session, cid,
                        type="tool",
                        content=str(event.data.get("tool_input", ""))[:500],
                        agent_role=self.agent_role,
                        agent_name=self.role_labels.get(self.agent_role, self.agent_role.capitalize()),
                        task_id=self.db_task_id,
                        tool_name=tool_name,
                        tool_status=tool_status,
                        meta=tool_meta or None,
                    )
            if tool_status == "running":
                if tool_key:
                    self.tool_msg_ids[tool_key] = out.id
                self.running_tool_msgs.add(out.id)
            return None

        if event.type == "file_change":
            # claude-code 工具结果（ToolResultBlock）：按 tool_use_id 回写工具卡片状态；
            # codex 的 fileChange item 不在映射中，保持仅事件存储
            tool_use_id = str(event.data.get("tool_use_id", "") or "")
            if tool_use_id and tool_use_id in self.tool_msg_ids:
                msg_id = self.tool_msg_ids.pop(tool_use_id)
                is_error = bool(event.data.get("is_error"))
                async with factory() as session:
                    async with session.begin():
                        await message_service.update_tool_message(
                            session, msg_id,
                            tool_status="failed" if is_error else "success",
                        )
                self.running_tool_msgs.discard(msg_id)
            return None

        if event.type == "diff_update":
            files = event.data.get("files") or []
            summary = str(event.data.get("summary", "代码变更"))
            async with factory() as session:
                async with session.begin():
                    await diff_service.create_diff(
                        session, cid,
                        summary=summary, files=files,
                        task_id=self.db_task_id, agent_role=self.agent_role,
                    )
            return None

        if event.type == "approval_request":
            request_id = str(event.data.get("request_id", ""))
            async with factory() as session:
                async with session.begin():
                    await task_service.update_task_status(
                        session, self.db_task_id, "waiting_approval"
                    )
                    approval = await approval_service.create_approval(
                        session, cid,
                        action_type=str(event.data.get("action_type", "run_command")),
                        summary=str(event.data.get("summary", "")),
                        risk_level=event.risk_level or "medium",
                        task_id=self.db_task_id,
                        request_id=request_id,
                        agent_role=self.agent_role,
                        agent_name=self.role_labels.get(
                            self.agent_role, self.agent_role.capitalize()
                        ),
                    )
            get_approval_coordinator().register(
                approval_id=approval.id,
                adapter_name=self.adapter_name,
                request_id=request_id,
                conversation_id=cid,
            )
            return None

        if event.type == "approval_resolved":
            async with factory() as session:
                async with session.begin():
                    await task_service.update_task_status(session, self.db_task_id, "running")
            return None

        if event.type == "completed":
            # 终态兜底：思考段与仍在 running 的工具卡片统一收口
            await self._flush_thinking()
            await self._finalize_running_tools("success")
            result_text = str(event.data.get("result", "")) or self._join(self.text_parts)
            cancelled = bool(event.data.get("cancelled") or event.data.get("interrupted"))
            full_text = self._join(self.text_parts) if self.text_parts else result_text
            # 真实 token 计量落库（压力分级 / 成本统计数据源）
            usage = token_meter.normalize_usage(event.data.get("usage"))
            msg_meta: dict[str, Any] = {"tokenUsage": usage} if usage else {}
            # claude session_id 在 completed 事件携带；codex 已在 started 缓存
            sdk_session_id = event.data.get("session_id") or self.sdk_session_id
            async with factory() as session:
                async with session.begin():
                    if full_text:
                        await message_service.append_message(
                            session, cid,
                            type="agent",
                            content=full_text,
                            agent_role=self.agent_role,
                            agent_name=self.role_labels.get(self.agent_role, self.agent_role.capitalize()),
                            task_id=self.db_task_id,
                            message_id=self.message_id,
                            meta=msg_meta or None,
                        )
                    await task_service.update_task_status(
                        session, self.db_task_id,
                        "cancelled" if cancelled else "success",
                        result=result_text[:2000],
                    )
                    # SDK session 延续映射：成功且非取消时入表，供同角色后续任务 resume
                    if sdk_session_id and not cancelled:
                        await agent_session_service.upsert_agent_session(
                            session, cid, self.agent_role, self.adapter_name,
                            str(sdk_session_id),
                        )
            return not cancelled

        if event.type == "error":
            await self._fail(str(event.data.get("error", "未知错误")))
            return False

        # started / file_change 等：仅事件存储，无业务转换
        return None

    def _join(self, parts: list[str]) -> str:
        """codex 字符级 delta 直接拼接；claude 消息级整块用换行分隔。"""
        return "".join(parts) if self.delta_mode else "\n".join(parts)

    async def _flush_thinking(self) -> None:
        """思考段收口：落库为独立 thinking 消息（前端自动折叠），并重置累积器。"""
        if not self.thinking_parts:
            return
        content = self._join(self.thinking_parts)
        meta: dict[str, Any] = {}
        if self.thinking_started is not None:
            elapsed = asyncio.get_event_loop().time() - self.thinking_started
            meta["thinkingMs"] = int(elapsed * 1000)
        self.thinking_parts = []
        self.thinking_started = None
        msg_id = self.thinking_message_id
        # 下一段思考用新 id（思考→工具→再思考各自成卡）
        self.thinking_message_id = uuid.uuid4().hex
        try:
            factory = _session_factory()
            async with factory() as session:
                async with session.begin():
                    await message_service.append_message(
                        session, self.state.conversation_id,
                        type="thinking",
                        content=content[:6000],
                        agent_role=self.agent_role,
                        agent_name=self.role_labels.get(self.agent_role, self.agent_role.capitalize()),
                        task_id=self.db_task_id,
                        message_id=msg_id,
                        meta=meta or None,
                    )
        except Exception:
            logger.warning("Flush thinking message failed", exc_info=True)

    async def _finalize_running_tools(self, status: str) -> None:
        """把仍处于 running 的工具消息统一更新为终态（成功收口/失败标记）。"""
        if not self.running_tool_msgs:
            return
        factory = _session_factory()
        try:
            async with factory() as session:
                async with session.begin():
                    for msg_id in list(self.running_tool_msgs):
                        await message_service.update_tool_message(
                            session, msg_id, tool_status=status
                        )
        except Exception:
            logger.warning("Finalize running tools failed", exc_info=True)
        self.running_tool_msgs.clear()
        self.tool_msg_ids.clear()

    async def _fail(self, reason: str) -> None:
        cid = self.state.conversation_id
        await self._flush_thinking()
        await self._finalize_running_tools("failed")
        factory = _session_factory()
        async with factory() as session:
            async with session.begin():
                await message_service.append_message(
                    session, cid,
                    type="error",
                    content=f"[{self.role_labels.get(self.agent_role, self.agent_role.capitalize())}] {reason}",
                    agent_role=self.agent_role,
                    task_id=self.db_task_id,
                )
                await task_service.update_task_status(
                    session, self.db_task_id, "failed", result=reason[:2000]
                )
                # 失败收口：清除 session 映射，下次该角色冷启动（防坏 session 反复 resume）
                if self.adapter_name:
                    await agent_session_service.clear_agent_session(
                        session, cid, self.agent_role, self.adapter_name
                    )


async def execute_plan(state: ExecutionState, plan: TaskPlan) -> tuple[int, int]:
    """拓扑调度：就绪任务并行执行；依赖失败的任务级联取消。

    返回 (成功数, 失败/取消数)。
    """
    role_labels = await _get_role_labels()
    # 断点续跑：已 success 的任务跳过（重试失败上游后再次编排时不重跑已完成的；
    # 失败/取消的下游不在 completed，会重新进入调度，上游修复后自动续跑）
    completed: set[str] = set()
    factory = _session_factory()
    async with factory() as session:
        for planned in plan.tasks:
            db_id = state.id_map.get(planned.id)
            if not db_id:
                continue
            existing = await task_service.get_task(session, db_id)
            if existing and existing.status == "success":
                completed.add(planned.id)
    pending: dict[str, PlannedTask] = {
        t.id: t for t in plan.tasks if t.id not in completed
    }
    failed: set[str] = set()

    while pending:
        ready = [
            t for t in pending.values()
            if all(dep in completed for dep in t.depends_on)
        ]
        # 依赖已失败 -> 级联取消
        doomed = [
            t for t in pending.values()
            if any(dep in failed for dep in t.depends_on)
        ]
        for t in doomed:
            del pending[t.id]
            failed.add(t.id)
            factory = _session_factory()
            async with factory() as session:
                async with session.begin():
                    await task_service.update_task_status(
                        session, state.id_map[t.id], "cancelled", result="上游任务失败，已取消"
                    )

        if not ready:
            if not doomed:
                # 调度异常兜底（A6）：无就绪任务、也无新增级联失败，但仍有 pending
                # 残留（id_map 缺键 / DB 写失败等异常路径，正常 DAG 校验后不达）。
                # 统一置 cancelled 并计入失败，杜绝"幽灵 pending"永久挂起拖死会话。
                stranded = list(pending.values())
                for t in stranded:
                    failed.add(t.id)
                    db_id = state.id_map.get(t.id)
                    if not db_id:
                        continue
                    factory = _session_factory()
                    async with factory() as session:
                        async with session.begin():
                            await task_service.update_task_status(
                                session, db_id, "cancelled",
                                result="调度异常终止：无就绪任务可推进",
                            )
                logger.error(
                    "execute_plan 调度异常：%d 个任务无法推进，已置 cancelled",
                    len(stranded),
                )
                pending.clear()
                break
            continue

        for t in ready:
            del pending[t.id]

        runners = [TaskRunner(state, t, role_labels) for t in ready]
        results = await asyncio.gather(*(r.run() for r in runners), return_exceptions=True)
        for t, ok in zip(ready, results):
            if isinstance(ok, Exception):
                logger.error("Task runner crashed: %s", ok)
                failed.add(t.id)
            elif ok:
                completed.add(t.id)
            else:
                failed.add(t.id)

    return len(completed), len(failed)
