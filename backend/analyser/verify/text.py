"""Text normalisation and quote matching (check V1, trap T17).

Two normal forms are used:

* ``normalise(text)``: lower case, one kind of quote and dash, hyphenated line
  breaks joined, split digits repaired ("0 .05%" -> "0.05%"), whitespace collapsed.
  Used for fuzzy matching and for showing text.
* ``compact(text)``: ``normalise`` and then only letters, digits, "." and "%" kept.
  Spaces and punctuation vanish, so a quote copied across a line break, a
  hyphenation or odd PDF punctuation still matches exactly.

``quote_in_text`` tries an exact match on the compact form first and falls back to
rapidfuzz ``partial_ratio`` (best-matching window of the page). A fuzzy match is only
accepted if every number in the quote also appears in the matched window, so a real
sentence with one number changed (a planted fake quote) still fails.
"""
from __future__ import annotations

import re
import unicodedata

from rapidfuzz import fuzz

# A fuzzy match must reach this partial_ratio score (0-100) to count as found.
# All 189 golden quotes match exactly (compact form). Misread letters score 95-99;
# invented sentences in contract vocabulary score 50-80 (tests/test_verify_quotes.py).
FUZZY_THRESHOLD = 92.0

_QUOTE_CHARS = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "`": "'",
    "“": '"', "”": '"', "„": '"', "″": '"',
}
_DASH_CHARS = "‐‑‒–—―−­"


def normalise(text: str) -> str:
    """Lower-case, unify quotes and dashes, join hyphenated breaks, repair split digits."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    for k, v in _QUOTE_CHARS.items():
        t = t.replace(k, v)
    for d in _DASH_CHARS:
        t = t.replace(d, "-")
    t = t.replace("�", " ")              # unreadable glyphs from the PDF
    t = t.lower()
    t = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", t)   # "per-\nformance" -> "performance"
    t = re.sub(r"\s+", " ", t)
    t = fix_split_digits(t)
    return t.strip()


def fix_split_digits(t: str) -> str:
    """Remove spaces inside numbers broken by the text layer (trap T17)."""
    t = re.sub(r"(\d)\s+([.,])\s*(\d)", r"\1\2\3", t)   # "0 .05" -> "0.05"
    t = re.sub(r"(\d)([.,])\s+(\d)", r"\1\2\3", t)       # "0. 05" -> "0.05"
    t = re.sub(r"(\d)\s+%", r"\1%", t)                   # "10 %" -> "10%"
    return t


def compact(text: str) -> str:
    """Normalised text with only letters, digits, '.' and '%' (no spaces)."""
    return re.sub(r"[^a-z0-9.%]", "", normalise(text))


def _numbers(norm_text: str) -> set[str]:
    """Digit strings in a normalised text, commas removed ("4,24,547" -> "424547")."""
    return {n.replace(",", "").rstrip(".") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", norm_text)}


def split_quote(quote: str) -> list[str]:
    """A quote with an ellipsis is several runs; each run is checked on its own."""
    parts = re.split(r"\.\.\.+|…|\[\.\.\.\]", quote or "")
    return [p for p in parts if len(compact(p)) >= 3] or ([quote] if quote else [])


def _match_one(quote: str, text: str) -> tuple[bool, float]:
    cq, ct = compact(quote), compact(text)
    if not cq:
        return False, 0.0
    if cq in ct:
        return True, 100.0
    nq, nt = normalise(quote), normalise(text)
    if not nt:
        return False, 0.0
    al = fuzz.partial_ratio_alignment(nq, nt)
    if al is None:
        return False, 0.0
    score = float(al.score)
    if score < FUZZY_THRESHOLD:
        return False, score
    # Guard: every number in the quote must be in the matched window (+ a little margin).
    window = nt[max(0, al.dest_start - 20): al.dest_end + 20]
    if not _numbers(nq) <= _numbers(window):
        return False, min(score, FUZZY_THRESHOLD - 0.1)
    # Guard: a "not" or "no" added to a real sentence changes its meaning.
    if _negations(nq) > _negations(window):
        return False, min(score, FUZZY_THRESHOLD - 0.1)
    return True, score


def _negations(norm_text: str) -> int:
    return len(re.findall(r"\b(?:not|no|never|nil|without|neither|nor)\b", norm_text))


def quote_in_text(quote: str, text: str) -> tuple[bool, float]:
    """Is ``quote`` in ``text``? Returns (found, score 0-100); 100 = exact match.

    Tolerates line breaks, hyphenation, curly quotes, dashes, split digits and a few
    misread characters. A quote with "..." is split into runs that must all be found.
    """
    parts = split_quote(quote)
    if not parts or not text:
        return False, 0.0
    results = [_match_one(p, text) for p in parts]
    found = all(f for f, _ in results)
    return found, min(s for _, s in results)
