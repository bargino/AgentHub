"""Agent Markdown 定义加载（借鉴 MiMo-Code 的 Markdown 驱动 Agent 设计）。

Agent 以 Markdown 文件定义：YAML frontmatter 放元数据（name/role/group/
model/capabilities/enabled），正文即该角色的 system prompt。

来源两层（同 role 后者覆盖前者）：
- 内置：agenthub-server/agents/*.md（随发行版分发，提供默认群成员）
- 用户：~/.agenthub/agents/*.md（用户自定义/覆盖，无需改代码即可加群成员）

加载结果在首次启动时播种到 AgentRecord（IM 群成员注册表），
正文 prompt 落到 AgentRecord.system_prompt，供 context_builder 注入。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app.db.engine import get_data_dir

logger = logging.getLogger(__name__)

# 内置 Agent 定义目录：app/orchestrator/agent_loader.py -> 上溯到 agenthub-server/agents
_BUILTIN_AGENTS_DIR = Path(__file__).resolve().parents[2] / "agents"

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


@dataclass
class AgentDef:
    """从 Agent Markdown 解析出的定义。"""

    name: str
    role: str
    description: str = ""
    skills: str = ""
    group: str = ""
    model: str = ""
    system_prompt: str = ""
    capabilities: dict = field(default_factory=dict)
    enabled: bool = True


def parse_agent_md(text: str, *, default_role: str = "") -> AgentDef | None:
    """解析单个 Agent Markdown 文本为 AgentDef。

    必须含 YAML frontmatter 且能解析出 role（frontmatter 缺省时用 default_role，
    通常为文件名）。frontmatter 非法或缺 role 返回 None，由调用方跳过。
    """
    match = _FRONTMATTER_RE.match(text.strip())
    if not match:
        return None
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return None
    if not isinstance(meta, dict):
        return None

    role = str(meta.get("role", "") or default_role).strip()
    if not role:
        return None

    caps = meta.get("capabilities") or {}
    if not isinstance(caps, dict):
        caps = {}

    return AgentDef(
        name=str(meta.get("name", "") or role).strip(),
        role=role,
        description=str(meta.get("description", "") or "").strip(),
        skills=str(meta.get("skills", "") or "").strip(),
        group=str(meta.get("group", "") or "").strip(),
        model=str(meta.get("model", "") or "").strip(),
        system_prompt=match.group(2).strip(),
        capabilities=caps,
        enabled=bool(meta.get("enabled", True)),
    )


def _load_dir(directory: Path) -> dict[str, AgentDef]:
    """加载目录下所有 *.md 为 {role: AgentDef}（解析失败的文件跳过并告警）。"""
    defs: dict[str, AgentDef] = {}
    if not directory.is_dir():
        return defs
    for path in sorted(directory.glob("*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            logger.warning("读取 Agent 定义失败：%s", path, exc_info=True)
            continue
        agent = parse_agent_md(text, default_role=path.stem)
        if agent is None:
            logger.warning("Agent 定义格式非法，已跳过：%s", path)
            continue
        defs[agent.role] = agent
    return defs


def load_agent_defs() -> list[AgentDef]:
    """加载内置 + 用户 Agent 定义（同 role 用户覆盖内置），按 role 稳定排序返回。"""
    merged = _load_dir(_BUILTIN_AGENTS_DIR)
    merged.update(_load_dir(get_data_dir() / "agents"))
    return [merged[role] for role in sorted(merged)]
