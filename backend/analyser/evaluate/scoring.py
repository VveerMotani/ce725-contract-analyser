"""F15 scoring: label every golden test and compute the metrics of spec 10.2-10.3."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from analyser import config
from analyser.models import Answer, AnswerEnvelope, ScoreSummary, TestScore

from .compare import Comparison, compare_answers
from .judge import judge_tests, needs_judging

LABELS = ["Correct", "Partial", "Incorrect", "Missed", "Correct absent", "Wrongly present"]
OVERRIDES_FILE = Path(__file__).with_name("manual_overrides.json")
RATE_CAP_QUESTIONS = {"2.2", "2.3", "4.2", "4.3"}


def load_golden(path: Path | None = None) -> list[dict]:
    """The 208 golden tests (spec 10.1)."""
    data = json.loads(Path(path or config.GOLDEN_TESTS).read_text(encoding="utf-8"))
    return data["tests"] if isinstance(data, dict) else data


def load_overrides(path: Path | None = None) -> list[dict]:
    """Manual labels set by a person: [{"test_id", "label", "reason", "run_id"?, "cause_code"?, "by"?}]."""
    p = Path(path or OVERRIDES_FILE)
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    return data.get("overrides", []) if isinstance(data, dict) else data


def tool_text(a: Answer) -> str:
    """The tool's answer as one string: value, unit and base."""
    return " | ".join(x for x in (a.answer_value, a.unit, a.base) if x)


def _quote_verified(env: AnswerEnvelope, a: Answer) -> bool | None:
    """Did the verifier find the quote? Unknown (None) for an edited quote or no verification."""
    v = env.verification
    if v is None or a.status == "NOT_STATED" or a.verbatim_quote != env.answer.verbatim_quote:
        return None
    return v.quote_found


def invented_number(env: AnswerEnvelope | None) -> bool:
    """V3 found a number that appears nowhere in the package."""
    if env is None or env.verification is None or env.review.decision == "edited":
        return False
    return any(c.check == "V3" and c.passed is False and c.severity == "fail"
               for c in env.verification.checks)


def suggest_cause(g: dict, a: Answer | None, label: str, cmp: Comparison | None,
                  quote_ok: bool | None, invented: bool) -> str:
    """Heuristic cause code (spec 10.6). A person should confirm it in the error log."""
    if label in ("Correct", "Correct absent"):
        return ""
    exp, tool = g["expected_status"], a.status if a else "NOT_STATED"
    visual = bool(g.get("scanned_or_visual_only"))
    hint = f"{g.get('notes', '')} {g.get('expected_answer', '')}".lower()
    strike = "struck" in hint or "strike" in hint
    if quote_ok is False:
        return "INVENTED_QUOTE"
    if label == "Wrongly present":
        return "INVENTED_VALUE"
    if label == "Missed" or (tool == "NOT_STATED" and exp != "NOT_STATED"):
        if strike:
            return "TEXT_LAYER_MISSED_STRIKE"
        if visual:
            return "SCAN_NOT_READ" if "scan" in hint else "IMAGE_NOT_READ"
        if exp == "POINTS_ELSEWHERE":
            return "REFERENCE_NOT_FOLLOWED"
        return "RETRIEVAL_MISSED"
    if exp != tool:
        if "POINTS_ELSEWHERE" in (exp, tool):
            return "REFERENCE_NOT_FOLLOWED"
        if strike or (visual and "NOT_APPLICABLE" in (exp, tool)):
            return "TEXT_LAYER_MISSED_STRIKE"
        if exp == "NOT_APPLICABLE":
            return "SCHEDULE_NOT_USED"
        if tool == "NOT_APPLICABLE":
            return "NEGATIVE_MISREAD"
        return "WRONG_CLAUSE"
    if invented:
        return "INVENTED_VALUE"
    if cmp is not None:
        if cmp.polarity_wrong:
            return "NEGATIVE_MISREAD"
        if ("conflict" in hint or "disagree" in hint or "two tables" in hint) and a and not a.conflicts:
            return "CONFLICT_MISSED"
        if cmp.contradicted:
            return "RATE_CAP_MIXED" if g["question_id"] in RATE_CAP_QUESTIONS else "WRONG_CLAUSE"
        if cmp.unit_mismatch or cmp.base_wrong or cmp.base_missing:
            return "WRONG_BASE_OR_UNIT"
        if cmp.missing:
            return "SCHEDULE_NOT_USED" if "schedule" in hint and visual else "ONE_OF_MANY_NUMBERS"
    return ""


def score_test(g: dict, env: AnswerEnvelope | None) -> TestScore:
    """Label one golden test against the tool's effective answer (review edits count)."""
    a = env.effective() if env is not None else None
    if env is not None and env.verification is not None and env.verification.discard \
            and env.review.decision != "edited":
        quote_ok: bool | None = False
    else:
        quote_ok = _quote_verified(env, a) if env is not None else None
    invented = invented_number(env)
    exp = g["expected_status"]
    tool = a.status if a else "NOT_STATED"
    accept_also = g.get("accept_also_status") or []
    cmp: Comparison | None = None
    human = False
    reasons: list[str] = []

    if a is None:
        reasons.append("no answer for this question in the run")
    if exp == "NOT_STATED":
        if tool == "NOT_STATED":
            label = "Correct absent"
        elif tool in accept_also:
            label = "Partial"
            reasons.append(f"status {tool} accepted as an alternative (accept_also)")
            human = True
        elif tool == "POINTS_ELSEWHERE":
            label = "Incorrect"
            reasons.append("wrong status: expected NOT_STATED, tool POINTS_ELSEWHERE")
        else:
            label = "Wrongly present"
            reasons.append(f"expected NOT_STATED but tool gives a value ({tool})")
    elif tool == "NOT_STATED":
        if "NOT_STATED" in accept_also:
            label = "Partial"
            reasons.append("NOT_STATED accepted as an alternative (accept_also)")
        else:
            label = "Missed"
            reasons.append(f"expected {exp} but tool says NOT_STATED")
    elif tool != exp and tool not in accept_also:
        label = "Incorrect"
        reasons.append(f"wrong status: expected {exp}, tool {tool}")
    else:
        label, cmp = _compare_content(g, a, reasons)
        if tool != exp:
            reasons.append(f"status {tool} accepted as an alternative (accept_also)")
            if label == "Correct":
                label = "Partial"
        human = cmp.mostly_text and label in ("Correct", "Partial")

    if quote_ok is False and label in ("Correct", "Partial"):
        label = "Incorrect"
        reasons.append("quote missing or not found in the document text (answer discarded)")
    if invented and label not in ("Wrongly present",):
        reasons.append("answer has a number that appears nowhere in the package")

    return TestScore(
        test_id=g["test_id"], contract_id=g["contract_id"], question_id=g["question_id"],
        clause_id=g["clause_id"], core=bool(g.get("core")), expected_status=exp,
        tool_status=tool, expected_answer=g.get("expected_answer", ""),
        tool_answer=tool_text(a) if a else "", label=label, reason="; ".join(reasons),
        cause_code=suggest_cause(g, a, label, cmp, quote_ok, invented),
        quote_verified=quote_ok, needs_human_check=human,
    )


def _compare_content(g: dict, a: Answer, reasons: list[str]) -> tuple[str, Comparison]:
    """Status is right: compare numbers, bases, Yes/No and wording."""
    cmp = compare_answers(g.get("expected_answer", ""), tool_text(a))
    if cmp.polarity_wrong:
        reasons.append("Yes/No answer is the opposite of the expected one")
        return "Incorrect", cmp
    if cmp.contradicted:
        reasons.append("wrong number: " + "; ".join(cmp.contradicted))
        return "Incorrect", cmp
    if cmp.base_wrong:
        reasons.append("wrong base: " + "; ".join(cmp.base_wrong))
        return "Incorrect", cmp
    gaps = []
    if cmp.missing:
        gaps.append("missing number(s): " + ", ".join(cmp.missing))
    if cmp.unit_mismatch:
        gaps.append("unit: " + "; ".join(cmp.unit_mismatch))
    if cmp.base_missing:
        gaps.append("base not named: " + ", ".join(cmp.base_missing))
    if gaps:
        reasons.extend(gaps)
        return "Partial", cmp
    if not cmp.expected_numbers and g["expected_status"] == "FOUND" and cmp.overlap < 0.2:
        reasons.append(f"text answer with little word overlap ({cmp.overlap:.0%}); check by hand")
        return "Partial", cmp
    if cmp.mostly_text:
        reasons.append(f"numbers match; mostly text answer, word overlap {cmp.overlap:.0%}: check by hand")
    return "Correct", cmp


# --------------------------------------------------------------------------- run level


def apply_overrides(tests: list[TestScore], run_id: str, overrides: list[dict]) -> int:
    """Replace labels set by a person (applied last, marked in the reason). Returns how many."""
    by_id = {t.test_id: t for t in tests}
    n = 0
    for o in overrides:
        t = by_id.get(o.get("test_id", ""))
        if t is None or o.get("label") not in LABELS:
            continue
        if o.get("run_id") not in (None, "", "*", run_id):
            continue
        old = f"auto label {t.label}" + (f": {t.reason}" if t.reason else "")
        who = f" by {o['by']}" if o.get("by") else ""
        t.label = o["label"]
        t.reason = f"MANUAL OVERRIDE{who}: {o.get('reason', '')} [{old}]"
        if o.get("cause_code") is not None:
            t.cause_code = o.get("cause_code", "")
        t.needs_human_check = False
        n += 1
    return n


def _counts(tests: list[TestScore]) -> dict[str, int]:
    c = Counter(t.label for t in tests)
    out = {lab: c.get(lab, 0) for lab in LABELS}
    out["total"] = len(tests)
    return out


def _rate(num: int, den: int) -> float:
    return round(num / den, 4) if den else 0.0


def summarise(tests: list[TestScore], run_id: str, invented_ids: set[str]) -> ScoreSummary:
    """Counts and metrics of spec 10.3 for a list of scored tests."""
    correct = sum(t.label == "Correct" for t in tests)
    given = sum(t.tool_status != "NOT_STATED" for t in tests)
    in_key = sum(t.expected_status != "NOT_STATED" for t in tests)
    core = [t for t in tests if t.core]
    checked = [t for t in tests if t.quote_verified is not None]
    wrongly = sum(t.label == "Wrongly present" for t in tests)
    invented = sum(1 for t in tests if t.test_id in invented_ids and t.label != "Wrongly present")
    return ScoreSummary(
        run_id=run_id,
        counts=_counts(tests),
        by_contract={c: _counts([t for t in tests if t.contract_id == c])
                     for c in sorted({t.contract_id for t in tests})},
        by_clause={c: _counts([t for t in tests if t.clause_id == c])
                   for c in sorted({t.clause_id for t in tests})},
        precision=_rate(correct, given),
        recall=_rate(correct, in_key),
        core_pass_rate=_rate(sum(t.label in ("Correct", "Correct absent") for t in core), len(core)),
        quote_verification_rate=_rate(sum(bool(t.quote_verified) for t in checked), len(checked)),
        hallucinations=wrongly + invented,
        tests=tests,
    )


def score_run(envelopes_by_contract: dict[str, list[AnswerEnvelope]], run_id: str,
              golden: list[dict] | None = None, overrides: list[dict] | None = None,
              judge=None) -> ScoreSummary:
    """Score every golden test of the contracts present in the run.

    ``golden`` and ``overrides`` default to golden_tests_v1.json and manual_overrides.json.
    ``judge``: optional LLMClient; text-heavy tests are then graded by the LLM (judge.py).
    Order: code labels, then LLM judge, then manual overrides (a person always wins).
    """
    golden = load_golden() if golden is None else golden
    overrides = load_overrides() if overrides is None else overrides
    tests: list[TestScore] = []
    to_judge: list[tuple[dict, TestScore, Answer]] = []
    invented_ids: set[str] = set()
    for contract_id, envelopes in envelopes_by_contract.items():
        by_qid: dict[str, AnswerEnvelope] = {}
        for env in envelopes:
            by_qid.setdefault(env.answer.question_id.strip(), env)
        for g in golden:
            if g["contract_id"] != contract_id:
                continue
            env = by_qid.get(g["question_id"])
            t = score_test(g, env)
            tests.append(t)
            if invented_number(env):
                invented_ids.add(g["test_id"])
            if judge is not None and env is not None and needs_judging(t):
                to_judge.append((g, t, env.effective()))
    if to_judge:
        judge_tests(to_judge, judge)
    apply_overrides(tests, run_id, overrides)
    return summarise(tests, run_id, invented_ids)
