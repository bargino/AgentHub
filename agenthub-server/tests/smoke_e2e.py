"""端到端冒烟测试：REST + WebSocket 完整链路。

验证：创建会话 -> WS 订阅 -> 发消息 -> 编排引擎规划 -> Mock Agent 执行
-> 流式事件 -> Diff 生成 -> 审批请求 -> 审批通过 -> 任务完成。

脚本会先把所有 Agent 的 adapterType 改为 mock（强制走 MockAdapter，
不调用真实 LLM / 不消耗 token），适合无 API Key 环境离线验证。

运行前需先启动后端：python -m uvicorn app.main:app --port 8642
"""

from __future__ import annotations

import asyncio
import json
import sys

import httpx
import websockets

BASE = "http://127.0.0.1:8642/api/v1"
WS_URL = "ws://127.0.0.1:8642/ws/session"


def ok(label: str) -> None:
    print(f"[PASS] {label}")


def fail(label: str, detail: str = "") -> None:
    print(f"[FAIL] {label} {detail}")
    sys.exit(1)


async def main() -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        # 1. 健康检查
        r = await client.get(f"{BASE}/health")
        assert r.status_code == 200, r.text
        health = r.json()
        adapter_names = [a["name"] for a in health["adapters"]]
        assert "mock" in adapter_names, f"mock adapter missing: {adapter_names}"
        ok(f"health: adapters={adapter_names}")

        # 2. Agent 列表（seed：orchestrator + 4 内置执行角色，允许额外自定义角色）
        r = await client.get(f"{BASE}/agents")
        agents = r.json()
        roles = {a["role"] for a in agents}
        expected_roles = {"orchestrator", "planner", "coder", "reviewer", "deployer"}
        assert expected_roles <= roles, f"missing seed roles: {expected_roles - roles}"
        ok(f"agents seeded: {sorted(roles)}")

        # 2.5 全部 Agent 强制走 mock 适配器（离线全链路，不调用真实 LLM）
        for a in agents:
            r = await client.patch(
                f"{BASE}/agents/{a['id']}", json={"adapterType": "mock"}
            )
            assert r.status_code == 200, f"patch agent {a['role']} failed: {r.text}"
        ok("all agents pinned to mock adapter")

        # 3. 创建会话
        r = await client.post(
            f"{BASE}/conversations", json={"title": "E2E 测试", "projectName": "demo"}
        )
        assert r.status_code == 200, r.text
        conv = r.json()
        cid = conv["id"]
        ok(f"conversation created: {cid}")

        # 4. WS 连接 + 订阅 + 发消息
        events: list[dict] = []
        approval_id: str | None = None
        diff_id: str | None = None
        task_states: dict[str, str] = {}

        async with websockets.connect(WS_URL) as ws:
            await ws.send(json.dumps({"action": "subscribe", "payload": {"conversationId": cid}}))
            await ws.send(
                json.dumps(
                    {
                        "action": "send_message",
                        "payload": {"conversationId": cid, "content": "给项目加一个暗色模式开关"},
                    }
                )
            )
            ok("ws: subscribed and message sent")

            deadline = asyncio.get_event_loop().time() + 60
            while asyncio.get_event_loop().time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    # 检查是否在等审批
                    if approval_id:
                        resolve = await client.post(
                            f"{BASE}/approvals/{approval_id}/resolve", json={"approved": True}
                        )
                        assert resolve.status_code == 200, resolve.text
                        ok(f"approval resolved via REST: {approval_id}")
                        approval_id = None
                    continue

                evt = json.loads(raw)
                etype = evt.get("type", "")
                if etype == "ping":
                    await ws.send(json.dumps({"action": "pong"}))
                    continue

                events.append(evt)
                data = evt.get("data", {})

                if etype == "task.status.changed":
                    task = data.get("task", {})
                    task_states[task.get("id", "?")] = task.get("status", "?")
                elif etype == "diff.generated":
                    diff_id = data.get("diff", {}).get("id")
                elif etype == "approval.required":
                    approval_id = data.get("approval", {}).get("id")
                    # 立即通过审批，解除 mock 阻塞
                    resolve = await client.post(
                        f"{BASE}/approvals/{approval_id}/resolve", json={"approved": True}
                    )
                    assert resolve.status_code == 200, resolve.text
                    ok(f"approval auto-approved: {approval_id}")
                    approval_id = None

                # 终止条件：编排引擎收口（会话状态回到 idle）且至少有任务被执行过
                if (
                    etype == "conversation.updated"
                    and data.get("conversation", {}).get("status") == "idle"
                    and task_states
                ):
                    break

        # 5. 验证事件流完整性
        types_seen = {e["type"] for e in events}
        for required in ("message.completed", "task.status.changed"):
            assert required in types_seen, f"missing event: {required}, saw {types_seen}"
        ok(f"event types seen: {sorted(types_seen)}")

        assert task_states, "no tasks were created"
        success_count = sum(1 for s in task_states.values() if s == "success")
        ok(f"tasks finished: {task_states} ({success_count} success)")

        # 6. REST 数据校验
        r = await client.get(f"{BASE}/conversations/{cid}/messages")
        messages = r.json()
        assert any(m["type"] == "user" for m in messages), "user message not persisted"
        assert any(m["type"] == "agent" for m in messages), "agent message not persisted"
        ok(f"messages persisted: {len(messages)}")

        r = await client.get(f"{BASE}/conversations/{cid}/tasks")
        tasks = r.json()
        assert len(tasks) == len(task_states), "task count mismatch"
        ok(f"tasks persisted: {len(tasks)}")

        if diff_id:
            r = await client.get(f"{BASE}/conversations/{cid}/diff")
            diff = r.json()
            assert diff and diff["files"], "diff not persisted"
            ok(f"diff persisted: {len(diff['files'])} files, status={diff['status']}")

        r = await client.get(f"{BASE}/conversations/{cid}/events")
        stored_events = r.json()["events"]
        assert len(stored_events) > 0, "event store empty"
        ok(f"event store: {len(stored_events)} records")

    print("\nALL SMOKE TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
