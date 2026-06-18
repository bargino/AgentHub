"""上下文分段观测（② 上下文工程 · D：measure-first）。

把组装进单次 Agent 上下文的各段（system / 规则 / 摘要 / 上游 / 历史 ...）按字符与
估算 token 量化并结构化日志，回答「哪段在吃窗口」，给后续「精简注入 / 动态预算 /
压缩升级」提供真实数据。零新依赖；默认开，可用 AGENTHUB_CONTEXT_METER=0 关闭。

token 为粗估（无分词器，零依赖）：CJK 字 ≈ 1 token，其余 ≈ 4 char/token。仅作占比参考，
精确预算仍以字符 + 适配器真实 usage（token_meter）为准。
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger(__name__)

_ENABLED = os.environ.get("AGENTHUB_CONTEXT_METER", "1") != "0"
_CJK = re.compile(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef]")


def estimate_tokens(text: str) -> int:
    """粗估 token：CJK 字符约 1 token，其余按 4 char/token。无分词器、零依赖。"""
    if not text:
        return 0
    cjk = len(_CJK.findall(text))
    other = len(text) - cjk
    return cjk + (other + 3) // 4


def log_context_breakdown(
    *,
    conversation_id: str,
    agent: str,
    sections: dict[str, str],
    window_tokens: int,
) -> dict:
    """统计各段 char/est-token 并按 token 占比降序输出；返回结构化结果（供测试/上报）。

    sections：有序 {段名: 文本}（空段自动跳过）。返回 {total_chars,total_tokens,window_tokens,sections:[...]}。
    """
    rows = []
    total_chars = 0
    total_tokens = 0
    for name, text in sections.items():
        text = text or ""
        if not text:
            continue
        c = len(text)
        t = estimate_tokens(text)
        total_chars += c
        total_tokens += t
        rows.append((name, c, t))
    rows.sort(key=lambda r: r[2], reverse=True)

    result = {
        "total_chars": total_chars,
        "total_tokens": total_tokens,
        "window_tokens": window_tokens,
        "sections": [{"name": n, "chars": c, "tokens": t} for n, c, t in rows],
    }

    if not _ENABLED:
        return result

    pct = (total_tokens / window_tokens * 100) if window_tokens else 0.0
    lines = [
        f"[CTX-METER] conv={conversation_id[:8]} agent={agent} "
        f"window={window_tokens}tok total~{total_tokens}tok({total_chars}ch) ~{pct:.1f}% of window"
    ]
    for name, c, t in rows:
        share = (t / total_tokens * 100) if total_tokens else 0.0
        lines.append(f"  {name:<16} {c:>7}ch  ~{t:>6}tok  {share:>5.1f}%")
    logger.info("\n".join(lines))
    return result
