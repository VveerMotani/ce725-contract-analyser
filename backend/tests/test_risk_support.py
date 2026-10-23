"""Helpers shared by the risk-rule tests (no tests in this file).

Builds AnswerEnvelopes by hand, and fixtures from golden_tests_v1.json expected
answers (the expected answer becomes the Answer an ideal extractor would return).
"""
from __future__ import annotations

import json
import re

from analyser.config import GOLDEN_TESTS
from analyser.models import (Answer, AnswerEnvelope, CashInputs, Conflict, DocumentFile,
                             MissingReference, Package, AdvanceInstalment)
from analyser.risk import flag_risks_with_trace
from analyser.risk.parse import fmt_rupees


def env(qid: str, status: str = "FOUND", value: str = "", unit: str = "", base: str = "",
        conflicts=(), points_to: str = "", section: str = "Cl. X", page: int = 1,
        quote: str = "quoted text") -> AnswerEnvelope:
    """One answer envelope for question `qid`."""
    return AnswerEnvelope(question=qid, answer=Answer(
        contract_id="T", clause_id="C" + qid.split(".")[0], question_id=qid, status=status,
        answer_value=value, unit=unit, base=base, section_ref=section, pdf_page=page,
        verbatim_quote=quote if status != "NOT_STATED" else "", conflicts=list(conflicts),
        points_to=points_to, confidence="high"))


def package(contract_id: str = "T", files=("Test_Contract.pdf",), missing=()) -> Package:
    return Package(
        package_id=contract_id, contract_id=contract_id,
        files=[DocumentFile(doc_id=f"d{i + 1}", filename=f, path=f, sha256="0" * 64, page_count=1)
               for i, f in enumerate(files)],
        missing_references=[MissingReference(label=label, doc_id="d1", page=page, quote=quote)
                            for label, page, quote in missing])


def run(*envelopes, cash=None, cash_result=None, pkg=None):
    """Flags only."""
    return flag_risks_with_trace(list(envelopes), pkg or package(), cash, cash_result)[0]


def ids(flags) -> list[str]:
    return [f.flag_id for f in flags]


def one(flags, rule_id: str):
    hits = [f for f in flags if f.flag_id == rule_id]
    assert len(hits) == 1, f"expected one {rule_id}, got {ids(flags)}"
    return hits[0]


# ---------------------------------------------------------------------------
# Golden fixtures
# ---------------------------------------------------------------------------

BENCHMARK_FILES = {
    "BM1": "BM1_NHAI_Makhu_Town_EPC_Agreement.pdf",
    "BM2": "BM2_IIT_Bombay_Chemistry_Lab_Tender.pdf",
    "BM3": "BM3_MP_Agro_Gwalior_Tender.pdf",
    "BM4": "BM4_MoEF_Zoological_Park_NIT.pdf",
}

# What M1's completeness check (F1) would report for each package. Taken from the
# spec (section 2.C: NHAI stage-payment schedules not in the text; MoEF NIT only
# references CPWD GCC 2023).
BENCHMARK_MISSING = {
    "BM1": [("Schedule H (stage payment percentages)", 105, "")],
    "BM4": [("CPWD General Conditions of Contract 2023", 21, "")],
}

# Conflicts the golden answer text itself describes (trap T10): the expected answer
# for BM3-5.3 gives two weight tables. The extractor would put the second in `conflicts`.
BENCHMARK_CONFLICTS = {
    ("BM3", "5.3"): [Conflict(value="cement 20%, steel 20%", section_ref="Annexure R", pdf_page=70)],
}

# Spec section 8.4 hand benchmark (illustrative round numbers, NHAI-style terms).
HAND_BENCHMARK_CASH = CashInputs(
    contract_value=100e7, duration_months=24, retention_rate=0.06, retention_cap=0.05,
    advance_instalments=[AdvanceInstalment(share_of_value=0.05, month=0),
                         AdvanceInstalment(share_of_value=0.05, month=2)],
    advance_recovery_rate=0.15, advance_recovery_deadline=0.8, advance_interest_rate_pa=0.0925,
    ld_rate_per_day=0.0005, ld_cap=0.10, perf_security_pct=0.03, delay_days=60)


def _points_to(text: str, pdf_names: list[str]) -> str:
    """Simulate F7 naming the target: a cited file name, else the contract's one cited GCC file."""
    m = re.search(r"see ([\w\-.]+\.pdf)", text)
    if m:
        return m.group(1)
    if re.search(r"\bGCC\b|General Conditions", text) and len(set(pdf_names)) == 1:
        return pdf_names[0]
    return ""


def golden_envelopes(contract_id: str) -> list[AnswerEnvelope]:
    """The 52 expected answers of one benchmark as AnswerEnvelopes."""
    with open(GOLDEN_TESTS, encoding="utf-8") as f:
        tests = [t for t in json.load(f)["tests"] if t["contract_id"] == contract_id]
    pdfs = [m.group(1) for t in tests for m in [re.search(r"see ([\w\-.]+\.pdf)", t["expected_answer"])] if m]
    out = []
    for t in tests:
        st = t["expected_status"]
        out.append(AnswerEnvelope(question=t["question"], answer=Answer(
            contract_id=contract_id, clause_id=t["clause_id"], question_id=t["question_id"],
            status=st, answer_value=t["expected_answer"], unit=t["expected_unit"],
            section_ref=t["section_ref"], pdf_page=t["pdf_page"] or 0,
            verbatim_quote=t["verbatim_quote"],
            conflicts=BENCHMARK_CONFLICTS.get((contract_id, t["question_id"]), []),
            points_to=_points_to(t["expected_answer"], pdfs) if st == "POINTS_ELSEWHERE" else "",
            confidence="high")))
    return out


def golden_package(contract_id: str) -> Package:
    return package(contract_id, (BENCHMARK_FILES[contract_id],), BENCHMARK_MISSING.get(contract_id, []))


def summary(contract_id: str, flags, skipped=None) -> str:
    """A readable list of flags for one contract."""
    lines = [f"=== {contract_id}: {len(flags)} flags ==="]
    for f in flags:
        rs = f"  [{fmt_rupees(f.rupee_impact)}]" if f.rupee_impact is not None else ""
        lines.append(f"{f.flag_id:<4} {f.severity:<12} {f.category:<8} {f.title}{rs}")
        lines.append(f"     found: {f.value_found}")
        lines.append(f"     Q {', '.join(f.question_ids) or '-'} | {f.section_ref} p{f.pdf_page}")
    if skipped is not None:
        lines.append("  not raised: " + "; ".join(f"{r}: {why}" for r, why in skipped))
    return "\n".join(lines)
