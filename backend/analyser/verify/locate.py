"""Find where a quote is in a package (used by V1/V2 and the answer-key check).

The ingest module stores page text extracted with PyMuPDF ``get_text(sort=True)`` and
tidied, which can reorder table and column text. A quote copied by a person (or read in
the PDF's own order) may then not match. So a quote is looked for in three ways:

1. "sorted text": the stored ``PageInfo.text`` (exact on the compact form, then fuzzy);
2. "raw text": the page re-extracted with plain ``get_text()`` from the PDF file;
3. "PDF search": ``analyser.ingest.find_quote_rects`` on the PDF page; accepted when the
   words inside the boxes it returns cover most of the quote's words and all its numbers.

Pages are tried in the order: stated page, the pages either side, then every page.
Raw text and opened PDFs are cached per page, so only quotes that are hard to find cost time.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from analyser.models import Package, PageInfo

from .numbers import all_number_values
from .text import compact, normalise, quote_in_text, split_quote

PDF_SEARCH_COVERAGE = 0.8      # share of quote words that must lie inside the boxes found


@dataclass
class QuoteHit:
    index: int | None          # position in PageIndex.pages, None = not found
    score: float               # 100 = exact
    method: str = ""           # "sorted text", "raw text" or "PDF search"


@dataclass
class PageIndex:
    """Page texts of a package, prepared once for fast quote and number look-ups."""
    pages: list[PageInfo]
    paths: dict[str, str] = field(default_factory=dict)          # doc_id -> PDF path
    compact_text: list[str] = field(default_factory=list)
    _raw: dict[int, str] = field(default_factory=dict)
    _raw_compact: dict[int, str] = field(default_factory=dict)
    _docs: dict = field(default_factory=dict)
    _numbers: dict[int, set[float]] = field(default_factory=dict)
    _all_numbers: set[float] | None = None

    @classmethod
    def from_package(cls, package: Package) -> "PageIndex":
        paths = {f.doc_id: f.path for f in package.files if f.path and Path(f.path).exists()}
        idx = cls(pages=list(package.pages), paths=paths)
        idx.compact_text = [compact(p.text) for p in idx.pages]
        return idx

    # ------------------------------------------------------------------ numbers

    def numbers_on(self, i: int) -> set[float]:
        if i not in self._numbers:
            self._numbers[i] = all_number_values(self.pages[i].text)
        return self._numbers[i]

    def all_numbers(self) -> set[float]:
        if self._all_numbers is None:
            self._all_numbers = set()
            for i in range(len(self.pages)):
                self._all_numbers |= self.numbers_on(i)
        return self._all_numbers

    def page_positions(self, page: int, doc_id: str = "") -> list[int]:
        return [i for i, p in enumerate(self.pages)
                if p.page == page and (not doc_id or p.doc_id == doc_id)]

    # ------------------------------------------------------------------ PDF access

    def _pdf_page(self, i: int):
        """The PyMuPDF page object for pages[i], or None if the file is not available."""
        p = self.pages[i]
        path = self.paths.get(p.doc_id)
        if not path:
            return None
        try:
            if p.doc_id not in self._docs:
                import fitz
                self._docs[p.doc_id] = fitz.open(path)
            doc = self._docs[p.doc_id]
            return doc[p.page - 1] if 1 <= p.page <= doc.page_count else None
        except Exception:
            return None

    def raw_text(self, i: int) -> str:
        """Plain PyMuPDF text of pages[i] (PDF order, not sorted); cached."""
        if i not in self._raw:
            page = self._pdf_page(i)
            self._raw[i] = page.get_text() if page is not None else ""
            self._raw_compact[i] = compact(self._raw[i])
        return self._raw[i]

    def close(self) -> None:
        for doc in self._docs.values():
            doc.close()
        self._docs.clear()

    # ------------------------------------------------------------------ quote search

    def _order(self, page: int, doc_id: str) -> tuple[list[int], list[int]]:
        near: list[int] = []
        for pg in (page, page - 1, page + 1):
            near += self.page_positions(pg, doc_id)
        rest = [i for i in range(len(self.pages)) if i not in near]
        return near, rest

    def _exact(self, parts: list[str], i: int, raw: bool) -> bool:
        if raw:
            self.raw_text(i)
            text = self._raw_compact.get(i, "")
        else:
            text = self.compact_text[i]
        return bool(parts) and all(p and p in text for p in parts)

    def _pdf_search(self, quote: str, i: int) -> float:
        """Share of the quote's words inside the boxes find_quote_rects returns (0 if numbers differ)."""
        page = self._pdf_page(i)
        if page is None:
            return 0.0
        try:
            from analyser.ingest import find_quote_rects
            rects = find_quote_rects(page, quote)
        except Exception:
            return 0.0
        if not rects:
            return 0.0
        inside = " ".join(w[4] for w in page.get_text("words")
                          if any(r.intersects((w[0], w[1], w[2], w[3])) for r in rects))
        q_words = re.findall(r"[a-z0-9]+", normalise(quote))
        got = set(re.findall(r"[a-z0-9]+", normalise(inside)))
        if not q_words:
            return 0.0
        nums = set(re.findall(r"\d+", normalise(quote).replace(",", "")))
        if not nums <= set(re.findall(r"\d+", normalise(inside).replace(",", ""))):
            return 0.0
        return sum(w in got for w in q_words) / len(q_words)

    def find_quote(self, quote: str, page: int, doc_id: str = "") -> QuoteHit:
        """Where the quote is: tries the stated page, +-1, then all pages, with each method."""
        near, rest = self._order(page, doc_id)
        parts = [compact(p) for p in split_quote(quote)]
        # Exact match on the stored text anywhere (cheap; most quotes end here).
        for i in near + rest:
            if self._exact(parts, i, raw=False):
                return QuoteHit(i, 100.0, "sorted text")
        best = QuoteHit(None, 0.0)
        for group in (near, rest):
            for i in group:                                    # exact on raw text
                if self._exact(parts, i, raw=True):
                    return QuoteHit(i, 100.0, "raw text")
            scores: dict[int, float] = {}
            for i in group:                                    # fuzzy on both texts
                for method, text in (("sorted text", self.pages[i].text), ("raw text", self.raw_text(i))):
                    ok, s = quote_in_text(quote, text)
                    scores[i] = max(scores.get(i, 0.0), s)
                    if ok and (best.index is None or s > best.score):
                        best = QuoteHit(i, s, method)
                    elif not ok and best.index is None and s > best.score:
                        best.score = s
            if best.index is not None:
                return best
            # PDF search (slow): every nearby page, but elsewhere only the 3 most similar pages.
            if group is rest:
                group = sorted(group, key=lambda i: -scores.get(i, 0.0))[:3]
            for i in group:
                cover = self._pdf_search(quote, i)
                if cover >= PDF_SEARCH_COVERAGE:
                    return QuoteHit(i, round(100 * cover, 1), "PDF search")
        return best
