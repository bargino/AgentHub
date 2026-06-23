from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.registry import get_global_registry
from app.db.models import AgentRecord
from app.orchestrator.agent_loader import load_agent_defs
from app.schemas import AgentCreate, AgentOut, AgentUpdate, ProviderScanOut
from app.services.provider import normalize_provider_config, scan_provider

router = APIRouter()


async def _seed_if_empty(db: AsyncSession) -> None:
    """首次运行时从 agents/*.md 定义播种默认 Agent（IM 群成员注册表）。

    适配器类型留空、运行时动态探测；正文 prompt 落 system_prompt。
    Markdown 定义缺失时不播种（agents 目录随发行版分发，缺失属异常环境）。
    """
    existing = (await db.execute(select(AgentRecord).limit(1))).scalars().first()
    if existing is not None:
        return
    for d in load_agent_defs():
        db.add(AgentRecord(
            name=d.name, role=d.role, description=d.description,
            skills=d.skills, system_prompt=d.system_prompt, group=d.group,
            model=d.model, capabilities=d.capabilities,
            adapter_type="", enabled=d.enabled,
        ))
    await db.flush()


class AdapterStatus(BaseModel):
    name: str
    available: bool
    version: str | None = None


class AgentOutWithAdapter(AgentOut):
    """扩展 AgentOut，附带实际可用的适配器信息。"""
    available_adapters: list[AdapterStatus] = []
    active_adapter: str | None = None


def _effective_model(provider_config: dict, adapter_type: str, fallback: str) -> str:
    """当前适配器槽内的模型名（与供应商绑定）；缺省回退旧顶层 model。"""
    entry = provider_config.get(adapter_type) if adapter_type else None
    if isinstance(entry, dict) and entry.get("model"):
        return str(entry["model"])
    return fallback or ""


def _to_out(r: AgentRecord) -> AgentOut:
    pc = normalize_provider_config(
        r.provider_config, legacy_adapter=r.adapter_type, legacy_model=r.model
    )
    return AgentOut(
        id=r.id, name=r.name, role=r.role,
        description=r.description or "", skills=r.skills or "",
        skill_specs=r.skill_specs or [],
        system_prompt=r.system_prompt or "", group=r.group or "",
        adapter_type=r.adapter_type,
        model=_effective_model(pc, r.adapter_type, r.model or ""),
        context_window=r.context_window,
        provider_config=pc,
        capabilities=r.capabilities or {}, enabled=r.enabled,
    )


@router.get("/agents", response_model=list[AgentOutWithAdapter])
async def list_agents(db: AsyncSession = Depends(get_db)) -> list[AgentOutWithAdapter]:
    """返回所有 Agent 角色，附带通过 SDK 探测的实际可用适配器状态。"""
    await _seed_if_empty(db)
    records = (await db.execute(select(AgentRecord))).scalars().all()

    # 探测所有已注册适配器的健康状态
    registry = get_global_registry()
    adapter_statuses: list[AdapterStatus] = []
    active_adapter: str | None = None

    for adapter_name in registry.list_adapters():
        adapter = registry.get(adapter_name)
        if adapter is None:
            continue
        try:
            available = await adapter.health_check()
        except Exception:
            available = False
        version = getattr(adapter, "get_version", lambda: None)()
        adapter_statuses.append(AdapterStatus(
            name=adapter_name, available=available, version=version,
        ))
        if available and active_adapter is None:
            active_adapter = adapter_name

    result: list[AgentOutWithAdapter] = []
    for r in records:
        eff_adapter = r.adapter_type or active_adapter or ""
        pc = normalize_provider_config(
            r.provider_config, legacy_adapter=eff_adapter, legacy_model=r.model
        )
        result.append(AgentOutWithAdapter(
            id=r.id,
            name=r.name,
            role=r.role,
            description=r.description or "",
            skills=r.skills or "",
            skill_specs=r.skill_specs or [],
            system_prompt=r.system_prompt or "",
            group=r.group or "",
            adapter_type=eff_adapter,
            model=_effective_model(pc, eff_adapter, r.model or ""),
            context_window=r.context_window,
            provider_config=pc,
            capabilities=r.capabilities or {},
            enabled=r.enabled and active_adapter is not None,
            available_adapters=adapter_statuses,
            active_adapter=active_adapter,
        ))
    return result


@router.post("/agents", response_model=AgentOut)
async def create_agent(data: AgentCreate, db: AsyncSession = Depends(get_db)) -> AgentOut:
    pc = normalize_provider_config(
        {k: v.model_dump() for k, v in data.provider_config.items()},
        legacy_adapter=data.adapter_type,
        legacy_model=data.model,
    )
    record = AgentRecord(
        name=data.name,
        role=data.role,
        description=data.description,
        skills=data.skills,
        skill_specs=[s.model_dump() for s in data.skill_specs],
        system_prompt=data.system_prompt,
        group=data.group,
        adapter_type=data.adapter_type,
        # 顶层 model 镜像当前适配器槽的模型名（权威源在 provider_config 内，按适配器绑定）
        model=_effective_model(pc, data.adapter_type, data.model),
        context_window=data.context_window,
        provider_config=pc,
        capabilities=data.capabilities,
        enabled=data.enabled,
    )
    db.add(record)
    await db.flush()
    return _to_out(record)


@router.patch("/agents/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: str, data: AgentUpdate, db: AsyncSession = Depends(get_db)
) -> AgentOut:
    record = await db.get(AgentRecord, agent_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    updates = data.model_dump(exclude_unset=True)
    # Orchestrator 是编排链路的固定入口：不可停用、不可改角色
    if record.role == "orchestrator":
        if updates.get("enabled") is False:
            raise HTTPException(status_code=400, detail="Orchestrator 不可停用")
        if "role" in updates and updates["role"] != "orchestrator":
            raise HTTPException(status_code=400, detail="Orchestrator 角色不可修改")
    # provider_config 落库前归一化为「按适配器分组」（兼容旧扁平结构、补全两个适配器槽）；
    # 顶层 model 镜像当前适配器槽的模型名（权威源在 provider_config 内，与供应商按适配器绑定）
    if "provider_config" in updates:
        legacy_adapter = updates.get("adapter_type") or record.adapter_type
        legacy_model = updates.get("model", record.model)
        pc = normalize_provider_config(
            updates["provider_config"], legacy_adapter=legacy_adapter, legacy_model=legacy_model
        )
        updates["provider_config"] = pc
        updates["model"] = _effective_model(pc, legacy_adapter, legacy_model or "")
    for key, value in updates.items():
        setattr(record, key, value)
    await db.flush()
    return _to_out(record)


@router.get("/agents/provider-scan", response_model=ProviderScanOut)
async def provider_scan(adapter: str) -> ProviderScanOut:
    """扫描本地 codex / claude-code 配置，供「默认」供应商模式回显检测到的供应商。"""
    return ProviderScanOut(**scan_provider(adapter))
