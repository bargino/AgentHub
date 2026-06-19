"""全局审批策略解析。"""

from app.config import resolve_approval_policy


def test_resolve_approval_policy_env(monkeypatch) -> None:
    monkeypatch.setenv("AGENTHUB_APPROVAL_POLICY", "auto")
    assert resolve_approval_policy() == "auto"
    monkeypatch.setenv("AGENTHUB_APPROVAL_POLICY", "invalid")
    assert resolve_approval_policy() == "review"
    monkeypatch.delenv("AGENTHUB_APPROVAL_POLICY", raising=False)
