"""The "at reference value" view (spec §8.2 step 11, §7, Appendix A).

Only terms that are WORSE for the contractor than the reference are changed;
terms that are already better are left as written. The reference values and
their sources are listed in REFERENCE below and in FORMULAS.md.
"""
from __future__ import annotations

from ..models import CashInputs, CashResult, ReleaseStep

REFERENCE = {
    # R1: Manual for Procurement of Works 2022, security deposit usually 5% of each bill [SEEN]
    "retention_rate": 0.05,
    "retention_cap": 0.05,
    "retention_release_months_after_completion": 0.0,   # released at completion (task brief)
    # R7: NHAI 30 days [SEEN]; 30 days as a line is [ASSUMPTION]
    "payment_days": 30.0,
    # R4: NHAI 0.05% a day [SEEN], Manual cap 10% [SEEN]
    "ld_rate_per_day": 0.0005,
    "ld_cap": 0.10,
    # R3: Manual 2022 "usually 5%" [SEEN]. The DoE OM of 12 Nov 2020 (3%) is the alternative;
    # 5% is used so the reference view matches the R3 flag threshold ("above 5%").
    "perf_security_pct": 0.05,
    # R10: Manual: price variation not applicable up to 18 months [SEEN]
    "pv_min_duration_months": 18,
    "pv_factor": 0.85,                                   # CPWD 10CC factor [SEEN]
}


def reference_changes(inputs: CashInputs) -> list[dict]:
    """List the terms that reference_view changes: field, as written, reference value, reason."""
    R = REFERENCE
    out: list[dict] = []

    def add(field, old, new, reason):
        out.append({"field": field, "as_written": old, "reference": new, "reason": reason})

    # retention (R1)
    if inputs.retention_rate > 0:
        if inputs.retention_rate > R["retention_rate"]:
            add("retention_rate", inputs.retention_rate, R["retention_rate"], "R1: retention above 5% of each bill")
        if inputs.retention_cap is None or inputs.retention_cap > R["retention_cap"]:
            add("retention_cap", inputs.retention_cap, R["retention_cap"], "R1: retention uncapped or cap above 5%")
        late = max((s.months_after_completion for s in inputs.retention_release), default=0.0)
        shares = sum(s.share for s in inputs.retention_release)
        if late > R["retention_release_months_after_completion"] + 0.5 or shares < 1 - 1e-9:
            add("retention_release", [s.model_dump() for s in inputs.retention_release],
                [{"share": 1.0, "months_after_completion": 0.0}],
                "R1: retention held after completion")
    # payment (R7)
    days = inputs.cert_lag_days + inputs.pay_lag_days
    if days > R["payment_days"]:
        add("cert_lag_days + pay_lag_days", days, R["payment_days"], "R7: payment slower than 30 days")
    # delay damages (R4)
    if inputs.ld_rate_per_day > R["ld_rate_per_day"]:
        add("ld_rate_per_day", inputs.ld_rate_per_day, R["ld_rate_per_day"], "R4: daily rate above 0.05%")
    if inputs.ld_rate_per_day > 0 and (inputs.ld_cap is None or inputs.ld_cap > R["ld_cap"]):
        add("ld_cap", inputs.ld_cap, R["ld_cap"], "R4: damages uncapped or cap above 10%")
    # performance security (R3)
    if inputs.perf_security_pct > R["perf_security_pct"]:
        add("perf_security_pct", inputs.perf_security_pct, R["perf_security_pct"], "R3: performance security above 5%")
    # price variation (R10)
    if not inputs.pv_applies and inputs.duration_months > R["pv_min_duration_months"]:
        add("pv_applies", False, True, "R10: fixed price on a contract longer than 18 months")
    return out


def reference_view(inputs: CashInputs) -> CashInputs:
    """Same project with the risky terms set to the reference values (worse terms only)."""
    R = REFERENCE
    upd: dict = {}
    for ch in reference_changes(inputs):
        f = ch["field"]
        if f == "retention_release":
            upd[f] = [ReleaseStep(share=1.0, months_after_completion=R["retention_release_months_after_completion"])]
        elif f == "cert_lag_days + pay_lag_days":
            upd["cert_lag_days"] = 0.0
            upd["pay_lag_days"] = R["payment_days"]
        elif f == "pv_applies":
            upd["pv_applies"] = True
            upd["pv_factor"] = R["pv_factor"]
            if not inputs.pv_weights and inputs.index_rise_pa:
                n = len(inputs.index_rise_pa)
                upd["pv_weights"] = {k: 1.0 / n for k in inputs.index_rise_pa}
        else:
            upd[f] = ch["reference"]
    return inputs.model_copy(update=upd, deep=True)


DIFF_ITEMS = [
    ("peak_funding", "Peak funding need", "Rs"),
    ("peak_month", "Month of peak funding", "month"),
    ("overdraft_interest", "Overdraft interest", "Rs"),
    ("advance_interest", "Interest on advance", "Rs"),
    ("guarantee_cost", "Bank guarantee cost", "Rs"),
    ("retention_locked_max", "Largest retention held", "Rs"),
    ("retention_financing_cost", "Cost of financing retention (part of overdraft interest)", "Rs"),
    ("ld_amount", "Delay damages", "Rs"),
    ("escalation_amount", "Escalation (recovery if price variation applies, else exposure)", "Rs"),
    ("total_cost_of_terms", "Total cost of terms", "Rs"),
]


def diff_views(a: CashResult, b: CashResult) -> list[dict]:
    """Item-by-item difference a - b (a = as written, b = reference).

    A positive difference on a cost item means the contract as written costs
    the contractor that much more than the reference terms would.
    """
    rows = []
    for key, label, unit in DIFF_ITEMS:
        va, vb = getattr(a, key), getattr(b, key)
        rows.append({"item": key, "label": label, "unit": unit,
                     "as_written": va, "reference": vb, "difference": va - vb})
    return rows
