"""M4 Cash flow (feature F13): deterministic monthly cash model. No LLM.

Public interface (INTERFACES.md): run_cashflow, reference_view.
Helpers: s_curve, even_curve, milestones, diff_views, reference_changes, run_detailed.
Formulas and conventions: FORMULAS.md in this folder.
"""
from .engine import (even_curve, ld_amount, ld_days_to_cap, milestones, run_cashflow,
                     run_detailed, s_curve, sensitivity_cases)
from .reference import REFERENCE, diff_views, reference_changes, reference_view

__all__ = [
    "run_cashflow", "reference_view", "diff_views", "reference_changes", "REFERENCE",
    "s_curve", "even_curve", "milestones", "run_detailed", "sensitivity_cases",
    "ld_amount", "ld_days_to_cap",
]
