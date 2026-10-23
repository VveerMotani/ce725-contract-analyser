"""F5 clause-type retrieval and pointer resolution.

For one clause type (C0..C6) we pick the pages the extraction model should see:

1. Term hits. Every page is scored with the clause's term list (terms.py):
       score = sum over terms of  weight x idf x min(count, 3)  / length factor
   * weight: phrases 2, single words 1, generic words 0.5 (terms.term_weight)
   * idf: a term found on almost every page of this package says little,
     a term found on few pages says a lot (as in TF-IDF search engines)
   * length factor: sqrt(chars / 1500), so long pages do not win just by
     being long (we score hit density, not raw hit count)
   We keep the top-K pages and every page scoring at least REL_SCORE x best.
   A phrase that occurs on only a few pages ("rare term") keeps its pages too.
2. Pointers. Near the hits we look for data locations: "Schedule F",
   "Contract Data", "Annexure P", "Bid Data Sheet", and add the pages of
   those sections that are relevant (two rounds, so "Contract Data ->
   Annexure P" chains are followed, trap T5).
3. Data pages. Contract-data / bid-data pages and compact schedule blocks
   (CPWD Schedules A-F) are always added; other schedule and annexure pages
   when they score reasonably. Pages whose heading names the clause
   ("7.5 Retention Money") are added.
4. Choice-field pages ("Yes/No", "Applicable/Not Applicable") are always added:
   they switch clauses on or off (trap T1).
5. Page breaks. When a kept page has a specific hit near its end, the next
   page is added.
6. Unsearchable pages (scans, image-only pages) are added: text search cannot
   rule them out, so the model must look at them.
7. C0 also gets the first pages of each document (cover, parties).

Recall matters more than precision here: the extraction step may send the
whole package when it fits and use these pages only as hints.
"""
from __future__ import annotations

import math
import re
from functools import lru_cache

from ..models import Package, PageInfo, RetrievalResult, SectionEntry
from .docmap import build_document_map, is_toc_page
from .terms import TERM_LISTS, term_weight

TOP_K_MIN = 12             # always keep at least this many best pages ...
TOP_K_SHARE = 0.05         # ... or this share of the package, whichever is larger
TOP_K_MAX = 25
REL_SCORE = 0.30           # also keep pages scoring at least 30% of the best page
SECTION_REL_SCORE = 0.15   # schedule/annexure/pointer-target pages need 15% of the best page
NEAR_HIT_CHARS = 200       # window around a hit in which pointers count
DATA_LABELS = ("schedule", "annex", "appendix", "contract data", "bid data")
TAIL_SHARE = 0.25          # a specific hit in the last 25% of a page pulls in the next page
TAIL_MIN_IDF = 0.4         # ... "specific" = a non-generic term that is not on most pages
MAX_SECTION_PAGES = {"schedule": 6, "annexure": 4, "contract_data": 6, "clause": 2,
                     "amendment": 3, "other": 2}
SECTION_KINDS = ("schedule", "annexure", "contract_data", "other")
FRONT_PAGES_C0 = 2
RARE_MIN_PAGES = 2         # a phrase found on at most this many pages ...
RARE_SHARE = 0.02          # ... (or 2% of the package) is "rare": all its pages are kept
COMPACT_SCHEDULE_PAGES = 10   # a schedule block this small is the contract's data sheet

POINTER_RE = re.compile(
    r"(?:Schedule|SCHEDULE)(?:\s*[-–—]\s*|\s+|\s*['‘’])['‘’]?[A-Z](?![A-Za-z0-9])"
    r"|(?:Annexure|ANNEXURE|Annex|ANNEX|Appendix|APPENDIX)(?:\s*[-–—]\s*|\s+|\s*['‘’])['‘’]?"
    r"(?:[A-Z](?:-\d)?|[IVX]{1,4}|\d{1,2})(?![A-Za-z0-9])"
    r"|Contract\s+Data|CONTRACT\s+DATA|Bid\s+Data\s+Sheet|BID\s+DATA\s+SHEET"
    r"|(?:Clause|CLAUSE|Cl\.)\s*\d{1,2}(?:\s?[A-Z]{1,3}(?![A-Za-z]))?(?:\.\d{1,2}){0,3}"
    r"|(?:GCC|ITB|SCC|BDS)\s*(?:Clause\s*)?\d{1,2}(?:\.\d{1,2})*")

Key = tuple[str, int]      # (doc_id, page)


# ---------------------------------------------------------------------------
# term matching
# ---------------------------------------------------------------------------

def _squash(text: str) -> tuple[str, list[int]]:
    """Lower-case text with all whitespace removed, plus the original index of each kept char.

    Matching on squashed text survives broken spacing such as "0 .05% pe r day" (trap T17).
    """
    chars, index = [], []
    for i, ch in enumerate(text.lower()):
        if not ch.isspace():
            chars.append(ch)
            index.append(i)
    return "".join(chars), index


@lru_cache(maxsize=512)
def _term_regex(term: str) -> re.Pattern:
    """Regex for short or wildcard terms, matched on normal lower-case text ("#" = a number)."""
    rx = r"\s*".join(re.escape(p) for p in term.lower().split())
    rx = rx.replace(r"\#", r"\d[\d,.]*\s*(?:\([^)]{0,30}\)\s*)?")
    lead = r"\b" if term[0].isalnum() else ""
    tail = r"\b" if term[-1].isalnum() else ""
    return re.compile(lead + rx + tail)


def _uses_regex(term: str) -> bool:
    """Short terms ("emd", "10cc") need word boundaries; wildcard terms need a regex."""
    return "#" in term or len(term.replace(" ", "")) < 6


def page_term_hits(page: PageInfo, terms: list[str]) -> dict[str, list[int]]:
    """{term: [character positions in page.text]} for every term found on the page."""
    lower = page.text.lower()
    squashed, index = _squash(page.text)
    out: dict[str, list[int]] = {}
    for t in terms:
        if _uses_regex(t):
            pos = [m.start() for m in _term_regex(t).finditer(lower)]
        else:
            key = re.escape(t.lower().replace(" ", ""))
            pos = [index[m.start()] for m in re.finditer(key, squashed)]
        if pos:
            out[t] = pos
    return out


def _idf(df: int, n_pages: int) -> float:
    """1.0 for a term on one page, falling towards 0 for a term on every page."""
    return math.log(1 + n_pages / max(df, 1)) / math.log(1 + n_pages)


def score_hits(hits: dict[str, list[int]], char_count: int,
               idf: dict[str, float] | None = None) -> float:
    """Weighted hit score, normalised by page length (hit density)."""
    raw = sum(term_weight(t) * (idf or {}).get(t, 1.0) * min(len(pos), 3) for t, pos in hits.items())
    return raw / math.sqrt(max(char_count, 1500) / 1500)


# ---------------------------------------------------------------------------
# pointers
# ---------------------------------------------------------------------------

def _canon_ref(text: str) -> str:
    """Normalise a label so headings and pointers compare equal: 'SCHEDULE - F' -> 'schedule f'."""
    t = " ".join(text.replace("‘", " ").replace("’", " ").replace("'", " ").split()).lower()
    t = re.sub(r"\s*[-–—]\s*", " ", t)
    t = re.sub(r"^(annex|appendix)\b", "annexure", t)
    t = re.sub(r"^cl\.\s*", "clause ", t)
    t = re.sub(r"^(clause \d+)\s+([a-z]{1,3})\b", r"\1\2", t)       # "clause 10 ca" -> "clause 10ca"
    t = re.sub(r"\s*\(.*$", "", t)                                   # drop "(ii)"
    t = t.replace("contract data sheet", "contract data")
    return t.strip()


def _section_pages(package: Package, doc_map: list[SectionEntry], idx: int) -> list[Key]:
    """Pages from a heading up to the next section heading (capped by kind)."""
    e = doc_map[idx]
    last_page = max((p.page for p in package.pages if p.doc_id == e.doc_id), default=e.page)
    end = min(e.page + MAX_SECTION_PAGES.get(e.kind, 2) - 1, last_page)
    if e.kind != "clause":
        for nxt in doc_map[idx + 1:]:
            if nxt.doc_id != e.doc_id:
                break
            if nxt.page > e.page and nxt.kind in SECTION_KINDS and _canon_ref(nxt.ref) != _canon_ref(e.ref):
                end = min(end, nxt.page)          # keep the page where the next section starts
                break
    return [(e.doc_id, pg) for pg in range(e.page, end + 1)]


def _resolve_sections(package: Package, label: str, doc_map: list[SectionEntry]) -> list[list[Key]]:
    """Page ranges of every section whose heading matches the label."""
    want = _canon_ref(label)
    if want.startswith("bid data sheet"):
        want = "bid data sheet"
    sections = []
    for i, e in enumerate(doc_map):
        have = _canon_ref(e.ref)
        same = have == want or (want.startswith("clause") and have.startswith(want)
                                and not have[len(want):len(want) + 1].isalnum())
        if same:
            sections.append(_section_pages(package, doc_map, i))
    return sections


def resolve_pointer(package: Package, pointer_text: str,
                    doc_map: list[SectionEntry]) -> list[Key]:
    """Pages that a pointer such as 'as per Schedule F', 'Contract Data' or 'Clause 7.5' points to.

    Uses the document map; when no heading matches, falls back to pages that
    show the label within their first lines.
    """
    pages: list[Key] = []
    labels = [m.group(0) for m in POINTER_RE.finditer(pointer_text)]
    for label in labels:
        for sec in _resolve_sections(package, label, doc_map):
            pages += sec
    if not pages:
        for label in labels:
            if label.lower().startswith(("clause", "cl.")):
                continue
            rx = re.compile(r"\s*".join(re.escape(w) for w in label.split()), re.I)
            pages += [(p.doc_id, p.page) for p in package.pages if rx.search(p.text[:300])]
    return sorted(set(pages))


def _compact_schedule_pages(package: Package, doc_map: list[SectionEntry]) -> set[Key]:
    """Schedule pages of every document whose schedules fit in a few pages (CPWD style)."""
    out: set[Key] = set()
    for f in package.files:
        pages: set[Key] = set()
        for i, e in enumerate(doc_map):
            if e.doc_id == f.doc_id and e.kind == "schedule":
                pages |= set(_section_pages(package, doc_map, i))
        if 0 < len(pages) <= COMPACT_SCHEDULE_PAGES:
            out |= pages
    return out


def _pointer_labels(text: str, hits: dict[str, list[int]]) -> set[str]:
    """Data-location labels (Schedule F, Annexure P, Contract Data ...) near specific hits."""
    positions = [pos for t, plist in hits.items() if term_weight(t) >= 1 for pos in plist]
    labels = set()
    for m in POINTER_RE.finditer(text):
        label = " ".join(m.group(0).split())
        if label.lower().startswith(DATA_LABELS) and any(abs(m.start() - x) <= NEAR_HIT_CHARS
                                                         for x in positions):
            labels.add(label)
    return labels


# ---------------------------------------------------------------------------
# retrieval
# ---------------------------------------------------------------------------

def _unsearchable(p: PageInfo) -> bool:
    """Scans and image-only pages: text search cannot see what is on them."""
    return p.low_text and p.needs_visual


def find_pages(package: Package, terms: list[str]) -> list[Key]:
    """Every page containing at least one of the terms, best-scoring first (used by F7/F8)."""
    scored = []
    for p in package.pages:
        hits = page_term_hits(p, terms)
        if hits:
            scored.append((score_hits(hits, p.char_count), p.doc_id, p.page))
    scored.sort(key=lambda x: (-x[0], x[1], x[2]))
    return [(d, pg) for _, d, pg in scored]


def score_pages(package: Package, terms: list[str]) -> tuple[dict[Key, dict[str, list[int]]],
                                                              dict[Key, float], dict[str, float]]:
    """Term hits, scores and idf weights for every page of the package."""
    hits_by_page: dict[Key, dict[str, list[int]]] = {}
    for p in package.pages:
        if p.char_count:
            hits = page_term_hits(p, terms)
            if hits:
                hits_by_page[(p.doc_id, p.page)] = hits
    n = max(len(package.pages), 1)
    df: dict[str, int] = {}
    for hits in hits_by_page.values():
        for t in hits:
            df[t] = df.get(t, 0) + 1
    idf = {t: _idf(c, n) for t, c in df.items()}
    char_counts = {(p.doc_id, p.page): p.char_count for p in package.pages}
    scores = {k: score_hits(h, char_counts[k], idf) for k, h in hits_by_page.items()}
    return hits_by_page, scores, idf


def retrieve(package: Package, clause_id: str,
             doc_map: list[SectionEntry] | None = None) -> RetrievalResult:
    """Candidate pages for one clause type, in reading order, with the reasons for each page."""
    if doc_map is None:
        doc_map = build_document_map(package)
    by_key = {(p.doc_id, p.page): p for p in package.pages}
    hits_by_page, scores, idf = score_pages(package, TERM_LISTS[clause_id])
    reasons: dict[Key, list[str]] = {}

    def add(key: Key, why: str) -> None:
        if key in by_key:
            lst = reasons.setdefault(key, [])
            if why not in lst and len(lst) < 8:
                lst.append(why)

    # 1. best pages by term score
    ranked = sorted(scores, key=lambda k: -scores[k])
    best = scores[ranked[0]] if ranked else 0.0
    k = min(TOP_K_MAX, max(TOP_K_MIN, math.ceil(TOP_K_SHARE * len(package.pages))))
    kept = [key for i, key in enumerate(ranked) if i < k or scores[key] >= REL_SCORE * best]
    for key in kept:
        h = hits_by_page[key]
        top = sorted(h, key=lambda t: -term_weight(t) * idf[t] * min(len(h[t]), 3))[:3]
        add(key, f"terms ({scores[key]:.1f}): " + ", ".join(top))
    section_min = SECTION_REL_SCORE * best

    # 1b. a specific phrase that occurs on only a few pages is strong evidence on its own
    df: dict[str, list[Key]] = {}
    for key, h in hits_by_page.items():
        for t in h:
            df.setdefault(t, []).append(key)
    rare_limit = max(RARE_MIN_PAGES, math.ceil(RARE_SHARE * len(package.pages)))
    for t, keys in df.items():
        if term_weight(t) >= 2 and len(keys) <= rare_limit:
            for key in keys:
                add(key, f"rare term: {t}")

    # 2. follow pointers to data locations, two rounds (T5); clause-to-clause cross
    #    references are left to F7, which calls resolve_pointer itself
    frontier, visited = list(kept), set()
    for _round in range(2):
        new_targets: list[Key] = []
        for key in frontier:
            if key in visited or key not in hits_by_page or is_toc_page(by_key[key].text):
                continue
            visited.add(key)
            for label in sorted(_pointer_labels(by_key[key].text, hits_by_page[key])):
                sections = _resolve_sections(package, label, doc_map)
                for sec in sections:
                    for j, target in enumerate(sec):
                        heading_page = j == 0 and len(sections) <= 2
                        if target != key and (heading_page or scores.get(target, 0.0) >= section_min):
                            add(target, f"pointer: {label} (from {key[0]} p{key[1]})")
                            new_targets.append(target)
        frontier = new_targets

    # 3. contract data always; schedule / annexure pages when they score reasonably.
    #    A compact schedule block (CPWD "Schedules A to F" on a few pages) is the
    #    contract data of that form, so it is always included as well.
    compact = _compact_schedule_pages(package, doc_map)
    for i, e in enumerate(doc_map):
        if e.kind == "contract_data":
            for target in _section_pages(package, doc_map, i):
                add(target, f"{e.ref} page")
        elif e.kind in ("schedule", "annexure"):
            for target in _section_pages(package, doc_map, i):
                if target in compact:
                    add(target, f"{e.ref} (compact schedule block)")
                elif scores.get(target, 0.0) >= section_min:
                    add(target, f"{e.ref} page with clause terms")

    # 3b. headings that name the clause ("7.5 Retention Money", "Clause 2 Compensation for delay")
    specific_terms = [t for t in TERM_LISTS[clause_id] if term_weight(t) >= 1]
    for e in doc_map:
        heading = f"{e.ref} {e.title}".lower()
        if any(_term_regex(t).search(heading) for t in specific_terms):
            add((e.doc_id, e.page), f"heading: {e.ref} {e.title}"[:90])

    # 4. choice fields switch clauses on or off
    for p in package.pages:
        if p.choice_fields:
            add((p.doc_id, p.page), "choice field: " + ", ".join(p.choice_fields))

    # 5. clauses that run over a page break (only specific, rare terms count)
    for key in kept:
        specific = [pos for t, plist in hits_by_page[key].items()
                    if term_weight(t) >= 1 and idf[t] >= TAIL_MIN_IDF for pos in plist]
        if specific and max(specific) >= (1 - TAIL_SHARE) * len(by_key[key].text):
            add((key[0], key[1] + 1), f"continues from p{key[1]}")

    # 6. pages text search cannot see
    for p in package.pages:
        if _unsearchable(p):
            add((p.doc_id, p.page), "unsearchable: " + "; ".join(p.visual_reasons))

    # 7. cover and parties for contract facts
    if clause_id == "C0":
        for p in package.pages:
            if p.page <= FRONT_PAGES_C0:
                add((p.doc_id, p.page), "front page")

    doc_order = {f.doc_id: i for i, f in enumerate(package.files)}
    pages = sorted(reasons, key=lambda key: (doc_order.get(key[0], 99), key[1]))
    image_pages = [key for key in pages if by_key[key].needs_visual]
    return RetrievalResult(clause_id=clause_id, pages=pages, image_pages=image_pages,
                           reasons={f"{d}:{pg}": reasons[(d, pg)] for d, pg in pages})
