"""Trap T1: find words that have a line drawn through them (strike-through).

Some tender schedules print "Yes/No" or "Applicable/Not Applicable" and then
strike out the option that does NOT apply by drawing a thin horizontal line
over it. The text layer still contains both words, so a text-only reader sees
"Yes/No" and cannot tell which option was chosen.

Method (pure geometry, no AI):
1. Collect thin horizontal drawing objects on the page (``page.get_drawings()``):
   line segments and very flat rectangles (height <= MAX_LINE_THICKNESS).
2. Get every character with its box (``page.get_text("rawdict")``).
3. A character is "struck" when such a line crosses it horizontally (the
   character's centre is inside the line's x-range) AND vertically just above
   the text baseline, at 10-55% of the font size: that is where a strike line
   sits. An underline or a table rule sits on or below the baseline, a border
   above the letters. (Using the baseline instead of the character box matters:
   some fonts report boxes twice as tall as the letters.)
4. Consecutive struck characters on the same text line form one StrikeHit.
"""
from __future__ import annotations

import fitz  # PyMuPDF

from ..models import StrikeHit

MAX_LINE_THICKNESS = 2.5     # points; thicker shapes are boxes or shading, not strokes
MIN_LINE_LENGTH = 4.0        # points; ignore dots and tiny ticks
STRIKE_BAND = (0.10, 0.55)   # height of a strike line above the baseline, as a share of font size


def horizontal_segments(page: fitz.Page) -> list[tuple[float, float, float]]:
    """Return thin horizontal strokes on the page as (x0, x1, y)."""
    segs: list[tuple[float, float, float]] = []
    for d in page.get_drawings():
        for item in d["items"]:
            kind = item[0]
            if kind == "l":                                   # straight line p1 -> p2
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) <= 1.0 and abs(p2.x - p1.x) >= MIN_LINE_LENGTH:
                    segs.append((min(p1.x, p2.x), max(p1.x, p2.x), (p1.y + p2.y) / 2))
            elif kind in ("re", "qu"):                        # rectangle or quad
                r = item[1].rect if kind == "qu" else item[1]
                if r.height <= MAX_LINE_THICKNESS and r.width >= MIN_LINE_LENGTH:
                    segs.append((r.x0, r.x1, (r.y0 + r.y1) / 2))
    return segs


def _is_struck(char: dict, size: float, segs) -> bool:
    """True when a horizontal stroke crosses this character at strike-through height."""
    x0, _, x1, _ = char["bbox"]
    if x1 <= x0 or size <= 0:
        return False
    cx = (x0 + x1) / 2
    baseline = char["origin"][1]
    lo, hi = baseline - STRIKE_BAND[1] * size, baseline - STRIKE_BAND[0] * size
    return any(sx0 <= cx <= sx1 and lo <= sy <= hi for sx0, sx1, sy in segs)


def _row_text(words, box) -> str:
    """Text of all words on the same visual row as box (gives the hit its context)."""
    cy = (box[1] + box[3]) / 2
    half = max((box[3] - box[1]) / 2, 2.0)
    row = sorted((w for w in words if abs((w[1] + w[3]) / 2 - cy) <= half), key=lambda w: w[0])
    return " ".join(w[4] for w in row)[:200]


def find_strike_hits(page: fitz.Page) -> list[StrikeHit]:
    """Return every run of struck-through characters on the page."""
    segs = horizontal_segments(page)
    if not segs:
        return []
    # quick filter: keep only segments that overlap some word box at all
    words = page.get_text("words")
    segs = [s for s in segs
            if any(w[0] <= s[1] and s[0] <= w[2] and w[1] <= s[2] <= w[3] for w in words)]
    if not segs:
        return []

    hits: list[StrikeHit] = []
    raw = page.get_text("rawdict")
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            chars = [(c, span["size"]) for span in line["spans"] for c in span["chars"]]
            run: list[dict] = []
            for c, size in chars + [(None, 0.0)]:          # None flushes the last run
                if c is not None and _is_struck(c, size, segs):
                    run.append(c)
                    continue
                if run:
                    word = "".join(x["c"] for x in run).strip(" /|,;:")
                    if any(ch.isalnum() for ch in word):
                        box = [min(x["bbox"][0] for x in run), min(x["bbox"][1] for x in run),
                               max(x["bbox"][2] for x in run), max(x["bbox"][3] for x in run)]
                        hits.append(StrikeHit(word=word, bbox=[round(v, 1) for v in box],
                                              context=_row_text(words, box)))
                    run = []
    return hits
