"""F4 document map: where clauses, schedules, contract data and annexures start.

Pure regular expressions over each page's lines. A heading is recognised when a
line STARTS with a label (so references in the middle of a sentence such as
"as per Schedule F" are not headings). Table-of-contents pages are skipped.

Kinds: clause, schedule, contract_data, annexure, amendment, other.
"""
from __future__ import annotations

import re

from ..models import Package, SectionEntry

MAX_HEADING_LEN = 90
TOP_LINES = 6              # "first lines of the page" for headings with a title

# "Clause 10B(ii)", "CLAUSE 2", "Cl. 7.5", "Clause 10 CA"
CLAUSE_WORD = re.compile(
    r"^(?:Clause|CLAUSE|Cl\.)\s*(?P<num>\d{1,2}(?:\s?[A-Z]{1,3}(?![A-Za-z]))?(?:\.\d{1,2}){0,3})"
    r"(?:\s*\((?P<sub>[ivx]{1,5}|[a-z])\))?(?![\d.])\s*[:.\-–—]?\s*(?P<title>.*)$")
# "7.5 Retention Money", "19.10 Price adjustment"
NUMBERED = re.compile(r"^(?P<num>\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(?P<title>[A-Z][^\n]{2,80})$")
# "23. No Interest Payable", "2. Compensation for delay" (short title-case line only)
NUMBERED_SHORT = re.compile(r"^(?P<num>\d{1,2})\.\s+(?P<title>[A-Z][A-Za-z ,'&/()-]{3,55})$")
ARTICLE = re.compile(r"^(?:ARTICLE|Article)\s+(?P<num>\d{1,2})\b\s*[:.\-–—]?\s*(?P<title>.*)$")
# "GCC 23", "ITB Clause 22", "SCC 5.1", "BDS 9"
PREFIXED = re.compile(r"^(?P<pre>GCC|ITB|SCC|BDS|PCC|SCC)\s*(?:Clause|Cl\.)?\s*(?P<num>\d{1,2}(?:\.\d{1,2})*)\b"
                      r"\s*[:.\-–—]?\s*(?P<title>.*)$")
SCHEDULE = re.compile(r"^(?:SCHEDULE|Schedule)(?:\s*[-–—]\s*|\s+|\s*['‘’])['‘’]?(?P<id>[A-Z](?:-\d)?)"
                      r"(?![A-Za-z0-9])['‘’]?\s*[:.\-–—]?\s*(?P<title>.*)$")
ANNEX = re.compile(r"^(?:ANNEXURE|Annexure|ANNEX|Annex|APPENDIX|Appendix)(?:\s*[-–—]\s*|\s+|\s*['‘’])['‘’]?"
                   r"(?P<id>[A-Z](?:-\d)?|[IVX]{1,4}|\d{1,2}(?:\.\d{1,2})?)(?![A-Za-z0-9])['‘’]?"
                   r"\s*[:.\-–—]?\s*(?P<title>.*)$")
CONTRACT_DATA = re.compile(r"^(?:PART\s*[-–—]?\s*[A-Z0-9]+\s*[:.\-–—]?\s*)?(?P<name>Contract\s+Data(?:\s+Sheet)?|"
                           r"Bid\s+Data\s+Sheet|Particulars\s+of\s+values|Appendix\s+to\s+(?:Bid|Tender))\b",
                           re.I)
AMENDMENT = re.compile(r"^(?P<name>Corrigendum|Addendum|Amendment\s+No|Correction\s+Slip)\b", re.I)
# "SECTION 3", "Section - 2 ITB", "PART-A" (kind "other": marks where a section ends)
SECTION = re.compile(r"^(?P<word>SECTION|Section|PART|Part)\s*[-–—]?\s*(?P<id>\d{1,2}|[IVX]{1,4}|[A-D])\b"
                     r"\s*[:.\-–—]?\s*(?P<title>.{0,50})$")


def is_toc_page(text: str) -> bool:
    """A table-of-contents page: many lines end with page numbers."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 8:
        return False
    ending_in_number = sum(1 for ln in lines if re.search(r"\s\d{1,7}\s*$", ln))
    return (ending_in_number / len(lines) > 0.4
            or bool(re.search(r"(?im)table\s+of\s+contents|^\s*contents\s*$|^\s*index\s*$", text[:300])))


def _clean_title(t: str) -> str:
    return " ".join(t.split())[:80]


def _norm_clause(num: str, sub: str | None) -> str:
    num = re.sub(r"\s+", "", num)
    return f"Clause {num}" + (f"({sub})" if sub else "")


def _section_heading_ok(title: str, near_top: bool) -> bool:
    """Schedule/annexure heading: label alone, label + (bracketed note), or short title near page top."""
    t = title.strip(" .-–—'‘’")
    if not t:
        return True
    if t.startswith("(") and t.endswith(")"):
        return True
    return near_top and len(t.split()) <= 8 and not t.endswith((":", ";", ","))


def classify_line(line: str, near_top: bool = True) -> tuple[str, str, str] | None:
    """Return (ref, kind, title) when the line is a heading, else None.

    near_top: the line is among the first lines of the page (headings with a
    title are only trusted there; elsewhere a schedule label must stand alone).
    """
    s = line.strip()
    if not s or len(s) > MAX_HEADING_LEN and not re.match(r"^(Clause|CLAUSE|\d)", s):
        return None
    if re.search(r"\.{4,}\s*\d+\s*$", s):           # dotted TOC leader
        return None
    m = SCHEDULE.match(s)
    if m and _section_heading_ok(m.group("title"), near_top):
        return f"Schedule {m.group('id')}", "schedule", _clean_title(m.group("title"))
    m = ANNEX.match(s)
    if m and _section_heading_ok(m.group("title"), near_top):
        return f"Annexure {m.group('id')}", "annexure", _clean_title(m.group("title"))
    m = CONTRACT_DATA.match(s)
    rest = s[m.end():].split() if m else []
    # a title, not a sentence: few words after the name (more allowed in an ALL-CAPS title)
    if m and len(s) <= 60 and not s.endswith((".", ":")) and (len(rest) <= 2 or s.isupper()):
        name = " ".join(m.group("name").split()).title()
        ref = "Bid Data Sheet" if name.lower().startswith("bid") else "Contract Data"
        return ref, "contract_data", name
    m = AMENDMENT.match(s)
    if m and len(s) <= 80:
        return " ".join(m.group("name").split()).title(), "amendment", _clean_title(s)
    m = SECTION.match(s)
    if m and near_top and len(m.group("title").split()) <= 6:
        return f"{m.group('word').title()} {m.group('id')}", "other", _clean_title(m.group("title"))
    m = ARTICLE.match(s)
    if m:
        return f"Article {m.group('num')}", "clause", _clean_title(m.group("title"))
    m = PREFIXED.match(s)
    if m:
        return f"{m.group('pre')} {m.group('num')}", "clause", _clean_title(m.group("title"))
    m = CLAUSE_WORD.match(s)
    if m:
        return _norm_clause(m.group("num"), m.group("sub")), "clause", _clean_title(m.group("title"))
    m = NUMBERED.match(s)
    if m and len(s) <= MAX_HEADING_LEN:
        return f"Clause {m.group('num')}", "clause", _clean_title(m.group("title"))
    m = NUMBERED_SHORT.match(s)
    if m:
        words = m.group("title").split()
        if sum(w[0].isupper() for w in words) >= max(1, len(words) // 2):   # Title Case
            return f"Clause {m.group('num')}", "clause", _clean_title(m.group("title"))
    return None


def _inside_sentence(lines: list[str], i: int) -> bool:
    """True when line i is a wrapped piece of a sentence ("... as given in" / "Schedule 'F'" / "of ...")."""
    prev_open = i > 0 and bool(re.search(r"[a-z,]$", lines[i - 1]))
    next_lower = i + 1 < len(lines) and lines[i + 1][:1].islower()
    return prev_open or next_lower


def build_document_map(package: Package) -> list[SectionEntry]:
    """All headings found in the package, in reading order (doc, page, line)."""
    entries: list[SectionEntry] = []
    seen: set[tuple[str, int, str]] = set()
    for p in package.pages:
        if not p.text or is_toc_page(p.text):
            continue
        lines = [ln.strip() for ln in p.text.splitlines() if ln.strip()]
        for i, line in enumerate(lines):
            hit = classify_line(line, near_top=i < TOP_LINES)
            if not hit:
                continue
            ref, kind, title = hit
            if kind in ("schedule", "annexure") and i >= TOP_LINES and _inside_sentence(lines, i):
                continue
            # "Article 12 of this Agreement ..." / "Clause 7 shall ..." are sentences, not headings
            if kind == "clause" and (title[:1].islower() or (i > 0 and re.search(r"[a-z,]$", lines[i - 1]))):
                continue
            key = (p.doc_id, p.page, ref)
            if key in seen:
                continue
            seen.add(key)
            entries.append(SectionEntry(doc_id=p.doc_id, page=p.page, ref=ref, title=title, kind=kind))
    return entries
