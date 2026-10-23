"""Deterministic monthly cash-flow engine (spec §8, feature F13).

Plain arithmetic only. No LLM. Every formula is written out in FORMULAS.md.

Time convention: row ``m`` is the END of month m. Row 0 is contract signing
(before work starts). Work of month m is billed at the end of month m.
Anything that arrives "t months" after an event at month m lands at
``m + t``; when ``m + t`` is not a whole number the amount is split linearly
between the two neighbouring month-ends (see ``_place``). 1 month = 30 days.
"""
from __future__ import annotations

import math

from ..models import CashInputs, CashResult, MonthRow, Sensitivity

DAYS_PER_MONTH = 30.0
DAYS_PER_YEAR = 365.0
ADVANCE_BG_SHARE = 1.10        # advance guarantee = 110% of the advance still outstanding [ASSUMPTION]
TOL = 1e-6                     # rupees; amounts smaller than this count as zero


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def s_curve(T: int) -> list[float]:
    """Standard S-shaped progress curve over T months, shares sum to exactly 1.

    Cumulative progress S(x) = 3x^2 - 2x^3 (x = elapsed share of time, the
    "smoothstep" curve): slow start, fastest at mid-point, slow finish.
    Monthly share p[m] = S(m/T) - S((m-1)/T).
    """
    if T < 1:
        raise ValueError("T must be at least 1 month")

    def cum(x: float) -> float:
        return 3 * x * x - 2 * x ** 3

    shares = [cum(m / T) - cum((m - 1) / T) for m in range(1, T + 1)]
    shares[-1] = 1.0 - sum(shares[:-1])   # remove floating-point residue
    return shares


def even_curve(T: int) -> list[float]:
    """Even progress: 1/T of the work in every month."""
    return [1.0 / T] * T


def _place(arr: list[float], t: float, amount: float) -> None:
    """Add ``amount`` at time t (months). Fractional t is split linearly.

    Example: t = 2.5 puts half in month 2 and half in month 3.
    """
    if abs(amount) < 1e-12:
        return
    t = max(0.0, t)
    k = math.floor(t + 1e-9)
    f = t - k
    if f < 1e-9:
        arr[k] += amount
    else:
        arr[k] += (1.0 - f) * amount
        arr[k + 1] += f * amount


def _progress(inp: CashInputs, notes: list[str]) -> list[float]:
    T = inp.duration_months
    if T < 1:
        raise ValueError("duration_months must be at least 1")
    if inp.progress is None:
        return even_curve(T)
    p = list(inp.progress)
    if len(p) != T:
        raise ValueError(f"progress has {len(p)} months but duration_months is {T}")
    if any(x < 0 for x in p):
        raise ValueError("progress shares cannot be negative")
    s = sum(p)
    if s <= 0:
        raise ValueError("progress shares add to zero")
    if abs(s - 1.0) > 1e-9:
        notes.append(f"Progress shares added to {s:.6f}; scaled to 1.")
        p = [x / s for x in p]
    return p


def _rise(rate_pa: float, t_months: float) -> float:
    """Index rise from the base date (month 0) to month t, compounding yearly rate."""
    return (1.0 + rate_pa) ** (t_months / 12.0) - 1.0


def _weighted_rise(weights: dict[str, float], scenario: dict[str, float], t: float) -> float:
    return sum(w * _rise(scenario.get(j, 0.0), t) for j, w in weights.items())


def ld_amount(inp: CashInputs, delay_days: float | None = None) -> float:
    """Delay damages in rupees: min(rate x max(0, D - grace), cap) x V."""
    D = inp.delay_days if delay_days is None else delay_days
    share = inp.ld_rate_per_day * max(0.0, D - inp.ld_grace_days)
    if inp.ld_cap is not None:
        share = min(share, inp.ld_cap)
    return share * inp.contract_value


def ld_days_to_cap(inp: CashInputs) -> float | None:
    """Days of delay (grace included) at which damages reach the cap. None if uncapped or no rate."""
    if inp.ld_cap is None or inp.ld_rate_per_day <= 0:
        return None
    return inp.ld_grace_days + inp.ld_cap / inp.ld_rate_per_day


# ---------------------------------------------------------------------------
# Core simulation
# ---------------------------------------------------------------------------


def _simulate(inp: CashInputs, extra_pay_delay_days: float = 0.0) -> tuple[CashResult, dict]:
    """Run the monthly model once. Returns the result and a dict of extra figures."""
    notes: list[str] = []
    V = inp.contract_value
    T = inp.duration_months
    p = _progress(inp, notes)

    bill_lag = (inp.cert_lag_days + inp.pay_lag_days + extra_pay_delay_days) / DAYS_PER_MONTH
    # part-payment rule: share paid at part_payment_days, the rest at pay_lag_days
    part_share = inp.part_payment_share if (inp.part_payment_share and inp.part_payment_days is not None) else 0.0
    part_share = min(1.0, max(0.0, part_share))
    part_lag = ((inp.cert_lag_days + inp.part_payment_days + extra_pay_delay_days) / DAYS_PER_MONTH
                if part_share > 0 else bill_lag)
    credit_lag = inp.supplier_credit_days / DAYS_PER_MONTH
    delay = max(0.0, float(inp.delay_days))
    Tc = T + delay / DAYS_PER_MONTH                    # completion certificate (month, may be fractional)

    # Retention release steps (shares of the retention held at completion)
    steps = [(max(0.0, s.share), max(0.0, s.months_after_completion)) for s in inp.retention_release]
    share_sum = sum(s for s, _ in steps)
    if share_sum > 1.0 + 1e-9:
        notes.append(f"Retention release shares added to {share_sum:.3f}; scaled to 1.")
        steps = [(s / share_sum, t) for s, t in steps]
        share_sum = 1.0
    remainder = 1.0 - share_sum
    if remainder > 1e-9 and inp.retention_rate > 0:
        steps.append((remainder, inp.dlp_months))
        notes.append(f"{remainder:.0%} of retention has no stated release; assumed released at the "
                     f"end of the defects period ({inp.dlp_months:g} months after completion).")

    inst_months = [a.month for a in inp.advance_instalments]
    last_event = max(
        [T + bill_lag, T + part_lag, T + credit_lag, Tc]
        + [Tc + t for _, t in steps]
        + [float(m) for m in inst_months]
    )
    H = math.ceil(last_event) + 3                      # array length (months 0..H-1)

    work = [0.0] * H
    for m in range(1, T + 1):
        work[m] = V * p[m - 1]

    # --- billing with minimum bill value: work accumulates until the threshold is met
    bill = [0.0] * H
    pending = 0.0
    for m in range(1, T + 1):
        pending += work[m]
        if pending >= inp.min_bill_value - TOL or m == T:
            bill[m] = pending
            pending = 0.0
    if inp.min_bill_value > 0:
        n_bills = sum(1 for m in range(1, T + 1) if bill[m] > TOL)
        notes.append(f"Minimum bill value Rs {inp.min_bill_value:,.0f}: {n_bills} running bills "
                     f"in {T} months (the final bill in month {T} is paid whatever its size).")

    # --- advance instalments
    adv_in = [0.0] * H
    for a in inp.advance_instalments:
        adv_in[max(0, a.month)] += a.share_of_value * V
    deadline_month = None
    if inp.advance_recovery_deadline is not None:
        deadline_month = max(1, math.floor(inp.advance_recovery_deadline * T + 1e-9))

    # --- deductions month by month
    ret = [0.0] * H
    rec = [0.0] * H
    net = [0.0] * H
    ret_cap = None if inp.retention_cap is None else inp.retention_cap * V
    ret_total = 0.0
    received = 0.0
    recovered = 0.0
    for m in range(H):
        received += adv_in[m]
        b = bill[m]
        # retention: r x bill until the running total reaches the cap
        r_m = inp.retention_rate * b
        if ret_cap is not None:
            r_m = max(0.0, min(r_m, ret_cap - ret_total))
            if r_m < TOL:
                r_m = 0.0
        # advance recovery: rho x bill until repaid; forced in full at the deadline or final bill
        room = received - recovered
        if room < TOL:
            room = 0.0
        forced = m >= T or (deadline_month is not None and m >= deadline_month)
        if forced:
            q = room
        else:
            q = min(inp.advance_recovery_rate * b, room)
        ret[m], rec[m] = r_m, q
        ret_total += r_m
        recovered += q
        net[m] = b - r_m - q
    if deadline_month is not None:
        notes.append(f"Advance recovery deadline: {inp.advance_recovery_deadline:.0%} of {T} months = "
                     f"month {inp.advance_recovery_deadline * T:g}; any balance is recovered in full "
                     f"from the bill of month {deadline_month}.")

    # --- cash in
    net_in = [0.0] * H
    for m in range(H):
        if net[m] != 0.0:
            _place(net_in, m + part_lag, part_share * net[m])
            _place(net_in, m + bill_lag, (1.0 - part_share) * net[m])
    rel_in = [0.0] * H
    for share, t in steps:
        _place(rel_in, Tc + t, share * ret_total)
    ld = ld_amount(inp)
    ld_out = [0.0] * H
    _place(ld_out, Tc, ld)                     # damages deducted from sums due at completion
    late_interest = 0.0
    if extra_pay_delay_days > 0 and inp.late_interest_rate_pa > 0:
        late_interest = sum(max(0.0, x) for x in net) * inp.late_interest_rate_pa * extra_pay_delay_days / DAYS_PER_YEAR
    cash_in = [net_in[m] + adv_in[m] + rel_in[m] - ld_out[m] for m in range(H)]

    # --- cash out
    cash_out = [0.0] * H
    for m in range(1, T + 1):
        _place(cash_out, m + credit_lag, inp.cost_share * work[m])

    # --- trim trailing empty months
    last = T
    for m in range(H):
        if any(abs(x[m]) > TOL for x in (cash_in, cash_out, ret, rec, adv_in, rel_in)):
            last = max(last, m)
    n = last + 1

    rows: list[MonthRow] = []
    cum_in = cum_out = held = adv_out = 0.0
    receivable = 0.0
    receivable_max = 0.0
    for m in range(n):
        cum_in += cash_in[m]
        cum_out += cash_out[m]
        held += ret[m] - rel_in[m]
        adv_out += adv_in[m] - rec[m]
        receivable += net[m] - net_in[m]
        receivable_max = max(receivable_max, receivable)
        rows.append(MonthRow(
            month=m, gross=work[m], retention=ret[m], advance_recovery=rec[m],
            net_certified=net[m], billed=bill[m], cash_in=cash_in[m], cash_out=cash_out[m],
            cum_in=cum_in, cum_out=cum_out, gap=cum_out - cum_in,
            retention_held=0.0 if abs(held) < TOL else held,
            advance_outstanding=0.0 if abs(adv_out) < TOL else adv_out,
        ))

    # --- peak funding
    peak_row = max(rows, key=lambda r: r.gap)          # first month with the largest gap
    peak_funding = max(0.0, peak_row.gap)
    peak_month = peak_row.month if peak_funding > 0 else 0

    # --- money costs (balance at the end of month m is carried through month m+1)
    overdraft_interest = sum(max(0.0, r.gap) for r in rows) * inp.overdraft_rate_pa / 12
    advance_interest = sum(r.advance_outstanding for r in rows) * inp.advance_interest_rate_pa / 12
    retention_financing = sum(r.retention_held for r in rows) * inp.overdraft_rate_pa / 12
    retention_locked_max = max(r.retention_held for r in rows)

    ps_years = (Tc + inp.perf_security_validity_months_after_completion) / 12
    ps_cost = inp.bg_commission_pa * inp.perf_security_pct * V * ps_years
    adv_bg_cost = sum(ADVANCE_BG_SHARE * r.advance_outstanding for r in rows) * inp.bg_commission_pa / 12
    guarantee_cost = ps_cost + adv_bg_cost

    # --- escalation
    scen = inp.index_rise_pa
    cost_w = dict(inp.pv_weights) if inp.pv_weights else (
        {k: 1.0 / len(scen) for k in scen} if scen else {})
    cost_rise = sum(inp.cost_share * work[m] * _weighted_rise(cost_w, scen, m) for m in range(1, T + 1))
    pv_recovery = 0.0
    if inp.pv_applies:
        lag = max(0, inp.index_lag_months)       # contract uses the index of month m - lag
        pv_recovery = sum(inp.pv_factor * bill[m] * _weighted_rise(inp.pv_weights, scen, max(0, m - lag))
                          for m in range(1, T + 1))
    escalation_amount = pv_recovery if inp.pv_applies else cost_rise
    escalation_burden = cost_rise - pv_recovery
    if scen and not inp.pv_weights:
        notes.append("No price-variation weights given: the index scenario is applied to the whole "
                     "cost with equal weights per index [ASSUMPTION].")
    if inp.pv_applies and scen and not inp.pv_weights:
        notes.append("Price variation applies but no weights are known, so the recovery is shown as 0.")

    total = (overdraft_interest + advance_interest + guarantee_cost + ld
             + escalation_burden - late_interest)

    extras = {
        "work": work[:n], "bill": bill[:n],
        "ps_guarantee_cost": ps_cost, "advance_bg_cost": adv_bg_cost,
        "late_interest_income": late_interest, "receivable_max": receivable_max,
        "cost_rise": cost_rise, "pv_recovery": pv_recovery, "escalation_burden": escalation_burden,
        "completion_month": Tc, "bill_lag_months": bill_lag,
    }
    ms = milestones(inp, rows)
    if part_share > 0:
        notes.append(f"Part payment: {part_share:.0%} of each bill paid {inp.part_payment_days:g} days after "
                     f"certification, the rest {inp.pay_lag_days:g} days after.")
    if inp.pv_applies and inp.index_lag_months:
        notes.append(f"Price variation uses indices {inp.index_lag_months} months before the billing month.")
    if inp.advance_interest_rate_encashed_pa is not None:
        notes.append("The higher interest rate on an encashed advance guarantee is not modelled "
                     "(the model assumes the advance is recovered from bills).")
    if ms["retention_cap_month"] is not None:
        notes.append(f"Retention reaches its cap in month {ms['retention_cap_month']}.")
    if ms["advance_repaid_month"] is not None:
        notes.append(f"Advance fully recovered in month {ms['advance_repaid_month']}.")
    notes.append(f"Largest sum certified but not yet paid: Rs {receivable_max:,.0f}.")
    if late_interest > 0:
        notes.append(f"Late-payment interest earned: Rs {late_interest:,.0f}.")
    if delay > 0:
        notes.append(f"Delay of {delay:g} days moves completion to month {Tc:.2f}; work is still billed as "
                     f"planned, retention release and the performance security move later; damages "
                     f"of Rs {ld:,.0f} are deducted at completion.")

    result = CashResult(
        months=rows, peak_funding=peak_funding, peak_month=peak_month,
        overdraft_interest=overdraft_interest, advance_interest=advance_interest,
        guarantee_cost=guarantee_cost, retention_locked_max=retention_locked_max,
        retention_financing_cost=retention_financing, ld_amount=ld,
        ld_days_to_cap=ld_days_to_cap(inp), escalation_amount=escalation_amount,
        escalation_is_recovery=inp.pv_applies, total_cost_of_terms=total, notes=notes,
        retention_cap_month=ms["retention_cap_month"], advance_repaid_month=ms["advance_repaid_month"],
        receivable_max=receivable_max, late_interest_income=late_interest,
        escalation_net_burden=escalation_burden,
    )
    return result, extras


def milestones(inp: CashInputs, rows: list[MonthRow]) -> dict:
    """Months in which retention reaches its cap and the advance is fully recovered (or None)."""
    V = inp.contract_value
    cap_month = None
    if inp.retention_cap is not None and inp.retention_rate > 0:
        cum = 0.0
        for r in rows:
            cum += r.retention
            if cum >= inp.retention_cap * V - 1e-6 * V:
                cap_month = r.month
                break
    repaid_month = None
    total_adv = sum(a.share_of_value for a in inp.advance_instalments) * V
    if total_adv > 0:
        cum = 0.0
        for r in rows:
            cum += r.advance_recovery
            if cum >= total_adv - 1e-6 * V:
                repaid_month = r.month
                break
    return {"retention_cap_month": cap_month, "advance_repaid_month": repaid_month}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

SENSITIVITY_DELAYS = (0, 30, 90, 180)


def sensitivity_cases(inp: CashInputs) -> list[tuple[str, CashInputs, float]]:
    """(name, inputs, extra employer payment delay in days) for each sensitivity run."""
    cases = [
        ("Payment lag +30 days", inp, 30.0),
        ("Retention release +6 months", inp.model_copy(update={"retention_release": [
            s.model_copy(update={"months_after_completion": s.months_after_completion + 6})
            for s in inp.retention_release]}), 0.0),
        ("Advance off", inp.model_copy(update={"advance_instalments": [],
                                                "advance_recovery_rate": 0.0}), 0.0),
    ]
    for d in SENSITIVITY_DELAYS:
        cases.append((f"Delay {d} days", inp.model_copy(update={"delay_days": d}), 0.0))
    return cases


def run_cashflow(inputs: CashInputs, sensitivities: bool = True) -> CashResult:
    """Run the monthly cash model for one set of inputs (spec §8.2), with optional sensitivities."""
    result, _ = _simulate(inputs)
    if sensitivities:
        for name, inp, extra in sensitivity_cases(inputs):
            r, _ = _simulate(inp, extra_pay_delay_days=extra)
            result.sensitivities.append(Sensitivity(
                name=name, peak_funding=r.peak_funding, peak_month=r.peak_month,
                interest_cost=r.overdraft_interest + r.advance_interest,
                total_cost_of_terms=r.total_cost_of_terms))
    return result


def run_detailed(inputs: CashInputs, extra_pay_delay_days: float = 0.0) -> tuple[CashResult, dict]:
    """Like run_cashflow (no sensitivities) but also returns the extra figures dict
    (bills, guarantee split, late interest, escalation split, receivable peak)."""
    return _simulate(inputs, extra_pay_delay_days)
