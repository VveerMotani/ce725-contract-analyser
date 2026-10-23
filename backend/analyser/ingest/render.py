"""Render a PDF page to PNG, optionally highlighting a quote (source viewer, F3 images).

Finding the quote on the page is done in three steps, from exact to fuzzy:
1. ``page.search_for`` with the whole quote (whitespace normalised).
2. ``page.search_for`` with progressively shorter chunks of the quote
   (12, 8 then 5 words); every chunk that is found is highlighted.
3. Fuzzy match over the page's word sequence with rapidfuzz (handles broken
   text such as "0 .05% pe r day", trap T17).
"""
from __future__ import annotations

import re

import fitz  # PyMuPDF
from rapidfuzz import fuzz

HIGHLIGHT_FILL = (1.0, 0.92, 0.0)    # yellow
HIGHLIGHT_OPACITY = 0.35
FUZZY_MIN_SCORE = 72.0

_QUOTES = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'",
                         "–": "-", "—": "-", "�": " "})


def normalise(text: str) -> str:
    """Collapse whitespace and straighten quotes/dashes."""
    return " ".join(text.translate(_QUOTES).split())


def _token(w: str) -> str:
    return re.sub(r"[^0-9a-z%]", "", w.lower().translate(_QUOTES))


def _merge_line_rects(rects: list[fitz.Rect]) -> list[fitz.Rect]:
    """Join word boxes that sit on the same text line into one box per line."""
    merged: list[fitz.Rect] = []
    for r in sorted(rects, key=lambda r: (round(r.y0), r.x0)):
        if merged and abs(merged[-1].y0 - r.y0) < 3 and r.x0 - merged[-1].x1 < 15:
            merged[-1] |= r
        else:
            merged.append(fitz.Rect(r))
    return merged


def _fuzzy_rects(page: fitz.Page, quote: str) -> list[fitz.Rect]:
    """Best fuzzy match of the quote over the page's word sequence."""
    words = [w for w in page.get_text("words", sort=True) if _token(w[4])]
    q_tokens = [t for t in (_token(w) for w in quote.split()) if t]
    if not words or not q_tokens:
        return []
    q = " ".join(q_tokens)
    tokens = [_token(w[4]) for w in words]
    n = len(q_tokens)
    best, best_i, best_len = 0.0, -1, n
    for size in {max(1, n - 2), n, n + 2}:             # allow a few split/merged words
        for i in range(0, max(1, len(tokens) - size + 1)):
            score = fuzz.ratio(q, " ".join(tokens[i:i + size]))
            if score > best:
                best, best_i, best_len = score, i, size
    if best < FUZZY_MIN_SCORE or best_i < 0:
        return []
    return [fitz.Rect(w[:4]) for w in words[best_i:best_i + best_len]]


def find_quote_rects(page: fitz.Page, quote: str) -> list[fitz.Rect]:
    """Boxes (one per text line) covering the best match of quote on the page."""
    q = normalise(quote)
    if not q:
        return []
    hits = page.search_for(q)
    if hits:
        return _merge_line_rects(hits)
    words = q.split()
    for size in (12, 8, 5):
        if len(words) <= size:
            continue
        chunks = [" ".join(words[i:i + size]) for i in range(0, len(words), size)]
        found: list[fitz.Rect] = []
        n_found = 0
        for chunk in chunks:
            rects = page.search_for(chunk) if len(chunk) >= 12 else []
            n_found += bool(rects)
            found += rects
        # at least half of the chunks must be on the page, else a common phrase
        # ("the contractor shall") could make an invented quote look found
        if n_found and n_found >= len(chunks) / 2:
            return _merge_line_rects(found)
    return _merge_line_rects(_fuzzy_rects(page, q))


def render_page_png(pdf_path: str, page: int, zoom: float = 2.0,
                    highlight: str | None = None) -> bytes:
    """PNG bytes of a 1-based page; draws semi-transparent yellow boxes over the highlight text."""
    with fitz.open(pdf_path) as doc:
        if not 1 <= page <= doc.page_count:
            raise ValueError(f"page {page} out of range 1..{doc.page_count}")
        pg = doc[page - 1]
        if highlight:
            # drawing changes only the in-memory copy; the file on disk is untouched
            for r in find_quote_rects(pg, highlight):
                r = fitz.Rect(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1)
                pg.draw_rect(r, color=(0.9, 0.6, 0.0), fill=HIGHLIGHT_FILL,
                             fill_opacity=HIGHLIGHT_OPACITY, stroke_opacity=0.8, width=0.6)
        pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("png")
