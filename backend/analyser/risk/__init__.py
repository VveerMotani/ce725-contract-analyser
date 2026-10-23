"""M3 risk rules (feature F12).

flag_risks() applies rules R1-R18 from rules_v1.yaml to the effective answers
of one contract and returns RiskFlags, worst first. Deterministic: no LLM calls,
every threshold comes from the YAML file.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import yaml

from ..models import AnswerEnvelope, CashInputs, CashResult, Package, RiskFlag
from .context import SEVERITY_ORDER, RuleContext
from .rules import EVALUATORS

RULES_PATH = Path(__file__).with_name("rules_v1.yaml")

__all__ = ["flag_risks", "flag_risks_with_trace", "load_rules", "sort_flags", "RULES_PATH"]


def load_rules(path: Path | str = RULES_PATH) -> list[dict]:
    """Read the rule table. Each rule is a dict with id, title, thresholds, triggers, ..."""
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    rules = data["rules"]
    for r in rules:
        for key in ("id", "title", "rule", "reference_source"):
            if key not in r:
                raise ValueError(f"rule {r.get('id', '?')} has no '{key}'")
        r.setdefault("thresholds", {})
        r.setdefault("patterns", {})
        r.setdefault("triggers", {})
        r.setdefault("unclear", {"severity": "Needs review"})
        for t in r["triggers"].values():
            if t["severity"] not in SEVERITY_ORDER:
                raise ValueError(f"rule {r['id']}: bad severity {t['severity']}")
    return rules


def sort_flags(flags: list[RiskFlag]) -> list[RiskFlag]:
    """High -> Medium -> Low -> Info -> Needs review; inside each, larger rupee impact first."""
    def key(f: RiskFlag):
        return (SEVERITY_ORDER.index(f.severity),
                0 if f.rupee_impact is not None else 1,
                -(f.rupee_impact or 0.0),
                int(f.flag_id[1:]) if f.flag_id[1:].isdigit() else 99)
    return sorted(flags, key=key)


def flag_risks_with_trace(envelopes: list[AnswerEnvelope], package: Package,
                          cash: Optional[CashInputs] = None, cash_result: Optional[CashResult] = None,
                          rules: Optional[list[dict]] = None) -> tuple[list[RiskFlag], list[tuple[str, str]]]:
    """Same as flag_risks, plus the list of (rule id, reason) for rules that did not fire."""
    rules = rules if rules is not None else load_rules()
    ctx = RuleContext(envelopes, package, cash, cash_result)
    ctx.rules = {r["id"]: r for r in rules}
    flags: list[RiskFlag] = []
    for rule in rules:
        fn = EVALUATORS.get(rule["id"])
        if fn is None:
            ctx.skip(rule["id"], "no evaluator for this rule id")
            continue
        flags.extend(fn(rule, ctx))
    for qid, why in ctx.dropped.items():
        ctx.skipped.append(("-", f"answer {qid} not used: {why}"))
    return sort_flags(flags), ctx.skipped


def flag_risks(envelopes: list[AnswerEnvelope], package: Package,
               cash: Optional[CashInputs] = None, cash_result: Optional[CashResult] = None) -> list[RiskFlag]:
    """Apply R1-R18 to one contract's answers (see INTERFACES.md, M3)."""
    return flag_risks_with_trace(envelopes, package, cash, cash_result)[0]
