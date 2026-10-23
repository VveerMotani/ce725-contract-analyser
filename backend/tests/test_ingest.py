"""Tests for M1 ingest (F1 package intake, F2 page parsing, F3 visual triggers, rendering).

Run from backend/:  python -m pytest tests/test_ingest.py -q
The first run parses the benchmark PDFs (about 10 s); later runs use the cache in runs/packages/.
"""
from __future__ import annotations

import fitz
import pytest

from analyser import config
from analyser.ingest import (benchmark_package, build_package, dev_package, find_quote_rects,
                             load_package, render_page_png)
from analyser.ingest import package as package_mod
from analyser.ingest.missing import heading_labels
from analyser.ingest.parse import is_garbled

BM2_PDF = str(config.BENCHMARK_DIR / "BM2_IIT_Bombay_Chemistry_Lab_Tender.pdf")


def page(pkg, n):
    return next(p for p in pkg.pages if p.page == n)


@pytest.mark.parametrize("contract_id,pages", [("BM1", 250), ("BM2", 114), ("BM3", 93), ("BM4", 38)])
def test_benchmark_page_counts(contract_id, pages):
    pkg = benchmark_package(contract_id)
    assert pkg.package_id == contract_id
    assert len(pkg.pages) == pages
    assert pkg.files[0].page_count == pages
    assert len(pkg.files[0].sha256) == 64
    assert [p.page for p in pkg.pages] == list(range(1, pages + 1))


def test_reference_gcc_page_count():
    pkg = dev_package("Reference_CPWD_GCC_2023.pdf")
    assert pkg.package_id == "DEV_Reference_CPWD_GCC_2023"
    assert len(pkg.pages) == 208


def test_dev_package_refuses_test_contracts():
    with pytest.raises(ValueError):
        dev_package("BM1_NHAI_Makhu_Town_EPC_Agreement.pdf")


# --- trap T1: strike-through detection -------------------------------------------------------

def test_strike_bm2_schedule_f_mobilisation_advance():
    """BM2 p109: in 'Whether Clause 10 B (ii) shall be applicable Yes/No' the 'No' is struck."""
    p = page(benchmark_package("BM2"), 109)
    hits = [h for h in p.strike_hits if "10 B (ii)" in h.context]
    assert [h.word for h in hits] == ["No"]
    assert "Yes/No" in p.choice_fields
    assert p.needs_visual


def test_strike_bm2_schedule_f_price_variation():
    """BM2 p110: 'Applicable' struck for 10CA, 'Not Applicable' struck for 10CC."""
    p = page(benchmark_package("BM2"), 110)
    by_clause = {("10CA" if "10CA" in h.context else "10CC"): h.word for h in p.strike_hits}
    assert by_clause == {"10CA": "Applicable", "10CC": "Not Applicable"}
    assert "Applicable/Not Applicable" in p.choice_fields


def test_strike_bm2_struck_payment_paragraph():
    """BM2 p25: the CPWD '10th working day' payment paragraph is printed struck through."""
    p = page(benchmark_package("BM2"), 25)
    assert any("10th working day" in h.word for h in p.strike_hits)


def test_no_strike_on_table_rules_and_underlines():
    """Reference GCC p157 (form with table rules and dotted fill-in lines) has no strike hits,
    and BM3 has no strike-through at all."""
    ref = dev_package("Reference_CPWD_GCC_2023.pdf")
    assert page(ref, 157).strike_hits == []
    assert all(not p.strike_hits for p in benchmark_package("BM3").pages)


# --- other F2/F3 triggers ---------------------------------------------------------------------

def test_image_only_front_pages_bm4():
    pkg = benchmark_package("BM4")
    for n in (1, 2, 3):
        p = page(pkg, n)
        assert p.low_text and p.needs_visual
        assert any("front page" in r for r in p.visual_reasons)


def test_scanned_pages_bm3():
    pkg = benchmark_package("BM3")
    for n in range(87, 94):
        assert page(pkg, n).low_text and page(pkg, n).needs_visual


def test_legacy_hindi_is_garbled():
    assert page(benchmark_package("BM3"), 82).garbled
    assert not page(benchmark_package("BM3"), 68).garbled
    assert is_garbled("fufonk vkea=.k lwpuk] fufonk dh leLr 'krsZ ,oa mijksDr lHkh 'krsZ " * 6)


def test_formula_image_bm1():
    p = page(benchmark_package("BM1"), 109)
    assert p.formula_image and p.needs_visual


def test_normal_text_page_needs_no_visual():
    p = page(benchmark_package("BM3"), 68)
    assert not p.needs_visual and p.char_count > 500


# --- F1 missing references --------------------------------------------------------------------

def test_missing_gcc_bm4():
    labels = [m.label for m in benchmark_package("BM4").missing_references]
    assert any("General Conditions of Contract" in lab and "2023" in lab for lab in labels)


def test_missing_schedules_bm1():
    refs = {m.label: m for m in benchmark_package("BM1").missing_references}
    assert "Schedule H" in refs and "Schedule A" in refs
    assert "Schedule J" not in refs           # present on p219
    assert "Schedule" in refs["Schedule H"].quote and refs["Schedule H"].page > 0


def test_no_missing_gcc_when_gcc_included():
    assert not any("General Conditions" in m.label for m in benchmark_package("BM2").missing_references)


def test_heading_labels():
    assert heading_labels("Schedule - J\n(See Clause 10.3)\ntext") == {"Schedule J"}
    assert heading_labels("SCHEDULE-G (Annex-III)\n") == {"Schedule G", "Annexure III"}
    assert heading_labels("as specified in Schedule-H;\nmore text") == set()


# --- rendering --------------------------------------------------------------------------------

def test_render_png_with_highlight():
    plain = render_page_png(BM2_PDF, 110, zoom=1.0)
    marked = render_page_png(BM2_PDF, 110, zoom=1.0, highlight="Clause 10CC Applicable/ Not Applicable")
    assert plain[:8] == b"\x89PNG\r\n\x1a\n" and marked[:8] == b"\x89PNG\r\n\x1a\n"
    assert plain != marked


def test_find_quote_handles_broken_spacing():
    """BM3 p68 text reads 'b e levied ... 0 .05% pe r day' (trap T17); the fuzzy matcher still finds it."""
    with fitz.open(config.BENCHMARK_DIR / "BM3_MP_Agro_Gwalior_Tender.pdf") as doc:
        rects = find_quote_rects(doc[67], "the compensation shall be levied on the contractor "
                                           "at the rate of 0.05% per day of delay")
        assert rects
        invented = find_quote_rects(doc[67], "The contractor shall be paid a bonus of 5% for "
                                             "early completion of the work")
        assert invented == []


def test_render_page_out_of_range():
    with pytest.raises(ValueError):
        render_page_png(BM2_PDF, 999)


# --- storage ----------------------------------------------------------------------------------

def test_package_json_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(package_mod, "PACKAGES_DIR", tmp_path)
    pdf = str(config.BENCHMARK_DIR / "BM4_MoEF_Zoological_Park_NIT.pdf")
    built = build_package([(pdf, "notice")], contract_id="TEST", title="round trip")
    assert built.package_id.startswith("TEST_")
    assert (tmp_path / built.package_id / "package.json").exists()
    assert (tmp_path / built.package_id / "pages.json").exists()
    loaded = load_package(built.package_id)
    assert loaded.model_dump() == built.model_dump()
    assert loaded.files[0].doc_id == "d1"
