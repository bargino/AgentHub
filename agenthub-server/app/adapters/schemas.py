from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field

from app.adapters.base import UnifiedApprovalMode, UnifiedSandboxLevel


class ExecuteRequest(BaseModel):
    adapter: str = Field(description="Adapter name: claude-code | codex")
    instructions: str = Field(description="Task instructions for the AI agent")
    workspace_path: str = Field(description="Absolute path to the workspace")
    approval_mode: UnifiedApprovalMode = UnifiedApprovalMode.REVIEW_EDITS
    sandbox_level: UnifiedSandboxLevel = UnifiedSandboxLevel.WORKSPACE_WRITE
    model: Optional[str] = None
    allowed_tools: Optional[list[str]] = None
    session_id: Optional[str] = None


class ApprovalDecision(BaseModel):
    request_id: str
    approved: bool


class AdapterStatus(BaseModel):
    name: str
    available: bool
    version: Optional[str] = None


class HealthResponse(BaseModel):
    status: str = "ok"
    adapters: list[AdapterStatus] = []


class WSMessage(BaseModel):
    action: str
    payload: dict[str, Any] = {}
