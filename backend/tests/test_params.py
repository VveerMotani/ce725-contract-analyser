"""Cash-parameter mapping: number checks, unit scaling, user overrides, regex mode."""
import pytest

from analyser.models import Answer, AnswerEnvelope
from analyser.params import map_to_cash_params, number_appears


def env(qid, answer_value, quote="", status="FOUND"):
    ans = Answer(contract_id="T", clause_id="C" + qid[0], question_id=qid, status=status,
                 answer_value=answer_value, section_ref="Cl. 1", pdf_page=1 if status != "NOT_STATED" else 0,
                 verbatim_quote=quote, confidence="high")
    return AnswerEnvelope(question="q", answer=ans)


ENVS = [
    env("1.3", "Payment within 30 days of the Stage Payment Statement"),
    env("1.4", "Bank Rate + 3% per annum on unpaid sums"),
    env("2.2", "6% of every stage payment", "deduct 6% of each payment"),
    env("2.3", "Capped at 5% of Contract Price"),
    env("3.2", "10% of Contract Price in two instalments of 5% each"),
    env("3.4", "15% of each bill; fully repaid before 80% of the construction period"),
    env("4.2", "0.05% of Contract Price for each day of delay"),
    env("4.3", "10% of Contract Price"),
    env("5.1", "No price variation: rates firm", status="NOT_APPLICABLE"),
    env("6.2", "Performance Security 3% of Bid Price"),
]


class FakeParamsLLM:
    def __init__(self, items):
        self.items = items
        self.prompts = []

    def call_json(self, system, user_text, images=[], schema=None, call_tag="", **kw):
        self.prompts.append(user_text)
        return {"params": self.items}, "key"


def item(field, qid, value, unit="percent", per="", **kw):
    base = {"field": field, "question_id": qid, "value": value, "unit": unit, "per": per,
            "relative_to_bank_rate": False, "component": "", "share": 100, "instalment_month": -1,
            "quote": "q"}
    base.update(kw)
    return base


def prov(params, name):
    return next(p for p in params.provenance if p.field == name)


def test_number_appears_with_percent_form():
    assert number_appears(0.05, "0.05% of Contract Price")
    assert number_appears(5, "5% of bill")
    assert number_appears(0.05, "5% of bill")            # fraction vs % form
    assert number_appears(424547, "Rs 4,24,547")
    assert not number_appears(7, "6% of every bill")


def test_llm_numbers_checked_and_scaled():
    llm = FakeParamsLLM([
        item("retention_rate", "2.2", 6),
        item("retention_cap", "2.3", 5),
        item("ld_rate_per_day", "4.2", 0.05, per="day"),
        item("ld_cap", "4.3", 10),
        item("late_interest_rate_pa", "1.4", 3, per="year", relative_to_bank_rate=True),
        item("advance_instalments", "3.2", 5, instalment_month=-1),
        item("advance_instalments", "3.2", 5, instalment_month=-1),
        item("advance_recovery_deadline", "3.4", 80),
        item("pay_lag_days", "1.3", 30, unit="days"),
        item("pv_applies", "5.1", 0, unit="number"),
    ])
    params = map_to_cash_params(ENVS, {"bank_rate_pa": 0.065}, llm)
    x = params.inputs
    assert x.retention_rate == pytest.approx(0.06) and x.retention_cap == pytest.approx(0.05)
    assert x.ld_rate_per_day == pytest.approx(0.0005) and x.ld_cap == pytest.approx(0.10)
    assert x.late_interest_rate_pa == pytest.approx(0.095)
    assert [i.share_of_value for i in x.advance_instalments] == pytest.approx([0.05, 0.05])
    assert x.advance_recovery_deadline == pytest.approx(0.8)
    assert x.pay_lag_days == 30 and x.pv_applies is False
    assert prov(params, "retention_rate").source == "extracted"
    assert prov(params, "retention_rate").question_id == "2.2"
    assert all(not p.confirmed for p in params.provenance)
    assert "6% of every stage payment" in llm.prompts[0]


def test_number_absent_from_source_is_rejected():
    llm = FakeParamsLLM([item("retention_rate", "2.2", 7),            # 7 is not in answer 2.2
                         item("perf_security_pct", "4.3", 3)])        # 3 is not in answer 4.3
    params = map_to_cash_params(ENVS, {}, llm)
    assert params.inputs.retention_rate == 0.0
    assert prov(params, "retention_rate").source == "default"
    assert params.inputs.perf_security_pct == 0.0


def test_number_from_non_found_answer_is_rejected():
    envs = ENVS + [env("3.3", "Interest 10% per annum", status="NOT_APPLICABLE")]
    llm = FakeParamsLLM([item("advance_interest_rate_pa", "3.3", 10, per="year")])
    params = map_to_cash_params(envs, {}, llm)
    assert params.inputs.advance_interest_rate_pa == 0.0


def test_user_inputs_override():
    llm = FakeParamsLLM([item("retention_rate", "2.2", 6)])
    params = map_to_cash_params(ENVS, {"contract_value": 5e8, "duration_months": 18,
                                       "retention_rate": 0.04, "overdraft_rate_pa": 0.11}, llm)
    assert params.inputs.contract_value == 5e8 and params.inputs.duration_months == 18
    assert params.inputs.retention_rate == 0.04
    assert prov(params, "retention_rate").source == "user"
    assert prov(params, "overdraft_rate_pa").source == "user"
    assert prov(params, "cost_share").source == "default"


def test_regex_mapping_without_llm():
    params = map_to_cash_params(ENVS, {}, None)
    x = params.inputs
    assert x.retention_rate == pytest.approx(0.06)
    assert x.retention_cap == pytest.approx(0.05)
    assert x.ld_rate_per_day == pytest.approx(0.0005)
    assert x.ld_cap == pytest.approx(0.10)
    assert [i.share_of_value for i in x.advance_instalments] == pytest.approx([0.05, 0.05])
    assert x.advance_recovery_rate == pytest.approx(0.15)
    assert x.advance_recovery_deadline == pytest.approx(0.8)
    assert x.pay_lag_days == 30
    assert x.perf_security_pct == pytest.approx(0.03)
    assert prov(params, "contract_value").source == "default"


def test_provenance_notes_explain_scaling_and_rejection():
    envs = ENVS + [env("4.4", "1% per month of delay", "1% per month")]
    llm = FakeParamsLLM([
        item("ld_rate_per_day", "4.4", 1, per="month"),
        item("retention_rate", "2.2", 7),                                  # not in answer 2.2
        item("late_interest_rate_pa", "1.4", 3, per="year", relative_to_bank_rate=True),
    ])
    params = map_to_cash_params(envs, {"bank_rate_pa": 0.065}, llm)
    assert params.inputs.ld_rate_per_day == pytest.approx(0.01 / 30)
    assert prov(params, "ld_rate_per_day").note.startswith("1% per month ÷ 30 = 0.03333% per day")
    rej = prov(params, "retention_rate")
    assert rej.source == "default" and rej.question_id == "2.2"
    assert "Rejected, default used: number 7 not in answer 2.2" in rej.note
    assert "+ Bank Rate 6.5%" in prov(params, "late_interest_rate_pa").note


def test_retention_release_steps():
    envs = ENVS + [env("2.5", "Half released 6 months after completion; balance after 12 months")]
    llm = FakeParamsLLM([item("retention_release", "2.5", 6, unit="months", share=50),
                         item("retention_release", "2.5", 12, unit="months", share=50)])
    params = map_to_cash_params(envs, {}, llm)
    steps = params.inputs.retention_release
    assert [(s.share, s.months_after_completion) for s in steps] == [(0.5, 6), (0.5, 12)]


# ---------------------------------------------------------------- regex mode on the golden answers
# The answer key stands in for extraction here (as in the offline replay runs); nothing from it
# goes into a prompt.

from analyser.evaluate.golden_check import golden_envelopes

GOLDEN = golden_envelopes()


def regex_params(cid, user=None):
    params = map_to_cash_params(GOLDEN[cid], user or {}, None)
    for p in params.provenance:
        if p.source == "extracted":
            assert p.question_id and p.quote and p.note, p      # every value carries proof and a note
    return params


def test_golden_bm1_regex():
    params = regex_params("BM1", {"bank_rate_pa": 0.065})
    x = params.inputs
    assert x.duration_months == 24 and prov(params, "duration_months").source == "extracted"
    assert prov(params, "contract_value").source == "default"          # price is blank (POINTS_ELSEWHERE)
    assert x.dlp_months == 60
    assert (x.cert_lag_days, x.pay_lag_days) == (15, 30)
    assert x.late_interest_rate_pa == pytest.approx(0.095)
    assert x.advance_interest_rate_pa == pytest.approx(0.095)
    assert (x.retention_rate, x.retention_cap) == pytest.approx((0.06, 0.05))
    assert x.retention_release[0].share == 1.0
    assert x.retention_release[0].months_after_completion == pytest.approx(15 / 30.4375)
    assert [(i.share_of_value, i.month) for i in x.advance_instalments] == [(0.05, 0), (0.05, 1)]
    assert "assumed paid in month 1" in prov(params, "advance_instalments").note
    assert (x.advance_recovery_rate, x.advance_recovery_deadline) == pytest.approx((0.15, 0.8))
    assert x.ld_rate_per_day == pytest.approx(0.0005) and x.ld_cap == pytest.approx(0.10)
    assert x.ld_grace_days == 30
    assert x.pv_applies is True and x.pv_factor == pytest.approx(0.85)
    assert x.perf_security_pct == pytest.approx(0.03)


def test_golden_bm2_regex():
    params = regex_params("BM2")
    x = params.inputs
    assert x.contract_value == 21_227_336 and x.duration_months == 9
    assert x.dlp_months == 12 and x.pay_lag_days == 10
    assert x.late_interest_rate_pa == pytest.approx(0.05)
    assert x.min_bill_value == pytest.approx(3_000_000)
    assert (x.retention_rate, x.retention_cap) == pytest.approx((0.05, 0.05))
    assert [(s.share, s.months_after_completion) for s in x.retention_release] == [(1.0, 12)]
    assert [(i.share_of_value, i.month) for i in x.advance_instalments] == [(0.10, 0)]
    assert x.advance_interest_rate_pa == pytest.approx(0.10)
    assert x.advance_recovery_rate == 0.0                    # pro rata, no per-bill % stated
    assert x.advance_recovery_deadline == pytest.approx(0.8)
    assert x.ld_rate_per_day == pytest.approx(0.01 / 30)
    assert "÷ 30" in prov(params, "ld_rate_per_day").note
    assert prov(params, "pv_applies").source == "default"   # 10CC gated on period: left for a person
    assert x.perf_security_pct == pytest.approx(0.05)


def test_golden_bm3_regex():
    params = regex_params("BM3")
    x = params.inputs
    assert x.contract_value == pytest.approx(18_865_000) and x.duration_months == 12
    assert x.dlp_months == 36
    assert x.late_interest_rate_pa == 0.0
    assert prov(params, "late_interest_rate_pa").source == "extracted"   # "No interest payable"
    assert [(s.share, s.months_after_completion) for s in x.retention_release] == [(1.0, 36)]
    assert x.advance_instalments == []                       # advance NOT_APPLICABLE
    assert x.ld_rate_per_day == pytest.approx(0.0005) and x.ld_cap == pytest.approx(0.10)
    assert x.pv_applies is False and prov(params, "pv_applies").source == "extracted"
    assert x.perf_security_pct == pytest.approx(0.05)


def test_golden_bm4_regex():
    params = regex_params("BM4")
    x = params.inputs
    assert x.contract_value == 725_065
    assert x.duration_months == 1                           # 40 days, rounded
    assert prov(params, "dlp_months").source == "default"   # "No defect liability period stated"
    assert x.min_bill_value == pytest.approx(350_000)
    assert x.retention_rate == pytest.approx(0.025) and x.retention_cap is None
    assert prov(params, "late_interest_rate_pa").source == "default"   # POINTS_ELSEWHERE
    assert x.pv_applies is False and x.perf_security_pct == pytest.approx(0.05)


def test_negative_interest_needs_the_words():
    envs = [env("1.4", "Interest at 0% stated nowhere")]
    llm = FakeParamsLLM([item("late_interest_rate_pa", "1.4", 0, per="year", negative=True)])
    params = map_to_cash_params(envs, {}, llm)
    assert prov(params, "late_interest_rate_pa").source == "default"
    assert "no 'no interest' wording" in prov(params, "late_interest_rate_pa").note


def test_payment_days_read_clause_by_clause():
    """Part payment within 10 days must not become the payment period (BM1-style answer)."""
    from analyser.params.mapping import _payment_day_items
    got = {}
    _payment_day_items(lambda f, q, v, u, **k: got.__setitem__(f, float(v)),
                       "Within 10 days AE recommends release of 90%; within 15 days AE issues IPC",
                       "90% part payment within 10 days of AE recommendation; full payment no later "
                       "than 30 days from submission; final payment within 30 days")
    assert got == {"cert_lag_days": 15, "part_payment_share": 90, "part_payment_days": 10,
                   "pay_lag_days": 30}
