"""Regression: V1 on golden quotes with the REAL ingest package.

Ingest stores page text from get_text(sort=True), which reorders tables and columns, while
the golden quotes follow the PDF's own order. V1 must still find them (raw text / PDF search).
"""
import time

import pytest

from analyser import config
from analyser.evaluate.golden_check import golden_envelopes
from analyser.verify import verify_answers
from analyser.verify.locate import PageIndex

PDFS_PRESENT = all((config.BENCHMARK_DIR / b["files"][0][0]).exists() for b in config.BENCHMARKS.values())
pytestmark = pytest.mark.skipif(not PDFS_PRESENT, reason="benchmark PDFs not available")

ingest = pytest.importorskip("analyser.ingest")


@pytest.mark.parametrize("cid", ["BM2", "BM3", "BM4"])
def test_v1_passes_for_every_golden_quote_on_ingest_text(cid):
    pkg = ingest.benchmark_package(cid)
    envs = golden_envelopes()[cid]
    start = time.time()
    verify_answers(envs, pkg)
    assert time.time() - start < 10
    failed = [e.answer.question_id for e in envs
              if e.answer.verbatim_quote and not e.verification.quote_found]
    assert failed == []
    methods = {e.verification.checks[0].detail for e in envs if e.verification.quote_found}
    print(cid, sorted(methods))
    # BM3-2.7 is the only golden answer without a quote (FOUND without proof -> discarded)
    discarded = [e.answer.question_id for e in envs if e.verification.discard]
    assert discarded == (["2.7"] if cid == "BM3" else [])


def test_pdf_search_fallback_accepts_real_and_rejects_fake_quotes():
    pkg = ingest.benchmark_package("BM4")
    idx = PageIndex.from_package(pkg)
    g = next(e.answer for e in golden_envelopes()["BM4"] if e.answer.question_id == "1.3")
    i = idx.page_positions(g.pdf_page)[0]
    assert idx._pdf_search(g.verbatim_quote, i) >= 0.8
    assert idx._pdf_search("The contractor shall be paid a mobilisation advance of 25% "
                           "free of interest within seven days", i) < 0.8
    idx.close()


def test_scrambled_stored_text_is_found_in_raw_text():
    pkg = ingest.benchmark_package("BM4").model_copy(deep=True)
    g = next(e.answer for e in golden_envelopes()["BM4"] if e.answer.question_id == "2.2")
    for p in pkg.pages:
        if p.page == g.pdf_page:
            p.text = " ".join(reversed(p.text.split()))        # a badly ordered text layer
    idx = PageIndex.from_package(pkg)
    hit = idx.find_quote(g.verbatim_quote, g.pdf_page)
    assert hit.index is not None and pkg.pages[hit.index].page == g.pdf_page
    assert hit.method in ("raw text", "PDF search")
    idx.close()
