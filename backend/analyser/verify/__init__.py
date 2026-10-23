"""M2 verification: F11 checks V1-V9, F10 normaliser, F9 conflicts, F14 review queue.

Public interface (INTERFACES.md):
    verify_answers(envelopes, package, llm=None) -> list[AnswerEnvelope]
    quote_in_text(quote, text) -> (found, score)

Verdict per answer: "fail" if V1 fails (quote not in the text; the answer is then
discarded, spec rule 10) or V3 finds a number that is nowhere in the package;
"warn" if any other check found a problem; else "pass".
"""
from __future__ import annotations

from analyser.models import AnswerEnvelope, CheckResult, Package, Verification

from .checks import (PageIndex, check_absence, check_numbers, check_own_conflicts,
                     check_plausible, check_quote, check_schedule, check_unit_base, is_fail)
from .conflicts import describe, find_conflicts
from .llm_check import check_with_llm
from .normalise import normalise_answer
from .review import apply_review
from .text import quote_in_text

__all__ = ["verify_answers", "verify_one", "quote_in_text", "normalise_answer"]


def verify_one(env: AnswerEnvelope, idx: PageIndex, llm=None) -> Verification:
    """Run V1-V8 (and V9 when ``llm`` is given) on one envelope's AI answer."""
    a = env.answer
    v1, v2, loc = check_quote(a, idx, env.doc_id)
    page_i = None
    if loc["quote_found"]:
        page_i = next((i for i, p in enumerate(idx.pages)
                       if p.doc_id == loc["found_doc_id"] and p.page == loc["found_page"]), None)
    normalised = normalise_answer(a)
    checks: list[CheckResult] = [
        v1, v2,
        check_numbers(a, idx, page_i),
        check_unit_base(a),
        check_schedule(a),
        check_own_conflicts(a),
        check_plausible(a, normalised),
        check_absence(a),
    ]
    if llm is not None and loc["quote_found"]:
        checks.append(check_with_llm(env, llm))
    return Verification(
        question_id=a.question_id,
        quote_found=loc["quote_found"],
        found_doc_id=loc["found_doc_id"],
        found_page=loc["found_page"],
        page_matches=loc["page_matches"],
        checks=checks,
        normalised=normalised,
        verdict=verdict(checks),
        discard=v1.passed is False,
    )


def verdict(checks: list[CheckResult]) -> str:
    if any(is_fail(c) for c in checks):
        return "fail"
    if any(c.passed is False for c in checks):
        return "warn"
    return "pass"


def verify_answers(envelopes: list[AnswerEnvelope], package: Package,
                   llm=None) -> list[AnswerEnvelope]:
    """Fill ``verification``, ``doc_id`` and ``review`` on every envelope (in place) and return them."""
    idx = PageIndex.from_package(package)
    for env in envelopes:
        env.verification = verify_one(env, idx, llm)
        if env.verification.found_doc_id:
            env.doc_id = env.verification.found_doc_id
    idx.close()                       # PDFs opened for raw text / PDF search

    # F9: the same item with different values in different answers.
    by_qid = {env.answer.question_id: env for env in envelopes}
    for conflict in find_conflicts([env.answer for env in envelopes]):
        text = describe(conflict)
        for qid in conflict["values"]:
            v = by_qid[qid].verification
            v.checks.append(CheckResult(check="V6", name="Consistent across answers",
                                        passed=False, detail=text, severity="warn"))
            v.normalised.setdefault("cross_conflicts", []).append(text)
            v.verdict = verdict(v.checks)

    for env in envelopes:
        apply_review(env)
    return envelopes
