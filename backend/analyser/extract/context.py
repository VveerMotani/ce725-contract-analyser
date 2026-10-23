"""What the model gets to read: page text with markers, retrieval hints, page images.

Ingest and structure are separate modules. If they are not importable yet, small keyword-based
stand-ins are used so extraction (and its tests) still run.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from ..llm.prompts import estimate_tokens
from ..models import DocumentFile, Package, PageInfo, RetrievalResult, SectionEntry
from .strike import page_text_with_strikes
from .terms import FALLBACK_TERM_LISTS

log = logging.getLogger(__name__)

FULL_TEXT_TOKEN_LIMIT = 350_000   # below this the whole package goes to every clause call (cached)
MAX_IMAGES_PER_CALL = 8
IMAGE_ZOOM = 1.5
FALLBACK_TOP_PAGES = 25
OPENING_PAGES = 5                 # used when retrieval finds no page at all


def page_marker(doc_id: str, page: int) -> str:
    return f"[[DOC {doc_id} PAGE {page}]]"


def page_block(p: PageInfo) -> str:
    """Marker line, then the page text with struck-through words shown as ~~word~~ (trap T1)."""
    return f"{page_marker(p.doc_id, p.page)}\n{page_text_with_strikes(p)}\n"


def package_text(package: Package, pages: list[tuple[str, int]] | None = None) -> str:
    """Text of the whole package (or the listed pages), each page under its marker."""
    if pages is None:
        chosen = package.pages
    else:
        lookup = page_lookup(package)
        chosen = [lookup[p] for p in pages if p in lookup]
    return "\n".join(page_block(p) for p in chosen)


def page_lookup(package: Package) -> dict[tuple[str, int], PageInfo]:
    return {(p.doc_id, p.page): p for p in package.pages}


def format_pages(pages: list[tuple[str, int]]) -> str:
    """[("d1", 12), ("d1", 13)] -> "d1 p12, d1 p13" ("none" when empty)."""
    return ", ".join(f"{d} p{n}" for d, n in pages) or "none"


def choose_mode(package: Package) -> str:
    """"full" if the whole package fits comfortably, else "retrieval"."""
    return "full" if estimate_tokens(package_text(package)) < FULL_TEXT_TOKEN_LIMIT else "retrieval"


# ---------------------------------------------------------------------------- structure adapter

def _structure():
    try:
        from .. import structure
        if hasattr(structure, "retrieve"):
            return structure
    except ImportError:
        pass
    return None


def _ingest():
    try:
        from .. import ingest
        if hasattr(ingest, "render_page_png"):
            return ingest
    except ImportError:
        pass
    return None


def term_list(clause_id: str) -> list[str]:
    structure = _structure()
    terms = getattr(structure, "TERM_LISTS", None) if structure else None
    if terms and clause_id in terms:
        return list(terms[clause_id])
    return list(FALLBACK_TERM_LISTS[clause_id])


def build_document_map(package: Package) -> list[SectionEntry] | None:
    structure = _structure()
    if structure and hasattr(structure, "build_document_map"):
        return structure.build_document_map(package)
    return None


def retrieve(package: Package, clause_id: str,
             doc_map: list[SectionEntry] | None) -> RetrievalResult:
    """F5 retrieval from the structure module, or a keyword stand-in."""
    structure = _structure()
    if structure:
        result = structure.retrieve(package, clause_id, doc_map)
    else:
        pages = sorted(_keyword_pages(package, term_list(clause_id))[:FALLBACK_TOP_PAGES])
        lookup = page_lookup(package)
        result = RetrievalResult(clause_id=clause_id, pages=pages,
                                 image_pages=[p for p in pages if lookup[p].needs_visual])
    if not result.pages:
        # Nothing matched: show the opening pages of each file (cover, NIT, contract data).
        result.pages = [(p.doc_id, p.page) for p in package.pages if p.page <= OPENING_PAGES]
    return result


def find_pages(package: Package, terms: list[str]) -> list[tuple[str, int]]:
    structure = _structure()
    if structure and hasattr(structure, "find_pages"):
        return structure.find_pages(package, terms)
    return _keyword_pages(package, terms)


def resolve_pointer(package: Package, pointer_text: str,
                    doc_map: list[SectionEntry] | None) -> list[tuple[str, int]]:
    """Pages that a pointer such as "as per Schedule F" leads to."""
    structure = _structure()
    if structure and hasattr(structure, "resolve_pointer"):
        return structure.resolve_pointer(package, pointer_text, doc_map or [])
    labels = re.findall(r"(Schedule\s+[A-Z]\b|Contract Data|Annexure[\s-]*[A-Z0-9]+|Appendix[\s-]*[A-Z0-9]+"
                        r"|Bid Data Sheet|Tender Data)", pointer_text, re.I)
    return _keyword_pages(package, labels)[:6] if labels else []


def _keyword_pages(package: Package, terms: list[str]) -> list[tuple[str, int]]:
    """Pages ranked by how many term hits they have (most first)."""
    lowered = [t.lower() for t in terms if t]
    scored = []
    for p in package.pages:
        text = (p.text or "").lower()
        hits = sum(text.count(t) for t in lowered)
        if hits:
            scored.append((-hits, p.doc_id, p.page))
    scored.sort()
    return [(d, n) for _, d, n in scored]


# ---------------------------------------------------------------------------- page images (F3)

def image_tier(info: PageInfo) -> int:
    """Which pages most need to be seen (0 first):
    0 choice fields or struck words (trap T1), 1 formula images (T2),
    2 image-only portal pages at the front (T16), 3 other scans (T3), 4 anything else flagged."""
    if info.choice_fields or info.strike_hits:
        return 0
    if info.formula_image:
        return 1
    if info.low_text and info.page <= OPENING_PAGES:
        return 2
    if info.low_text:
        return 3
    return 4


def retrieval_scores(retrieval: RetrievalResult | None) -> dict[tuple[str, int], float]:
    """Term score per page parsed from the retrieval reasons ("terms (4.6): ...")."""
    scores: dict[tuple[str, int], float] = {}
    for key, reasons in (retrieval.reasons if retrieval else {}).items():
        doc_id, _, page = key.partition(":")
        values = [float(m) for r in reasons for m in re.findall(r"terms \(([\d.]+)\)", r)]
        scores[(doc_id, int(page))] = max(values, default=0.0) + 0.01 * len(reasons)
    return scores


def visual_pages(package: Package, pages: list[tuple[str, int]],
                 extra: list[tuple[str, int]] = (),
                 scores: dict[tuple[str, int], float] | None = None,
                 ) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """(pages to send as images, pages dropped by the cap of MAX_IMAGES_PER_CALL).

    Candidates are the retrieval's image pages plus any page that needs to be seen; they are
    ranked by image_tier, then by retrieval score, then by their original order."""
    lookup = page_lookup(package)
    scores = scores or {}
    candidates: list[tuple[str, int]] = []
    for ref in list(extra) + list(pages):
        info = lookup.get(ref)
        if info is None or ref in candidates:
            continue
        if ref in extra or info.needs_visual or image_tier(info) < 2:
            candidates.append(ref)
    order = {ref: i for i, ref in enumerate(candidates)}
    ranked = sorted(candidates, key=lambda r: (image_tier(lookup[r]), -scores.get(r, 0.0), order[r]))
    return ranked[:MAX_IMAGES_PER_CALL], ranked[MAX_IMAGES_PER_CALL:]


def render_pages(package: Package, refs: list[tuple[str, int]]) -> tuple[list[bytes], list[tuple[str, int]]]:
    """PNG bytes for each page that could be rendered, and the list of those pages."""
    ingest = _ingest()
    paths = {f.doc_id: f.path for f in package.files}
    images, done = [], []
    for doc_id, page in refs:
        try:
            if ingest:
                png = ingest.render_page_png(paths[doc_id], page, zoom=IMAGE_ZOOM)
            else:
                png = _render_with_fitz(paths[doc_id], page)
        except Exception as exc:          # a page that cannot be drawn is skipped, not fatal
            log.warning("Could not render %s p%s: %s", doc_id, page, exc)
            continue
        images.append(png)
        done.append((doc_id, page))
    return images, done


def _render_with_fitz(pdf_path: str, page: int) -> bytes:
    import fitz
    with fitz.open(pdf_path) as doc:
        pix = doc[page - 1].get_pixmap(matrix=fitz.Matrix(IMAGE_ZOOM, IMAGE_ZOOM))
        return pix.tobytes("png")


# ---------------------------------------------------------------------------- package loading (CLI)

def load_package_for_cli(target: str) -> Package:
    """A benchmark id (BM1..BM4) or a PDF path -> Package, using ingest if it is available."""
    ingest = None
    try:
        from .. import ingest as _ing
        ingest = _ing if hasattr(_ing, "build_package") else None
    except ImportError:
        pass
    from .. import config
    if target.upper() in config.BENCHMARKS:
        cid = target.upper()
        if ingest:
            return ingest.benchmark_package(cid)
        files = [(str(config.BENCHMARK_DIR / name), tag) for name, tag in config.BENCHMARKS[cid]["files"]]
        return simple_package(files, cid, config.BENCHMARKS[cid]["title"])
    path = Path(target).resolve()
    if ingest:
        return ingest.build_package([(str(path), "other")], contract_id=path.stem, title=path.stem)
    return simple_package([(str(path), "other")], path.stem, path.stem)


def simple_package(files: list[tuple[str, str]], contract_id: str, title: str = "") -> Package:
    """Minimal stand-in for ingest.build_package: text per page, low-text pages flagged visual."""
    import fitz
    docs, pages = [], []
    for i, (path, tag) in enumerate(files, start=1):
        doc_id = f"d{i}"
        data = Path(path).read_bytes()
        with fitz.open(path) as pdf:
            for n, pg in enumerate(pdf, start=1):
                text = pg.get_text()
                low = len(text.strip()) < 200
                choice = re.findall(r"Yes\s*/\s*No|Applicable\s*/\s*Not Applicable", text, re.I)
                images = len(pg.get_images())
                pages.append(PageInfo(doc_id=doc_id, page=n, text=text, char_count=len(text),
                                      image_count=images, low_text=low, choice_fields=choice,
                                      needs_visual=low or bool(choice),
                                      visual_reasons=(["low text"] if low else []) +
                                                     (["choice field"] if choice else [])))
            count = pdf.page_count
        docs.append(DocumentFile(doc_id=doc_id, filename=Path(path).name, path=str(path), tag=tag,
                                 sha256=hashlib.sha256(data).hexdigest(), page_count=count))
    return Package(package_id=contract_id, contract_id=contract_id, title=title, files=docs,
                   pages=pages, created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
