"""Export tests (F14): CSV columns and the PDF report."""
from __future__ import annotations

import csv
import io

import pytest

from analyser import config
from analyser.models import Answer, CashInputs, ReviewState, RunMeta
from analyser.report import COLUMNS, answers_csv, report_pdf
from analyser.report.csv_export import ANSWER_KEY_COLUMNS, question_sort_key
from analyser.report.pdf_report import rupees
from tests.test_api_fakes import (fake_reference_view, fake_run_cashflow, fake_verify,
                                  make_envelopes, make_flags, make_package, make_score)


def envelopes():
    envs = fake_verify(make_envelopes("BM1"), None)
    ld = next(e for e in envs if e.answer.question_id == "4.1")
    ld.review = ReviewState(decision="edited", decided_at="2026-10-23T12:00:00",
                            user_answer=Answer(**{**ld.answer.model_dump(), "answer_value": "0.1"}),
                            note="checked page 3")
    return envs


def test_csv_columns_match_answer_key():
    rows = list(csv.DictReader(io.StringIO(answers_csv(envelopes()))))
    assert list(rows[0].keys()) == COLUMNS
    assert [r["Q"] for r in rows] == ["0.4", "1.10", "2.1", "4.1"]
    ld = rows[-1]
    assert ld["Answer"] == "0.1" and ld["AI answer (before review)"] == "0.05"
    assert ld["Review decision"] == "edited" and ld["Quote found"] == "Yes"
    assert rows[1]["Review decision"] == "pending" and rows[1]["PDF page"] == ""


def test_csv_header_matches_the_real_answer_key():
    openpyxl = pytest.importorskip("openpyxl")
    path = config.PROJECT_DIR / "Contract_Answer_Key_v2_verified.xlsx"
    if not path.exists():
        pytest.skip("answer key not present")
    sheet = openpyxl.load_workbook(path, read_only=True)["Answer Key"]
    key_header = next(sheet.iter_rows(max_row=1, values_only=True))
    assert list(key_header[:10]) == ANSWER_KEY_COLUMNS[:10]
    assert key_header[10].startswith("Notes")


def test_question_sort_key():
    assert sorted(["2.10", "2.9", "2.1"], key=question_sort_key) == ["2.1", "2.9", "2.10"]


def test_report_pdf_full_and_minimal():
    meta = RunMeta(run_id="BM1_20261023-120000", package_id="BM1", contract_id="BM1",
                   model="fake-model", effort="low", stage="done", llm_calls=7)
    inputs = CashInputs(contract_value=1e7, duration_months=12, retention_rate=0.05,
                        ld_rate_per_day=0.0005, delay_days=30)
    cash = {"as_written": fake_run_cashflow(inputs),
            "reference": fake_run_cashflow(fake_reference_view(inputs))}
    envs = envelopes()
    score = make_score({"BM1": envs}, meta.run_id)
    pdf = report_pdf(meta, make_package("BM1", "BM1"), envs, make_flags(cash["as_written"]),
                     cash, score)
    assert pdf.startswith(b"%PDF") and len(pdf) > 5000

    minimal = report_pdf(meta, None, [], [], None, None)
    assert minimal.startswith(b"%PDF")


def test_rupees():
    assert rupees(2.5e7) == "Rs 2.50 crore"
    assert rupees(150000) == "Rs 1.50 lakh"
    assert rupees(999) == "Rs 999"
    assert rupees(None) == "-"
