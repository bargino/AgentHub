"""跨会话进展记忆（#9a structured note-taking，对标 claude-progress.txt）。

编排收口阶段把「本轮目标 + 各任务结果」追加写入 {workspace}/.agenthub/progress.md，
供后续会话经 context_builder 预加载（#2 hybrid memory）快速接续。

写入前一律过 sanitize_for_memory（#8 注入隔离）：只持久化编排器自身产出的结构化
结论，剥离控制 marker、折叠多行，杜绝「注入写进记忆、后续会话当可信读取」。
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_PROGRESS_REL = Path(".agenthub") / "progress.md"
# 单文件封顶（防无限增长拖累每轮预加载；超限保留尾部最近进展）
_MAX_FILE_CHARS = 16000


def sanitize_for_memory(text: str, limit: int = 200) -> str:
    """写入记忆前的不可信内容消毒（#8 边界隔离）。

    - 剥离控制 marker（===VERDICT=== / ===MEMORY===），防 marker 注入
    - 折叠所有空白/换行为单行，杜绝多行伪指令/伪小节破坏文件结构
    - 截断到 limit
    """
    t = (text or "").replace("===VERDICT===", "").replace("===MEMORY===", "")
    return " ".join(t.split())[:limit]


def _sanitize_body(text: str, limit: int = 2000) -> str:
    """小节正文消毒（#8 写时隔离，保留多行结构）。

    - 剥离控制 marker
    - 行首 markdown 标题井号降级为普通文本，防伪小节破坏 upsert 锚点
    - 截断到 limit
    """
    t = (text or "").replace("===VERDICT===", "").replace("===MEMORY===", "")
    lines = [
        ln.lstrip("#").lstrip() if ln.lstrip().startswith("#") else ln
        for ln in t.splitlines()
    ]
    return "\n".join(lines).strip()[:limit]


def _truncate_tail(content: str) -> str:
    """超 _MAX_FILE_CHARS 时保留尾部最近内容，并对齐到完整小节边界。"""
    if len(content) <= _MAX_FILE_CHARS:
        return content
    tail = content[-_MAX_FILE_CHARS:]
    cut = tail.find("\n## ")
    return tail[cut + 1 :] if cut != -1 else tail


def append_progress(
    workspace_path: str,
    *,
    goal: str,
    task_lines: list[tuple[str, str]],
    conclusion: str,
) -> None:
    """把本轮进展（消毒后）追加到 .agenthub/progress.md；失败静默（不阻断收口）。"""
    try:
        path = Path(workspace_path) / _PROGRESS_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        block = [f"## {ts} · {sanitize_for_memory(goal, 120)}"]
        for title, status in task_lines:
            block.append(
                f"- {sanitize_for_memory(title, 100)}：{sanitize_for_memory(status, 32)}"
            )
        block.append(f"- 结论：{sanitize_for_memory(conclusion, 120)}")
        block.append("")

        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        new_content = _truncate_tail(existing + "\n".join(block) + "\n")
        path.write_text(new_content, encoding="utf-8")
    except OSError:
        logger.warning("progress.md 写入失败：%s", workspace_path, exc_info=True)


def upsert_section(
    workspace_path: str,
    *,
    title: str,
    body: str,
    rel_path: str | None = None,
) -> None:
    """#9b 按主题 upsert：把名为 {title} 的小节内容替换为 body，不存在则追加新小节。

    对标 memory tool str_replace —— 同主题增量更新而非无脑追加（#9a），避免记忆
    文件同主题进展重复堆叠膨胀。title 过 sanitize_for_memory 作单行锚点，body 过
    _sanitize_body（剥 marker + 行首井号降级），杜绝注入伪小节破坏文件结构。失败静默。
    """
    try:
        rel = Path(rel_path) if rel_path else _PROGRESS_REL
        path = Path(workspace_path) / rel
        path.parent.mkdir(parents=True, exist_ok=True)

        header = f"## {sanitize_for_memory(title, 120)}"
        section = f"{header}\n{_sanitize_body(body)}"

        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        lines = existing.split("\n") if existing else []
        start = next((i for i, ln in enumerate(lines) if ln.strip() == header), -1)
        if start == -1:
            # 同主题不存在：追加新小节（与已有内容隔一空行）
            prefix = existing.rstrip("\n")
            new_content = f"{prefix}\n\n{section}\n" if prefix else f"{section}\n"
        else:
            # 同主题已存在：替换 [header, 下一个 ## 或文件尾) 区间，其余原样保留
            end = next(
                (j for j in range(start + 1, len(lines)) if lines[j].startswith("## ")),
                len(lines),
            )
            kept_head = "\n".join(lines[:start]).rstrip("\n")
            kept_tail = "\n".join(lines[end:]).strip("\n")
            parts = [p for p in (kept_head, section, kept_tail) if p]
            new_content = "\n\n".join(parts) + "\n"

        path.write_text(_truncate_tail(new_content), encoding="utf-8")
    except OSError:
        logger.warning("upsert_section 写入失败：%s", workspace_path, exc_info=True)
