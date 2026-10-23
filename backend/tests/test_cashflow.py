"""M4 cash-flow engine: spec §8.4 hand benchmark (exact) plus edge and conservation tests."""
import math

import pytest

from analyser.cashflow import (diff_views, milestones, reference_changes, reference_view,
                               run_cashflow, run_detailed, s_curve)
from analyser.cashflow.benchmark import CRORE, benchmark_inputs
from analyser.models import AdvanceInstalment, CashInputs, ReleaseStep

V = 100 * CRORE


def approx(x, rel=1e-12, abs_=1e-4):
    return pytest.approx(x, rel=rel, abs=abs_)


def base(**kw) -> CashInputs:
    """Plain project with no special terms: Rs 100 crore, 24 months, even, zero lags."""
    d = dict(contract_value=V, duration_months=24, pay_lag_days=0.0, retention_release=[])
    d.update(kw)
    return CashInputs(**d)


# ---------------------------------------------------------------------------
# §8.4 hand benchmark, reproduced exactly
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def bm():
    inp = benchmark_inputs()
    return inp, run_cashflow(inp, sensitivities=False)


def test_84_gross_each_month(bm):
    _, res = bm
    for m in range(1, 25):
        assert res.months[m].gross == approx(V / 24)
    assert round(res.months[1].gross / CRORE, 4) == 4.1667


def test_84_retention_each_month_and_cap_month(bm):
    inp, res = bm
    for m in range(1, 21):
        assert res.months[m].retention == approx(0.25 * CRORE)
    for m in range(21, 25):
        assert res.months[m].retention == 0.0
    assert milestones(inp, res.months)["retention_cap_month"] == 20
    assert sum(r.retention for r in res.months) == approx(5 * CRORE)
    assert res.retention_locked_max == approx(5 * CRORE)


def test_84_advance_recovery_each_month_and_repaid_month(bm):
    inp, res = bm
    for m in range(1, 17):
        assert res.months[m].advance_recovery == approx(0.625 * CRORE)
    for m in range(17, 25):
        assert res.months[m].advance_recovery == approx(0.0)
    repaid = milestones(inp, res.months)["advance_repaid_month"]
    assert repaid == 16
    assert repaid <= inp.advance_recovery_deadline * inp.duration_months == pytest.approx(19.2)


def test_84_net_certified_month_1(bm):
    _, res = bm
    assert res.months[1].net_certified == approx((100 / 24 - 0.25 - 0.625) * CRORE)
    assert round(res.months[1].net_certified / CRORE, 4) == 3.2917


def test_84_delay_damages(bm):
    inp, res = bm
    assert inp.delay_days == 60
    assert res.ld_amount == approx(3 * CRORE)
    assert res.ld_days_to_cap == pytest.approx(200)
    at_cap = run_cashflow(inp.model_copy(update={"delay_days": 200}), sensitivities=False)
    beyond = run_cashflow(inp.model_copy(update={"delay_days": 400}), sensitivities=False)
    assert at_cap.ld_amount == approx(10 * CRORE)
    assert beyond.ld_amount == approx(10 * CRORE)


def test_84_cash_curve_shape(bm):
    """Payment lag 30 days = 1 month; advance 5 cr in months 0 and 2; release 1 month after completion."""
    _, res = bm
    m = res.months
    assert m[0].cash_in == approx(5 * CRORE)
    assert m[1].cash_in == approx(0.0)                       # month 1 bill is paid in month 2
    assert m[2].cash_in == approx(5 * CRORE + m[1].net_certified)
    assert m[26].cash_in == approx(-3 * CRORE)               # completion at 24 + 60/30 = 26: damages
    assert m[27].cash_in == approx(5 * CRORE)                # retention released
    assert m[-1].month == 27
    assert m[-1].retention_held == 0.0 and m[-1].advance_outstanding == 0.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def test_s_curve_shape():
    for T in (1, 6, 12, 24, 37):
        p = s_curve(T)
        assert len(p) == T
        assert sum(p) == pytest.approx(1.0, abs=1e-15)
        assert all(x >= 0 for x in p)
    p = s_curve(24)
    assert p[0] < p[5] < p[11]                                # rises to the middle
    assert p[11] == pytest.approx(p[12])                      # symmetric
    assert p[0] == pytest.approx(p[-1])


def test_progress_validation():
    with pytest.raises(ValueError):
        run_cashflow(base(progress=[0.5, 0.5]), sensitivities=False)
    res = run_cashflow(base(duration_months=2, progress=[1.0, 1.0]), sensitivities=False)
    assert res.months[1].gross == approx(V / 2)               # scaled to 1, with a note
    assert any("scaled" in n for n in res.notes)


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_no_retention():
    inp = base(retention_rate=0.0, retention_cap=0.05)
    res = run_cashflow(inp, sensitivities=False)
    assert all(r.retention == 0 for r in res.months)
    assert res.retention_locked_max == 0 and res.retention_financing_cost == 0
    assert milestones(inp, res.months)["retention_cap_month"] is None


def test_uncapped_retention_released_at_completion():
    inp = base(retention_rate=0.05, retention_cap=None,
               retention_release=[ReleaseStep(share=1.0, months_after_completion=0.0)])
    res = run_cashflow(inp, sensitivities=False)
    assert sum(r.retention for r in res.months) == approx(0.05 * V)
    assert res.months[24].retention_held == 0.0               # released at the end of month 24


def test_uncapped_ld_and_grace():
    inp = base(ld_rate_per_day=0.0005, ld_cap=None, delay_days=500)
    res = run_cashflow(inp, sensitivities=False)
    assert res.ld_amount == approx(0.25 * V)                  # 500 x 0.05% = 25%, no cap
    assert res.ld_days_to_cap is None
    g = run_cashflow(base(ld_rate_per_day=0.0005, ld_cap=0.10, ld_grace_days=10, delay_days=40),
                     sensitivities=False)
    assert g.ld_amount == approx(30 * 0.0005 * V)
    assert g.ld_days_to_cap == pytest.approx(210)
    assert run_cashflow(base(ld_rate_per_day=0.0005, ld_cap=0.1, ld_grace_days=30, delay_days=20),
                        sensitivities=False).ld_amount == 0.0


def test_zero_lag_cash_in_same_month():
    res = run_cashflow(base(pay_lag_days=0, cert_lag_days=0), sensitivities=False)
    for m in range(1, 25):
        assert res.months[m].cash_in == approx(res.months[m].net_certified)


def test_fractional_lag_is_split():
    """45 days = 1.5 months: half of the month-1 bill in month 2, half in month 3."""
    res = run_cashflow(base(duration_months=1, cert_lag_days=15, pay_lag_days=30), sensitivities=False)
    assert res.months[1].cash_in == approx(0.0)
    assert res.months[2].cash_in == approx(0.5 * V)
    assert res.months[3].cash_in == approx(0.5 * V)


def test_supplier_credit_shifts_cash_out():
    res = run_cashflow(base(duration_months=2, supplier_credit_days=30), sensitivities=False)
    assert res.months[1].cash_out == 0.0
    assert res.months[2].cash_out == approx(0.85 * V / 2)
    assert res.months[3].cash_out == approx(0.85 * V / 2)


def test_min_bill_threshold_accumulates():
    inp = base(duration_months=10, min_bill_value=0.25 * V)    # 10 cr a month, bill needs 25 cr
    res, ex = run_detailed(inp)
    bills = {m: b for m, b in enumerate(ex["bill"]) if b > 0}
    assert list(bills) == [3, 6, 9, 10]                         # last bill paid whatever its size
    assert bills[3] == approx(0.3 * V) and bills[10] == approx(0.1 * V)
    assert res.months[1].net_certified == 0.0
    assert sum(ex["bill"]) == approx(V)


def test_advance_deadline_forces_recovery():
    inp = base(advance_instalments=[AdvanceInstalment(share_of_value=0.10, month=0)],
               advance_recovery_rate=0.05, advance_recovery_deadline=0.8)
    res = run_cashflow(inp, sensitivities=False)
    # 5% of 4.1667 cr = 0.2083 cr a month for 18 months = 3.75 cr; rest (6.25 cr) forced in month 19
    assert res.months[18].advance_outstanding == approx(0.10 * V - 18 * 0.05 * V / 24)
    assert res.months[19].advance_recovery == approx(0.10 * V - 18 * 0.05 * V / 24)
    assert res.months[19].advance_outstanding == 0.0
    assert res.months[19].net_certified < 0                      # contractor repays more than the bill
    assert milestones(inp, res.months)["advance_repaid_month"] == 19


def test_advance_without_rate_recovered_at_final_bill():
    inp = base(advance_instalments=[AdvanceInstalment(share_of_value=0.05, month=1)])
    res = run_cashflow(inp, sensitivities=False)
    assert res.months[24].advance_recovery == approx(0.05 * V)
    assert res.months[-1].advance_outstanding == 0.0


def test_delay_moves_retention_release():
    inp = base(retention_rate=0.05, retention_cap=0.05,
               retention_release=[ReleaseStep(share=1.0, months_after_completion=1.0)])
    r0 = run_cashflow(inp, sensitivities=False)
    r90 = run_cashflow(inp.model_copy(update={"delay_days": 90}), sensitivities=False)
    assert r0.months[25].retention_held == 0.0 and r0.months[24].retention_held > 0
    assert r90.months[27].retention_held > 0 and r90.months[28].retention_held == 0.0


def test_release_shares_remainder_goes_to_dlp():
    inp = base(retention_rate=0.05, retention_cap=0.05, dlp_months=12,
               retention_release=[ReleaseStep(share=0.5, months_after_completion=0.0)])
    res = run_cashflow(inp, sensitivities=False)
    assert res.months[24].retention_held == approx(0.025 * V)
    assert res.months[36].retention_held == 0.0
    assert any("defects period" in n for n in res.notes)


# ---------------------------------------------------------------------------
# Conservation: all cash is captured by the extended timeline
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("delay", [0, 45, 250])
def test_conservation(delay):
    inp = CashInputs(
        contract_value=V, duration_months=18, progress=s_curve(18), cost_share=0.8,
        supplier_credit_days=20, cert_lag_days=7, pay_lag_days=38, min_bill_value=3 * CRORE,
        retention_rate=0.06, retention_cap=0.05,
        retention_release=[ReleaseStep(share=0.5, months_after_completion=0.5),
                           ReleaseStep(share=0.5, months_after_completion=12.25)],
        advance_instalments=[AdvanceInstalment(share_of_value=0.05, month=0),
                             AdvanceInstalment(share_of_value=0.05, month=3)],
        advance_recovery_rate=0.12, advance_recovery_deadline=0.8, advance_interest_rate_pa=0.09,
        ld_rate_per_day=0.0005, ld_cap=0.10, delay_days=delay,
        perf_security_pct=0.03, perf_security_validity_months_after_completion=6,
    )
    res = run_cashflow(inp, sensitivities=False)
    m = res.months
    total_adv = 0.10 * V
    assert sum(r.gross for r in m) == approx(V)
    assert sum(r.advance_recovery for r in m) == approx(total_adv)
    assert sum(r.net_certified for r in m) == approx(V - sum(r.retention for r in m) - total_adv)
    # total cash in = V + advances - recoveries + retention released - damages = V - damages
    assert m[-1].cum_in == approx(V - res.ld_amount)
    assert m[-1].cum_out == approx(0.8 * V)
    assert m[-1].gap == approx(0.8 * V - V + res.ld_amount)
    assert m[-1].retention_held == 0.0 and m[-1].advance_outstanding == 0.0
    assert res.ld_amount == approx(min(0.0005 * delay, 0.10) * V)
    # interest is exactly the sum of positive month-end gaps x rate / 12
    assert res.overdraft_interest == approx(sum(max(0, r.gap) for r in m) * 0.10 / 12)
    assert res.peak_funding == approx(max(0, max(r.gap for r in m)))


# ---------------------------------------------------------------------------
# Costs: guarantees, interest, escalation, late payment
# ---------------------------------------------------------------------------


def test_guarantee_cost():
    inp = base(perf_security_pct=0.03, perf_security_validity_months_after_completion=6,
               bg_commission_pa=0.015)
    res, ex = run_detailed(inp)
    assert ex["ps_guarantee_cost"] == approx(0.015 * 0.03 * V * 30 / 12)
    assert ex["advance_bg_cost"] == 0.0
    delayed, ex2 = run_detailed(inp.model_copy(update={"delay_days": 90}))
    assert ex2["ps_guarantee_cost"] == approx(0.015 * 0.03 * V * 33 / 12)   # validity moves with delay
    adv = base(bg_commission_pa=0.015, advance_interest_rate_pa=0.12,
               advance_instalments=[AdvanceInstalment(share_of_value=0.10, month=0)],
               advance_recovery_rate=0.15)
    res, ex = run_detailed(adv)
    bal = sum(r.advance_outstanding for r in res.months)
    assert ex["advance_bg_cost"] == approx(1.10 * bal * 0.015 / 12)
    assert res.advance_interest == approx(bal * 0.12 / 12)


def test_escalation_pv_and_fixed_price():
    scen = {"steel": 0.12, "labour": 0.06}
    w = {"steel": 0.3, "labour": 0.2}
    fixed = run_cashflow(base(index_rise_pa=scen, pv_weights=w), sensitivities=False)
    exp = sum(0.85 * V / 24 * (0.3 * (1.12 ** (m / 12) - 1) + 0.2 * (1.06 ** (m / 12) - 1))
              for m in range(1, 25))
    assert not fixed.escalation_is_recovery
    assert fixed.escalation_amount == approx(exp)
    pv = run_cashflow(base(index_rise_pa=scen, pv_weights=w, pv_applies=True, pv_factor=0.85),
                      sensitivities=False)
    assert pv.escalation_is_recovery
    assert pv.escalation_amount == approx(exp)                # 0.85 factor x bill = 0.85 cost share x work
    assert pv.total_cost_of_terms == approx(fixed.total_cost_of_terms - exp)
    none = run_cashflow(base(), sensitivities=False)
    assert none.escalation_amount == 0.0


def test_late_interest_only_if_contract_gives_it():
    inp = base(pay_lag_days=30)
    _, ex = run_detailed(inp, extra_pay_delay_days=30)
    assert ex["late_interest_income"] == 0.0
    _, ex = run_detailed(inp.model_copy(update={"late_interest_rate_pa": 0.0925}), extra_pay_delay_days=30)
    assert ex["late_interest_income"] == approx(V * 0.0925 * 30 / 365)
    _, ex = run_detailed(inp.model_copy(update={"late_interest_rate_pa": 0.0925}))
    assert ex["late_interest_income"] == 0.0                   # paid on time as written


def test_total_cost_of_terms_adds_up():
    inp = benchmark_inputs().model_copy(update={"perf_security_pct": 0.03, "advance_interest_rate_pa": 0.09,
                                                "pay_lag_days": 90, "advance_instalments": []})
    res = run_cashflow(inp, sensitivities=False)
    assert res.peak_funding > 0
    assert res.total_cost_of_terms == approx(res.overdraft_interest + res.advance_interest
                                             + res.guarantee_cost + res.ld_amount)


# ---------------------------------------------------------------------------
# Sensitivities, reference view, diff
# ---------------------------------------------------------------------------


def test_sensitivities():
    inp = benchmark_inputs()
    res = run_cashflow(inp)
    names = [s.name for s in res.sensitivities]
    assert names == ["Payment lag +30 days", "Retention release +6 months", "Advance off",
                     "Delay 0 days", "Delay 30 days", "Delay 90 days", "Delay 180 days"]
    s = {x.name: x for x in res.sensitivities}
    assert s["Advance off"].peak_funding > res.peak_funding
    assert s["Payment lag +30 days"].total_cost_of_terms >= res.total_cost_of_terms
    assert s["Delay 180 days"].total_cost_of_terms - s["Delay 0 days"].total_cost_of_terms >= 0.09 * V
    assert s["Delay 0 days"].total_cost_of_terms < res.total_cost_of_terms   # as written has 60 days


def test_reference_view_changes_only_worse_terms():
    inp = benchmark_inputs().model_copy(update={
        "pay_lag_days": 60, "ld_cap": None, "perf_security_pct": 0.10, "pv_applies": False,
        "index_rise_pa": {"steel": 0.1},
        "retention_release": [ReleaseStep(share=1.0, months_after_completion=12)]})
    ref = reference_view(inp)
    assert ref.retention_rate == 0.05 and ref.retention_cap == 0.05
    assert ref.retention_release[0].months_after_completion == 0.0
    assert ref.cert_lag_days + ref.pay_lag_days == 30
    assert ref.ld_cap == 0.10 and ref.ld_rate_per_day == 0.0005
    assert ref.perf_security_pct == 0.05
    assert ref.pv_applies and ref.pv_weights == {"steel": 1.0}
    assert inp.pay_lag_days == 60                              # original untouched
    good = base(pay_lag_days=10, retention_rate=0.025, retention_cap=0.025,
                retention_release=[ReleaseStep(share=1.0, months_after_completion=0.5)],
                ld_rate_per_day=0.0003, ld_cap=0.05, perf_security_pct=0.03, duration_months=12)
    assert reference_changes(good) == []
    assert reference_view(good) == good


def test_diff_views():
    inp = benchmark_inputs().model_copy(update={"pay_lag_days": 90, "advance_instalments": []})
    a = run_cashflow(inp, sensitivities=False)
    b = run_cashflow(reference_view(inp), sensitivities=False)
    d = {x["item"]: x for x in diff_views(a, b)}
    assert d["peak_funding"]["difference"] == approx(a.peak_funding - b.peak_funding)
    assert d["peak_funding"]["difference"] > 0                  # 90-day payment needs more funding
    assert d["total_cost_of_terms"]["difference"] > 0
    assert {"as_written", "reference", "difference", "label", "unit"} <= set(d["ld_amount"])


# ---------------------------------------------------------------------------
# Fields added after the first version (MonthRow.billed, CashResult extras,
# part payment, index lag)
# ---------------------------------------------------------------------------


def test_result_fields_filled(bm):
    inp, res = bm
    assert res.retention_cap_month == 20
    assert res.advance_repaid_month == 16
    assert res.receivable_max == approx(max(r.net_certified for r in res.months))   # 1-month lag
    assert res.late_interest_income == 0.0
    assert res.escalation_net_burden == 0.0
    assert all(r.billed == approx(r.gross) for r in res.months)


def test_billed_differs_with_min_bill():
    res = run_cashflow(base(duration_months=10, min_bill_value=0.25 * V), sensitivities=False)
    assert [r.month for r in res.months if r.billed > 0] == [3, 6, 9, 10]
    assert res.months[1].gross == approx(0.1 * V) and res.months[1].billed == 0.0
    assert sum(r.billed for r in res.months) == approx(V)


def test_part_payment_split():
    """75% paid 10 days after the bill (1/3 month: split), 25% after 60 days (2 months)."""
    inp = base(duration_months=1, pay_lag_days=60, part_payment_share=0.75, part_payment_days=10)
    res = run_cashflow(inp, sensitivities=False)
    m = res.months
    assert m[1].cash_in == approx(0.75 * V * 2 / 3)
    assert m[2].cash_in == approx(0.75 * V / 3)
    assert m[3].cash_in == approx(0.25 * V)
    assert m[-1].cum_in == approx(V)
    assert any("Part payment" in n for n in res.notes)
    # no part-payment days -> rule ignored
    plain = run_cashflow(base(duration_months=1, pay_lag_days=60, part_payment_share=0.75), sensitivities=False)
    assert plain.months[3].cash_in == approx(V)


def test_part_payment_reduces_funding():
    inp = benchmark_inputs().model_copy(update={"advance_instalments": [], "pay_lag_days": 60})
    slow = run_cashflow(inp, sensitivities=False)
    fast = run_cashflow(inp.model_copy(update={"part_payment_share": 0.75, "part_payment_days": 10}),
                        sensitivities=False)
    assert fast.peak_funding < slow.peak_funding
    assert fast.overdraft_interest < slow.overdraft_interest


def test_index_lag_reduces_pv_recovery():
    scen, w = {"steel": 0.12}, {"steel": 0.5}
    kw = dict(index_rise_pa=scen, pv_weights=w, pv_applies=True, pv_factor=0.85)
    r0 = run_cashflow(base(**kw), sensitivities=False)
    r3 = run_cashflow(base(index_lag_months=3, **kw), sensitivities=False)
    exp3 = sum(0.85 * V / 24 * 0.5 * (1.12 ** (max(0, m - 3) / 12) - 1) for m in range(1, 25))
    assert r3.escalation_amount == approx(exp3)
    assert r3.escalation_amount < r0.escalation_amount
    # the contractor's own cost rise is unchanged, so the net burden grows by the lost recovery
    assert r3.escalation_net_burden - r0.escalation_net_burden == approx(r0.escalation_amount - exp3)
    assert r0.escalation_net_burden == approx(0.0)


def test_late_interest_field_in_sensitivity_run():
    inp = base(pay_lag_days=30, late_interest_rate_pa=0.0925)
    res, _ = run_detailed(inp, extra_pay_delay_days=30)
    assert res.late_interest_income == approx(V * 0.0925 * 30 / 365)
