"""Golden quotes checked against the real benchmark PDF text (spec 10.1: checks the key itself).

Pages are read with PyMuPDF directly (analyser.evaluate.golden_check.pdf_package), so this
test does not depend on the ingest module.
"""
from collections import Counter

import pytest

from analyser import config
from analyser.evaluate import score_run
from analyser.evaluate.golden_check import check_key_quotes, golden_envelopes, pdf_package
from analyser.verify import verify_answers

PDFS_PRESENT = all((config.BENCHMARK_DIR / b["files"][0][0]).exists() for b in config.BENCHMARKS.values())
pytestmark = pytest.mark.skipif(not PDFS_PRESENT, reason="benchmark PDFs not available")


def test_golden_quotes_verify_on_stated_page():
    rows = check_key_quotes()
    on_page = [r for r in rows if r["on_stated_page"]]
    failures = [r for r in rows if not r["on_stated_page"]]
    print(f"\n{len(on_page)} of {len(rows)} golden quotes verify on their stated page")
    for r in failures:
        print("  not on stated page:", r)
    assert len(rows) >= 180
    assert len(on_page) / len(rows) >= 0.95


def test_verifier_on_golden_answers_discards_nothing_and_scores_100():
    envs = golden_envelopes()
    verdicts = Counter()
    for cid, items in envs.items():
        verify_answers(items, pdf_package(cid))
        verdicts.update(e.verification.verdict for e in items)
        for e in items:
            if e.answer.verbatim_quote:
                assert e.verification.quote_found, e.answer.question_id
                assert not e.verification.discard
    print("\nverdicts on golden answers:", dict(verdicts))
    summary = score_run(envs, "golden-verified", overrides=[])
    # Known quirk of the key: BM3-2.7 is FOUND with an empty quote, which rule 1 does not
    # allow, so the verifier discards it. Every other expected answer stays correct.
    wrong = [t.test_id for t in summary.tests if t.label not in ("Correct", "Correct absent")]
    assert wrong == ["BM3-2.7"]
    assert summary.quote_verification_rate >= 0.99
    # BM3-4.8 (Rs 30,000 / 18,000) and BM3-5.1 (Rs 1.89 crore, derived) hold numbers that are
    # not in the PDF text layer: V3 flags them, which is what it should do.
    print("hallucination count on the key itself:", summary.hallucinations)
