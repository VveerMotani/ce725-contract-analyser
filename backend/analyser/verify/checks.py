"""F11 verifier checks V1-V9 for one answer (spec F11, design doc section 3).

Each check returns a ``CheckResult``: ``passed=True`` ok, ``False`` a problem,
``None`` not applicable. ``severity`` says how serious: "fail" only for V1 (quote not in
text) and V3 (a number found nowhere in the package), whose detail also starts with
"FAIL:"; "warn" for every other problem; "info" when the check passed or does not apply.
"""
from __future__ import annotations

import re
from analyser.models import Answer, CheckResult

from .locate import PageIndex
from .numbers import all_number_values, contains_value, extract_quantities, value_quantities

FAIL = "FAIL: "

# The six main numbers of spec 10.4: payment days, retention, advance,
# damages rate, damages cap, performance security.
KEY_QUESTIONS = {"1.3", "2.2", "3.2", "4.2", "4.3", "6.2"}

# V7 plausibility limits (percent of the stated base unless noted). Starting points only.
PCT_LIMITS = {
    "2.2": (20.0, "retention rate above 20%"),
    "2.3": (20.0, "retention cap above 20%"),
    "3.2": (30.0, "advance above 30%"),
    "4.3": (25.0, "damages cap above 25%"),
    "6.2": (20.0, "performance security above 20%"),
}
INTEREST_QUESTIONS = {"1.4", "3.3"}          # yearly interest above 30% is implausible
LD_PER_DAY_LIMIT = 1.0                        # % per day
PERIOD_LIMITS_DAYS = {"1.2": 365, "1.3": 365, "0.4": 3650}
# Percentages whose base is another security or a shortfall (e.g. "110% of each instalment")
# are not the headline rate, so V7 skips them.
_SECONDARY_BASE = re.compile(r"advance|instal|install|shortfall|difference|cost|guarantee amount")

_POINTER = re.compile(r"\b(schedule|contract data|annexure|appendix|bid data sheet|data sheet|"
                      r"special conditions|particular conditions)\b", re.I)
_DERIVED = re.compile(r"=|\bequivalent\b|\bi\.e\.|\bconverted\b|\bworks out\b|\bderived\b", re.I)



def _cr(check: str, name: str, passed: bool | None, detail: str = "") -> CheckResult:
    """A check result; severity is "fail" for a FAIL: detail, "warn" for other problems, else "info"."""
    if passed is False:
        severity = "fail" if detail.startswith(FAIL) else "warn"
    else:
        severity = "info"
    return CheckResult(check=check, name=name, passed=passed, detail=detail, severity=severity)


def is_fail(c: CheckResult) -> bool:
    return c.passed is False and c.severity == "fail"


# --------------------------------------------------------------------------- V1, V2


def check_quote(a: Answer, idx: PageIndex, doc_id: str = "") -> tuple[CheckResult, CheckResult, dict]:
    """V1 quote exists in the package; V2 it is on the stated page (+-1 is a warning)."""
    loc: dict = {"quote_found": None, "found_doc_id": "", "found_page": 0, "page_matches": None}
    quote = (a.verbatim_quote or "").strip()
    if not quote:
        if a.status == "FOUND" and not (a.visual_check == "done" and a.visual_evidence):
            loc["quote_found"] = False
            return (_cr("V1", "Quote exists", False, FAIL + "FOUND answer without a quote (rule 1)"),
                    _cr("V2", "Page matches", None, "no quote"), loc)
        why = "answer read from a page image" if a.visual_check == "done" else "no quote to check"
        return _cr("V1", "Quote exists", None, why), _cr("V2", "Page matches", None, why), loc
    if not idx.pages:
        return (_cr("V1", "Quote exists", None, "package has no page text"),
                _cr("V2", "Page matches", None, "package has no page text"), loc)

    hit = idx.find_quote(quote, a.pdf_page, doc_id)
    if hit.index is None:
        loc["quote_found"] = False
        return (_cr("V1", "Quote exists", False,
                    FAIL + f"quote not found in any page: sorted text, raw text or PDF search "
                           f"(best fuzzy score {hit.score:.0f})"),
                _cr("V2", "Page matches", None, "quote not found"), loc)
    page = idx.pages[hit.index]
    loc.update(quote_found=True, found_doc_id=page.doc_id, found_page=page.page)
    if hit.method == "PDF search":
        how = f"PDF search, {hit.score:.0f}% of the words"
    elif hit.score >= 100:
        how = f"exact match ({hit.method})"
    else:
        how = f"fuzzy match, score {hit.score:.0f} ({hit.method})"
    v1 = _cr("V1", "Quote exists", True, how)
    diff = abs(page.page - a.pdf_page)
    if diff == 0:
        loc["page_matches"] = True
        v2 = _cr("V2", "Page matches", True, f"{page.doc_id} page {page.page}")
    elif diff == 1:
        loc["page_matches"] = True
        v2 = _cr("V2", "Page matches", False,
                 f"quote is on page {page.page}, answer says {a.pdf_page} (off by one, allowed)")
    else:
        loc["page_matches"] = False
        v2 = _cr("V2", "Page matches", False,
                 f"quote is on {page.doc_id} page {page.page}, answer says page {a.pdf_page}")
    return v1, v2, loc


# --------------------------------------------------------------------------- V3


def check_numbers(a: Answer, idx: PageIndex, page_i: int | None) -> CheckResult:
    """V3 every number in the answer is in the quote, else on the page, else anywhere."""
    qs = value_quantities(a.answer_value)
    if not qs:
        return _cr("V3", "Numbers in quote", None, "no numbers in the answer")
    in_quote = all_number_values(a.verbatim_quote or "")
    page_idx = [page_i] if page_i is not None else idx.page_positions(a.pdf_page)
    on_page: set[float] = set()
    for i in page_idx:
        on_page |= idx.numbers_on(i)
    only_page, nowhere = [], []
    for q in qs:
        if contains_value(in_quote, q):
            continue
        if contains_value(on_page, q):
            only_page.append(q.raw)
        elif idx.pages and contains_value(idx.all_numbers(), q):
            only_page.append(q.raw + " (elsewhere in package)")
        else:
            nowhere.append(q.raw)
    if nowhere:
        if not idx.pages:
            return _cr("V3", "Numbers in quote", False, f"not in quote: {', '.join(nowhere)} (no page text)")
        if _DERIVED.search(a.answer_value) or _DERIVED.search(a.notes):
            return _cr("V3", "Numbers in quote", False,
                       f"not in the package, looks derived (conversion stated): {', '.join(nowhere)}")
        return _cr("V3", "Numbers in quote", False,
                   FAIL + f"invented value? not in quote or anywhere in the package: {', '.join(nowhere)}")
    if only_page:
        return _cr("V3", "Numbers in quote", False, f"not in quote, only on the page: {', '.join(only_page)}")
    return _cr("V3", "Numbers in quote", True, f"{len(qs)} number(s) found in the quote")


# --------------------------------------------------------------------------- V4, V5, V6


def check_unit_base(a: Answer) -> CheckResult:
    """V4 every percentage has a base and every number has a unit."""
    if a.status not in ("FOUND", "NOT_APPLICABLE"):
        return _cr("V4", "Unit and base present", None, f"status {a.status}")
    qs = [q for q in extract_quantities(a.answer_value) if q.kind not in ("ref", "ordinal")]
    pcts = [q for q in qs if q.kind == "percent"]
    periods = [q for q in qs if q.kind in ("days", "weeks", "months", "years")]
    if not pcts and not periods:
        return _cr("V4", "Unit and base present", None, "no percentage or period")
    problems = []
    unit_has_base = " of " in f" {a.unit.lower()} "
    # Interest rates ("Bank Rate + 3% per annum") are of the unpaid sum: no base needed.
    no_base = [q.raw + "%" for q in pcts if not q.base and q.per != "year"]
    if no_base and not a.base.strip() and not unit_has_base:
        problems.append(f"no base for {', '.join(no_base)}")
    if not a.unit.strip():
        problems.append("unit field empty")
    untyped = [q.raw for q in periods if q.kind == "days" and not q.day_type]
    note = f" (working/calendar not said for {', '.join(untyped)} days)" if untyped else ""
    if problems:
        return _cr("V4", "Unit and base present", False, "; ".join(problems) + note)
    return _cr("V4", "Unit and base present", True, "base and unit given" + note)


def check_schedule(a: Answer) -> CheckResult:
    """V5 the answer or quote points to a schedule but the answer cites only the clause."""
    if a.status != "FOUND":
        return _cr("V5", "Schedule followed", None, f"status {a.status}")
    text = f"{a.answer_value} {a.verbatim_quote}"
    m = _POINTER.search(text)
    if not m:
        return _cr("V5", "Schedule followed", None, "no schedule or contract-data pointer")
    if a.value_source in ("schedule", "contract_data", "annexure", "amendment"):
        return _cr("V5", "Schedule followed", True, f"value taken from {a.value_source}")
    if _POINTER.search(a.section_ref or ""):
        return _cr("V5", "Schedule followed", True, f"cites {a.section_ref}")
    if a.value_source == "clause":
        return _cr("V5", "Schedule followed", False,
                   f"incomplete? the text mentions '{m.group(0)}' but the answer cites only the clause")
    return _cr("V5", "Schedule followed", None, f"mentions '{m.group(0)}'; value source '{a.value_source}'")


def check_own_conflicts(a: Answer) -> CheckResult:
    """V6 the answer itself reports values that disagree."""
    if not a.conflicts:
        return _cr("V6", "No conflicting values", True, "none reported")
    parts = [f"{c.value} ({c.section_ref}, p{c.pdf_page})" for c in a.conflicts]
    return _cr("V6", "No conflicting values", False, "other values reported: " + "; ".join(parts))


# --------------------------------------------------------------------------- V7, V8


def check_plausible(a: Answer, normalised: dict) -> CheckResult:
    """V7 values inside sane ranges (catches unit errors and misreads)."""
    if a.status != "FOUND":
        return _cr("V7", "Plausible range", None, f"status {a.status}")
    qid, issues = a.question_id, []
    pcts = normalised.get("percentages", [])
    if qid in PCT_LIMITS:
        limit, msg = PCT_LIMITS[qid]
        for p in pcts:
            if not p.get("per") and not _SECONDARY_BASE.search(p.get("base", "")) and p["value"] > limit:
                issues.append(f"{msg}: {p['text']}%")
    if qid in INTEREST_QUESTIONS:
        issues += [f"interest above 30% a year: {p['text']}%" for p in pcts
                   if p.get("per") == "year" and p["value"] > 30]
    if qid == "4.2":
        issues += [f"damages above {LD_PER_DAY_LIMIT}% per day: {p['text']}% per {p['per']}"
                   for p in pcts if p.get("per_day_pct", 0) > LD_PER_DAY_LIMIT]
    if qid in PERIOD_LIMITS_DAYS:
        lim = PERIOD_LIMITS_DAYS[qid]
        issues += [f"period above {lim} days: {p['text']} {p['unit']}"
                   for p in normalised.get("periods", []) if p.get("days", 0) > lim]
    if issues:
        return _cr("V7", "Plausible range", False, "; ".join(dict.fromkeys(issues)))
    return _cr("V7", "Plausible range", True, "within ranges" if pcts or normalised.get("periods") else "no values to test")


def check_absence(a: Answer) -> CheckResult:
    """V8 a key field reported NOT_STATED must be confirmed by a person."""
    if a.status != "NOT_STATED":
        return _cr("V8", "Absence confirmed", None, f"status {a.status}")
    if a.question_id in KEY_QUESTIONS:
        return _cr("V8", "Absence confirmed", False,
                   "key number reported NOT_STATED: confirm the whole package was searched")
    return _cr("V8", "Absence confirmed", True, "not a key number; queued for review like every NOT_STATED")
