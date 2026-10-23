"""F1 completeness check: documents that are referenced but not in the package.

Two conservative heuristics (spec §2 C, traps T8 and R18):

1. Incorporated-by-reference conditions. The text names a general-conditions
   document with a year ("General Conditions of Contract 2023 ...") but the
   package contains no general conditions: no file tagged "gcc" and no page
   headed "General Conditions of Contract".
2. Missing schedules or annexures. A label such as "Schedule H" or
   "Annexure P" is mentioned on at least two pages, the package does have a
   schedules/annexures section (at least two other labels of the same kind
   appear as headings), but no page carries a heading for this label.

Both return a MissingReference with the first quote and page, so a person can
check the claim quickly.
"""
from __future__ import annotations

import re
from collections import defaultdict

from ..models import DocumentFile, MissingReference, PageInfo

GCC_NAME = re.compile(
    r"(General\s+Conditions\s+of\s+Contract[^.\n;]{0,60}?\b(?:19|20)\d\d"
    r"|(?:CPWD|MES|PWD)\s+(?:Works\s+)?Manual[^.\n;]{0,20}?\b(?:19|20)\d\d"
    r"|Standard\s+(?:EPC|Bidding|Item\s+Rate)\s+(?:Agreement|Document)[^.\n;]{0,30}?\b(?:19|20)\d\d)",
    re.I)
# a title line near the top of a page: "GENERAL CONDITIONS OF CONTRACT",
# "D.GENERAL CONDITIONS OF CONTRACT (GCC)", "Section 3 - General Conditions of Contract"
GCC_HEADING = re.compile(r"^[^\n]{0,15}?General\s+Conditions\s+of\s+Contract\b", re.I | re.M)

# "Schedule H", "Schedule - H", "SCHEDULE 'F'", "Annexure P", "Annexure-M-1", "Annex II"
LABEL_RE = re.compile(
    r"\b(?P<kind>Schedule|SCHEDULE|Annexure|ANNEXURE|Annex|ANNEX)"
    r"(?:\s*[-–—]\s*|\s+|\s*['‘’])['‘’]?(?P<id>[A-Z](?:-\d)?|[IVX]{1,4}|\d{1,2})(?![A-Za-z0-9])['‘’]?")
HEADING_MAX_LEN = 70      # longer lines are sentences, not headings
TOP_LINES = 6             # headings with a short title are trusted only in the first lines of a page


def label_key(kind: str, ident: str) -> str:
    """Canonical label, e.g. ('SCHEDULE', 'f') -> 'Schedule F'."""
    kind = kind.capitalize()
    if kind == "Annex":
        kind = "Annexure"
    return f"{kind} {ident.upper()}"


def heading_labels(text: str) -> set[str]:
    """Labels that appear as headings on this page.

    A heading is either a line that holds only the label (e.g. "SCHEDULE 'F'"),
    or, within the first lines of the page, the label followed by a short title.
    Sentences, table cells ending in ":" or ";" and table-of-contents lines
    (ending in a page number) are not headings.
    """
    found = set()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for i, s in enumerate(lines):
        if len(s) > HEADING_MAX_LEN or re.search(r"\d{2,}\s*$", s) or s[-1] in ":;,":
            continue
        labels = list(LABEL_RE.finditer(s))
        if not labels or labels[0].start() > 0:          # a heading starts with its label
            continue
        after = s[labels[0].end():].strip(" .-–—'‘’")
        alone = not after                                  # "Schedule - J"
        in_brackets = after.startswith("(") and after.endswith(")")   # "Schedule-G (Annex-III)"
        short_title = i < TOP_LINES and len(after.split()) <= 8       # "Annexure - P Compensation"
        if alone or in_brackets or short_title:
            found |= {label_key(m.group("kind"), m.group("id")) for m in labels}
    return found


def _quote_around(text: str, start: int, end: int, width: int = 90) -> str:
    a, b = max(0, start - width), min(len(text), end + width)
    return " ".join(text[a:b].split())


def find_missing_references(files: list[DocumentFile], pages: list[PageInfo]) -> list[MissingReference]:
    """Return referenced-but-missing documents, schedules and annexures."""
    out: list[MissingReference] = []

    # 1. general conditions incorporated by reference
    has_gcc = any(f.tag == "gcc" for f in files) or any(GCC_HEADING.search(p.text[:600]) for p in pages)
    if not has_gcc:
        seen: set[str] = set()
        for p in pages:
            for m in GCC_NAME.finditer(p.text):
                label = " ".join(m.group(0).split())
                key = " ".join(label.lower().split()[:3]) + label[-4:]   # e.g. "general conditions of2023"
                if key in seen:
                    continue
                seen.add(key)
                out.append(MissingReference(label=label, doc_id=p.doc_id, page=p.page,
                                            quote=_quote_around(p.text, m.start(), m.end())))

    # 2. schedules / annexures mentioned but never headed
    headed: set[str] = set()
    for p in pages:
        headed |= heading_labels(p.text)
    mentions: dict[str, list[tuple[PageInfo, re.Match]]] = defaultdict(list)
    for p in pages:
        for m in LABEL_RE.finditer(p.text):
            mentions[label_key(m.group("kind"), m.group("id"))].append((p, m))
    for kind in ("Schedule", "Annexure"):
        kind_headed = {h for h in headed if h.startswith(kind)}
        if len(kind_headed) < 2:          # no schedules section at all: cannot judge
            continue
        for label, hits in sorted(mentions.items()):
            base = label.split("-")[0]
            if not label.startswith(kind) or label in kind_headed or base in kind_headed:
                continue
            if len({(p.doc_id, p.page) for p, _ in hits}) < 2:    # mentioned on one page only
                continue
            p, m = hits[0]
            out.append(MissingReference(label=label, doc_id=p.doc_id, page=p.page,
                                        quote=_quote_around(p.text, m.start(), m.end())))
    return out
