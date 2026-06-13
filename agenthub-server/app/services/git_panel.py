"""Git 面板只读服务（照搬 CodexMonitor Git 集成的只读命令子集）。

提供 status / log / branches / unified diff 四类视图，全部基于会话 workspace
执行 git 命令，不做任何写操作（stage/commit/push 仍走审批后的 diff 服务链路）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.workspace import _run_git


async def git_status(workspace_path: str) -> dict[str, Any]:
    """工作区状态：当前分支 + 变更文件清单（porcelain v1 两位状态码）。"""
    ws = Path(workspace_path)
    if not ws.is_dir():
        return {"available": False, "error": "workspace 不存在"}

    code, branch_out, err = await _run_git(["rev-parse", "--abbrev-ref", "HEAD"], ws)
    if code != 0:
        return {"available": False, "error": err.strip() or "非 git 仓库"}

    _, status_out, _ = await _run_git(["status", "--porcelain"], ws)
    files = []
    for line in status_out.splitlines():
        if len(line) < 4:
            continue
        files.append({
            "staged": line[0].strip(),
            "unstaged": line[1].strip(),
            "path": line[3:].strip(),
        })
    return {
        "available": True,
        "branch": branch_out.strip(),
        "files": files,
        "clean": not files,
    }


async def git_log(workspace_path: str, limit: int = 30) -> list[dict[str, Any]]:
    """提交历史（hash / 作者 / 时间 / 标题）。"""
    ws = Path(workspace_path)
    sep = "\x1f"
    code, out, _ = await _run_git(
        [
            "log",
            f"-{max(1, min(limit, 200))}",
            f"--pretty=format:%h{sep}%an{sep}%aI{sep}%s",
        ],
        ws,
    )
    if code != 0:
        return []
    commits = []
    for line in out.splitlines():
        parts = line.split(sep)
        if len(parts) != 4:
            continue
        commits.append({
            "hash": parts[0],
            "author": parts[1],
            "date": parts[2],
            "subject": parts[3],
        })
    return commits


async def git_branches(workspace_path: str) -> dict[str, Any]:
    """分支列表 + 当前分支 + upstream ahead/behind 计数。"""
    ws = Path(workspace_path)
    code, out, err = await _run_git(
        ["branch", "--format=%(refname:short)%09%(HEAD)"], ws
    )
    if code != 0:
        return {"available": False, "error": err.strip(), "branches": []}

    branches = []
    current = ""
    for line in out.splitlines():
        parts = line.split("\t")
        name = parts[0].strip()
        if not name:
            continue
        is_current = len(parts) > 1 and parts[1].strip() == "*"
        if is_current:
            current = name
        branches.append({"name": name, "current": is_current})

    ahead = behind = None
    code, counts, _ = await _run_git(
        ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], ws
    )
    if code == 0 and counts.strip():
        parts = counts.split()
        if len(parts) == 2:
            behind, ahead = int(parts[0]), int(parts[1])

    return {
        "available": True,
        "current": current,
        "branches": branches,
        "ahead": ahead,
        "behind": behind,
    }


async def git_unified_diff(workspace_path: str) -> dict[str, Any]:
    """对照 HEAD 的 unified diff 全文（含未跟踪文件，intent-to-add）。"""
    ws = Path(workspace_path)
    await _run_git(["add", "-A", "-N"], ws)
    code, out, err = await _run_git(["diff", "HEAD"], ws)
    if code != 0:
        return {"available": False, "error": err.strip(), "diff": ""}
    return {"available": True, "diff": out}
