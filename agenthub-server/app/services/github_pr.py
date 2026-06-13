"""GitHub PR 集成（照搬 CodexMonitor 的 gh CLI 模式 + Ask PR 注入链）。

全部通过 gh CLI 完成（无需额外依赖），gh 未安装或仓库无 remote 时返回明确错误。
Ask PR：拉取 PR 元信息与 diff，组装审查指令注入会话，路由给 reviewer 角色。
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

_DIFF_INJECT_LIMIT = 30000


async def _run_gh(args: list[str], cwd: str, timeout: float = 30) -> tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "gh",
            *args,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return 127, "", "gh CLI 未安装（https://cli.github.com）"
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "", "gh 命令超时"
    return (
        proc.returncode or 0,
        stdout.decode("utf-8", "replace"),
        stderr.decode("utf-8", "replace"),
    )


async def list_pull_requests(repo_path: str, limit: int = 20) -> dict[str, Any]:
    code, out, err = await _run_gh(
        [
            "pr", "list",
            "--limit", str(max(1, min(limit, 100))),
            "--json", "number,title,headRefName,author,state,updatedAt,url",
        ],
        repo_path,
    )
    if code != 0:
        return {"available": False, "error": err.strip() or out.strip(), "prs": []}
    try:
        prs = json.loads(out or "[]")
    except json.JSONDecodeError:
        return {"available": False, "error": "gh 输出解析失败", "prs": []}
    return {"available": True, "prs": prs}


async def build_ask_pr_instructions(repo_path: str, number: int) -> dict[str, Any]:
    """拉取 PR 上下文并组装 reviewer 审查指令（CodexMonitor "Ask PR" 模式）。"""
    code, meta_out, err = await _run_gh(
        ["pr", "view", str(number), "--json", "number,title,body,headRefName,baseRefName,url"],
        repo_path,
    )
    if code != 0:
        return {"ok": False, "error": err.strip() or meta_out.strip()}
    try:
        meta = json.loads(meta_out)
    except json.JSONDecodeError:
        return {"ok": False, "error": "PR 元信息解析失败"}

    code, diff_out, err = await _run_gh(
        ["pr", "diff", str(number)], repo_path, timeout=60
    )
    if code != 0:
        return {"ok": False, "error": err.strip() or "PR diff 拉取失败"}

    truncated = len(diff_out) > _DIFF_INJECT_LIMIT
    diff_text = diff_out[:_DIFF_INJECT_LIMIT]
    body = str(meta.get("body") or "").strip()
    instructions = (
        f"[Ask PR] 请审查 Pull Request #{meta.get('number')}：{meta.get('title')}\n"
        f"分支：{meta.get('headRefName')} -> {meta.get('baseRefName')}\n"
        f"链接：{meta.get('url')}\n"
        + (f"描述：{body[:1000]}\n" if body else "")
        + "\n请从正确性、安全性、可维护性角度给出审查结论与改进建议。\n\n"
        f"```diff\n{diff_text}\n```"
        + ("\n（diff 超长已截断，完整内容请用 gh pr diff 查看）" if truncated else "")
    )
    return {"ok": True, "instructions": instructions, "meta": meta, "truncated": truncated}
