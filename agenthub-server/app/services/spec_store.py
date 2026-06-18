"""规格落盘（Phase 0 · spec-driven）：把 Orchestrator 的 TaskPlan 持久化为可评审的 spec 文档。

SDD 第一类 artifact：goal + 任务清单（标题 / 负责 agent / 依赖 / 是否需审批）写到
`{workspace}/.agenthub/specs/<conversation_id>-<trace_id>.md`，人可读、可 review、可进 git、可 diff。

设计取舍：
- 仅 pipeline（复杂多步）模式落盘；direct / single（简单 / 直达）不写，避免简单任务额外开销。
- 文件优先（对齐本项目既有的 AGENTHUB.md / progress.md 文档记忆形态），写失败只告警不阻塞主链路。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.orchestrator.task_planner import TaskPlan

logger = logging.getLogger(__name__)

# 规格文档相对工作区的存放目录（与 .agenthub/progress.md 同处一个隐藏目录）
SPECS_SUBDIR = ".agenthub/specs"


def spec_path(workspace_path: str, conversation_id: str, trace_id: str) -> Path:
    """规格文件路径：{workspace}/.agenthub/specs/<conversation>-<trace>.md。"""
    safe_trace = (trace_id or "notrace")[:16]
    return Path(workspace_path) / SPECS_SUBDIR / f"{conversation_id}-{safe_trace}.md"


def render_spec(
    plan: "TaskPlan",
    *,
    conversation_id: str,
    trace_id: str,
    instructions: str,
) -> str:
    """把 TaskPlan 渲染为结构化 Markdown 规格文档。"""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [
        f"# 规格：{plan.goal}",
        "",
        f"- 会话：`{conversation_id}`",
        f"- Trace：`{trace_id}`",
        f"- 生成时间：{ts}",
        "",
        "## 原始需求",
        (instructions.strip() or "（空）"),
        "",
        "## 任务计划（DAG）",
        "",
        "| # | 任务 | 负责 Agent | 验收标准 | 依赖 | 需审批 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for i, t in enumerate(plan.tasks, 1):
        deps = ", ".join(t.depends_on) if t.depends_on else "—"
        appr = "是" if t.requires_approval else "否"
        # 单元格内换行/竖线会破坏表格，统一压平
        title = t.title.replace("\n", " ").replace("|", "｜")
        acc = (getattr(t, "acceptance", "") or "—").replace("\n", " ").replace("|", "｜")
        lines.append(f"| {i} | {title} | {t.agent} | {acc} | {deps} | {appr} |")
    lines.extend(
        [
            "",
            "> 本文件由 AgentHub 规划阶段自动生成（Phase 0 规格落盘）；可人工评审 / 修改 / 进 git。",
        ]
    )
    return "\n".join(lines)


def write_spec(
    workspace_path: str,
    plan: "TaskPlan",
    *,
    conversation_id: str,
    trace_id: str,
    instructions: str,
) -> str | None:
    """写规格文档到工作区 `.agenthub/specs/`，返回路径字符串；失败返回 None（不阻塞主链路）。"""
    if not workspace_path or plan is None or not plan.tasks:
        return None
    try:
        path = spec_path(workspace_path, conversation_id, trace_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        content = render_spec(
            plan,
            conversation_id=conversation_id,
            trace_id=trace_id,
            instructions=instructions,
        )
        path.write_text(content, encoding="utf-8")
        logger.info("规格已落盘：%s", path)
        return str(path)
    except OSError:
        logger.warning("规格落盘失败：%s", workspace_path, exc_info=True)
        return None


def triplet_dir(workspace_path: str, conversation_id: str, trace_id: str) -> Path:
    """三件套规格目录：{workspace}/.agenthub/specs/<conversation>-<trace>/。"""
    safe_trace = (trace_id or "notrace")[:16]
    return Path(workspace_path) / SPECS_SUBDIR / f"{conversation_id}-{safe_trace}"


def _mermaid_dag(plan: "TaskPlan") -> list[str]:
    """把任务 DAG 渲染为 mermaid flowchart（无依赖时退化为单列节点）。"""
    out = ["```mermaid", "flowchart TD"]
    for t in plan.tasks:
        label = t.title.replace('"', "'")[:40]
        out.append(f'    {t.id}["{t.id}: {label}"]')
    for t in plan.tasks:
        for dep in t.depends_on:
            out.append(f"    {dep} --> {t.id}")
    out.append("```")
    return out


def render_requirements(plan: "TaskPlan", instructions: str) -> str:
    """requirements.md（Spec Kit 三件套之一）：原始需求 + 每步 EARS 验收作为可核验需求项。"""
    lines = [
        f"# 需求规格：{plan.goal}",
        "",
        "## 原始需求",
        (instructions.strip() or "（空）"),
        "",
        "## 验收需求（EARS）",
        "",
        "> 逐条可编辑；每条形如「当<条件>，系统应<可观测结果>」。reviewer 与离线 eval 按此逐条核验。",
        "",
    ]
    has_acc = False
    for i, t in enumerate(plan.tasks, 1):
        acc = (getattr(t, "acceptance", "") or "").strip()
        if acc:
            has_acc = True
            lines.append(f"{i}. ({t.id}/{t.agent}) {acc}")
    if not has_acc:
        lines.append("（本计划暂未给出 EARS 验收，建议补充）")
    return "\n".join(lines) + "\n"


def render_design(plan: "TaskPlan") -> str:
    """design.md（Spec Kit 三件套之一）：目标 + 任务编排图（DAG）+ 角色分工。"""
    lines = [
        f"# 设计 / 方案：{plan.goal}",
        "",
        "## 任务编排（DAG）",
        "",
        *_mermaid_dag(plan),
        "",
        "## 角色与职责",
        "",
        "| 任务 | 负责 Agent | 依赖 |",
        "| --- | --- | --- |",
    ]
    for t in plan.tasks:
        deps = ", ".join(t.depends_on) if t.depends_on else "—"
        title = t.title.replace("\n", " ").replace("|", "｜")
        lines.append(f"| {t.id} {title} | {t.agent} | {deps} |")
    return "\n".join(lines) + "\n"


def render_tasks(plan: "TaskPlan") -> str:
    """tasks.md（Spec Kit 三件套之一）：可勾选、可逐条编辑的任务清单。"""
    lines = [f"# 任务清单：{plan.goal}", ""]
    for t in plan.tasks:
        deps = f"（依赖：{', '.join(t.depends_on)}）" if t.depends_on else ""
        appr = " [需审批]" if t.requires_approval else ""
        title = t.title.replace("\n", " ")
        lines.append(f"- [ ] **{t.id}** [{t.agent}] {title}{deps}{appr}")
        acc = (getattr(t, "acceptance", "") or "").strip()
        if acc:
            lines.append(f"  - 验收：{acc}")
    lines.append("")
    lines.append("> 可逐条编辑/增删；改后用「修改计划」把诉求反馈给规划层重新拆解。")
    return "\n".join(lines) + "\n"


def write_spec_triplet(
    workspace_path: str,
    plan: "TaskPlan",
    *,
    conversation_id: str,
    trace_id: str,
    instructions: str,
) -> dict[str, str] | None:
    """写 Spec Kit 三件套（requirements/design/tasks.md）到独立目录，返回 {文件名: 路径}。

    与合并版 spec（write_spec）并存：合并版承载「活文档」回写，三件套供文件级评审/逐条编辑。
    失败只告警不阻塞主链路。
    """
    if not workspace_path or plan is None or not plan.tasks:
        return None
    try:
        d = triplet_dir(workspace_path, conversation_id, trace_id)
        d.mkdir(parents=True, exist_ok=True)
        files = {
            "requirements.md": render_requirements(plan, instructions),
            "design.md": render_design(plan),
            "tasks.md": render_tasks(plan),
        }
        out: dict[str, str] = {}
        for name, content in files.items():
            p = d / name
            p.write_text(content, encoding="utf-8")
            out[name] = str(p)
        logger.info("规格三件套已落盘：%s", d)
        return out
    except OSError:
        logger.warning("规格三件套落盘失败：%s", workspace_path, exc_info=True)
        return None


def _specs_root(workspace_path: str) -> Path:
    return Path(workspace_path) / SPECS_SUBDIR


def _resolve_within_specs(workspace_path: str, relpath: str) -> Path | None:
    """把 relpath 解析到 specs 根内，越界 / 非 .md 一律拒绝（防路径穿越）。"""
    root = _specs_root(workspace_path).resolve()
    try:
        target = (root / relpath).resolve()
    except (OSError, ValueError):
        return None
    if target != root and root not in target.parents:
        return None
    if target.suffix.lower() != ".md":
        return None
    return target


def list_spec_files(workspace_path: str, conversation_id: str) -> list[dict]:
    """列出该会话的所有规格文件（合并版 + 三件套），返回 [{name, path(相对 specs 根), size, mtime}]。"""
    root = _specs_root(workspace_path)
    if not root.is_dir():
        return []
    out: list[dict] = []
    for p in sorted(root.rglob("*.md")):
        # 仅本会话相关（合并版 <conv>-*.md 与三件套目录 <conv>-*/）
        rel = p.relative_to(root)
        if not str(rel).startswith(conversation_id):
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        out.append(
            {
                "name": p.name,
                "path": rel.as_posix(),
                "size": st.st_size,
                "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime(
                    "%Y-%m-%d %H:%M:%S UTC"
                ),
            }
        )
    return out


def read_spec_file(workspace_path: str, relpath: str) -> str | None:
    """读取 specs 根内的规格文件内容；越界 / 不存在返回 None。"""
    target = _resolve_within_specs(workspace_path, relpath)
    if target is None or not target.is_file():
        return None
    try:
        return target.read_text(encoding="utf-8")
    except OSError:
        return None


def write_spec_file(workspace_path: str, relpath: str, content: str) -> bool:
    """写入 specs 根内的规格文件（文件级逐条编辑落盘）；越界返回 False。"""
    target = _resolve_within_specs(workspace_path, relpath)
    if target is None:
        return False
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return True
    except OSError:
        logger.warning("规格文件写入失败：%s", relpath, exc_info=True)
        return False


def append_outcome(
    workspace_path: str,
    conversation_id: str,
    trace_id: str,
    statuses: list[tuple[str, str]],
) -> str | None:
    """C：执行收口后把任务状态回写 spec，形成"活文档"（规划 + 实际结果同处一份）。

    statuses 为 [(任务标题, 状态)]。trace 对不上时（重启重建场景）回退到该会话最新的 spec。
    写失败只告警不阻塞。
    """
    if not workspace_path or not statuses:
        return None
    try:
        path = spec_path(workspace_path, conversation_id, trace_id)
        if not path.is_file():
            cands = sorted(
                (Path(workspace_path) / SPECS_SUBDIR).glob(f"{conversation_id}-*.md"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if not cands:
                return None
            path = cands[0]
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        lines = ["", f"## 执行结果（更新于 {ts}）", "", "| 任务 | 状态 |", "| --- | --- |"]
        for title, status in statuses:
            t = str(title).replace("\n", " ").replace("|", "｜")
            lines.append(f"| {t} | {status} |")
        with path.open("a", encoding="utf-8") as f:
            f.write("\n" + "\n".join(lines) + "\n")
        return str(path)
    except OSError:
        logger.warning("规格执行结果回写失败：%s", workspace_path, exc_info=True)
        return None
