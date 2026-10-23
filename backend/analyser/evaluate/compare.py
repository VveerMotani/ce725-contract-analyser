"""Deterministic comparison of an expected answer with the tool's answer (spec 10.2).

Rules:
* every value number in the expected answer (percentages, periods, rupee amounts,
  counts, plain numbers; clause numbers and years are ignored) must appear in the
  tool's answer_value + unit + base. Formatting does not matter: "10 %" = "10%",
  "Rs 4,24,547" = "424547", "two instalments" = "2", "30 lakh" = "3000000";
* a missing number is "missing" (-> Partial) unless the tool gives a different
  number of the same kind, which is "contradicted" (-> Incorrect);
* "1% per month" and "0.0333% per day" are equal only if the tool states the
  conversion (spec 10.2); a rate with the wrong period is contradicted;
* a base in the expected answer (contract price, tendered value, bid price, estimate,
  working days) must be named by the tool;
* answers that start with Yes/No must agree on Yes/No;
* for answers that are mostly words, a word-overlap share is computed and the test
  is flagged for a person (``needs_human_check``).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from analyser.verify.numbers import Quantity, value_quantities
from analyser.verify.normalise import DAYS_PER
from analyser.verify.text import normalise

TYPED_KINDS = {"percent", "days", "weeks", "months", "years", "rupees"}
_CONVERSION = re.compile(r"=|\bequivalent\b|\bi\.e\.|\bconverted\b|\bworks out\b|\bequals\b|\bthat is\b")

BASE_GROUPS: dict[str, tuple[str, ...]] = {
    "contract price": ("contract price", "contract value", "contract amount"),
    "tendered value": ("tendered value", "tendered amount", "tender value", "tendered cost",
                       "tender amount", "accepted tendered"),
    "bid price": ("bid price", "bid amount", "quoted price"),
    "estimated cost": ("estimated cost", "estimate", "probable amount"),
    "working days": ("working day", "business day"),
}

STOPWORDS = set("""a an the and or of to in on for by with from at as is are be been was were it its this that
these those any all each every per than then there their which who whom whose not no nor but if so such
shall will may can must should would could has have had do does done into upon under over after before
within without between also only other same both either neither more most less least up down out off""".split())


@dataclass
class Comparison:
    expected_numbers: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    contradicted: list[str] = field(default_factory=list)
    unit_mismatch: list[str] = field(default_factory=list)
    base_missing: list[str] = field(default_factory=list)
    base_wrong: list[str] = field(default_factory=list)
    polarity_wrong: bool = False
    overlap: float = 1.0
    mostly_text: bool = False

    @property
    def numbers_ok(self) -> bool:
        return not (self.missing or self.contradicted or self.unit_mismatch)


def _unique(qs: list[Quantity]) -> list[Quantity]:
    seen, out = set(), []
    for q in qs:
        key = (q.kind, round(q.value, 6), q.per)
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out


def _label(q: Quantity) -> str:
    unit = {"percent": "%", "rupees": " (Rs)"}.get(q.kind, f" {q.kind}" if q.kind in TYPED_KINDS else "")
    per = f" per {q.per}" if q.per else ""
    return f"{q.raw}{unit}{per}"


def _converted(e: Quantity, tool: list[Quantity], tool_text: str) -> bool:
    """A rate given per another period, with the conversion stated by the tool."""
    if e.kind != "percent" or not e.per or not _CONVERSION.search(tool_text):
        return False
    e_day = e.value / DAYS_PER[e.per]
    return any(t.kind == "percent" and t.per and
               abs(t.value / DAYS_PER[t.per] - e_day) <= 0.02 * e_day for t in tool)


def compare_numbers(expected: str, tool_text: str, cmp: Comparison) -> None:
    exp = _unique(value_quantities(expected))
    tool = value_quantities(tool_text)
    low_tool = normalise(tool_text)
    cmp.expected_numbers = [_label(q) for q in exp]
    for e in exp:
        same_value = [t for t in tool if e.matches(t)]
        if e.kind == "percent" and e.per:
            same_value = [t for t in same_value if t.kind == "percent" or not t.kind]
            if any(t.per == e.per for t in same_value):
                continue
            if _converted(e, tool, tool_text):
                continue
            if any(t.per and t.per != e.per for t in same_value):
                cmp.contradicted.append(f"{_label(e)} (tool gives another period)")
                continue
            if same_value:
                per_words = rf"\b(per|a|each|every)\s+(calendar\s+)?{e.per}"
                if e.per == "year":
                    per_words += r"|\bp\.?\s?a\b|per annum|annual"
                if re.search(per_words, low_tool):
                    continue
                cmp.unit_mismatch.append(f"{_label(e)} (period not stated)")
                continue
        elif same_value:
            continue
        # Not found: is there a different number of the same kind (a wrong value)?
        exp_vals = {round(v, 6) for x in exp if x.kind == e.kind for v in x.alts}
        rivals = [t for t in tool if t.kind == e.kind and e.kind in TYPED_KINDS
                  and not any(round(v, 6) in exp_vals for v in t.alts)]
        if rivals:
            cmp.contradicted.append(f"{_label(e)} (tool says {', '.join(_label(t) for t in rivals[:3])})")
        else:
            cmp.missing.append(_label(e))


def compare_bases(expected: str, tool_text: str, cmp: Comparison) -> None:
    exp, tool = normalise(expected), normalise(tool_text)
    exp_groups = [g for g, words in BASE_GROUPS.items() if any(w in exp for w in words)]
    tool_groups = [g for g, words in BASE_GROUPS.items() if any(w in tool for w in words)]
    for g in exp_groups:
        if g in tool_groups:
            continue
        others = [t for t in tool_groups if t not in exp_groups and t != "working days"]
        if others and g != "working days":
            cmp.base_wrong.append(f"{g} (tool says {', '.join(others)})")
        else:
            cmp.base_missing.append(g)


def polarity(text: str) -> str:
    """'yes', 'no' or '' from the first word of an answer."""
    m = re.match(r"\W*(\w+)", normalise(text))
    if not m:
        return ""
    w = m.group(1)
    if w in ("yes", "applicable"):
        return "yes"
    if w in ("no", "not", "none", "nil", "nothing"):
        return "no"
    return ""


def _stems(text: str) -> set[str]:
    words = re.findall(r"[a-z]{3,}", normalise(text))
    return {w[:6] for w in words if w not in STOPWORDS}


def word_overlap(expected: str, tool_text: str) -> float:
    """Share of the expected answer's content words that the tool also uses."""
    exp = _stems(expected)
    return 1.0 if not exp else len(exp & _stems(tool_text)) / len(exp)


def compare_answers(expected: str, tool_text: str) -> Comparison:
    cmp = Comparison()
    compare_numbers(expected, tool_text, cmp)
    compare_bases(expected, tool_text, cmp)
    pe, pt = polarity(expected), polarity(tool_text)
    cmp.polarity_wrong = bool(pe and pt and pe != pt)
    cmp.overlap = word_overlap(expected, tool_text)
    n_words = len(_stems(expected))
    # "Mostly text": no numbers at all, or many more content words than numbers.
    n_nums = len(cmp.expected_numbers)
    cmp.mostly_text = n_nums == 0 or (n_words >= 8 and n_words >= 5 * n_nums)
    return cmp
