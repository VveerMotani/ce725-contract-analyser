"""Name the document a POINTS_ELSEWHERE answer points to, in one standard form.

The extractor words the same target many ways: "CPWD GCC 2023",
"General Conditions of Contract for CPWD 2023 (clause 2)",
"Reference_CPWD_GCC_2023.pdf", "GCC clause 2". R17 groups answers by the key
returned here so one missing document gives one group.
"""
from __future__ import annotations

import re
from typing import Optional

from ..models import Answer

UNNAMED = "a blank or an unnamed document"

_GCC = re.compile(r"\bgcc\b|general\s+conditions(\s+of\s+contract)?|\bconditions\s+of\s+contract\b", re.I)
_ISSUER = re.compile(r"\b(cpwd|mes|morth|nhai|pwd|nbcc|iit\w*)\b", re.I)
_YEAR = re.compile(r"\b(19|20)\d{2}\b")
_PART = re.compile(r"\b(schedule|annexure|annex|appendix|attachment)s?\s*[-:]?\s*([a-z](?:-?\d)?|\d{1,2}|[ivx]{2,4})\b", re.I)
_CONTRACT_DATA = re.compile(r"\b(contract|bid)\s+data(\s+sheet)?\b", re.I)
_FILE = re.compile(r"[\w\-.]+\.(pdf|docx?|xlsx?)\b", re.I)
_CLAUSE_TAIL = re.compile(r"[,;(]?\s*\b(cl\.?|clause|clauses|section|sec\.?|para(graph)?|article|art\.?|item|sl\.?)\s*[\w.()\-]+.*$", re.I)


def normalise(text: str) -> Optional[tuple[str, str]]:
    """(group key, display name) for a target description, or None if it names nothing.

    GCC-style documents -> key "gcc|<issuer>|<year>" (blank when not stated);
    Schedule / Annexure X -> "schedule f" / "annexure p"; else Contract Data -> "contract data";
    anything else -> lower-cased text without file extension and clause numbers.
    """
    raw = (text or "").strip()
    if not raw:
        return None
    flat = re.sub(r"[_]+", " ", raw)
    flat = re.sub(r"\.(pdf|docx?|xlsx?)\b", "", flat, flags=re.I)
    if _GCC.search(flat):
        issuer = (_ISSUER.search(flat).group(1).upper() if _ISSUER.search(flat) else "")
        year = _YEAR.search(flat).group(0) if _YEAR.search(flat) else ""
        display = " ".join(x for x in (issuer, "GCC", year) if x)
        return f"gcc|{issuer.lower()}|{year}", display
    m = _PART.search(flat)
    if m:
        kind = "annexure" if m.group(1).lower() in ("annex", "annexure") else m.group(1).lower()
        return f"{kind} {m.group(2).lower()}", f"{kind.capitalize()} {m.group(2).upper()}"
    if _CONTRACT_DATA.search(flat):
        return "contract data", "Contract Data"
    rest = _CLAUSE_TAIL.sub("", flat)
    rest = re.sub(r"\breference\b", "", rest, flags=re.I)
    rest = " ".join(re.sub(r"[()\[\]]", " ", rest).split()).strip(" ,;:-")
    return (rest.lower(), rest) if rest else None


def _mentions(text: str) -> Optional[tuple[str, str]]:
    """The first document named inside a sentence: a GCC, a file, a contract data sheet, a schedule."""
    if not text:
        return None
    flat = text.replace("_", " ")
    m = _GCC.search(flat)
    if m:                       # keep the words around "GCC" so the issuer and year come along
        return normalise(flat[max(0, m.start() - 25): m.end() + 25])
    m = _FILE.search(text)
    if m:
        return normalise(m.group(0))
    m = _PART.search(flat)
    if m:
        return normalise(m.group(0))
    return ("contract data", "Contract Data") if _CONTRACT_DATA.search(flat) else None


def target_of(a: Answer) -> tuple[str, str]:
    """Group key and display name of what this answer points to.

    Order: a document named in points_to; points_to as written; a document named
    in the answer or notes; else the place the pointer was cited (section_ref).
    """
    found = (_mentions(a.points_to) or normalise(a.points_to)
             or _mentions(a.answer_value) or _mentions(a.notes))
    if found:
        return found
    cited = a.section_ref.strip() or "?"
    return f"unnamed|{cited.lower()}", f"{UNNAMED} (cited at {cited})"


def merge_gcc(groups: dict[str, list[str]]) -> dict[str, str]:
    """Map less specific GCC keys onto the one more specific key they fit.

    "gcc||" (bare GCC) and "gcc||2023" both merge into "gcc|cpwd|2023" when that is
    the only compatible fuller key. Returns {old key: new key}.
    """
    keys = [k for k in groups if k.startswith("gcc|")]
    parts = {k: k.split("|")[1:] for k in keys}

    def fits(small, big):
        return all(s == "" or s == b for s, b in zip(parts[small], parts[big]))

    def filled(k):
        return sum(1 for p in parts[k] if p)
    out = {}
    for k in keys:
        bigger = [b for b in keys if b != k and fits(k, b) and filled(b) > filled(k)]
        tops = {b for b in bigger if not any(c != b and fits(b, c) and filled(c) > filled(b) for c in keys)}
        if len(tops) == 1:
            out[k] = tops.pop()
    return out
