"""Diff 业务服务（代码变更与审批状态）。

模块级 async 函数：接收 AsyncSession（事务由调用方管理），返回 Pydantic Out 模型。
"""

from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import get_event_bus
from app.db.models import DiffRecord
from app.schemas import DiffFileOut, DiffOut, WSEvent
from app.security.permission_manager import is_path_inside_workspace

_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@")


def _to_out(record: DiffRecord) -> DiffOut:
    return DiffOut(
        id=record.id,
        conversation_id=record.conversation_id,
        task_id=record.task_id,
        # DiffOut.agent_id 对应模型的 agent_role 列
        agent_id=record.agent_role,
        summary=record.summary,
        files=[DiffFileOut.model_validate(f) for f in (record.files or [])],
        status=record.status,
    )


def _git_path_from_header(line: str) -> str:
    """`diff --git a/x b/x` -> 文件路径（取 b/ 侧；缺则取 a/ 侧）。"""
    parts = line.split()
    # parts: ["diff", "--git", "a/x", "b/x"]
    cand = parts[3] if len(parts) >= 4 else (parts[2] if len(parts) >= 3 else "")
    for prefix in ("a/", "b/"):
        if cand.startswith(prefix):
            return cand[len(prefix):]
    return cand


def _rebuild_from_body(body: str) -> tuple[str, str, int, int]:
    """unified diff 体 -> (oldContent, newContent, additions, deletions)。
    跳过文件/hunk 头，按 +/-/' ' 重建（hunk 外内容无法还原，与
    notification_converter._parse_unified_diff 同口径）。"""
    old_lines: list[str] = []
    new_lines: list[str] = []
    additions = deletions = 0
    for line in body.splitlines():
        if line.startswith(("diff --git", "index ", "@@", "+++ ", "--- ")):
            continue
        if line.startswith("+"):
            new_lines.append(line[1:])
            additions += 1
        elif line.startswith("-"):
            old_lines.append(line[1:])
            deletions += 1
        elif line.startswith(" "):
            old_lines.append(line[1:])
            new_lines.append(line[1:])
        else:
            old_lines.append(line)
            new_lines.append(line)
    return "\n".join(old_lines), "\n".join(new_lines), additions, deletions


def _split_diff_by_file(diff_text: str) -> list[tuple[str, str]]:
    """把可能含多个文件段的 unified diff 按 `diff --git` 边界拆为 [(path, body)]。
    无 `diff --git` 头（如本仓库 claude/codex 单文件 change）则返回单段、path 留空交调用方补。"""
    lines = diff_text.splitlines()
    segments: list[tuple[str, list[str]]] = []
    for line in lines:
        if line.startswith("diff --git "):
            segments.append((_git_path_from_header(line), [line]))
        elif segments:
            segments[-1][1].append(line)
        else:
            segments.append(("", [line]))
    return [(path, "\n".join(body)) for path, body in segments]


def _apply_unified_hunks(old_text: str, diff_body: str) -> str | None:
    """把 unified diff 的 hunk 应用到完整旧文件上，还原出完整新文件（含 hunk 外上下文）。

    严格校验：上下文/删除行必须与旧文件逐行匹配；任何不一致（行号偏移 / 文件已变）则返回
    None，由调用方回退到仅 hunk 重建，不冒险生成错误的完整内容。仅适用于预览展示。
    """
    old_lines = old_text.split("\n")
    lines = diff_body.splitlines()
    result: list[str] = []
    idx = 0  # 0-based 指针，指向尚未消费的旧行
    i = 0
    saw_hunk = False
    while i < len(lines):
        m = _HUNK_RE.match(lines[i])
        if not m:
            i += 1
            continue
        saw_hunk = True
        start0 = int(m.group(1)) - 1
        if start0 < idx or start0 > len(old_lines):
            return None
        result.extend(old_lines[idx:start0])
        idx = start0
        i += 1
        while i < len(lines):
            hl = lines[i]
            if _HUNK_RE.match(hl) or hl.startswith("diff --git"):
                break
            if hl.startswith("\\"):  # "\ No newline at end of file"
                i += 1
                continue
            if hl.startswith("-"):
                if idx >= len(old_lines) or old_lines[idx] != hl[1:]:
                    return None
                idx += 1
            elif hl.startswith("+"):
                result.append(hl[1:])
            elif hl.startswith(" "):
                if idx >= len(old_lines) or old_lines[idx] != hl[1:]:
                    return None
                result.append(hl[1:])
                idx += 1
            else:
                return None
            i += 1
    if not saw_hunk:
        return None
    result.extend(old_lines[idx:])
    return "\n".join(result)


def _full_contents(
    workspace_path: str, filename: str, diff_body: str
) -> tuple[str, str] | None:
    """读 workspace 真实文件还原「完整文件」的 old/new（审查界面能看到变更周围上下文）。

    codex/claude 均为「应用前闸门」（PreToolUse / applyPatch 审批），故创建 diff 时磁盘上是
    旧版本：oldContent = 磁盘现文；newContent = 把变更应用到旧文。无法可靠还原时返回 None。
    """
    if not filename:
        return None
    abspath = Path(workspace_path) / filename
    if not is_path_inside_workspace(abspath, workspace_path):
        return None
    try:
        old_full = (
            abspath.read_text(encoding="utf-8", errors="replace")
            if abspath.is_file()
            else ""
        )
    except OSError:
        return None

    if "@@" in diff_body:
        new_full = _apply_unified_hunks(old_full, diff_body)
        return (old_full, new_full) if new_full is not None else None

    # claude 简易 -/+ 体（无 @@ 行号锚点）：去一块旧文本换成新文本
    removed = [
        ln[1:] for ln in diff_body.splitlines()
        if ln.startswith("-") and not ln.startswith("--")
    ]
    added = [
        ln[1:] for ln in diff_body.splitlines()
        if ln.startswith("+") and not ln.startswith("++")
    ]
    old_block = "\n".join(removed)
    new_block = "\n".join(added)
    if not old_block:
        # Write / 新文件：整文覆写
        return old_full, new_block
    if old_block in old_full:
        return old_full, old_full.replace(old_block, new_block, 1)
    return None


def build_files_from_changes(
    changes: list[dict], workspace_path: str | None = None
) -> list[dict]:
    """codex apply_diff 审批的 changes（[{path, kind, diff, additions, deletions}]）
    转为 DiffFileOut dict（filename/additions/deletions/oldContent/newContent），供审查
    界面 side-by-side 展示。

    - 单 change.diff 含多个 `diff --git` 文件段时拆成多个文件条目（避免多文件被压成一个）。
    - 传入 workspace_path 时读真实文件还原完整 old/new（带上下文）；还原失败则回退为仅
      hunk 重建。不传 workspace_path 时与原行为一致。
    """
    files: list[dict] = []
    for change in changes or []:
        path = str(change.get("path", "") or "")
        diff_text = str(change.get("diff", "") or "")
        segments = _split_diff_by_file(diff_text)
        multi = len(segments) > 1
        for seg_path, seg_body in segments:
            filename = (seg_path or path) if multi else path
            old, new, adds, dels = _rebuild_from_body(seg_body)
            if not multi:
                # 单文件：沿用 change 提供的 additions/deletions（保持既有行为）
                adds = int(change.get("additions", 0) or 0)
                dels = int(change.get("deletions", 0) or 0)
            if workspace_path:
                full = _full_contents(workspace_path, filename, seg_body)
                if full is not None:
                    old, new = full
            files.append({
                "filename": filename,
                "additions": adds,
                "deletions": dels,
                "oldContent": old,
                "newContent": new,
            })
    return files


async def create_diff(
    session: AsyncSession,
    conversation_id: str,
    *,
    summary: str,
    files: list[dict],
    task_id: str | None = None,
    agent_role: str | None = None,
) -> DiffOut:
    record = DiffRecord(
        conversation_id=conversation_id,
        task_id=task_id,
        agent_role=agent_role,
        summary=summary,
        files=files,
    )
    session.add(record)
    await session.flush()

    out = _to_out(record)
    await get_event_bus().publish(
        WSEvent(
            type="diff.generated",
            conversation_id=conversation_id,
            data={"diff": out.model_dump(by_alias=True)},
        )
    )
    return out


async def get_latest_diff(session: AsyncSession, conversation_id: str) -> DiffOut | None:
    stmt = (
        select(DiffRecord)
        .where(DiffRecord.conversation_id == conversation_id)
        .order_by(DiffRecord.created_at.desc())
        .limit(1)
    )
    record = (await session.execute(stmt)).scalars().first()
    if record is None:
        return None
    return _to_out(record)


async def get_diff_by_id(session: AsyncSession, diff_id: str) -> DiffOut | None:
    """按 id 取单条 diff（审查界面按 approval.diff_id 联动拉取）。"""
    record = await session.get(DiffRecord, diff_id)
    if record is None:
        return None
    return _to_out(record)


async def set_status_silent(
    session: AsyncSession, diff_id: str, status: str
) -> DiffOut | None:
    """设置 diff 状态但不发事件（供 approval 级联调用，状态变更由审批事件统一携带）。

    仅在当前为 pending 时生效，避免覆盖已决态。
    """
    record = await session.get(DiffRecord, diff_id)
    if record is None or record.status != "pending":
        return None
    record.status = status
    await session.flush()
    return _to_out(record)


async def resolve_diff(
    session: AsyncSession, diff_id: str, approved: bool
) -> DiffOut | None:
    record = await session.get(DiffRecord, diff_id)
    if record is None:
        return None
    record.status = "approved" if approved else "rejected"
    await session.flush()

    out = _to_out(record)
    await get_event_bus().publish(
        WSEvent(
            type="approval.resolved",
            conversation_id=record.conversation_id,
            data={"diff": out.model_dump(by_alias=True)},
        )
    )
    return out
