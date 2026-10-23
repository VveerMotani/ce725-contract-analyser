"""Everything a rule needs to look at, in one object.

`RuleContext` turns the list of AnswerEnvelopes into a dict of effective
answers by question id, and works out a few shared facts (contract value,
duration) once, saying where each came from.
"""
from __future__ import annotations

from typing import Optional

from ..models import Answer, AnswerEnvelope, CashInputs, CashResult, Package, RiskFlag
from . import parse

SEVERITY_ORDER = ["High", "Medium", "Low", "Info", "Needs review"]

# Keys we accept from Verification.normalised (F10, built by M2 in parallel).
# All shares are fractions (0.05 = 5%). Used when present, else the text is parsed.
NORMALISED_KEYS = {
    "rate_share": "deduction or rate as a share (2.2, 6.2)",
    "cap_share_of_value": "cap as a share of contract value (2.3, 4.3)",
    "rate_per_day_of_value": "delay damages per day as a share of value (4.2)",
    "days": "payment period in calendar days (1.3)",
    "months": "duration in months (0.4)",
    "amount_rs": "rupee amount (0.3, 1.6)",
}


class _SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


class RuleContext:
    """Effective answers plus the user's cash inputs, with small helpers."""

    def __init__(self, envelopes: list[AnswerEnvelope], package: Package,
                 cash: Optional[CashInputs] = None, cash_result: Optional[CashResult] = None):
        self.package = package
        self.cash = cash
        self.cash_result = cash_result
        self.answers: dict[str, Answer] = {}
        self.normalised: dict[str, dict] = {}
        self.dropped: dict[str, str] = {}          # question id -> why the answer is not used
        self.skipped: list[tuple[str, str]] = []   # (rule id, reason) for the trace
        self.rules: dict[str, dict] = {}            # all rules by id (R11 reads R10's gate patterns)
        for env in envelopes:
            ans = env.effective()
            qid = ans.question_id
            if qid in self.answers or qid in self.dropped:
                continue
            if env.review.decision == "rejected":
                self.dropped[qid] = "rejected by the reviewer"
                continue
            if env.verification is not None and env.verification.discard \
                    and env.review.decision != "edited":
                self.dropped[qid] = "discarded by the verifier (quote not found)"
                continue
            self.answers[qid] = ans
            if env.verification is not None and env.verification.normalised:
                self.normalised[qid] = dict(env.verification.normalised)

    # ---- answer access -------------------------------------------------

    def get(self, qid: str) -> Optional[Answer]:
        return self.answers.get(qid)

    def status(self, qid: str) -> str:
        """FOUND / NOT_STATED / NOT_APPLICABLE / POINTS_ELSEWHERE, or MISSING if no usable answer."""
        a = self.answers.get(qid)
        return a.status if a else "MISSING"

    def text(self, qid: str) -> str:
        """answer_value plus unit and base, so parsers see every word."""
        a = self.answers.get(qid)
        if not a:
            return ""
        return " ; ".join(x for x in (a.answer_value, a.unit, a.base) if x)

    def value(self, qid: str) -> str:
        a = self.answers.get(qid)
        return a.answer_value if a else ""

    def norm(self, qid: str, key: str) -> Optional[float]:
        v = self.normalised.get(qid, {}).get(key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    def skip(self, rule_id: str, reason: str) -> list[RiskFlag]:
        self.skipped.append((rule_id, reason))
        return []

    # ---- shared facts --------------------------------------------------

    def contract_value(self) -> Optional[float]:
        """Contract value in Rs from the user's cash inputs (used for rupee impact)."""
        if self.cash and self.cash.contract_value > 0:
            return self.cash.contract_value
        return None

    def value_for_gates(self) -> tuple[Optional[float], str]:
        """Contract value for size tests: cash input first, else the amount in answer 0.3."""
        v = self.contract_value()
        if v:
            return v, "contract value from the cash inputs"
        if self.status("0.3") == "FOUND":
            amt = self.norm("0.3", "amount_rs")
            if amt is None:
                found = parse.rupees(self.value("0.3"))
                amt = found[0] if found else None
            if amt:
                return amt, "amount in answer 0.3, may be an estimate"
        return None, ""

    def duration_months(self) -> tuple[Optional[float], str]:
        """Planned duration: cash input first, else the completion period in answer 0.4."""
        if self.cash and self.cash.duration_months > 0:
            return float(self.cash.duration_months), "duration from the cash inputs"
        if self.status("0.4") == "FOUND":
            m = self.norm("0.4", "months")
            if m is None:
                m = parse.first_duration_months(self.value("0.4"))
            if m:
                return m, "completion period in answer 0.4"
        return None, ""


def fill(template: str, values: dict) -> str:
    """Fill an explanation template; unknown placeholders are left as they are."""
    return (template or "").format_map(_SafeDict(values))
