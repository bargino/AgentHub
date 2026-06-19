"""review.parse_review_verdict 单元测试。"""

from app.orchestrator.review import (
    VERDICT_APPROVE,
    VERDICT_MARKER,
    VERDICT_NEEDS_CHANGES,
    parse_review_verdict,
    review_verdict_degraded,
)


def test_no_marker_fail_open_approve() -> None:
    verdict, issues = parse_review_verdict("Looks good to me.")
    assert verdict == VERDICT_APPROVE
    assert issues == []


def test_needs_changes_with_issues() -> None:
    raw = f"""Review notes here.

{VERDICT_MARKER}
{{"verdict": "needs_changes", "issues": ["missing tests", "bad naming"]}}
"""
    verdict, issues = parse_review_verdict(raw)
    assert verdict == VERDICT_NEEDS_CHANGES
    assert issues == ["missing tests", "bad naming"]


def test_malformed_json_degraded() -> None:
    raw = f"Summary\n{VERDICT_MARKER}\n{{not json"
    assert review_verdict_degraded(raw) is True
    verdict, _ = parse_review_verdict(raw)
    assert verdict == VERDICT_APPROVE
