"""Which cash-model figures are still missing: not in the contract and not given by the user.

The cash model never runs on a made-up number. A figure is needed when the model uses it for
this contract (a guarantee commission only matters if there is a guarantee) and its provenance
is still "default". Until nothing is missing, the website shows no cash figure and asks for
the missing ones, and the risk rules work from the contract's own answers only.
"""
from __future__ import annotations

from ..models import CashInputs, CashParams

# Every contract: the size and length of the job, when bills are paid, and the contractor's own
# cost, financing rate, supplier credit and work programme (never in a contract). Price rise is
# a scenario: with none given, no price-rise figure is worked out (the panel asks for one).
ALWAYS = ["contract_value", "duration_months", "pay_lag_days", "cost_share", "overdraft_rate_pa",
          "supplier_credit_days", "progress"]


def needed_fields(inputs: CashInputs, provenance_notes: str = "") -> list[str]:
    """The inputs the cash model actually uses for this contract."""
    need = list(ALWAYS)
    if inputs.retention_rate > 0:
        need += ["retention_release", "dlp_months"]
    if inputs.perf_security_pct > 0:
        need += ["bg_commission_pa", "perf_security_validity_months_after_completion"]
    if any(a.share_of_value > 0 for a in inputs.advance_instalments) and "bg_commission_pa" not in need:
        need.append("bg_commission_pa")
    if inputs.pv_applies and inputs.index_rise_pa:
        need += ["pv_factor", "pv_weights"]   # only when a price-rise scenario is being tried
    if "Bank Rate" in provenance_notes:
        need.append("bank_rate_pa")       # a rate like "Bank Rate + 3%" was read from the contract
    return need


def missing_figures(params: CashParams, overrides: dict | None = None) -> list[str]:
    """Needed inputs that are neither from the contract nor the user's (overrides count as the user's)."""
    overrides = overrides or {}
    data = {**params.inputs.model_dump(), **{k: v for k, v in overrides.items() if k in CashInputs.model_fields}}
    inputs = CashInputs.model_validate(data)
    src = {p.field: p.source for p in params.provenance}
    notes = " ".join(p.note for p in params.provenance)
    missing = []
    for f in needed_fields(inputs, notes):
        given = f in overrides or src.get(f, "default") in ("extracted", "user")
        if f in ("contract_value", "duration_months") and not getattr(inputs, f):
            given = False                 # zero means unknown
        if not given:
            missing.append(f)
    return missing


def rebase_bank_rate(params: CashParams, new_bank_rate: float) -> dict:
    """Rates read as "Bank Rate + x%" were stored with the Bank Rate in force when they were
    mapped; move them to the Bank Rate the user gives. Returns the changed fields."""
    old = params.inputs.bank_rate_pa
    out = {}
    for p in params.provenance:
        if "Bank Rate" in p.note and p.field in ("late_interest_rate_pa", "advance_interest_rate_pa"):
            out[p.field] = max(0.0, getattr(params.inputs, p.field) - old + new_bank_rate)
    return out
