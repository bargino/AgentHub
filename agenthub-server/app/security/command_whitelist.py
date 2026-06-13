"""命令白名单检查（PRD §10.2）。

默认允许：npm/pnpm 的 install/dev/build/test 等开发命令。
默认拦截：rm -rf、sudo、管道执行远程脚本、权限修改、ssh/scp、敏感路径访问。
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from enum import Enum


class CommandVerdict(str, Enum):
    ALLOWED = "allowed"  # 白名单内，直接执行并记录日志
    NEEDS_APPROVAL = "needs_approval"  # 非白名单，需人工审批
    BLOCKED = "blocked"  # 危险命令，直接拦截


@dataclass
class CommandCheckResult:
    verdict: CommandVerdict
    reason: str
    command: str


# 白名单：完整命令前缀（按词元匹配）
ALLOWED_PREFIXES: list[tuple[str, ...]] = [
    ("npm", "install"),
    ("npm", "ci"),
    ("npm", "run", "dev"),
    ("npm", "run", "build"),
    ("npm", "run", "test"),
    ("npm", "test"),
    ("pnpm", "install"),
    ("pnpm", "dev"),
    ("pnpm", "build"),
    ("pnpm", "test"),
    ("yarn", "install"),
    ("yarn", "dev"),
    ("yarn", "build"),
    ("node", "--version"),
    ("npm", "--version"),
    ("git", "status"),
    ("git", "diff"),
    ("git", "log"),
    ("git", "add"),
    ("git", "branch"),
    ("git", "worktree"),
]

# 硬拦截模式（正则，匹配即 BLOCKED）
BLOCKED_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # rm 同时带 recursive 与 force（覆盖 -rf / -fr / -r -f / --recursive --force 等任意顺序与拆分写法）
    (
        re.compile(
            r"\brm\b(?=.*\s-(?:[a-z]*r|-recursive\b))(?=.*\s-(?:[a-z]*f|-force\b))",
            re.I | re.S,
        ),
        "递归强制删除",
    ),
    (re.compile(r"\bsudo\b", re.I), "提权命令"),
    (re.compile(r"(curl|wget)[^|]*\|\s*(ba|z|da)?sh\b", re.I), "管道执行远程脚本"),
    (re.compile(r"\bchmod\s+777\b", re.I), "开放全部权限"),
    (re.compile(r"\bssh\b|\bscp\b", re.I), "远程连接命令"),
    (re.compile(r"~/\.ssh|\.ssh[/\\]", re.I), "访问 SSH 密钥目录"),
    (re.compile(r"(^|[/\\\s])\.env\b", re.I), "访问环境变量文件"),
    (re.compile(r"\bformat\s+[a-z]:", re.I), "格式化磁盘"),
    (re.compile(r"\bdel\s+/[sfq]\b", re.I), "Windows 递归删除"),
    (re.compile(r"\b(rd|rmdir)\s+/s\b", re.I), "Windows 递归删除目录"),
    # PowerShell Remove-Item：-Recurse 与 -Force 任意顺序
    (
        re.compile(r"remove-item(?=.*-recurse)(?=.*-force)", re.I | re.S),
        "PowerShell 递归强制删除",
    ),
    (re.compile(r"shutil\.rmtree", re.I), "Python 内联递归删除"),
    (re.compile(r"\brimraf\b", re.I), "Node 递归删除"),
    (re.compile(r"fs\.(rm|rmdir)sync?\s*\(.*recursive", re.I | re.S), "Node fs 递归删除"),
    (re.compile(r"\bmkfs(\.[a-z0-9]+)?\b", re.I), "格式化文件系统"),
    (re.compile(r"\bdd\b.*\bof=/dev/", re.I), "直接写入块设备"),
    (re.compile(r"\breg\s+delete\b", re.I), "删除注册表项"),
    (re.compile(r"\bvssadmin\s+delete\b", re.I), "删除卷影副本"),
]


def check_command(command: str) -> CommandCheckResult:
    """三级判定：BLOCKED > ALLOWED > NEEDS_APPROVAL。"""
    stripped = command.strip()
    if not stripped:
        return CommandCheckResult(CommandVerdict.BLOCKED, "空命令", command)

    for pattern, reason in BLOCKED_PATTERNS:
        if pattern.search(stripped):
            return CommandCheckResult(CommandVerdict.BLOCKED, f"危险命令：{reason}", command)

    # 含 shell 控制符的命令不进白名单（防止 `npm install && rm ...` 绕过）
    if re.search(r"[;&|><`$]", stripped):
        return CommandCheckResult(
            CommandVerdict.NEEDS_APPROVAL, "含 shell 控制字符，需人工审批", command
        )

    try:
        tokens = tuple(shlex.split(stripped, posix=False))
    except ValueError:
        return CommandCheckResult(CommandVerdict.NEEDS_APPROVAL, "命令解析失败，需人工审批", command)

    lowered = tuple(t.lower() for t in tokens)
    for prefix in ALLOWED_PREFIXES:
        if lowered[: len(prefix)] == prefix:
            return CommandCheckResult(CommandVerdict.ALLOWED, "白名单命令", command)

    return CommandCheckResult(CommandVerdict.NEEDS_APPROVAL, "非白名单命令，需人工审批", command)
