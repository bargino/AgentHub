"""Workspace 只读文件浏览（VSCode 风格 Explorer 后端）。

提供「文件树」与「读单文件」两个纯函数，全部限制在 workspace 根目录内：
- 目录遍历跳过 .git / node_modules 等噪声目录，并对总条目数封顶，防超大仓库卡死。
- 读文件做路径穿越防护（解析后必须仍在根内）、大小封顶、二进制识别。

这些函数为同步阻塞 I/O，调用方（API 层）用 asyncio.to_thread 包裹，避免阻塞事件循环。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

# 噪声目录：不纳入文件树（与 workspace 复制时的 ignore 模式保持一致并补充常见项）
IGNORE_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".env",
    "dist",
    "out",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".idea",
    ".vscode",
    ".DS_Store",
}

MAX_ENTRIES = 4000  # 文件树总条目上限，防超大仓库
MAX_FILE_BYTES = 1024 * 1024  # 单文件文本读取上限 1MB
_BINARY_SNIFF_BYTES = 8000  # 取前 N 字节判定二进制（含 NUL 即视为二进制）


def _is_within(target: Path, root: Path) -> bool:
    """target 解析后是否仍位于 root 之内（防 ../ 穿越与符号链接逃逸）。"""
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def build_tree(root: str | Path) -> dict[str, Any]:
    """构建 workspace 文件树（目录在前、文件在后，按名排序）。

    返回根节点：{name, path:"", type:"dir", children:[...], truncated?:bool}
    每个节点：dir -> {name,path,type:"dir",children}; file -> {name,path,type:"file",size}
    """
    root_path = Path(root).resolve()
    counter = {"n": 0}
    truncated = {"hit": False}

    def walk(dir_path: Path) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        try:
            children = sorted(
                dir_path.iterdir(),
                key=lambda p: (p.is_file(), p.name.lower()),
            )
        except OSError:
            return entries
        for child in children:
            if counter["n"] >= MAX_ENTRIES:
                truncated["hit"] = True
                break
            if child.name in IGNORE_DIRS:
                continue
            counter["n"] += 1
            try:
                rel = child.relative_to(root_path).as_posix()
            except ValueError:
                continue
            if child.is_dir():
                entries.append(
                    {
                        "name": child.name,
                        "path": rel,
                        "type": "dir",
                        "children": walk(child),
                    }
                )
            else:
                try:
                    size = child.stat().st_size
                except OSError:
                    size = 0
                entries.append({"name": child.name, "path": rel, "type": "file", "size": size})
        return entries

    tree = walk(root_path)
    result: dict[str, Any] = {
        "name": root_path.name,
        "path": "",
        "type": "dir",
        "children": tree,
    }
    if truncated["hit"]:
        result["truncated"] = True
    return result


def read_file(root: str | Path, rel_path: str) -> dict[str, Any]:
    """读取 workspace 内单个文件（只读 + 路径穿越防护 + 大小封顶 + 二进制识别）。

    raises:
        ValueError: 路径越过 workspace 根（穿越攻击）
        FileNotFoundError: 目标不存在或非普通文件
    """
    root_path = Path(root).resolve()
    target = (root_path / rel_path).resolve()
    if not _is_within(target, root_path):
        raise ValueError("path escapes workspace root")
    if not target.is_file():
        raise FileNotFoundError(rel_path)

    try:
        size = target.stat().st_size
    except OSError:
        size = 0

    if size > MAX_FILE_BYTES:
        return {
            "path": rel_path,
            "content": "",
            "size": size,
            "binary": False,
            "truncated": True,
            "tooLarge": True,
        }

    try:
        raw = target.read_bytes()
    except OSError as e:
        raise FileNotFoundError(rel_path) from e

    if b"\x00" in raw[:_BINARY_SNIFF_BYTES]:
        return {"path": rel_path, "content": "", "size": size, "binary": True, "truncated": False}

    return {
        "path": rel_path,
        "content": raw.decode("utf-8", errors="replace"),
        "size": size,
        "binary": False,
        "truncated": False,
    }
