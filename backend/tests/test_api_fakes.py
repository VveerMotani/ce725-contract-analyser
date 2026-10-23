"""Fake versions of the M1-M4 modules, shared by test_api.py and test_report.py.

The real modules are written in parallel and may not exist yet, so the API
tests put these fakes into sys.modules. They follow the INTERFACES.md
signatures and return small, valid models. (No tests in this file.)
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

from analyser import config
from analyser.api import pipeline
from analyser.models import (Answer, AnswerEnvelope, CashInputs, CashParams, CashResult,
                             CheckResult, DocumentFile, MissingReference, MonthRow, Package,
                             PageInfo, ParamProvenance, ReviewState, RiskFlag, ScoreSummary,
                             Sensitivity, Verification)

FAKE_PNG = b"\x89PNG\r\n\x1a\nfake"


def make_package(contract_id: str, package_id: str, paths: list[tuple[str, str]] | None = None,
                 title: str = "") -> Package:
    paths = paths or [(f"C:/fake/{contract_id}.pdf", "gcc")]
    files = [DocumentFile(doc_id=f"d{i + 1}", filename=Path(p).name, path=p, tag=t,
                          sha256="ab" * 32, page_count=3) for i, (p, t) in enumerate(paths)]
    pages = [PageInfo(doc_id="d1", page=n, text="x" * 1000, char_count=1000,
                      low_text=(n == 3), needs_visual=(n == 3)) for n in (1, 2, 3)]
    return Package(package_id=package_id, contract_id=contract_id, title=title or contract_id,
                   files=files, pages=pages, created_at="2026-10-23T10:00:00",
                   missing_references=[MissingReference(label="Schedule F", doc_id="d1", page=2,
                                                        quote="as per Schedule F")])


def _answer(cid: str, clause: str, qid: str, status: str, value: str, quote: str,
            page: int = 2, unit: str = "") -> Answer:
    return Answer(contract_id=cid, clause_id=clause, question_id=qid, status=status,
                  answer_value=value, unit=unit, section_ref="Cl. 1", pdf_page=page,
                  verbatim_quote=quote, confidence="high")


def make_envelopes(cid: str) -> list[AnswerEnvelope]:
    return [
        AnswerEnvelope(question="Completion period", raw_call_id="k0",
                       answer=_answer(cid, "C0", "0.4", "FOUND", "730", "730 days", 1, "days")),
        AnswerEnvelope(question="Late payment interest",
                       answer=_answer(cid, "C1", "1.10", "NOT_STATED", "", "", 0)),
        AnswerEnvelope(question="Retention rate",
                       answer=_answer(cid, "C2", "2.1", "FOUND", "5", "5% of each bill", 2, "%")),
        AnswerEnvelope(question="Delay damages rate",
                       answer=_answer(cid, "C4", "4.1", "FOUND", "0.05",
                                      "0.05% of contract price per day", 3, "% per day")),
    ]


def fake_verify(envelopes, package, llm=None):
    out = []
    for e in envelopes:
        e = e.model_copy(deep=True)
        found = e.answer.status == "FOUND"
        e.doc_id = "d1"
        e.verification = Verification(
            question_id=e.answer.question_id, quote_found=found if found else None,
            found_doc_id="d1", found_page=e.answer.pdf_page, page_matches=found or None,
            checks=[CheckResult(check="V1", name="quote exists", passed=found or None)],
            verdict="pass" if found else "warn")
        e.review = (ReviewState(decision="pending", reasons=["NOT_STATED: confirm absence"])
                    if not found else ReviewState())
        out.append(e)
    return out


def fake_params(envelopes, user_inputs, llm):
    ld = next(e.effective() for e in envelopes if e.answer.question_id == "4.1")
    inputs = CashInputs(contract_value=float(user_inputs.get("contract_value", 1e7)),
                        duration_months=int(user_inputs.get("duration_months", 12)),
                        retention_rate=0.05, ld_rate_per_day=float(ld.answer_value) / 100)
    return CashParams(inputs=inputs, provenance=[
        ParamProvenance(field="contract_value", source="user"),
        ParamProvenance(field="ld_rate_per_day", source="extracted", question_id="4.1",
                        quote=ld.verbatim_quote)])


def fake_run_cashflow(inputs: CashInputs, sensitivities: bool = True) -> CashResult:
    v, t = inputs.contract_value, inputs.duration_months
    months, cum_in, cum_out = [], 0.0, 0.0
    for m in range(1, t + 1):
        gross = v / t
        cum_in += gross * (1 - inputs.retention_rate) if m > 1 else 0
        cum_out += gross * 0.85
        months.append(MonthRow(month=m, gross=gross, retention=gross * inputs.retention_rate,
                               advance_recovery=0, net_certified=gross, cash_in=0, cash_out=0,
                               cum_in=cum_in, cum_out=cum_out, gap=cum_out - cum_in,
                               retention_held=0, advance_outstanding=0))
    ld = v * inputs.ld_rate_per_day * inputs.delay_days
    return CashResult(months=months, peak_funding=max(r.gap for r in months), peak_month=t,
                      overdraft_interest=1000, advance_interest=0, guarantee_cost=500,
                      retention_locked_max=v * inputs.retention_rate,
                      retention_financing_cost=200, ld_amount=ld, ld_days_to_cap=None,
                      escalation_amount=0, escalation_is_recovery=False,
                      total_cost_of_terms=1700 + ld,
                      sensitivities=[Sensitivity(name="Delay +30 days", peak_funding=1,
                                                 peak_month=1, interest_cost=1,
                                                 total_cost_of_terms=1)] if sensitivities else [],
                      notes=["fake model"])


def fake_reference_view(inputs: CashInputs) -> CashInputs:
    return inputs.model_copy(update={"retention_rate": 0.0, "ld_rate_per_day": 0.0005})


def make_flags(cash_result=None) -> list[RiskFlag]:
    return [RiskFlag(flag_id="R7", title="Uncapped delay damages", severity="High",
                     category="risk", rule="LD cap missing", value_found="no cap",
                     question_ids=["4.1"], quote="0.05% per day", section_ref="Cl. 1",
                     pdf_page=3, explanation="Damages can grow without limit.",
                     rupee_impact=cash_result.ld_amount if cash_result else None),
            RiskFlag(flag_id="R18", title="Late payment interest not stated",
                     severity="Needs review", category="unclear", rule="absent",
                     value_found="not stated", explanation="Check the GCC.")]


def make_score(envelopes_by_contract, run_id) -> ScoreSummary:
    n = sum(len(v) for v in envelopes_by_contract.values())
    return ScoreSummary(run_id=run_id, counts={"Correct": n},
                        by_contract={c: {"Correct": len(v)} for c, v in envelopes_by_contract.items()},
                        by_clause={}, precision=1.0, recall=0.9, core_pass_rate=1.0,
                        quote_verification_rate=1.0, hallucinations=0, tests=[])


class FakeLLM:
    def __init__(self, model: str = "fake-model", effort: str = "low"):
        self.model, self.effort = model, effort
        self.stats = {"calls": 0, "cache_hits": 0, "input_tokens": 0, "output_tokens": 0}


def install_fakes(monkeypatch, tmp_path: Path) -> dict:
    """Point config at tmp_path and replace M1-M4 modules with fakes. Returns call counters."""
    monkeypatch.setattr(config, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(config, "UPLOADS_DIR", tmp_path / "runs" / "_uploads")
    (tmp_path / "runs").mkdir()
    pipeline.clear_caches()
    calls = {"flags": 0, "score": [], "params": 0, "build": 0, "user_inputs": []}

    def build_package(files, contract_id, title="", package_id=None):
        calls["build"] += 1
        pid = package_id or f"pkg-{contract_id}-{calls['build']}"
        pkg = make_package(contract_id, pid, files, title)
        folder = config.RUNS_DIR / "packages" / pid
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "package.json").write_text(pkg.model_dump_json(), encoding="utf-8")
        return pkg

    def load_package(package_id):
        f = config.RUNS_DIR / "packages" / package_id / "package.json"
        if not f.exists():
            raise FileNotFoundError(package_id)
        return Package.model_validate(json.loads(f.read_text(encoding="utf-8")))

    def extract_package(package, llm, on_progress=None):
        for stage, frac in (("retrieve", 0.1), ("extract", 0.5), ("absence", 1.0)):
            if on_progress:
                on_progress(stage, frac, f"{stage} step")
        llm.stats["calls"] += 7
        llm.stats["input_tokens"] += 1000
        return make_envelopes(package.contract_id)

    def params(envelopes, user_inputs, llm):
        calls["params"] += 1
        calls["user_inputs"].append(dict(user_inputs))
        return fake_params(envelopes, user_inputs, llm)

    def flag_risks(envelopes, package, cash=None, cash_result=None):
        calls["flags"] += 1
        return make_flags(cash_result)

    def score_run(envelopes_by_contract, run_id):
        calls["score"].append(sorted(envelopes_by_contract))
        return make_score(envelopes_by_contract, run_id)

    fakes = {
        "ingest": dict(build_package=build_package, load_package=load_package,
                       benchmark_package=lambda cid: make_package(cid, cid),
                       render_page_png=lambda path, page, zoom=2.0, highlight=None: FAKE_PNG),
        "llm": dict(LLMClient=FakeLLM),
        "extract": dict(extract_package=extract_package),
        "verify": dict(verify_answers=fake_verify),
        "params": dict(map_to_cash_params=params),
        "cashflow": dict(run_cashflow=fake_run_cashflow, reference_view=fake_reference_view,
                         s_curve=lambda T: [1.0 / T] * T),
        "risk": dict(flag_risks=flag_risks),
        "evaluate": dict(score_run=score_run),
    }
    for name, attrs in fakes.items():
        mod = types.ModuleType(f"analyser.{name}")
        for k, v in attrs.items():
            setattr(mod, k, v)
        monkeypatch.setitem(sys.modules, f"analyser.{name}", mod)
    return calls
