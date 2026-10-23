"""Find the numbers in a piece of contract text and say what kind each one is.

Used by the verifier (V3, V7), the normaliser (F10), the conflict detector (F9) and
the scorer (F15). Each number becomes a ``Quantity``:

    "0.05% of Contract Price for each day"  -> percent 0.05, per="day", base="contract price"
    "10 working days"                       -> days 10, day_type="working"
    "Rs 4,24,547" / "Rs 30 lakhs"           -> rupees 424547 / 3000000
    "two instalments"                       -> count 2
    "Clause 19.5", "10CC", "NH-54", "2023"  -> kind "ref" (a label, not a value)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .text import fix_split_digits, normalise

WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "ninety": 90,
    "hundred": 100,
}
# A number word only counts when a unit follows it ("two instalments", "ten crore"),
# so "one of the" or "any one" are not read as numbers.
_UNIT_AFTER_WORD = (r"(?:-|\s)?(?:per\s?cent|percent|%|days?|weeks?|months?|years?|"
                    r"instalments?|installments?|lakhs?|lacs?|crores?|times|bonds?|"
                    r"working|business|calendar|milestones?)\b")

_NUM_RE = re.compile(r"\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?")
_WORD_RE = re.compile(r"\b(" + "|".join(WORD_NUMBERS) + r")\b(?=" + _UNIT_AFTER_WORD + ")")

_REF_BEFORE = re.compile(
    r"\b(?:clauses?|cls?\.?|schedule|sch\.?|para(?:graph)?|article|section|sec\.?|annexure|"
    r"appendix|itb|gcc|scc|no\.?|form|format|rule|item|page|p\.|pp\.|chapter|table|see|question|"
    r"contract data|bid data sheet|data sheet|cpwd|nh|sl\.?|sr\.?|s\.?\s?no\.?|dated|"
    r"january|february|march|april|may|june|july|august|september|october|"
    r"november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)"
    r"[\s\-:.]*(?:\d+[a-z]*(?:\([a-z0-9]+\))*\s*(?:,|and|or|&|/)\s*)*$")
_PERIOD_WORDS = {"day": "days", "days": "days", "week": "weeks", "weeks": "weeks",
                 "month": "months", "months": "months", "year": "years", "years": "years",
                 "yrs": "years", "yr": "years"}
_PER_RE = re.compile(r"^[^;]{0,60}?\b(?:per|a|each|every|for each|for every)\s+"
                     r"(?:calendar\s+|working\s+)?(day|week|month|year|annum)\b")
_BASE_RE = re.compile(r"^\s*(?:of|on)\s+(?:the\s+|each\s+|every\s+|all\s+)?([a-z][a-z \-/']{2,50})")
_DATE_RE = re.compile(r"(?<!\d)\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}(?!\d)")
_MULT = {"lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5, "crore": 1e7, "crores": 1e7, "cr": 1e7}


@dataclass
class Quantity:
    value: float                 # the number as printed (lakh/crore not applied)
    kind: str                    # percent, days, weeks, months, years, rupees, count, ordinal, number, ref
    raw: str                     # the text it came from
    start: int = 0               # position in the normalised text
    per: str = ""                # for rates: day, week, month, year
    base: str = ""               # for percentages: what it is "of"
    day_type: str = ""           # working, calendar, business or "" (unspecified)
    rupees: float | None = None  # value in rupees for amounts (lakh/crore applied)
    alts: set = field(default_factory=set)   # every value this number may be written as

    def matches(self, other: "Quantity") -> bool:
        """Same number, allowing lakh/crore conversion (e.g. 30 lakh == 3000000)."""
        return any(_close(a, b) for a in self.alts for b in other.alts)


def _close(a: float, b: float, rel: float = 1e-9) -> bool:
    return abs(a - b) <= rel * max(1.0, abs(a), abs(b))


def _to_float(s: str) -> float:
    return float(s.replace(",", ""))


def extract_quantities(text: str, already_normalised: bool = False) -> list[Quantity]:
    """Every number in ``text`` with its kind, rate period, base and rupee value."""
    t = text if already_normalised else normalise(text)
    t = fix_split_digits(t)
    found: list[Quantity] = []
    date_spans = [m.span() for m in _DATE_RE.finditer(t)]
    spans = [(m.start(), m.end(), _to_float(m.group())) for m in _NUM_RE.finditer(t)]
    spans += [(m.start(), m.end(), float(WORD_NUMBERS[m.group(1)])) for m in _WORD_RE.finditer(t)]
    spans.sort()
    for start, end, value in spans:
        raw = t[start:end]
        before, after = t[max(0, start - 40):start], t[end:end + 80]
        q = Quantity(value=value, kind="number", raw=raw, start=start)
        _classify(q, before, after, t, start, end, date_spans)
        q.alts = {q.value} | ({q.rupees} if q.rupees is not None else set())
        found.append(q)
    return found


def _classify(q: Quantity, before: str, after: str, t: str, start: int, end: int,
              date_spans: list[tuple[int, int]]) -> None:
    """Decide the kind of one number from the words around it."""
    prev_char = t[start - 1] if start > 0 else " "
    next_char = t[end] if end < len(t) else " "
    # Dates such as 05.08.2021 or 31.12.2024
    if any(a <= start < b for a, b in date_spans):
        q.kind = "ref"
        return
    # Attached to letters: 10CC, 19C, L0, NH-54, CPWD-6 (but 7th is an ordinal)
    m_ord = re.match(r"(st|nd|rd|th)\b", after)
    if m_ord:
        q.kind = "ordinal"
        return
    if next_char.isalpha() or prev_char.isalpha() or re.search(r"[a-z]-$", before):
        if not re.search(r"(rs|inr)\.?$", before):
            q.kind = "ref"
            return
    if _REF_BEFORE.search(before) or re.match(r"^\s*\((?:[ivx]+|[a-z])\)", after):
        q.kind = "ref"
        return
    if 1900 <= q.value <= 2100 and float(q.value).is_integer() and "%" not in after[:2] \
            and not re.search(r"(rs|inr|₹)\.?\s*$", before):
        q.kind = "ref"          # a year
        return
    a = after.lstrip()
    if re.match(r"(%|per\s?cent|percent|pc\b)", a):
        q.kind = "percent"
        rest = re.sub(r"^(%|per\s?cent|percent|pc)\s*(\([^)]*\))?", "", a)
        m = _PER_RE.match(rest)
        if m:
            q.per = "year" if m.group(1) == "annum" else m.group(1)
        elif re.match(r"^(p\.?\s?a\.?|a year|per year)\b", rest):
            q.per = "year"
        mb = _BASE_RE.match(rest)
        if mb:
            base = re.split(r"\b(?:for|per|from|in|which|subject|after|before|and|or|if|is|"
                            r"are|shall|will|to|against|as|on|with)\b", mb.group(1))[0]
            q.base = " ".join(base.split()[:5]).strip(" -/")
        return
    m = re.match(r"(?:\([^)]*\)\s*)?(working|business|calendar|clear)?\s*"
                 r"(days?|weeks?|months?|years?|yrs?)\b", a)
    if m:
        q.kind = _PERIOD_WORDS[m.group(2)]
        q.day_type = m.group(1) or ""
        return
    m = re.match(r"(lakhs?|lacs?|crores?|cr)\b", a)
    if m:
        q.kind = "rupees"
        q.rupees = q.value * _MULT[m.group(1)]
        return
    if re.search(r"(rs|inr|rupees|₹)\.?\s*$", before):
        q.kind = "rupees"
        q.rupees = q.value
        return
    if re.search(r"\b(day|days|month|months|year|years|week|weeks)\s*$", before):
        q.kind = _PERIOD_WORDS[re.search(r"(\w+)\s*$", before).group(1)]   # "day 145"
        return
    if re.match(r"(instalments?|installments?|bonds?|times|milestones?|stages?|parts?)\b", a):
        q.kind = "count"
        return
    # A run like "20/20/15%": the numbers take the kind of the last one.
    m = re.match(r"(?:/\s*(?:\d+(?:\.\d+)?|nil)\s*)+(%)", a)
    if m:
        q.kind = "percent"


def value_quantities(text: str) -> list[Quantity]:
    """Numbers that carry a value (labels such as clause numbers and years removed)."""
    return [q for q in extract_quantities(text) if q.kind != "ref"]


def all_number_values(text: str) -> set[float]:
    """Every numeric value in a text, including labels, for "is it anywhere?" checks."""
    vals: set[float] = set()
    for q in extract_quantities(text):
        vals |= q.alts
    return vals


def contains_value(values: set[float], q: Quantity) -> bool:
    return any(_close(a, v) for a in q.alts for v in values)
