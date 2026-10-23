"""F14 review queue: decide which answers a person must look at, and why."""
from __future__ import annotations

from analyser.models import AnswerEnvelope

from .checks import is_fail

HUMAN_DECISIONS = {"accepted", "edited", "rejected"}


def review_reasons(env: AnswerEnvelope) -> list[str]:
    """Every reason this answer belongs in the review queue (empty = not needed)."""
    a, v = env.answer, env.verification
    reasons: list[str] = []
    if a.status == "NOT_STATED":
        reasons.append("NOT_STATED: confirm nothing is said anywhere in the package")
    if a.status == "POINTS_ELSEWHERE":
        target = f" ({a.points_to})" if a.points_to else ""
        reasons.append(f"POINTS_ELSEWHERE: detail is in another document{target}")
    if a.conflicts:
        reasons.append(f"Conflict: {len(a.conflicts)} other value(s) reported in the document")
    if a.visual_check == "needed":
        reasons.append("Visual check needed: the page must be read as an image")
    elif a.visual_check == "done":
        reasons.append("Visual-only answer: read from a page image, confirm against the page")
    if a.confidence == "low":
        reasons.append("Low confidence")
    if v is not None:
        for c in v.checks:
            if c.passed is False:
                level = "failed" if is_fail(c) else "warning"
                reasons.append(f"{c.check} {c.name} {level}: {c.detail.removeprefix('FAIL: ')}")
        if v.discard:
            reasons.insert(0, "Discarded: quote not found in the document text (rule 10)")
    return list(dict.fromkeys(reasons))


def apply_review(env: AnswerEnvelope) -> None:
    """Fill review.reasons; set decision to pending or not_needed (a person's decision stays)."""
    env.review.reasons = review_reasons(env)
    if env.review.decision in HUMAN_DECISIONS:
        return
    env.review.decision = "pending" if env.review.reasons else "not_needed"
