"""多模态附件统一适配工具（多模态接入 MVP）。

统一附件契约 = {type:"image", mime, path, filename?}（参照 MiMo-Code FilePart，落盘存路径）：
- 上游（API/engine/context_builder）只产这一种结构，不关心 claude/codex 差异
- 下游各 adapter 据此转换为自身 SDK 图片输入（claude=base64 block / codex=本地路径）

纯函数 + 文件 IO，便于单测与跨 adapter 复用。失败统一抛 ValueError，调用方跳过该附件 + 告警。
"""

from __future__ import annotations

import base64
import binascii
import re
import uuid
from pathlib import Path
from typing import Any

# 支持的图片 MIME -> 落盘扩展名（claude/codex 均支持的常见 vision 格式）
_IMAGE_EXT: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}

# 单附件解码后字节上限（防超大图打爆内存/上下文）
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

# data:<mime>;base64,<data>（允许 mime 缺省与中间参数如 ;charset=..)
_DATA_URL_RE = re.compile(
    r"^data:(?P<mime>[\w.+-]+/[\w.+-]+)?(?:;[\w.+-]+=[\w.+-]+)*;base64,(?P<data>.*)$",
    re.S,
)


def is_supported_image(mime: str) -> bool:
    return (mime or "").lower() in _IMAGE_EXT


def ext_for_mime(mime: str) -> str:
    return _IMAGE_EXT.get((mime or "").lower(), "bin")


def decode_data_url(data_url: str) -> tuple[str, bytes]:
    """解析 data:<mime>;base64,<data> -> (mime, bytes)；非法抛 ValueError。"""
    m = _DATA_URL_RE.match((data_url or "").strip())
    if not m:
        raise ValueError("不是合法的 base64 data URL")
    mime = (m.group("mime") or "").lower()
    try:
        raw = base64.b64decode(m.group("data"), validate=True)
    except (binascii.Error, ValueError) as e:
        raise ValueError(f"base64 解码失败：{e}") from e
    if not raw:
        raise ValueError("空附件数据")
    return mime, raw


def _attachments_dir(data_dir: Path, conversation_id: str) -> Path:
    d = Path(data_dir) / "attachments" / conversation_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_image_attachment(
    data_dir: Path,
    conversation_id: str,
    *,
    data_url: str,
    filename: str | None = None,
) -> dict[str, Any]:
    """base64 data URL -> 落盘 -> 统一附件 ref {type,mime,path,filename}。

    校验：支持的图片 MIME + 解码成功 + 不超限；任一不满足抛 ValueError。
    """
    mime, raw = decode_data_url(data_url)
    if not is_supported_image(mime):
        raise ValueError(f"不支持的图片类型：{mime or '未知'}")
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise ValueError(f"图片超过上限（{MAX_ATTACHMENT_BYTES} 字节）")
    target = _attachments_dir(data_dir, conversation_id) / f"{uuid.uuid4().hex}.{ext_for_mime(mime)}"
    target.write_bytes(raw)
    return {"type": "image", "mime": mime, "path": str(target), "filename": filename or target.name}


def read_as_base64(path: str) -> str:
    """读图片文件 -> 纯 base64 字符串（不含 data: 前缀）；供 claude image block。"""
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


def _valid_image_path(att: dict[str, Any]) -> str | None:
    """统一附件 -> 可用图片本地路径；非图片/路径缺失/文件不存在返回 None。"""
    if att.get("type") != "image":
        return None
    path = att.get("path")
    if not path or not Path(path).is_file():
        return None
    return str(path)


def to_claude_blocks(attachments: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """统一附件 -> Claude image content blocks（base64 source，Anthropic vision 格式）。

    跳过非图/路径缺失/读失败的附件（不阻断），供 claude adapter 拼进 user 消息 content。
    """
    blocks: list[dict[str, Any]] = []
    for att in attachments or []:
        path = _valid_image_path(att)
        if not path:
            continue
        try:
            data = read_as_base64(path)
        except OSError:
            continue
        blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": att.get("mime") or "image/png",
                "data": data,
            },
        })
    return blocks


def to_codex_items(attachments: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """统一附件 -> Codex 输入项（localImage path，见 openai_codex._inputs._to_wire_item）。

    跳过非图/路径缺失的附件，供 codex adapter 拼进 turn_start 的 input_items。
    """
    items: list[dict[str, Any]] = []
    for att in attachments or []:
        path = _valid_image_path(att)
        if path:
            items.append({"type": "localImage", "path": path})
    return items
