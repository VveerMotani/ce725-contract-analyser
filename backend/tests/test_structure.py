"""Tests for M1 structure: document map (F4) and clause-type retrieval (F5).

Run from backend/:  python -m pytest tests/test_structure.py -q
The golden tests are used ONLY to measure retrieval recall here (is the golden
pdf_page among the retrieved pages?), never inside the retrieval code.
"""
from __future__ import annotations

import json
from functools import lru_cache

import pytest

from analyser import config
from analyser.ingest import benchmark_package
from analyser.structure import TERM_LISTS, build_document_map, find_pages, resolve_pointer, retrieve

CLAUSES = ["C0", "C1", "C2", "C3", "C4", "C5", "C6"]
CONTRACTS = ["BM1", "BM2", "BM3", "BM4"]
RECALL_OVERALL_MIN = 0.98     # measured: 153/154 = 0.994
RECALL_CONTRACT_MIN = 0.95    # measured: BM1 46/46, BM2 47/48, BM3 32/32, BM4 28/28
MAX_SHARE_OF_PACKAGE = 0.50   # average pages per clause must stay below half the package


@lru_cache(maxsize=None)
def results(contract_id: str):
    pkg = benchmark_package(contract_id)
    dm = build_document_map(pkg)
    return pkg, dm, {c: retrieve(pkg, c, dm) for c in CLAUSES}


def golden_found():
    tests = json.loads(config.GOLDEN_TESTS.read_text(encoding="utf-8"))["tests"]
    return [t for t in tests if t["expected_status"] == "FOUND" and t["pdf_page"] > 0]


def test_term_lists_cover_all_clauses():
    assert sorted(TERM_LISTS) == CLAUSES
    assert "liquidated damages" in TERM_LISTS["C4"] and "compensation for delay" in TERM_LISTS["C4"]
    assert "security deposit" in TERM_LISTS["C2"] and "retention money" in TERM_LISTS["C2"]


def test_document_map_finds_key_sections():
    _, dm2, _ = results("BM2")
    assert any(e.ref == "Schedule F" and e.page == 105 and e.kind == "schedule" for e in dm2)
    _, dm3, _ = results("BM3")
    assert any(e.kind == "contract_data" and e.page == 61 for e in dm3)
    assert any(e.ref == "Annexure P" and e.page == 68 for e in dm3)
    assert any(e.ref == "Clause 23" and "Interest" in e.title for e in dm3)
    _, dm1, _ = results("BM1")
    assert any(e.ref == "Clause 7.5" and e.page == 50 for e in dm1)
    assert any(e.ref == "Schedule J" and e.page == 219 for e in dm1)
    assert not any(e.page in range(2, 13) for e in dm1)        # table of contents is skipped


def test_resolve_pointer():
    pkg3, dm3, _ = results("BM3")
    assert ("d1", 68) in resolve_pointer(pkg3, "as per Annexure P", dm3)
    pkg2, dm2, _ = results("BM2")
    pages = resolve_pointer(pkg2, "as specified in Schedule 'F'", dm2)
    assert {("d1", n) for n in range(105, 111)} <= set(pages)
    assert ("d1", 50) in resolve_pointer(results("BM1")[0], "Clause 7.5", results("BM1")[1])


def test_find_pages():
    pkg, _, _ = results("BM3")
    hits = find_pages(pkg, ["no interest"])
    assert ("d1", 52) in hits


def test_retrieval_shape():
    pkg, _, res = results("BM2")
    by_key = {(p.doc_id, p.page): p for p in pkg.pages}
    for c, r in res.items():
        assert r.clause_id == c
        assert r.pages == sorted(r.pages, key=lambda k: k[1])               # reading order
        assert set(r.image_pages) <= set(r.pages)
        assert all(by_key[k].needs_visual for k in r.image_pages)
        assert set(r.reasons) == {f"{d}:{p}" for d, p in r.pages}
    # the struck-through Schedule F choice pages are sent as images
    assert ("d1", 109) in res["C3"].image_pages
    assert ("d1", 110) in res["C5"].image_pages


def test_retrieval_recall_on_golden_pages():
    found = golden_found()
    misses, per_contract = [], {}
    for t in found:
        _, _, res = results(t["contract_id"])
        ok = ("d1", t["pdf_page"]) in res[t["clause_id"]].pages
        a, b = per_contract.get(t["contract_id"], (0, 0))
        per_contract[t["contract_id"]] = (a + ok, b + 1)
        if not ok:
            misses.append(t["test_id"])
    overall = sum(a for a, _ in per_contract.values()) / len(found)
    assert overall >= RECALL_OVERALL_MIN, (overall, misses)
    for cid, (a, b) in per_contract.items():
        assert a / b >= RECALL_CONTRACT_MIN, (cid, a, b, misses)


@pytest.mark.parametrize("contract_id", CONTRACTS)
def test_retrieval_is_selective(contract_id):
    pkg, _, res = results(contract_id)
    avg = sum(len(r.pages) for r in res.values()) / len(res)
    assert avg <= MAX_SHARE_OF_PACKAGE * len(pkg.pages)
