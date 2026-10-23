"""Trap T1: show struck-through words to the model as ~~word~~.

Ingest finds the struck words (PageInfo.strike_hits: word, bbox, context line) but the page text
does not mark them. Here each hit is located in the page text (inside its context line), runs of
neighbouring struck words are merged, and every run is wrapped once in ~~ ~~.
"""
from __future__ import annotations

import re

from ..models import PageInfo, StrikeHit

CHOICE = re.compile(r"Yes\s*/\s*No|Applicable\s*/\s*Not\s+Applicable", re.I)
MAX_LISTED = 10          # struck items named in the line under the page marker
MIN_GLOBAL_CHARS = 15    # a hit whose context is not found is searched page-wide only if this long


def _loose(text: str) -> str:
    """Regex for text with any spacing between its tokens."""
    return r"\s*".join(re.escape(tok) for tok in text.split())


def _word_pattern(word: str) -> re.Pattern:
    pattern = _loose(word)
    if len(word.split()) == 1:            # "No" must not match inside "Not" or "Nos"
        pattern = r"(?<![A-Za-z])" + pattern + r"(?![A-Za-z])"
    return re.compile(pattern)


def find_span(text: str, hit: StrikeHit) -> tuple[int, int] | None:
    """Where the struck word is in the page text, searched inside its context line first."""
    if not hit.word.strip():
        return None
    word = _word_pattern(hit.word)
    context_tokens = hit.context.split()[:10]
    if context_tokens:
        ctx = re.search(_loose(" ".join(context_tokens)), text)
        if ctx:
            end = min(len(text), ctx.start() + len(hit.context) + 200)
            match = word.search(text, ctx.start(), end)
            if match:
                return match.span()
    if len(hit.word) >= MIN_GLOBAL_CHARS:
        match = word.search(text)
        if match:
            return match.span()
    return None


def merge_spans(text: str, spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge overlapping spans and spans separated only by white space (one run, one ~~ pair)."""
    merged: list[list[int]] = []
    for start, end in sorted(set(spans)):
        if merged and (start <= merged[-1][1] or not text[merged[-1][1]:start].strip()):
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


def mark_struck(text: str, hits: list[StrikeHit]) -> str:
    """Page text with every located struck run wrapped as ~~run~~."""
    spans = [s for s in (find_span(text, h) for h in hits) if s]
    for start, end in reversed(merge_spans(text, spans)):
        text = text[:start] + "~~" + text[start:end] + "~~" + text[end:]
    return text


def struck_summary(hits: list[StrikeHit]) -> str:
    """'[struck-through words on this page: "No" (in "Yes/No"), ...]' or '' when none."""
    items = []
    for hit in hits:
        word = " ".join(hit.word.split())
        shown = word if len(word) <= 60 else word[:57] + "..."
        choice = CHOICE.search(hit.context)
        if choice:
            items.append(f'"{shown}" (in "{" ".join(choice.group(0).split())}")')
        else:
            items.append(f'"{shown}"')
    items = list(dict.fromkeys(items))
    if not items:
        return ""
    extra = f", and {len(items) - MAX_LISTED} more" if len(items) > MAX_LISTED else ""
    return "[struck-through words on this page: " + ", ".join(items[:MAX_LISTED]) + extra + "]"


def page_text_with_strikes(page: PageInfo) -> str:
    """Summary line (if any) followed by the marked page text."""
    text = (page.text or "").strip()
    if not page.strike_hits:
        return text
    return struck_summary(page.strike_hits) + "\n" + mark_struck(text, page.strike_hits)
