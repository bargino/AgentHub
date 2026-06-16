"""Workspace 隔离服务（PRD §10.1）。

每个会话一个独立目录 ~/.agenthub/workspaces/{conversation_id}/，
git 仓库隔离变更，命令执行限制在 workspace 内并过白名单。
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_data_dir
from app.db.models import Workspace
from app.security.command_whitelist import CommandVerdict, check_command

logger = logging.getLogger(__name__)


def get_workspaces_root() -> Path:
    root = get_data_dir() / "workspaces"
    root.mkdir(parents=True, exist_ok=True)
    return root


async def _run_git(args: list[str], cwd: Path, timeout: float = 30) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "", "git command timeout"
    return proc.returncode or 0, stdout.decode("utf-8", "replace"), stderr.decode("utf-8", "replace")


async def ensure_workspace(
    session: AsyncSession,
    conversation_id: str,
    project_name: str = "",
    source_project: str | None = None,
) -> Workspace:
    """获取或创建会话 workspace。

    source_project 是 git 仓库时优先用 git worktree 隔离（借鉴 CodexMonitor 的
    worktree-per-agent 模式）：免复制、共享对象库、agent 分支可直接 merge 回源仓库，
    且 diff/commit/reset 语义与独立仓库完全一致。worktree 创建失败（如分支残留）
    或源不是 git 仓库时，回退为复制目录 + 独立 git 仓库。
    """
    result = await session.execute(
        select(Workspace).where(Workspace.conversation_id == conversation_id)
    )
    ws = result.scalars().first()
    if ws:
        return ws

    ws_path = get_workspaces_root() / conversation_id
    branch = f"agent/{conversation_id[:12]}"
    src = Path(source_project) if source_project else None
    worktree_mode = False

    if src and src.is_dir() and (src / ".git").exists() and not ws_path.exists():
        ws_path.parent.mkdir(parents=True, exist_ok=True)
        code, _, err = await _run_git(
            ["worktree", "add", "-b", branch, str(ws_path)], src
        )
        if code == 0:
            worktree_mode = True
        else:
            logger.warning("worktree add failed, fallback to copy: %s", err.strip())

    if not worktree_mode:
        ws_path.mkdir(parents=True, exist_ok=True)
        if src and src.is_dir():
            shutil.copytree(
                src,
                ws_path,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__", "dist", "out"),
            )
        code, _, err = await _run_git(["init", "-b", branch], ws_path)
        if code != 0:
            # 兼容旧版 git 不支持 -b
            await _run_git(["init"], ws_path)
            await _run_git(["checkout", "-b", branch], ws_path)
        await _run_git(["add", "-A"], ws_path)
        await _run_git(
            ["-c", "user.email=agent@agenthub.local", "-c", "user.name=AgentHub", "commit", "-m", "baseline", "--allow-empty"],
            ws_path,
        )

    ws = Workspace(
        conversation_id=conversation_id,
        project_name=project_name,
        path=str(ws_path),
        branch_name=branch,
        status="active",
    )
    session.add(ws)
    await session.flush()
    logger.info(
        "Workspace created: %s -> %s (mode=%s)",
        conversation_id, ws_path, "worktree" if worktree_mode else "copy",
    )
    return ws


async def generate_diff(workspace_path: str) -> list[dict]:
    """对照基线提交生成结构化 diff 文件列表。"""
    ws = Path(workspace_path)
    if not ws.is_dir():
        return []

    await _run_git(["add", "-A", "-N"], ws)  # intent-to-add，让新文件进入 diff
    code, name_status, _ = await _run_git(["diff", "HEAD", "--name-status"], ws)
    if code != 0 or not name_status.strip():
        return []

    files: list[dict] = []
    for line in name_status.strip().splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status, filename = parts[0], parts[-1]

        _, numstat, _ = await _run_git(["diff", "HEAD", "--numstat", "--", filename], ws)
        additions, deletions = 0, 0
        if numstat.strip():
            ns = numstat.strip().split("\t")
            additions = int(ns[0]) if ns[0].isdigit() else 0
            deletions = int(ns[1]) if len(ns) > 1 and ns[1].isdigit() else 0

        old_content = ""
        if status != "A":  # 新增文件无旧内容
            _, old_content, _ = await _run_git(["show", f"HEAD:{filename}"], ws)

        new_content = ""
        target = ws / filename
        if target.is_file():
            try:
                new_content = target.read_text(encoding="utf-8", errors="replace")
            except OSError:
                new_content = ""

        files.append(
            {
                "filename": filename,
                "additions": additions,
                "deletions": deletions,
                "old_content": old_content,
                "new_content": new_content,
            }
        )
    return files


async def stage_changes(workspace_path: str) -> bool:
    """把工作区改动 git add 暂存（不提交），让 git 面板把已审批落盘的变更显示为 staged。

    审批闸门为「应用前」，agent 在放行后才写盘，故在写型任务收尾时统一暂存：此刻被拒绝的
    改动从未落盘、被通过的改动已落盘，git add -A 恰好暂存「已通过」的变更。"""
    ws = Path(workspace_path)
    if not ws.is_dir():
        return False
    code, _, err = await _run_git(["add", "-A"], ws)
    if code != 0:
        logger.warning("Stage failed: %s", err.strip())
    return code == 0


async def commit_changes(workspace_path: str, message: str) -> bool:
    """审批通过后提交变更（推进基线）。"""
    ws = Path(workspace_path)
    await _run_git(["add", "-A"], ws)
    code, _, err = await _run_git(
        ["-c", "user.email=agent@agenthub.local", "-c", "user.name=AgentHub", "commit", "-m", message],
        ws,
    )
    if code != 0:
        logger.warning("Commit failed: %s", err)
    return code == 0


async def discard_changes(workspace_path: str) -> bool:
    """审批拒绝后回滚到基线。"""
    ws = Path(workspace_path)
    code1, _, _ = await _run_git(["reset", "--hard", "HEAD"], ws)
    code2, _, _ = await _run_git(["clean", "-fd"], ws)
    return code1 == 0 and code2 == 0


async def run_command_in_workspace(
    workspace_path: str,
    command: str,
    *,
    timeout: float = 300,
    skip_whitelist: bool = False,
) -> tuple[int, str]:
    """在 workspace 内执行命令（强制白名单检查 + cwd 限制）。

    返回 (exit_code, combined_output)。白名单拦截时返回 (-1, 原因)。
    """
    if not skip_whitelist:
        result = check_command(command)
        if result.verdict == CommandVerdict.BLOCKED:
            return -1, f"命令被拦截：{result.reason}"
        if result.verdict == CommandVerdict.NEEDS_APPROVAL:
            return -1, f"命令需要审批：{result.reason}"

    proc = await asyncio.create_subprocess_shell(
        command,
        cwd=workspace_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "命令执行超时"
    return proc.returncode or 0, stdout.decode("utf-8", "replace")


async def get_workspace(session: AsyncSession, conversation_id: str) -> Workspace | None:
    result = await session.execute(
        select(Workspace).where(Workspace.conversation_id == conversation_id)
    )
    return result.scalars().first()


async def archive_workspace(session: AsyncSession, conversation_id: str) -> bool:
    """归档 workspace（标记状态，不删除文件）。"""
    result = await session.execute(
        select(Workspace).where(Workspace.conversation_id == conversation_id)
    )
    ws = result.scalars().first()
    if not ws:
        return False
    ws.status = "archived"
    await session.flush()
    return True
