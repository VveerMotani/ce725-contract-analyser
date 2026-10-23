"""One function per rule R1-R18.

Each function takes the rule (a dict from rules_v1.yaml) and the RuleContext
and returns a list of RiskFlags (usually zero or one). All numbers it compares
against come from rule["thresholds"]; all phrases it looks for come from
rule["patterns"]. When a rule cannot run it records why with ctx.skip().
"""
from __future__ import annotations

import re
from typing import Callable, Optional

from ..models import RiskFlag
from . import parse
from .context import SEVERITY_ORDER, RuleContext, fill

EPS = 1e-9          # "above 5%" means strictly above; 5.0 is not flagged


# ---------------------------------------------------------------------------
# Building flags
# ---------------------------------------------------------------------------

class Hit:
    """One reason a rule fired: which trigger, what was found, from which question."""

    def __init__(self, key: str, detail: str, qid: str, **extra):
        self.key, self.detail, self.qid, self.extra = key, detail, qid, extra


def _short(text: str, n: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 3].rstrip() + "..."


def _rupee_sentence(rupee: Optional[tuple[float, str]]) -> str:
    if not rupee or rupee[0] is None:
        return ""
    return f" Money at stake: about {parse.fmt_rupees(rupee[0])} ({rupee[1]})."


def build_flag(rule: dict, hits: list[Hit], ctx: RuleContext,
               rupee: Optional[tuple[float, str]] = None,
               question_ids: Optional[list[str]] = None) -> RiskFlag:
    """Combine the hits of one rule into one flag; severity is the worst trigger."""
    triggers = rule.get("triggers", {})
    severities = [triggers[h.key]["severity"] for h in hits]
    severity = min(severities, key=SEVERITY_ORDER.index)
    explanation = " ".join(
        fill(triggers[h.key]["explanation"], {**rule.get("thresholds", {}), **h.extra, "detail": h.detail})
        for h in hits) + _rupee_sentence(rupee)
    first = ctx.get(hits[0].qid) if hits[0].qid else None
    return RiskFlag(
        flag_id=rule["id"], title=rule["title"], severity=severity,
        category=rule.get("category", "risk"), rule=rule["rule"],
        value_found="; ".join(h.detail for h in hits),
        reference_value=rule.get("reference_value", ""),
        reference_source=rule.get("reference_source", ""),
        question_ids=question_ids or sorted({h.qid for h in hits if h.qid}, key=_qkey),
        quote=first.verbatim_quote if first else "",
        section_ref=first.section_ref if first else "",
        pdf_page=first.pdf_page if first else 0,
        explanation=explanation.strip(),
        rupee_impact=round(rupee[0], 2) if rupee and rupee[0] is not None else None,
    )


def unclear_flag(rule: dict, ctx: RuleContext, qid: str, kind: Optional[str] = None,
                 detail: str = "") -> RiskFlag:
    """A flag for a term that is silent, deferred, or cannot be tested (category 'unclear')."""
    a = ctx.get(qid)
    status = a.status if a else "MISSING"
    kind = kind or {"NOT_STATED": "not_stated", "POINTS_ELSEWHERE": "points_elsewhere"}.get(status, "not_stated")
    unclear = rule.get("unclear", {})
    severity = "Needs review" if kind == "points_elsewhere" else unclear.get("severity", "Needs review")
    pointer = (a.points_to or f"the document cited at {a.section_ref or 'an unnamed place'}") if a else ""
    default = {
        "not_stated": f"The package does not answer question {qid} after a full search, so this rule cannot be checked. Confirm the term with the employer.",
        "points_elsewhere": "This term is not in the package; it is in {pointer}. Check it there.",
    }.get(kind, "This rule could not be checked: {detail}.")
    explanation = fill(unclear.get(kind, default), {**rule.get("thresholds", {}), "pointer": pointer, "detail": detail})
    if kind == "not_stated":
        value = "NOT_STATED: silent (nothing found after a full search)"
    elif kind == "points_elsewhere":
        value = f"POINTS_ELSEWHERE: {pointer}"
    else:
        value = detail
    return RiskFlag(
        flag_id=rule["id"], title=rule["title"], severity=severity, category="unclear",
        rule=rule["rule"], value_found=value,
        reference_value=rule.get("reference_value", ""), reference_source=rule.get("reference_source", ""),
        question_ids=[qid], quote=a.verbatim_quote if a else "",
        section_ref=a.section_ref if a else "", pdf_page=a.pdf_page if a else 0,
        explanation=explanation,
    )


def _qkey(qid: str) -> tuple:
    try:
        return tuple(int(x) for x in qid.split("."))
    except ValueError:
        return (999, qid)


def _pct(ctx: RuleContext, qid: str, norm_key: str) -> Optional[float]:
    """A percentage for a question: normalised share x 100 if the verifier gave one, else the first % in the text."""
    v = ctx.norm(qid, norm_key)
    if v is not None:
        return v * 100
    return parse.first_percent(ctx.value(qid))


# ---------------------------------------------------------------------------
# R1-R15: rules on the terms
# ---------------------------------------------------------------------------

def r1_retention(rule, ctx):
    th, pat = rule["thresholds"], rule["patterns"]
    if "NOT_APPLICABLE" in (ctx.status("2.1"), ctx.status("2.2")):
        return ctx.skip("R1", "no retention in this contract (NOT_APPLICABLE)")
    if ctx.status("2.2") != "FOUND":
        return ctx.skip("R1", f"retention rate not found (2.2 is {ctx.status('2.2')})")
    rate = _pct(ctx, "2.2", "rate_share")
    t22 = ctx.text("2.2")
    whole_value = parse.has(t22, pat["whole_value_base"]) and not parse.has(t22, pat["per_bill_base"])
    hits: list[Hit] = []

    s23, t23 = ctx.status("2.3"), ctx.value("2.3")
    no_cap_said = s23 == "FOUND" and parse.has(t23, pat["no_cap"])
    cap = _pct(ctx, "2.3", "cap_share_of_value") if s23 == "FOUND" and not no_cap_said else None
    if cap is not None:
        if cap > th["max_cap_pct"] + EPS:
            hits.append(Hit("cap_high", f"{parse.fmt_num(cap)}%", "2.3"))
    elif whole_value and rate is not None:
        # "2.5% of tendered amount": the rate is itself the total, so it acts as the cap
        if rate > th["max_cap_pct"] + EPS:
            hits.append(Hit("cap_high", f"{parse.fmt_num(rate)}% (rate on the whole contract value)", "2.2"))
    elif s23 == "NOT_STATED" or no_cap_said:
        hits.append(Hit("no_cap", f"{parse.fmt_num(rate) if rate is not None else '?'}% of each bill, no cap stated",
                        "2.3" if no_cap_said else "2.2"))

    if ctx.status("2.5") == "FOUND":
        t25 = ctx.value("2.5")
        if parse.has(t25, pat["late_release"]) and not parse.has(t25, pat["stage_release"]):
            hits.append(Hit("late_release", _short(parse.segments(t25)[0], 120), "2.5"))
    if not hits:
        return ctx.skip("R1", "retention cap and release within the reference")

    rupee = None
    v = ctx.contract_value()
    if ctx.cash_result is not None and ctx.cash_result.retention_locked_max > 0:
        rupee = (ctx.cash_result.retention_locked_max, "largest retention held, from the cash model")
    elif v:
        share = ctx.cash.retention_cap if ctx.cash and ctx.cash.retention_cap is not None else \
            (cap / 100 if cap is not None else (rate or 0) / 100)
        rupee = (share * v, "retention cap x contract value") if share else None
    return [build_flag(rule, hits, ctx, rupee)]


def r2_rate_above_cap(rule, ctx):
    if ctx.status("2.2") != "FOUND" or ctx.status("2.3") != "FOUND":
        return ctx.skip("R2", "needs both a retention rate (2.2) and a cap (2.3)")
    rate = _pct(ctx, "2.2", "rate_share")
    cap = _pct(ctx, "2.3", "cap_share_of_value")
    if rate is None or cap is None or rate <= cap + EPS:
        return ctx.skip("R2", "deduction rate is not above the cap")
    detail = (f"{parse.fmt_num(rate)}% of each bill with a total cap of {parse.fmt_num(cap)}%; "
              f"deductions stop after about {cap / rate:.0%} of the work is billed")
    return [build_flag(rule, [Hit("rate_above_cap", detail, "2.2")], ctx, question_ids=["2.2", "2.3"])]


def r3_performance_security(rule, ctx):
    th, pat = rule["thresholds"], rule["patterns"]
    hits: list[Hit] = []
    pct = None
    if ctx.status("6.2") == "FOUND":
        pct = ctx.norm("6.2", "rate_share")
        pct = pct * 100 if pct is not None else None
        if pct is None:
            for seg in parse.segments(ctx.value("6.2")):
                if parse.has(seg, pat["performance"]) and not parse.has(seg, pat["additional"]):
                    pct = parse.first_percent(seg)
                    if pct is not None:
                        break
        if pct is not None and pct > th["max_pct"] + EPS:
            hits.append(Hit("pct_high", f"{parse.fmt_num(pct)}% of contract value", "6.2"))
    if ctx.status("6.8") == "FOUND" and not parse.has(ctx.value("6.8"), pat["no_additional"]):
        hits.append(Hit("additional", _short(ctx.value("6.8"), 140), "6.8"))
    elif ctx.status("6.2") == "FOUND":
        for seg in parse.segments(ctx.value("6.2")):
            if parse.has(seg, pat["additional"]) and parse.percents(seg) and not parse.has(seg, pat["no_additional"]):
                hits.append(Hit("additional", _short(seg, 140), "6.2"))
                break
    if not hits:
        return ctx.skip("R3", "performance security within the reference and no extra security")
    v = ctx.contract_value()
    share = (ctx.cash.perf_security_pct if ctx.cash and ctx.cash.perf_security_pct else (pct or 0) / 100)
    rupee = (share * v, "performance security x contract value") if v and share else None
    return [build_flag(rule, hits, ctx, rupee)]


def r4_delay_damages(rule, ctx):
    th, pat = rule["thresholds"], rule["patterns"]
    s41, s42, s43 = ctx.status("4.1"), ctx.status("4.2"), ctx.status("4.3")
    said_none = s41 == "FOUND" and parse.has(ctx.value("4.1"), pat["no_damages"])
    if s41 == "NOT_APPLICABLE" or (said_none and s42 != "FOUND"):
        return ctx.skip("R4", "no delay damages in this contract")
    if s42 != "FOUND" and s43 != "FOUND":
        return ctx.skip("R4", f"rate and cap not in the package (4.2 {s42}, 4.3 {s43}); see R17")
    nrate = ctx.norm("4.2", "rate_per_day_of_value")
    rates = [(nrate * 100, "normalised")] if nrate is not None else \
        parse.per_day_rates(ctx.value("4.2"), th["days_per_month"]) if s42 == "FOUND" else []
    top = max(rates, key=lambda r: r[0]) if rates else None
    hits: list[Hit] = []

    cap = None
    if s43 == "FOUND" and parse.has(ctx.value("4.3"), pat["no_cap"]):
        uncapped = True
    elif s43 == "FOUND":
        cap = _pct(ctx, "4.3", "cap_share_of_value")
        uncapped = False
    else:
        uncapped = s43 == "NOT_STATED"
    if uncapped:
        rate_txt = f"{parse.fmt_num(top[0])}% of value a day" if top else _short(ctx.value("4.2"), 100)
        hits.append(Hit("no_cap", rate_txt, "4.3" if s43 == "FOUND" else "4.2"))
    elif cap is not None and cap > th["max_cap_pct"] + EPS:
        hits.append(Hit("cap_high", f"{parse.fmt_num(cap)}%", "4.3"))
    if top and top[0] > th["max_daily_rate_pct"] + EPS:
        phrase = "" if top[1] == "normalised" else f" ('{_short(top[1], 60)}')"
        hits.append(Hit("daily_rate_high", f"{parse.fmt_num(top[0])}% of value a day{phrase}", "4.2"))
    if not hits:
        return ctx.skip("R4", "damages capped at or below the reference, daily rate within the reference")

    v = ctx.contract_value()
    rupee = None
    if v and not uncapped:
        share = ctx.cash.ld_cap if ctx.cash and ctx.cash.ld_cap is not None else (cap / 100 if cap else None)
        rupee = (share * v, "damages cap x contract value") if share else None
    elif v and ctx.cash_result is not None and ctx.cash_result.ld_amount > 0:
        rupee = (ctx.cash_result.ld_amount, "damages for the chosen delay, from the cash model")
    elif v and top and ctx.cash and ctx.cash.delay_days:
        rupee = (top[0] / 100 * ctx.cash.delay_days * v, f"damages for {ctx.cash.delay_days} days of delay, no cap")
    return [build_flag(rule, hits, ctx, rupee, question_ids=["4.1", "4.2", "4.3"])]


def r5_extension_of_time(rule, ctx):
    pat = rule.get("patterns", {})
    damages = (ctx.status("4.1") == "FOUND" and not re.match(r"\s*no\b", ctx.value("4.1"), re.I)) \
        or ctx.status("4.2") == "FOUND"
    if not damages:
        return ctx.skip("R5", "no delay damages found, so extension of time is not tested")
    s45 = ctx.status("4.5")
    if s45 == "NOT_STATED" or (s45 == "FOUND" and parse.has(ctx.value("4.5"), pat.get("no_eot", []))):
        return [build_flag(rule, [Hit("no_eot", "damages apply; no extension-of-time grounds found", "4.5")], ctx,
                           question_ids=["4.1", "4.5"])]
    return ctx.skip("R5", f"extension-of-time answer is {s45}")


def r6_late_payment_interest(rule, ctx):
    pat = rule["patterns"]
    s = ctx.status("1.4")
    if s in ("NOT_STATED", "POINTS_ELSEWHERE"):
        return [unclear_flag(rule, ctx, "1.4")]
    if s == "NOT_APPLICABLE" or (s == "FOUND" and parse.has(ctx.value("1.4"), pat["no_interest"])):
        detail = "no interest is payable on late payment: '" + _short(parse.segments(ctx.value("1.4"))[0] if ctx.value("1.4") else "not applicable", 100) + "'"
        return [build_flag(rule, [Hit("no_interest", detail, "1.4")], ctx)]
    return ctx.skip("R6", f"interest on late payment is provided (1.4 {s})")


def r7_payment_period(rule, ctx):
    th = rule["thresholds"]
    s = ctx.status("1.3")
    if s in ("NOT_STATED", "POINTS_ELSEWHERE"):
        return [unclear_flag(rule, ctx, "1.3")]
    if s != "FOUND":
        return ctx.skip("R7", f"payment period answer is {s}")
    days = ctx.norm("1.3", "days")
    shown = ""
    if days is None:
        parts = []
        for seg in parse.segments(ctx.value("1.3")):
            if parse.has(seg, rule["patterns"]["ignore_segment"]):
                continue
            for val, unit in parse.durations(seg):
                parts.append((parse.to_calendar_days(val, unit, th["working_day_factor"]), val, unit))
        if not parts:
            return ctx.skip("R7", "payment period found but no number of days in it")
        days, val, unit = max(parts)
        shown = f"{parse.fmt_num(val)} {unit.replace('_', ' ')}s"
        if unit != "day":
            shown += f" (about {days:.0f} calendar days)"
    else:
        shown = f"{days:.0f} days"
    if days <= th["max_payment_days"] + EPS:
        return ctx.skip("R7", f"payment within {days:.0f} days")
    rupee = None
    v = ctx.contract_value()
    if v and ctx.cash:
        extra = days - th["max_payment_days"]
        rupee = (v * ctx.cash.overdraft_rate_pa * extra / 365,
                 f"overdraft interest on the contract value for {extra:.0f} extra days")
    return [build_flag(rule, [Hit("slow", shown, "1.3")], ctx, rupee)]


def r8_advance(rule, ctx):
    th, pat = rule["thresholds"], rule["patterns"]
    s31, t31 = ctx.status("3.1"), ctx.value("3.1")
    if s31 in ("NOT_STATED", "POINTS_ELSEWHERE"):
        return [unclear_flag(rule, ctx, "3.1")]
    if s31 == "MISSING":
        return ctx.skip("R8", "no usable answer to 3.1")
    says_yes = bool(re.match(r"\s*yes\b", t31, re.I))
    if s31 == "NOT_APPLICABLE" or (not says_yes and parse.has(t31, pat["no_advance"])):
        return [build_flag(rule, [Hit("no_advance", _short(t31 or "not applicable", 100), "3.1")], ctx)]
    hits: list[Hit] = []
    if ctx.status("3.3") == "FOUND":
        t33 = ctx.value("3.3")
        if parse.has(t33, pat["interest_bearing"]) and not parse.has(t33, pat["interest_free"]):
            hits.append(Hit("interest_bearing", _short(parse.segments(t33)[0], 100), "3.3"))
    if ctx.status("3.5") == "FOUND":
        g = parse.max_percent(ctx.value("3.5"))
        if g is not None and g > th["max_guarantee_pct"] + EPS:
            hits.append(Hit("guarantee_high", f"{parse.fmt_num(g)}% of the advance", "3.5"))
    if not hits:
        return ctx.skip("R8", "advance given, interest-free, guarantee not above the advance")
    rupee = None
    if ctx.cash_result is not None and ctx.cash_result.advance_interest > 0:
        rupee = (ctx.cash_result.advance_interest, "interest on the advance, from the cash model")
    return [build_flag(rule, hits, ctx, rupee)]


def _recovery_from_cash(ctx) -> Optional[tuple[int, float, float, int]]:
    """(month fully recovered, work share done by then, advance Rs, duration) from CashResult or CashInputs."""
    cash, res = ctx.cash, ctx.cash_result
    v = cash.contract_value if cash else None
    if res is not None and res.months and v:
        advance = max((r.advance_outstanding + r.advance_recovery for r in res.months), default=0)
        cum_gross, recovered_any = 0.0, False
        for r in res.months:
            cum_gross += r.gross
            recovered_any = recovered_any or r.advance_recovery > 0
            if recovered_any and r.advance_outstanding <= 1e-6 * v:
                return r.month, cum_gross / v, advance, len(res.months)
        return None
    if not cash or not cash.advance_instalments or cash.advance_recovery_rate <= 0:
        return None
    T = cash.duration_months
    progress = cash.progress or [1 / T] * T
    advance = sum(i.share_of_value for i in cash.advance_instalments) * v
    left, done = advance, 0.0
    for m, p in enumerate(progress, start=1):
        done += p
        left -= min(left, cash.advance_recovery_rate * v * p)
        deadline = cash.advance_recovery_deadline
        if deadline and m >= deadline * T:
            left = 0.0                      # balance deducted at the deadline
        if left <= 1e-6 * v:
            return m, done, advance, T
    return None


def r9_advance_recovery(rule, ctx):
    th = rule["thresholds"]
    if ctx.cash is None and ctx.cash_result is None:
        return ctx.skip("R9", "needs the cash inputs or cash result (S-curve) to compare recovery with the work")
    if ctx.status("3.1") == "NOT_APPLICABLE":
        return ctx.skip("R9", "no advance in this contract")
    rec = _recovery_from_cash(ctx)
    if rec is None:
        return ctx.skip("R9", "no advance or recovery rate in the cash inputs, or not fully recovered within the contract")
    month, share, advance, T = rec
    if share >= th["min_work_share_at_full_recovery"] - EPS:
        return ctx.skip("R9", f"advance fully recovered at {share:.0%} of the work")
    detail = f"month {month} of {T}, when only {share:.0%} of the work is done"
    return [build_flag(rule, [Hit("fast", detail, "3.4")], ctx,
                       (advance, "advance taken back from bills before 80% of the work"), question_ids=["3.4"])]


def price_variation_state(ctx: RuleContext, rule10: dict) -> dict:
    """Decide whether price variation applies: on, off, gate_not_met, gate_unknown, or not answered.

    Gates such as 'only above Rs 10 crore' or 'only for periods over 12 months'
    are tested against the contract value and duration (trap T13).
    """
    pat = rule10["patterns"]
    s = ctx.status("5.1")
    if s in ("NOT_STATED", "POINTS_ELSEWHERE", "MISSING"):
        return {"state": s}
    text = ctx.value("5.1")
    dur, dur_src = ctx.duration_months()
    val, val_src = ctx.value_for_gates()
    gates = []      # (met: True/False/None, description)
    for p in pat["gate_months"]:
        for m in re.finditer(p, text, re.I):
            g = float(m.group(1))
            met = None if dur is None else dur > g
            gates.append((met, f"applies only over {parse.fmt_num(g)} months; "
                               + (f"this contract is {parse.fmt_num(dur)} months ({dur_src})" if dur else "duration unknown")))
    for p in pat["gate_value"]:
        for m in re.finditer(p, text, re.I):
            amt = parse.rupees("Rs " + m.group(1) + " " + (m.group(2) or ""))
            if not amt:
                continue
            met = None if val is None else val > amt[0]
            gates.append((met, f"applies only over {parse.fmt_rupees(amt[0])}; "
                               + (f"this contract is {parse.fmt_rupees(val)} ({val_src})" if val else "contract value unknown")))
    fixed = s == "NOT_APPLICABLE" or parse.has(text, pat["fixed"])
    gate_desc = "; ".join(d for _, d in gates)
    if any(met is False for met, _ in gates):
        state = "gate_not_met"
    elif fixed:
        state = "off"
    elif any(met is None for met, _ in gates):
        state = "gate_unknown"
    elif parse.has(text, pat["active"]):
        state = "on"
    else:
        state = "unclear"
    return {"state": state, "gate": gate_desc, "duration": dur, "duration_src": dur_src,
            "fixed_reason": find_fixed_reason(text, pat["fixed"]) or ("switched off (NOT_APPLICABLE)" if s == "NOT_APPLICABLE" else "")}


def find_fixed_reason(text: str, patterns: list[str]) -> str:
    phrase = parse.find(text, patterns)
    return f"'{phrase}'" if phrase else ""


def r10_fixed_price_long(rule, ctx):
    th = rule["thresholds"]
    pv = price_variation_state(ctx, rule)
    st = pv["state"]
    if st in ("NOT_STATED", "POINTS_ELSEWHERE"):
        return [unclear_flag(rule, ctx, "5.1")]
    if st not in ("off", "gate_not_met"):
        return ctx.skip("R10", f"price variation state is '{st}'")
    reason = pv["fixed_reason"] or pv["gate"] or "no price variation"
    if pv["duration"] is None:
        return [unclear_flag(rule, ctx, "5.1", "no_duration", reason)]
    if pv["duration"] <= th["max_fixed_price_months"] + EPS:
        return ctx.skip("R10", f"fixed price but only {parse.fmt_num(pv['duration'])} months")
    detail = f"{reason}; planned duration {parse.fmt_num(pv['duration'])} months ({pv['duration_src']})"
    rupee = None
    r = ctx.cash_result
    if r is not None and not r.escalation_is_recovery and r.escalation_amount > 0:
        rupee = (r.escalation_amount, "cost rise not recovered, from the cash model's index scenario")
    return [build_flag(rule, [Hit("long_fixed", detail, "5.1")], ctx, rupee, question_ids=["5.1", "0.4"])]


def r11_price_variation_holes(rule, ctx):
    th, pat = rule["thresholds"], rule["patterns"]
    pv = price_variation_state(ctx, ctx.rules["R10"])    # R10 holds the gate patterns
    st = pv["state"]
    if st == "gate_not_met":
        return [build_flag(rule, [Hit("gate_not_met", pv["gate"], "5.1")], ctx)]
    if st == "gate_unknown":
        return [unclear_flag(rule, ctx, "5.1", "gate_unknown", pv["gate"])]
    if st != "on":
        return ctx.skip("R11", f"price variation state is '{st}'")
    hits: list[Hit] = []
    if ctx.status("5.3") == "FOUND" and not parse.has(ctx.value("5.3"), pat["labour"]):
        hits.append(Hit("no_labour", _short(ctx.value("5.3"), 100), "5.3"))
    words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
    for q in ("5.4", "5.2", "5.5"):
        if ctx.status(q) != "FOUND":
            continue
        for p in pat["lag"]:
            m = re.search(p, ctx.value(q), re.I)
            if m:
                n = words.get(m.group(1).lower()) or float(m.group(1))
                if n > th["max_index_lag_months"] + EPS:
                    hits.append(Hit("long_lag", m.group(0), q))
                break
    if ctx.status("5.7") == "FOUND" and parse.has(ctx.value("5.7"), pat["billing_cutoff"]):
        hits.append(Hit("billing_cutoff", _short(ctx.value("5.7"), 140), "5.7"))
    if not hits:
        return ctx.skip("R11", "price variation applies with no holes found")
    return [build_flag(rule, hits, ctx)]


def r12_termination_withholding(rule, ctx):
    th, pat = rule["thresholds"], rule["patterns"]
    term_hit, wh_hit, wh_max = None, None, 0.0
    for q in rule["question_ids"]:
        if ctx.status(q) != "FOUND":
            continue
        for seg in parse.segments(ctx.value(q)):
            if term_hit is None and parse.has(seg, pat["termination"]):
                term_hit = Hit("termination", _short(seg, 140), q)
            if parse.has(seg, pat["withholding"]):
                top = parse.max_percent(seg)
                if top is not None and top > th["withholding_pct"] + EPS and top > wh_max:
                    wh_max, wh_hit = top, Hit("withholding", _short(seg, 140), q)
    hits = [h for h in (term_hit, wh_hit) if h]
    if not hits:
        return ctx.skip("R12", "no progress-linked termination or large milestone withholding found")
    v = ctx.contract_value()
    rupee = (wh_max / 100 * v, "largest withholding % x contract value") if v and wh_hit else None
    return [build_flag(rule, hits, ctx, rupee)]


def r13_minimum_bill(rule, ctx):
    th, pat = rule["thresholds"], rule["patterns"]
    if ctx.status("1.6") != "FOUND":
        return ctx.skip("R13", f"minimum bill answer is {ctx.status('1.6')}")
    t16 = ctx.value("1.6")
    if parse.has(t16, pat["none"]):
        return ctx.skip("R13", "no minimum bill value")
    amt = ctx.norm("1.6", "amount_rs")
    if amt is None:
        found = parse.rupees(t16)
        amt = found[0] if found else None
    if amt is None:
        return ctx.skip("R13", "minimum bill stated without a rupee amount")
    val, val_src = ctx.value_for_gates()
    dur, _ = ctx.duration_months()
    if not val or not dur:
        return [unclear_flag(rule, ctx, "1.6", "no_value", f"{parse.fmt_rupees(amt)}")]
    monthly = val / max(dur, 1.0)
    if amt <= monthly * th["max_months_of_billing"] + EPS:
        return ctx.skip("R13", f"minimum bill {parse.fmt_rupees(amt)} within one month of billing ({parse.fmt_rupees(monthly)})")
    detail = (f"work worth {parse.fmt_rupees(amt)} is done since the last bill; one planned month of billing is about "
              f"{parse.fmt_rupees(monthly)} ({val_src}, over {parse.fmt_num(dur)} months)")
    return [build_flag(rule, [Hit("high", detail, "1.6")], ctx,
                       (amt, "work value you may have to carry before a bill is due"))]


def r14_guarantee_extension(rule, ctx):
    if ctx.status("6.5") != "FOUND" or not parse.has(ctx.value("6.5"), rule["patterns"]["tied"]):
        return ctx.skip("R14", "guarantee validity not tied to extensions of time")
    phrase = next((s for s in parse.segments(ctx.value("6.5")) if parse.has(s, rule["patterns"]["tied"])), "")
    phrase = _short(phrase, 140)
    rupee = None
    v = ctx.contract_value()
    if v and ctx.cash:
        share = ctx.cash.perf_security_pct or (parse.first_percent(ctx.value("6.2")) or 0) / 100
        if share:
            rupee = (ctx.cash.bg_commission_pa * share * v, "bank commission on the performance guarantee per extra year")
    return [build_flag(rule, [Hit("tied", f"'{phrase}'", "6.5")], ctx, rupee)]


def r15_payment_conditions(rule, ctx):
    pat = rule["patterns"]
    hits: list[Hit] = []
    if ctx.status("1.8") == "FOUND" and not parse.has(ctx.value("1.8"), pat["none"]):
        hits.append(Hit("condition", _short(ctx.value("1.8"), 140), "1.8"))
    else:
        for q in ("1.1", "1.5", "1.7"):
            if ctx.status(q) == "FOUND":
                for seg in parse.segments(ctx.value(q)):
                    if parse.has(seg, pat["condition"]):
                        hits.append(Hit("condition", _short(seg, 140), q))
                        break
            if hits:
                break
    if not hits:
        return ctx.skip("R15", "no payment conditions found")
    return [build_flag(rule, hits, ctx)]


# ---------------------------------------------------------------------------
# R16-R18: conflicts, unresolved references, missing documents
# ---------------------------------------------------------------------------

def r16_conflicts(rule, ctx):
    flags = []
    for qid in sorted(ctx.answers, key=_qkey):
        a = ctx.answers[qid]
        parts = []
        for c in a.conflicts:
            gov = " (stated to govern)" if c.governs else ""
            parts.append(f"'{_short(c.value, 80)}' at {c.section_ref or '?'}, p{c.pdf_page}{gov}")
        if not parts:
            continue
        detail = f"Q{qid}: '{_short(a.answer_value, 80)}' at {a.section_ref or '?'}, p{a.pdf_page} vs " + "; ".join(parts)
        flags.append(build_flag(rule, [Hit("conflict", detail, qid)], ctx))
    if not flags:
        ctx.skip("R16", "no conflicts recorded on any answer")
    return flags


_STOP = {"the", "and", "of", "for", "see", "pdf", "document", "conditions", "general", "contract", "reference"}


def _tokens(s: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if len(t) >= 3 and t not in _STOP}


def _target_in_package(target: str, ctx: RuleContext) -> bool:
    want = _tokens(target)
    if len(want) < 2:
        return False
    for f in ctx.package.files:
        have = _tokens(f.filename.rsplit(".", 1)[0])
        if len(want & have) >= max(2, int(0.67 * len(want) + 0.5)):
            return True
    return False


UNNAMED_TARGET = "a blank or an unnamed document"


def r17_unresolved_references(rule, ctx):
    groups: dict[str, list[str]] = {}
    names: dict[str, str] = {}
    for qid in sorted(ctx.answers, key=_qkey):
        a = ctx.answers[qid]
        if a.status != "POINTS_ELSEWHERE":
            continue
        name = a.points_to.strip() or f"{UNNAMED_TARGET} (cited at {a.section_ref or '?'})"
        key = name.lower()
        groups.setdefault(key, []).append(qid)
        names[key] = name
    flags = []
    for key, qids in groups.items():
        name = names[key]
        in_package = not name.startswith(UNNAMED_TARGET) and _target_in_package(name, ctx)
        trigger = "target_in_package" if in_package else "missing_target"
        detail = "questions " + ", ".join(qids)
        hit = Hit(trigger, detail, qids[0], count=len(qids), pointer=name)
        flags.append(build_flag(rule, [hit], ctx, question_ids=qids))
    if not flags:
        ctx.skip("R17", "no POINTS_ELSEWHERE answers")
    return flags


def r18_missing_documents(rule, ctx):
    flags, seen = [], set()
    for ref in ctx.package.missing_references:
        key = ref.label.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        hit = Hit("missing", ref.label, "")
        f = build_flag(rule, [hit], ctx)
        f.quote, f.pdf_page, f.section_ref = ref.quote, ref.page, f"cited in {ref.doc_id}"
        flags.append(f)
    if not flags:
        ctx.skip("R18", "package lists no missing references")
    return flags


EVALUATORS: dict[str, Callable] = {
    "R1": r1_retention, "R2": r2_rate_above_cap, "R3": r3_performance_security,
    "R4": r4_delay_damages, "R5": r5_extension_of_time, "R6": r6_late_payment_interest,
    "R7": r7_payment_period, "R8": r8_advance, "R9": r9_advance_recovery,
    "R10": r10_fixed_price_long, "R11": r11_price_variation_holes, "R12": r12_termination_withholding,
    "R13": r13_minimum_bill, "R14": r14_guarantee_extension, "R15": r15_payment_conditions,
    "R16": r16_conflicts, "R17": r17_unresolved_references, "R18": r18_missing_documents,
}
