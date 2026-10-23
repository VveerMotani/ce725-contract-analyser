"""Unit tests for the risk rules (M3, F12): boundary values and status handling."""
from __future__ import annotations

import re

import pytest

from analyser.models import (AdvanceInstalment, CashInputs, Conflict, RiskFlag, Verification)
from analyser.risk import load_rules, sort_flags
from analyser.risk.parse import per_day_rates, rupees, durations, percents

from .test_risk_support import env, ids, one, package, run

V = 50e7   # Rs 50 crore, for rupee-impact tests


# ---------------------------------------------------------------------------
# Rule table
# ---------------------------------------------------------------------------

def test_rule_table_has_r1_to_r18_with_sources():
    rules = load_rules()
    assert [r["id"] for r in rules] == [f"R{i}" for i in range(1, 19)]
    for r in rules:
        assert r["reference_source"]
        assert r["triggers"], r["id"]
        # every threshold carries a status tag
        for name in r["thresholds"]:
            assert r["threshold_status"][name] in ("[SEEN]", "[ASSUMPTION]"), (r["id"], name)
        # source text carries a tag, or is n/a for the review rules
        assert re.search(r"\[(SEEN|ASSUMPTION)", r["reference_source"]) or r["reference_source"].startswith("n/a")


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def test_parsers():
    assert [p[0] for p in percents("deduct 6%, cap 0 .05% and 2.50 per cent")] == [6, 0.05, 2.5]
    assert per_day_rates("Maximum 1% per month of delay, computed per day", 30)[0][0] == pytest.approx(1 / 30, abs=1e-6)
    assert per_day_rates("2.5%, 5% or 10% of work unexecuted; final delay: 0.05% of contract price per day", 30) \
        == [(0.05, "0.05% of contract price per day")]
    assert rupees("Estimated cost Rs 2,12,27,336") == [21227336]
    assert rupees("Rs 188.65 lakh") == [pytest.approx(18865000)]
    assert rupees("more than Rs 10 crore") == [1e8]
    assert durations("10 working days (15 working days outside)") == [(10, "working_day"), (15, "working_day")]


# ---------------------------------------------------------------------------
# Boundary-value table
# ---------------------------------------------------------------------------

PAYMENT = [("30 days from submission of the bill", False), ("31 days from submission of the bill", True),
           ("22 working days", True), ("21 working days", False),   # x1.4 = 30.8 / 29.4 calendar days
("1 month", False), ("2 months", True)]


@pytest.mark.parametrize("text,flagged", PAYMENT)
def test_r7_payment_period_boundary(text, flagged):
    flags = run(env("1.3", value=text, unit="days"))
    assert ("R7" in ids(flags)) == flagged
    if flagged:
        assert one(flags, "R7").severity == "Medium"


RETENTION_CAP = [("5% of Contract Price", False), ("5.5% of Contract Price", True)]


@pytest.mark.parametrize("cap,flagged", RETENTION_CAP)
def test_r1_retention_cap_boundary(cap, flagged):
    flags = run(env("2.2", value="5% of each running bill"), env("2.3", value=cap),
                env("2.5", value="Refunded within 15 days of the completion certificate"))
    assert ("R1" in ids(flags)) == flagged


def test_r1_no_cap_and_late_release():
    flags = run(env("2.2", value="5% of gross amount of each running bill"), env("2.3", status="NOT_STATED"),
                env("2.5", value="Refunded on completion of defect liability period"))
    f = one(flags, "R1")
    assert "no cap" in f.value_found and "defect liability" in f.value_found


def test_r1_whole_value_rate_is_its_own_cap():
    # "2.5% of tendered amount" with no separate cap is not "uncapped"
    flags = run(env("2.2", value="2.50% of tendered amount", unit="% of tendered amount"),
                env("2.3", value="Fixed at 2.50% of the tendered amount; no separate cap on retention is stated"))
    assert "R1" not in ids(flags)


LD_CAP = [("10% of Contract Price", None), ("12% of Contract Price", "Medium"),
          ("No cap on damages", "High"), (None, "High")]   # None = 4.3 NOT_STATED


@pytest.mark.parametrize("cap,severity", LD_CAP)
def test_r4_ld_cap_boundary(cap, severity):
    cap_env = env("4.3", value=cap) if cap else env("4.3", status="NOT_STATED")
    flags = run(env("4.1", value="Yes"), env("4.2", value="0.05% of Contract Price for each day of delay"), cap_env)
    if severity is None:
        assert "R4" not in ids(flags)
    else:
        assert one(flags, "R4").severity == severity


LD_RATE = [("0.05% of Contract Price per day", False), ("0.06% of Contract Price per day", True),
           ("Maximum 1% per month of delay, computed per day", False),
           ("1.8% of tendered value per month of delay", True)]


@pytest.mark.parametrize("rate,flagged", LD_RATE)
def test_r4_daily_rate_boundary(rate, flagged):
    flags = run(env("4.1", value="Yes"), env("4.2", value=rate), env("4.3", value="10% of contract price"))
    assert ("R4" in ids(flags)) == flagged
    if flagged:
        assert one(flags, "R4").severity == "Medium"


DURATION = [("18 months from the date of start", False), ("19 months from the date of start", True)]


@pytest.mark.parametrize("duration,flagged", DURATION)
def test_r10_fixed_price_duration_boundary(duration, flagged):
    flags = run(env("5.1", value="Fixed price; no price variation clause"), env("0.4", value=duration))
    assert ("R10" in ids(flags)) == flagged
    if flagged:
        assert one(flags, "R10").severity == "High"


def test_r10_uses_cash_duration_when_given():
    cash = CashInputs(contract_value=V, duration_months=24)
    flags = run(env("5.1", value="Rates are firm; no escalation shall be paid"), cash=cash)
    assert "24 months" in one(flags, "R10").value_found


def test_r10_not_applicable_status_means_fixed_price():
    flags = run(env("5.1", status="NOT_APPLICABLE", value="Price variation clause printed but switched off"),
                env("0.4", value="730 days"))
    assert one(flags, "R10").severity == "High"


# ---------------------------------------------------------------------------
# Status handling
# ---------------------------------------------------------------------------

def test_r6_no_interest_is_high_risk():
    f = one(run(env("1.4", value="No interest payable on any payment due or awarded")), "R6")
    assert (f.severity, f.category) == ("High", "risk")
    assert "no interest" in f.value_found.lower()


def test_r6_silent_is_unclear_and_says_silent():
    f = one(run(env("1.4", status="NOT_STATED")), "R6")
    assert f.category == "unclear"
    assert "silent" in f.value_found.lower() and "SILENT" in f.explanation


def test_r6_points_elsewhere_names_the_document():
    f = one(run(env("1.4", status="POINTS_ELSEWHERE", value="In the GCC", points_to="CPWD GCC 2023")), "R6")
    assert f.category == "unclear" and f.severity == "Needs review" and "CPWD GCC 2023" in f.explanation


def test_r6_interest_provided_no_flag():
    assert "R6" not in ids(run(env("1.4", value="Bank Rate + 3% per annum on all unpaid sums")))


def test_r7_not_stated_is_unclear():
    f = one(run(env("1.3", status="NOT_STATED")), "R7")
    assert f.category == "unclear" and f.severity == "Medium"


def test_r8_no_advance_and_costly_advance():
    f = one(run(env("3.1", status="NOT_APPLICABLE", value="No mobilisation advance is payable")), "R8")
    assert "No mobilisation" in f.value_found
    f = one(run(env("3.1", value="Yes"), env("3.3", value="Simple interest 10% a year"),
                env("3.5", value="Bank guarantee for 110% of the advance")), "R8")
    assert "Simple interest" in f.value_found and "110%" in f.value_found
    assert "R8" not in ids(run(env("3.1", value="Yes"), env("3.3", value="Interest-free"),
                               env("3.5", value="Bank guarantee for 100% of the advance")))


def test_r11_gate_not_evaluable_t13():
    flags = run(env("5.1", value="Price adjustment applies only if the amount in the NIT is more than Rs 10 crore"))
    f = one(flags, "R11")
    assert f.category == "unclear" and "unknown" in f.value_found


@pytest.mark.parametrize("value,state", [(12e7, "on"), (5e7, "gate_not_met")])
def test_r11_gate_evaluated_with_contract_value(value, state):
    cash = CashInputs(contract_value=value, duration_months=12)
    flags = run(env("5.1", value="Price adjustment applies only if the amount in the NIT is more than Rs 10 crore"),
                cash=cash)
    if state == "on":
        assert "R11" not in ids(flags)
    else:
        assert one(flags, "R11").category == "risk"


def test_r11_holes_when_variation_applies():
    flags = run(env("5.1", value="Price variation clause applies"),
                env("5.3", value="Cement 20%, steel 15%, fuel 10%"),
                env("5.4", value="WPI for the month six months before the month of billing"),
                env("5.7", value="Payable only for stages billed within 30 days of the milestone"))
    f = one(flags, "R11")
    assert "labour" in f.explanation.lower() and "six months before" in f.value_found and "billed within" in f.value_found


def test_r13_minimum_bill_against_monthly_billing():
    cash = CashInputs(contract_value=2.4e7, duration_months=12)          # Rs 20 lakh a month
    flags = run(env("1.6", value="Minimum gross work Rs 30 lakhs before an interim payment"), cash=cash)
    assert one(flags, "R13").rupee_impact == pytest.approx(30e5)
    flags = run(env("1.6", value="Minimum gross work Rs 15 lakhs before an interim payment"), cash=cash)
    assert "R13" not in ids(flags)


def test_r14_guarantee_tied_to_time_extension():
    assert "R14" in ids(run(env("6.5", value="Valid to completion plus 60 days, and extended if time is extended")))
    assert "R14" not in ids(run(env("6.5", value="Furnished for 2 years and extended 2 months before expiry")))


def test_r5_damages_without_extension_route():
    flags = run(env("4.1", value="Yes"), env("4.5", status="NOT_STATED"))
    assert one(flags, "R5").severity == "High"


def test_missing_document_gives_r18():
    pkg = package(missing=[("General Conditions of Contract 2023", 21, "GCC 2023 shall apply")])
    f = one(run(pkg=pkg), "R18")
    assert f.severity == "Needs review" and f.category == "unclear" and f.pdf_page == 21
    assert "General Conditions of Contract 2023" in f.explanation


def test_r18_is_one_flag_with_important_documents_first():
    pkg = package(missing=[("Schedule A", 30, "qa"), ("Schedule B", 30, "qb"), ("Schedule H", 54, "qh"),
                           ("Annexure A", 229, "qx"), ("Schedule A", 31, "dup")])
    f = one(run(pkg=pkg), "R18")
    assert f.value_found == "Schedule H, Schedule A, Schedule B, Annexure A"
    assert (f.quote, f.pdf_page) == ("qh", 54)
    assert "4 document(s)" in f.explanation and "Schedule H (sets the stage-payment percentages)" in f.explanation


def test_conflict_gives_r16():
    c = Conflict(value="cement 20%, steel 20%", section_ref="Annexure R", pdf_page=70)
    f = one(run(env("5.3", value="cement 18%, steel 13%", section="Contract Data", conflicts=[c])), "R16")
    assert f.severity == "Needs review" and "Annexure R" in f.value_found and f.question_ids == ["5.3"]


def test_r17_groups_by_target_and_checks_package():
    flags = run(env("1.2", status="POINTS_ELSEWHERE", points_to="CPWD GCC 2023"),
                env("1.3", status="POINTS_ELSEWHERE", points_to="CPWD GCC 2023"))
    f = one(flags, "R17")
    assert f.question_ids == ["1.2", "1.3"] and "not in the package" in f.explanation
    pkg = package(files=("NIT.pdf", "Reference_CPWD_GCC_2023.pdf"))
    f = one(run(env("1.2", status="POINTS_ELSEWHERE", points_to="CPWD GCC 2023"), pkg=pkg), "R17")
    assert "seems to be in the package" in f.explanation


GCC_PHRASINGS = [
    dict(points_to="CPWD GCC 2023"),
    dict(points_to="General Conditions of Contract for CPWD 2023 (clause 2)"),
    dict(points_to="Reference_CPWD_GCC_2023.pdf"),
    dict(points_to="cpwd gcc-2023, Clause 10CC"),
    dict(points_to="GCC clause 2"),                                   # bare: merges into CPWD GCC 2023
    dict(value="Not in this file (GCC clause 2)."),                   # no points_to: read from the answer
    dict(value="The NIT incorporates CPWD General Conditions of Contract 2023 by reference (Schedule E)."),
    dict(value="Rate not stated here", section="Schedule E"),          # nothing named: unnamed, cited place
]


def test_r17_normalises_varied_gcc_phrasings():
    envs = [env(f"1.{i + 1}", status="POINTS_ELSEWHERE", **{"value": "", **p}) for i, p in enumerate(GCC_PHRASINGS)]
    flags = [f for f in run(*envs) if f.flag_id == "R17"]
    assert len(flags) == 2, [f.value_found for f in flags]
    gcc = next(f for f in flags if "CPWD GCC 2023" in f.explanation)
    assert gcc.question_ids == [f"1.{i}" for i in range(1, 8)]
    assert any("cited at Schedule E" in f.explanation for f in flags)


@pytest.mark.parametrize("text,key", [
    ("Schedule F, Cl. 2", "schedule f"), ("Schedule-F (clause 7)", "schedule f"), ("SCHEDULE F of the NIT", "schedule f"),
    ("Annexure P", "annexure p"), ("Annex-P to Contract Data", "annexure p"), ("Annexure-P, item 3", "annexure p"),
    ("Contract Data sheet, item 18", "contract data"), ("Schedules A to D", "schedule a"),
    ("MoRTH Specifications for Road Works, Section 900", "morth specifications for road works"),
])
def test_target_normalisation(text, key):
    from analyser.risk.targets import normalise
    assert normalise(text)[0] == key


def test_r17_more_than_three_targets_gives_one_flag():
    envs = [env("1.2", status="POINTS_ELSEWHERE", points_to="CPWD GCC 2023"),
            env("1.3", status="POINTS_ELSEWHERE", points_to="General Conditions of Contract (CPWD) 2023, cl. 7"),
            env("2.5", status="POINTS_ELSEWHERE", points_to="Schedule F, Cl. 17"),
            env("4.2", status="POINTS_ELSEWHERE", points_to="Annexure P"),
            env("5.3", status="POINTS_ELSEWHERE", points_to="Contract Data 31.2.4"),
            env("6.2", status="POINTS_ELSEWHERE", points_to="Schedule-F")]
    f = one(run(*envs), "R17")
    assert f.question_ids == ["1.2", "1.3", "2.5", "4.2", "5.3", "6.2"]
    assert "CPWD GCC 2023: Q 1.2, 1.3" in f.value_found and "Schedule F: Q 2.5, 6.2" in f.value_found
    assert "Annexure P: Q 4.2" in f.value_found and "Contract Data: Q 5.3" in f.value_found
    assert "4 documents" in f.explanation


# ---------------------------------------------------------------------------
# Cash-based rules and rupee impact
# ---------------------------------------------------------------------------

def _advance_cash(rate):
    return CashInputs(contract_value=100e7, duration_months=24,
                      advance_instalments=[AdvanceInstalment(share_of_value=0.05, month=0),
                                           AdvanceInstalment(share_of_value=0.05, month=2)],
                      advance_recovery_rate=rate, advance_recovery_deadline=0.8)


def test_r9_fast_recovery_uses_cash():
    flags = run(env("3.1", value="Yes"), env("3.4", value="15% of each bill"), cash=_advance_cash(0.15))
    f = one(flags, "R9")
    assert "month 16 of 24" in f.value_found and f.rupee_impact == pytest.approx(10e7)
    # slower recovery finishes at the 80% deadline: not "fast"
    assert "R9" not in ids(run(env("3.1", value="Yes"), cash=_advance_cash(0.10)))
    # no cash: skipped
    assert "R9" not in ids(run(env("3.1", value="Yes"), env("3.4", value="15% of each bill")))


def test_rupee_impact_ld_cap_times_value():
    cash = CashInputs(contract_value=V, duration_months=24)
    f = one(run(env("4.1", value="Yes"), env("4.2", value="0.05% per day"), env("4.3", value="15% of contract price"),
                cash=cash), "R4")
    assert f.rupee_impact == pytest.approx(0.15 * V)


def test_normalised_values_are_used_when_present():
    e = env("4.2", value="As stated in the contract data")
    e.verification = Verification(question_id="4.2", quote_found=True, normalised={"rate_per_day_of_value": 0.0006})
    f = one(run(env("4.1", value="Yes"), e, env("4.3", value="10% of contract price")), "R4")
    assert "0.06%" in f.value_found


def test_discarded_and_edited_answers():
    e = env("1.4", value="No interest payable")
    e.verification = Verification(question_id="1.4", quote_found=False, discard=True)
    assert "R6" not in ids(run(e))
    e2 = env("1.4", value="Bank Rate + 3%")
    e2.review.decision = "edited"
    e2.review.user_answer = env("1.4", value="No interest payable on any payment").answer
    assert one(run(e2), "R6").severity == "High"


def test_sort_order_severity_then_rupees():
    def f(i, sev, r=None):
        return RiskFlag(flag_id=f"R{i}", title="t", severity=sev, category="risk", rule="r",
                        value_found="v", explanation="e", rupee_impact=r)
    out = sort_flags([f(18, "Needs review"), f(14, "Low"), f(2, "Info"), f(1, "Medium", 1e5),
                      f(3, "Medium", 9e7), f(8, "Medium"), f(6, "High")])
    assert ids(out) == ["R6", "R3", "R1", "R8", "R14", "R2", "R18"]


def test_r11_labour_weight_written_as_L_code():
    """A weight table written as 'L20 C5 ...' has a labour component (regression)."""
    from analyser.risk import load_rules, parse
    pat = [r for r in load_rules() if r["id"] == "R11"][0]["patterns"]["labour"]
    assert parse.has("Earthwork: L20 C5 S0 B0 F10 M50 A15", pat)
    assert not parse.has("cement 18%, steel 13%", pat)
