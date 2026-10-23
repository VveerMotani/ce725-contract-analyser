"""Helpers that use the golden tests themselves.

* ``golden_envelopes``: turn expected answers into AnswerEnvelopes (for the sanity test:
  the key scored against itself must give 100%).
* ``pdf_package``: a simple Package straight from a benchmark PDF with PyMuPDF (one
  PageInfo per page), so the verifier can be tested without the ingest module.
* ``check_key_quotes``: does each golden quote verify on its stated page? This checks the
  answer key itself (spec 10.1).

    python -m analyser.evaluate.golden_check
"""
from __future__ import annotations

from pathlib import Path

from analyser import config
from analyser.models import Answer, AnswerEnvelope, DocumentFile, Package, PageInfo

from .scoring import load_golden


def golden_answer(g: dict) -> Answer:
    visual = bool(g.get("scanned_or_visual_only"))
    return Answer(
        contract_id=g["contract_id"], clause_id=g["clause_id"], question_id=g["question_id"],
        status=g["expected_status"], answer_value=g.get("expected_answer", ""),
        unit=g.get("expected_unit", ""), section_ref=g.get("section_ref", ""),
        pdf_page=int(g.get("pdf_page") or 0), verbatim_quote=g.get("verbatim_quote", ""),
        visual_check="done" if visual else "none",
        visual_evidence=g.get("notes", "") if visual else "",
        confidence="high", notes=g.get("notes", "")[:300],
    )


def golden_envelopes(golden: list[dict] | None = None) -> dict[str, list[AnswerEnvelope]]:
    """Expected answers as envelopes, grouped by contract."""
    out: dict[str, list[AnswerEnvelope]] = {}
    for g in golden if golden is not None else load_golden():
        env = AnswerEnvelope(question=g.get("question", ""), answer=golden_answer(g))
        out.setdefault(g["contract_id"], []).append(env)
    return out


def pdf_package(contract_id: str, doc_id: str = "d1") -> Package:
    """Package for a benchmark contract built directly with PyMuPDF (text only)."""
    import fitz

    filename = config.BENCHMARKS[contract_id]["files"][0][0]
    path = Path(config.BENCHMARK_DIR) / filename
    pages = []
    with fitz.open(path) as doc:
        for i, p in enumerate(doc):
            text = p.get_text()
            pages.append(PageInfo(doc_id=doc_id, page=i + 1, text=text, char_count=len(text),
                                  image_count=len(p.get_images()), low_text=len(text.strip()) < 50))
        n = doc.page_count
    files = [DocumentFile(doc_id=doc_id, filename=filename, path=str(path), sha256="", page_count=n)]
    return Package(package_id=contract_id, contract_id=contract_id, files=files, pages=pages)


def check_key_quotes(golden: list[dict] | None = None) -> list[dict]:
    """For every golden quote: found on the stated page, on another page, or nowhere."""
    from analyser.verify.checks import PageIndex

    golden = golden if golden is not None else load_golden()
    rows = []
    for cid in sorted({g["contract_id"] for g in golden}):
        idx = PageIndex.from_package(pdf_package(cid))
        for g in golden:
            if g["contract_id"] != cid or not g.get("verbatim_quote"):
                continue
            i, score = idx.find_quote(g["verbatim_quote"], int(g["pdf_page"]))
            found_page = idx.pages[i].page if i is not None else 0
            rows.append({"test_id": g["test_id"], "stated_page": g["pdf_page"],
                         "found_page": found_page, "score": round(score, 1),
                         "on_stated_page": found_page == g["pdf_page"]})
    return rows


if __name__ == "__main__":
    rows = check_key_quotes()
    ok = [r for r in rows if r["on_stated_page"]]
    print(f"{len(ok)} of {len(rows)} golden quotes verify on their stated page")
    for r in rows:
        if not r["on_stated_page"]:
            where = f"page {r['found_page']}" if r["found_page"] else "nowhere"
            print(f"  {r['test_id']}: stated page {r['stated_page']}, found {where} (score {r['score']})")
