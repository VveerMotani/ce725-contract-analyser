"""F10 normaliser: put every number of an answer into one unit set.

The original wording is kept next to each value. Conventions (stated in the output so a
reader can check them):

* percentages are kept as printed (6 means 6%), with the base they are "of";
* rates per week, month or year are also given per day: week = 7 days, month = 30 days,
  year = 365 days, so "1% per month" -> 0.0333% per day (conversion stated);
* periods keep their unit and say whether the days are working, business or calendar;
  weeks are converted to days, months and years are converted to approximate days;
* rupee amounts in lakh or crore are converted to rupees (1 lakh = 1,00,000; 1 crore = 100 lakh).

Besides the lists, flat keys for the risk and cash modules (shares are fractions):
``rate_share``, ``cap_share_of_value``, ``rate_per_day_of_value`` (C4 only), ``days``,
``days_kind``, ``months``, ``amount_rs``, ``conversion_note``.
"""
from __future__ import annotations

import re

from analyser.models import Answer

from .numbers import Quantity, extract_quantities
from .text import normalise

DAYS_PER = {"day": 1, "week": 7, "month": 30, "year": 365}
APPROX_DAYS = {"days": 1, "weeks": 7, "months": 30, "years": 365}


def _pct(x: float) -> str:
    return f"{x:.4f}".rstrip("0").rstrip(".")


def normalise_quantity(q: Quantity) -> dict:
    """One number in the common unit set, with the conversion written out."""
    out: dict = {"text": q.raw, "kind": q.kind, "value": q.value}
    if q.kind == "percent":
        out["base"] = q.base
        if q.per:
            per_day = q.value / DAYS_PER[q.per]
            out["per"] = q.per
            out["per_day_pct"] = round(per_day, 6)
            if q.per != "day":
                out["conversion"] = (f"{_pct(q.value)}% per {q.per} = {_pct(q.value)}/"
                                     f"{DAYS_PER[q.per]} = {_pct(per_day)}% per day "
                                     f"({DAYS_PER[q.per]}-day {q.per})")
    elif q.kind in APPROX_DAYS:
        out["unit"] = q.kind
        out["day_type"] = q.day_type or ("unspecified" if q.kind == "days" else "")
        days = q.value * APPROX_DAYS[q.kind]
        out["days"] = days
        if q.kind in ("months", "years"):
            out["conversion"] = f"{q.raw} {q.kind} ~ {days:g} days ({APPROX_DAYS[q.kind]} days per {q.kind[:-1]})"
    elif q.kind == "rupees":
        out["rupees"] = q.rupees
        if q.rupees != q.value:
            out["conversion"] = f"{q.raw} -> Rs {q.rupees:,.0f}"
    return out


def normalise_answer(answer: Answer) -> dict:
    """F10 output for one answer: lists of percentages, rates, periods and amounts."""
    text = "; ".join(x for x in (answer.answer_value, answer.unit) if x)
    qs = [q for q in extract_quantities(text) if q.kind not in ("ref", "ordinal")]
    # When the base field is filled and a percentage has none, use the stated base.
    for q in qs:
        if q.kind == "percent" and not q.base and answer.base:
            q.base = answer.base.lower()
    items = [normalise_quantity(q) for q in qs]
    result: dict = {
        "original": answer.answer_value,
        "unit": answer.unit,
        "base": answer.base,
        "percentages": [i for i in items if i["kind"] == "percent"],
        "periods": [i for i in items if i["kind"] in APPROX_DAYS],
        "amounts_rs": [i for i in items if i["kind"] == "rupees"],
        "other_numbers": [i for i in items if i["kind"] in ("number", "count")],
    }
    # For delay damages (C4) a single time-based rate is the damages rate per day,
    # so "1% per month" and "0.05% per day" become comparable (spec F10 "done when").
    rates = [i for i in result["percentages"] if "per_day_pct" in i]
    if answer.clause_id == "C4" and len(rates) == 1:
        result["rate_per_day_of_value"] = rates[0]["per_day_pct"] / 100.0
        if "conversion" in rates[0]:
            result["rate_conversion"] = rates[0]["conversion"]
            result["conversion_note"] = rates[0]["conversion"]
    result.update(headline_values(answer, qs, text))
    return result


_CAP_WORDS = re.compile(r"(cap(?:ped)?|maximum|max\.?|not exceed(?:ing)?|limited to|ceiling|"
                        r"not (?:be )?(?:more|above|greater) than|not above|"
                        r"up to|upto|subject to a maximum of|total)\W*(?:\w+\W+){0,3}$")
CAP_QUESTIONS = {"2.3", "4.3"}


def headline_values(answer: Answer, qs: list[Quantity], text: str) -> dict:
    """Flat keys read by the risk and cash modules; shares are fractions (6% -> 0.06).

    rate_share: first percentage that is not a cap and not a per-period rate;
    cap_share_of_value: a percentage after "cap", "maximum", "not exceed" (or the first
    percentage of a cap question, 2.3 / 4.3); days, months, amount_rs: first of each.
    """
    out: dict = {}
    norm = normalise(text)
    for q in qs:
        if q.kind != "percent" or q.per:      # per-period rates are not caps or shares
            continue
        is_cap = answer.question_id in CAP_QUESTIONS or bool(_CAP_WORDS.search(norm[max(0, q.start - 40):q.start]))
        if is_cap and "cap_share_of_value" not in out:
            out["cap_share_of_value"] = round(q.value / 100.0, 8)
        elif not is_cap and "rate_share" not in out:
            out["rate_share"] = round(q.value / 100.0, 8)
    for q in qs:
        if q.kind in ("days", "weeks") and "days" not in out:
            out["days"] = q.value * APPROX_DAYS[q.kind]
            out["days_kind"] = q.day_type or "unspecified"
            if q.kind == "weeks":
                out.setdefault("conversion_note", f"{q.raw} weeks = {out['days']:g} days")
        elif q.kind == "months" and "months" not in out:
            out["months"] = q.value
        elif q.kind == "rupees" and "amount_rs" not in out:
            out["amount_rs"] = q.rupees
            if q.rupees != q.value:
                out.setdefault("conversion_note", f"{q.raw} -> Rs {q.rupees:,.0f}")
    return out
