"""Extraction pipeline with a fake LLM (no network, no PDFs)."""
import hashlib
import re

import pytest

from analyser.extract import QUESTIONS, extract_package
from analyser.extract import context as ctxmod
from analyser.extract import pipeline
from analyser.extract.records import normalise, schema_errors
from analyser.models import DocumentFile, Package, PageInfo

EXPECTED_IDS = {
    "C0": ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6"],
    "C1": [f"1.{i}" for i in range(1, 9)],
    "C2": [f"2.{i}" for i in range(1, 8)],
    "C3": [f"3.{i}" for i in range(1, 8)],
    "C4": [f"4.{i}" for i in range(1, 9)],
    "C5": [f"5.{i}" for i in range(1, 9)],
    "C6": [f"6.{i}" for i in range(1, 9)],
}


def fake_package(two_files=False):
    pages = [
        PageInfo(doc_id="d1", page=1, text="Retention money: 5% of each running bill shall be deducted.",
                 char_count=60),
        PageInfo(doc_id="d1", page=2, text="Liquidated damages as per Schedule F.", char_count=40),
        PageInfo(doc_id="d1", page=3, text="Schedule F\nCompensation for delay: 1% per month, maximum 10%.",
                 char_count=60, needs_visual=True, choice_fields=["Yes/No"]),
    ]
    files = [DocumentFile(doc_id="d1", filename="a.pdf", path="a.pdf", sha256="x", page_count=3)]
    if two_files:
        files.append(DocumentFile(doc_id="d2", filename="b.pdf", path="b.pdf", sha256="y", page_count=1))
        pages.append(PageInfo(doc_id="d2", page=1, text="Annexure P: nothing.", char_count=20))
    return Package(package_id="T", contract_id="TEST", files=files, pages=pages)


def record(qid, status="NOT_STATED", **kw):
    rec = {"contract_id": "TEST", "clause_id": "C" + qid[0], "question_id": qid, "doc_id": "",
           "status": status, "answer_value": "", "unit": "", "base": "", "value_source": "",
           "section_ref": "", "pdf_page": 0, "verbatim_quote": "", "conflicts": [],
           "points_to": "", "visual_check": "none", "visual_evidence": "", "confidence": "high",
           "notes": ""}
    rec.update(kw)
    return rec


class FakeLLM:
    """Answers like a model would, keyed on the call tag. Records every call."""

    def __init__(self, drop=()):
        self.calls = []
        self.drop = set(drop)

    def call_json(self, system, user_text, images=[], schema=None, call_tag="", document=None,
                  validate=None):
        self.calls.append({"tag": call_tag, "user": user_text, "document": document,
                           "images": images, "schema": schema})
        kind, _, cid = call_tag.split(":")
        qids = re.findall(r"^(\d\.\d) ", user_text.split("Questions:")[1], re.M)
        answers = []
        for qid in qids:
            if qid in self.drop and kind == "extract":
                continue
            if kind == "extract" and qid == "2.2":
                answers.append(record(qid, "FOUND", answer_value="5% of each running bill",
                                      unit="% of gross bill", base="gross bill",
                                      value_source="clause", section_ref="Cl. 1", pdf_page=1,
                                      doc_id="d1",
                                      verbatim_quote="Retention money: 5% of each running bill"))
            elif kind == "extract" and qid == "4.2":
                answers.append(record(qid, "POINTS_ELSEWHERE", answer_value="Rate as per Schedule F",
                                      section_ref="Cl. 2", pdf_page=2, doc_id="d1",
                                      verbatim_quote="Liquidated damages as per Schedule F.",
                                      points_to="Schedule F"))
            elif kind == "crossref":
                answers.append(record(qid, "FOUND", answer_value="1% per month, maximum 10%",
                                      section_ref="Schedule F", pdf_page=3, doc_id="d1",
                                      verbatim_quote="Compensation for delay: 1% per month",
                                      notes="Cl. 2 -> Schedule F"))
            elif kind == "absence" and qid == "2.3":
                answers.append(record(qid, "FOUND", answer_value="10%", section_ref="Schedule F",
                                      pdf_page=3, doc_id="d1", verbatim_quote="maximum 10%",
                                      absence_result="FOUND_PASSAGE", searched_sections=[]))
            elif kind == "absence":
                answers.append(record(qid, absence_result="CONFIRMED_ABSENT",
                                      searched_sections=["Schedule F", "Clause 1"]))
            else:
                answers.append(record(qid))
        parsed = {"answers": answers}
        if validate:
            assert validate(parsed) == [] or self.drop, validate(parsed)
        return parsed, hashlib.sha256(call_tag.encode()).hexdigest()


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    """No PDF rendering, and the keyword stand-ins instead of the structure module."""
    monkeypatch.setattr(ctxmod, "render_pages", lambda package, refs: ([b"PNG"] * len(refs), list(refs)))
    monkeypatch.setattr(ctxmod, "_structure", lambda: None)


def test_52_questions_with_right_ids():
    assert {cid: [q["question_id"] for q in qs] for cid, qs in QUESTIONS.items()} == EXPECTED_IDS
    assert sum(len(qs) for qs in QUESTIONS.values()) == 52
    assert all(q["question"] and q["fields"] for qs in QUESTIONS.values() for q in qs)


def test_extract_returns_52_schema_valid_envelopes():
    progress = []
    llm = FakeLLM()
    envs = extract_package(fake_package(), llm, on_progress=lambda s, f, m: progress.append((s, f)))
    assert len(envs) == 52
    assert [e.answer.question_id for e in envs] == [q for ids in EXPECTED_IDS.values() for q in ids]
    for env in envs:
        assert schema_errors(env.answer.model_dump()) == []
        assert env.question and env.raw_call_id
    assert progress[-1][1] == 1.0
    assert {s for s, _ in progress} >= {"retrieve", "extract", "crossref", "absence"}


def test_full_mode_sends_cached_document_and_images():
    llm = FakeLLM()
    extract_package(fake_package(), llm)
    extract_calls = [c for c in llm.calls if c["tag"].startswith("extract:")]
    assert len(extract_calls) == 7
    assert all("[[DOC d1 PAGE 3]]" in c["document"] for c in extract_calls)
    c4 = next(c for c in extract_calls if c["tag"].endswith(":C4"))
    assert c4["images"] and "Page images supplied for: d1 p3" in c4["user"]


def test_crossref_resolves_pointer():
    envs = {e.answer.question_id: e for e in extract_package(fake_package(), FakeLLM())}
    ld = envs["4.2"]
    assert ld.answer.status == "FOUND" and ld.answer.pdf_page == 3
    assert "cross-reference" in ld.answer.notes
    assert ld.doc_id == "d1"


def test_absence_pass_replaces_or_confirms():
    llm = FakeLLM()
    envs = {e.answer.question_id: e for e in extract_package(fake_package(), llm)}
    assert envs["2.3"].answer.status == "FOUND"
    assert "absence check" in envs["2.3"].answer.notes
    assert envs["2.4"].answer.status == "NOT_STATED"
    assert "searched Schedule F, Clause 1" in envs["2.4"].answer.notes
    assert envs["2.3"].raw_call_id != envs["2.2"].raw_call_id


def test_missing_record_becomes_low_confidence_not_stated(monkeypatch):
    monkeypatch.setattr(pipeline, "absence_pass", lambda *a: None)
    envs = {e.answer.question_id: e for e in extract_package(fake_package(), FakeLLM(drop={"1.1"}))}
    ans = envs["1.1"].answer
    assert ans.status == "NOT_STATED" and ans.confidence == "low"
    assert "model returned no record" in ans.notes


def test_retrieval_mode_sends_page_text(monkeypatch):
    monkeypatch.setattr(ctxmod, "FULL_TEXT_TOKEN_LIMIT", 1)
    llm = FakeLLM()
    extract_package(fake_package(), llm)
    first = llm.calls[0]
    assert first["document"] is None and "[[DOC d1 PAGE" in first["user"]


def test_doc_id_for_multi_file_package():
    envs = {e.answer.question_id: e for e in extract_package(fake_package(two_files=True), FakeLLM())}
    assert envs["2.2"].doc_id == "d1"
    assert envs["1.1"].doc_id == ""


def test_normalise_fixes_mechanical_problems():
    rec = record("2.2", "NOT_STATED", pdf_page=7, notes="x" * 500, doc_id="d1",
                 conflicts=[{"value": "a", "section_ref": "b", "pdf_page": 1, "verbatim_quote": "",
                             "governs": None}])
    fixed = normalise(rec, "TEST", "C2")
    assert fixed["pdf_page"] == 0 and len(fixed["notes"]) == 400 and "doc_id" not in fixed
    assert "governs" not in fixed["conflicts"][0]
    assert schema_errors(fixed) == []


def test_pointer_detection():
    assert pipeline.pointer_texts(record("4.2", "FOUND", answer_value="rate as per Contract Data"))
    assert pipeline.pointer_texts(record("4.2", "POINTS_ELSEWHERE", points_to="Annexure P"))
    assert not pipeline.pointer_texts(record("4.2", "FOUND", answer_value="0.05% per day"))


def test_second_run_is_served_from_cache(tmp_path):
    """Real LLMClient with a fake transport: a repeat run makes no new API calls."""
    import json
    from types import SimpleNamespace

    from analyser.llm import LLMClient

    class Transport(LLMClient):
        def _send(self, request):
            text = request["messages"][0]["content"][-1]["text"]
            qids = re.findall(r"^(\d\.\d) ", text.split("Questions:")[1], re.M)
            extra = {"absence_result": "CONFIRMED_ABSENT", "searched_sections": ["all"]} \
                if text.startswith("Contract id") and "answered NOT_STATED" in text else {}
            body = json.dumps({"answers": [dict(record(q), **extra) for q in qids]})
            usage = SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=0,
                                    cache_creation_input_tokens=0)
            return SimpleNamespace(content=[SimpleNamespace(type="text", text=body)],
                                   stop_reason="end_turn", usage=usage, model="claude-opus-5-5")

    first = Transport(cache_dir=tmp_path)
    envs1 = extract_package(fake_package(), first)
    second = Transport(cache_dir=tmp_path)
    envs2 = extract_package(fake_package(), second)
    assert first.stats["calls"] > 0 and second.stats["calls"] == 0
    assert second.stats["cache_hits"] == first.stats["calls"]
    assert [e.model_dump() for e in envs1] == [e.model_dump() for e in envs2]


def test_points_elsewhere_requires_points_to():
    from analyser.extract.records import fill_points_to, make_validator
    bad = record("4.2", "POINTS_ELSEWHERE", answer_value="rate as per Schedule F", pdf_page=2,
                 section_ref="Cl. 2", verbatim_quote="as per Schedule F")
    errors = make_validator("TEST", "C4", ["4.2"])({"answers": [bad]})
    assert any("points_to" in e for e in errors)          # triggers the retry
    fixed = normalise(bad, "TEST", "C4")
    fill_points_to(fixed)
    assert fixed["points_to"] == "Schedule F" and schema_errors(fixed) == []
