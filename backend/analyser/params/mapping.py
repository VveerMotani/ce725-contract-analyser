"""Interface B: turn extracted answers into cash-model inputs (CashInputs) with provenance.

The model only TRANSCRIBES numbers (value as printed + its unit). This code then
  1. checks that the number (or its % form) really appears in the cited answer,
  2. does the unit scaling (5 percent -> 0.05, "per week" -> per day, 730 days -> months),
  3. falls back to the CashInputs default (provenance "default") when a number fails the check,
  4. lets the user's own inputs override everything (provenance "user").
Nothing is "confirmed" until a person confirms it in the UI.
"""
from __future__ import annotations

import json
import logging
import re

from ..llm.prompts import load_prompt, render
from ..models import (AdvanceInstalment, AnswerEnvelope, CashInputs, CashParams, ParamProvenance,
                      ReleaseStep)

log = logging.getLogger(__name__)

# field -> (meaning, usual question, kind). "kind" decides the unit scaling.
FIELDS: dict[str, tuple[str, str, str]] = {
    "contract_value": ("contract value, tendered amount or contract price", "0.3", "money"),
    "duration_months": ("stipulated completion period", "0.4", "months"),
    "dlp_months": ("defects liability period", "0.5", "months"),
    "cert_lag_days": ("days for the employer to certify a bill", "1.2", "days"),
    "pay_lag_days": ("days to pay a certified bill", "1.3", "days"),
    "late_interest_rate_pa": ("interest rate on delayed payment", "1.4", "rate_pa"),
    "min_bill_value": ("minimum value of work before an interim bill is payable", "1.6", "money"),
    "retention_rate": ("retention or security deposit deducted from each bill", "2.2", "share"),
    "retention_cap": ("cap on total retention, of contract value", "2.3", "share"),
    "retention_release": ("retention release steps (time after completion, share released)", "2.5", "release"),
    "advance_instalments": ("mobilisation advance instalments, each as % of contract value", "3.2", "instalment"),
    "advance_recovery_rate": ("advance recovered from each bill, % of the gross bill", "3.4", "share"),
    "advance_recovery_deadline": ("advance fully recovered by this % of the contract period", "3.4", "share"),
    "advance_interest_rate_pa": ("interest rate on the advance", "3.3", "rate_pa"),
    "ld_rate_per_day": ("delay damages rate with its period (per day/week/month)", "4.2", "rate_per_day"),
    "ld_cap": ("cap on delay damages, of contract value", "4.3", "share"),
    "ld_grace_days": ("days of grace before delay damages apply", "4.2", "days"),
    "pv_applies": ("1 if price variation applies to this contract, 0 if not", "5.1", "flag"),
    "pv_factor": ("constant factor in the price variation formula (for example 0.85)", "5.2", "number"),
    "pv_weights": ("price variation weight of one component (give component)", "5.3", "weight"),
    "perf_security_pct": ("performance security, % of contract value", "6.2", "share"),
    "perf_security_validity_months_after_completion":
        ("how long performance security stays valid after completion", "6.5", "months"),
}
PARAM_QUESTIONS = sorted({q for _, q, _ in FIELDS.values()} | {"3.1", "6.1"})
USER_FIELDS = ["contract_value", "duration_months", "cost_share", "overdraft_rate_pa",
               "bg_commission_pa", "delay_days", "progress", "index_rise_pa", "bank_rate_pa",
               "supplier_credit_days"]
FALLBACK_PROJECT = {"contract_value": 1_000_000_000.0, "duration_months": 24}   # spec 8.4 example
DAYS_PER_MONTH = 30.4375
PER_DAYS = {"day": 1, "week": 7, "month": 30, "year": 365}   # "1% per month" -> /30 (CPWD convention)
MONEY = {"rupees": 1.0, "lakh": 1e5, "crore": 1e7}
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
                "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "fifteen": 15, "thirty": 30,
                "half": 50, "full": 100, "entire": 100}

PARAMS_SCHEMA = {
    "type": "object",
    "properties": {"params": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "field": {"type": "string", "enum": list(FIELDS)},
            "question_id": {"type": "string"},
            "value": {"type": "number"},
            "unit": {"type": "string", "enum": ["percent", "days", "weeks", "months", "years",
                                                "rupees", "lakh", "crore", "number"]},
            "per": {"type": "string", "enum": ["", "day", "week", "month", "year"]},
            "relative_to_bank_rate": {"type": "boolean"},
            "component": {"type": "string"},
            "share": {"type": "number"},
            "instalment_month": {"type": "integer"},
            "quote": {"type": "string"},
        },
        "required": ["field", "question_id", "value", "unit", "per", "relative_to_bank_rate",
                     "component", "share", "instalment_month", "quote"],
        "additionalProperties": False}}},
    "required": ["params"], "additionalProperties": False,
}


# ---------------------------------------------------------------------------- number checks

def numbers_in(text: str) -> list[float]:
    """Every number written in the text: '4,24,547' -> 424547, '0 .05' -> 0.05, 'six' -> 6."""
    found = []
    for raw in re.findall(r"\d[\d,]*(?:\s?\.\s?\d+)?", text):
        try:
            found.append(float(re.sub(r"[,\s]", "", raw)))
        except ValueError:
            pass
    for word in re.findall(r"[a-z]+", text.lower()):
        if word in NUMBER_WORDS:
            found.append(float(NUMBER_WORDS[word]))
    return found


def number_appears(value: float, text: str) -> bool:
    """True if value, or its percent form (0.05 <-> 5), is written in text."""
    for n in numbers_in(text):
        for candidate in (value, value * 100, value / 100):
            if abs(n - candidate) <= 1e-9 * max(1.0, abs(candidate)):
                return True
    return False


def _source_text(env: AnswerEnvelope) -> str:
    ans = env.effective()
    return " ".join([ans.answer_value, ans.verbatim_quote, ans.unit, ans.base])


# ---------------------------------------------------------------------------- unit scaling

def to_model_value(kind: str, item: dict, bank_rate: float) -> float | None:
    """Convert a transcribed number to CashInputs units. None = cannot convert safely."""
    v, unit, per = float(item["value"]), item["unit"], item.get("per", "")
    if kind in ("share", "weight", "instalment"):
        return v / 100 if unit == "percent" else (v if unit == "number" and v <= 1 else None)
    if kind == "rate_pa":
        if unit != "percent" or per not in ("", "year", "month"):
            return None
        rate = v / 100 * (12 if per == "month" else 1)
        return rate + bank_rate if item.get("relative_to_bank_rate") else rate
    if kind == "rate_per_day":
        if unit != "percent" or per not in PER_DAYS:
            return None
        return v / 100 / PER_DAYS[per]
    if kind == "days":
        scale = {"days": 1, "weeks": 7, "months": 30}.get(unit)
        return v * scale if scale else None
    if kind in ("months", "release"):      # release: time after completion, in months
        scale = {"days": 1 / DAYS_PER_MONTH, "weeks": 7 / DAYS_PER_MONTH, "months": 1, "years": 12}.get(unit)
        return v * scale if scale else None
    if kind == "money":
        return v * MONEY[unit] if unit in MONEY else None
    if kind in ("number", "flag"):
        return v
    return None


def scaling_note(kind: str, item: dict, value: float, bank_rate: float) -> str:
    """Plain words for the unit scaling done, e.g. '1% per month ÷ 30 = 0.0333% per day'."""
    v, unit, per = float(item["value"]), item["unit"], item.get("per", "")
    printed = f"{v:g}%" if unit == "percent" else f"{v:g} {unit}"
    if kind == "rate_per_day":
        div = PER_DAYS[per]
        step = f" ÷ {div}" if div != 1 else ""
        return f"{printed} per {per}{step} = {value * 100:.4g}% per day ({value:.6g} of value per day)"
    if kind == "rate_pa":
        text = printed + (" per month × 12" if per == "month" else " per year")
        if item.get("relative_to_bank_rate"):
            text += f" + Bank Rate {bank_rate * 100:g}%"
        return f"{text} = {value:.4g} per year"
    if kind in ("share", "weight", "instalment"):
        return f"{printed} = {value:.4g} (fraction)"
    if kind == "release":
        return (f"{float(item.get('share', 100)):g}% released {printed} after completion "
                f"= {value:.4g} months")
    if kind in ("days", "months", "money"):
        same = {"days": "days", "months": "months", "money": "rupees"}[kind]
        if unit != same:
            return f"{printed} = {value:.4g} {'Rs' if kind == 'money' else same}"
    return f"as printed: {printed}"


# ---------------------------------------------------------------------------- main entry

def map_to_cash_params(envelopes: list[AnswerEnvelope], user_inputs: dict, llm) -> CashParams:
    """Build CashParams from answers (+ user inputs). llm=None uses the regex rules only."""
    user_inputs = dict(user_inputs or {})
    by_q = {e.answer.question_id: e for e in envelopes}
    bank_rate = float(user_inputs.get("bank_rate_pa", CashInputs.model_fields["bank_rate_pa"].default))

    items = _ask_llm(by_q, llm) if llm is not None else regex_items(by_q)
    values, prov = accept_items(items, by_q, bank_rate)

    for name, value in user_inputs.items():
        if name in CashInputs.model_fields and value is not None:
            values[name] = value
            prov[name] = ParamProvenance(field=name, source="user")
    for name, value in FALLBACK_PROJECT.items():
        values.setdefault(name, value)
    if isinstance(values.get("duration_months"), float):
        values["duration_months"] = max(1, round(values["duration_months"]))

    inputs = CashInputs(**values)
    provenance = []
    for name in list(FIELDS) + USER_FIELDS:
        if name not in CashInputs.model_fields or any(p.field == name for p in provenance):
            continue
        provenance.append(prov.get(name) or ParamProvenance(field=name, source="default"))
    return CashParams(inputs=inputs, provenance=provenance)


def _ask_llm(by_q: dict[str, AnswerEnvelope], llm) -> list[dict]:
    """One call (params.txt): the model lists the numbers it can transcribe."""
    answers = []
    for qid in PARAM_QUESTIONS:
        env = by_q.get(qid)
        if env is None:
            continue
        a = env.effective()
        answers.append({"question_id": qid, "question": env.question, "status": a.status,
                        "answer_value": a.answer_value, "unit": a.unit, "base": a.base,
                        "verbatim_quote": a.verbatim_quote})
    guide = "\n".join(f"- {name}: {meaning}; usually question {q}"
                      for name, (meaning, q, _) in FIELDS.items())
    prompt = render(load_prompt("params"), field_guide=guide,
                    answers_json=json.dumps(answers, indent=1, ensure_ascii=False))
    parsed, _ = llm.call_json(load_prompt("system"), prompt, [], PARAMS_SCHEMA, "params")
    return parsed.get("params", []) if isinstance(parsed, dict) else []


def accept_items(items: list[dict], by_q: dict[str, AnswerEnvelope],
                 bank_rate: float) -> tuple[dict, dict[str, ParamProvenance]]:
    """Check every transcribed number against its source answer and convert it."""
    values: dict = {}
    prov: dict[str, ParamProvenance] = {}
    instalments, releases, weights = [], [], {}
    for item in items:
        name = item.get("field")
        if name not in FIELDS:
            continue
        kind = FIELDS[name][2]
        reason = _reject_reason(item, kind, by_q)
        value = None if reason else to_model_value(kind, item, bank_rate)
        if reason or value is None:
            reason = reason or f"unit '{item.get('unit')}' per '{item.get('per')}' cannot be converted"
            log.info("params: %s from %s rejected: %s", name, item.get("question_id"), reason)
            if name not in prov:          # keep the default, but say why
                prov[name] = ParamProvenance(field=name, source="default",
                                             question_id=str(item.get("question_id") or ""),
                                             note=f"Rejected, default used: {reason}")
            continue
        source = ParamProvenance(field=name, source="extracted", question_id=item["question_id"],
                                 quote=(item.get("quote") or "")[:200],
                                 note="; ".join(filter(None, [scaling_note(kind, item, value, bank_rate),
                                                              item.get("note", "")])))
        if kind == "instalment":
            month = item.get("instalment_month", -1)
            instalments.append(AdvanceInstalment(share_of_value=value,
                                                 month=month if month >= 0 else len(instalments)))
        elif kind == "release":
            share = item.get("share", 100) / 100
            releases.append(ReleaseStep(share=share, months_after_completion=value))
        elif kind == "weight":
            weights[(item.get("component") or "other").strip().lower()] = value
        elif kind == "flag":
            value = bool(value)
        elif name in values:
            continue                      # first accepted number wins for a single field
        if kind not in ("instalment", "release", "weight"):
            values[name] = value
        if name not in prov or prov[name].source == "default":
            prov[name] = source           # an accepted number replaces an earlier rejection
        elif kind in ("instalment", "release", "weight"):
            prov[name].note += "; " + source.note
    if instalments:
        values["advance_instalments"] = instalments
    if releases:
        values["retention_release"] = releases
    if weights:
        values["pv_weights"] = weights
    return values, prov


def _reject_reason(item: dict, kind: str, by_q: dict[str, AnswerEnvelope]) -> str:
    """Why a transcribed number cannot be used ("" = it can)."""
    env = by_q.get(str(item.get("question_id")))
    if env is None:
        return "cited question does not exist"
    status = env.effective().status
    if kind == "flag":
        if item.get("value") not in (0, 1):
            return "pv_applies must be 0 or 1"
        return "" if (item["value"] == 0 or status == "FOUND") else "price variation not FOUND"
    if status != "FOUND":
        return f"source answer is {status}"
    text = _source_text(env)
    value = float(item.get("value", 0))
    if item.get("negative") or (kind == "rate_pa" and value == 0):
        # "no interest payable" -> 0: the words must be in the answer
        return "" if value == 0 and NEGATIVE_RATE.search(text) else "no 'no interest' wording in answer"
    if item.get("check_question_id"):      # release "after the DLP": the months come from 0.5
        other = by_q.get(item["check_question_id"])
        if other is None or other.effective().status != "FOUND":
            return f"question {item['check_question_id']} has no value"
        text = _source_text(other)
    if kind == "release":
        share = float(item.get("share", 100))
        if share != 100 and not number_appears(share, _source_text(env)):
            return f"share {share:g}% not in answer"
        if value == 0:
            return ""                      # "on completion": no number to check
    if not number_appears(value, text):
        return f"number {value:g} not in answer {item.get('check_question_id') or item['question_id']}"
    return ""


# ---------------------------------------------------------------------------- no-LLM mapping
#
# Used when there is no LLM (offline answer-key replay runs). Each rule reads the effective
# answer of one question; every number it produces still goes through accept_items, so it must
# appear in that answer (or, for "after the DLP", in answer 0.5).

_NUM = r"(\d+(?:\.\d+)?|" + "|".join(NUMBER_WORDS) + r")"
_PCT = r"(\d+(?:\.\d+)?)\s*%"
NEGATIVE_RATE = re.compile(r"\bno\s+interest\b|\binterest[\s-]free\b|\bwithout\s+interest\b", re.I)
NOT_GIVEN = re.compile(r"^\s*no\b|\bnot\s+stated\b|\bno\s+(?:separate\s+)?cap\b", re.I)
RUPEES = re.compile(r"(?:Rs\.?|INR|₹)\s*₹?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?)?", re.I)
PV_OFF = re.compile(r"fixed\s+price|rates?\s+(?:are\s+|shall\s+be\s+)?firm|no\s+(?:general\s+)?"
                    r"(?:index-based\s+)?(?:price\s+variation|price\s+adjustment|escalation)", re.I)
PV_ON = re.compile(r"\b(?:applies|is\s+applicable|shall\s+be\s+adjusted)\b", re.I)
PV_GATE = re.compile(r"\bonly\s+(?:if|for|in\s+case|where|when)\b|\bprobably\b|\bnot\s+applicable\b", re.I)


def _num(word: str) -> float:
    """'12' -> 12.0, 'twelve' -> 12.0, 'half' -> 50.0."""
    return float(word) if word[0].isdigit() else float(NUMBER_WORDS[word.lower()])


def _money_unit(word: str | None) -> str:
    word = (word or "").lower()
    return "crore" if word.startswith("crore") else "lakh" if word.startswith(("lakh", "lac")) else "rupees"


def regex_items(by_q: dict[str, AnswerEnvelope]) -> list[dict]:
    """Deterministic rules for the obvious numbers (used when there is no LLM)."""
    items: list[dict] = []

    def answer(qid: str) -> str:
        env = by_q.get(qid)
        return env.effective().answer_value if env and env.effective().status == "FOUND" else ""

    def status(qid: str) -> str:
        env = by_q.get(qid)
        return env.effective().status if env else ""

    def add(field_name, qid, value, unit, per="", quote="", **extra):
        items.append({"field": field_name, "question_id": qid, "value": float(value), "unit": unit,
                      "per": per, "relative_to_bank_rate": False, "component": "", "share": 100,
                      "instalment_month": -1, "quote": quote.strip(), **extra})

    # C0 facts: contract value, duration, defects liability period
    if (m := RUPEES.search(answer("0.3"))):
        add("contract_value", "0.3", m.group(1).replace(",", ""), _money_unit(m.group(2)), quote=m.group(0))
    if (m := re.search(r"(\d+)\s*(days|weeks|months|years)\b", answer("0.4"), re.I)):
        add("duration_months", "0.4", m.group(1), m.group(2).lower(), quote=m.group(0),
            note="rounded to whole months")
    dlp, dlp_period = answer("0.5"), None
    if dlp and not NOT_GIVEN.search(dlp) and (m := re.search(_NUM + r"\s*(years?|months?)\b", dlp, re.I)):
        unit = "years" if m.group(2).lower().startswith("year") else "months"
        several = len(re.findall(r"\b(?:years?|months?)\b", dlp, re.I)) > 1
        dlp_period = (_num(m.group(1)), unit)
        add("dlp_months", "0.5", dlp_period[0], unit, quote=m.group(0),
            note="first period stated; others apply to other work types" if several else "")

    # C1 payment
    for field_name, qid in (("cert_lag_days", "1.2"), ("pay_lag_days", "1.3")):
        if (m := re.search(r"(\d+)\s*(?:working\s+|calendar\s+|clear\s+)?days", answer(qid), re.I)):
            add(field_name, qid, m.group(1), "days", quote=m.group(0))
    _interest_items(add, "late_interest_rate_pa", "1.4", answer("1.4"))
    bill = answer("1.6")
    if bill and not NOT_GIVEN.search(bill) and (m := RUPEES.search(bill)):
        add("min_bill_value", "1.6", m.group(1).replace(",", ""), _money_unit(m.group(2)), quote=m.group(0))

    # C2 retention
    if (m := re.search(_PCT, answer("2.2"))):
        add("retention_rate", "2.2", m.group(1), "percent", quote=m.group(0))
    cap = answer("2.3")
    if cap and not NOT_GIVEN.search(cap) and (m := re.search(_PCT, cap)):
        add("retention_cap", "2.3", m.group(1), "percent", quote=m.group(0))
    _release_items(add, answer("2.5"), dlp_period)

    # C3 advance
    adv = answer("3.2")
    parts = re.search(r"\b(two|three|four|\d+)\s+(?:equal\s+)?instal+ments?\s+of\s+" + _PCT, adv, re.I)
    if parts:
        for i in range(int(_num(parts.group(1)))):
            add("advance_instalments", "3.2", parts.group(2), "percent", quote=parts.group(0),
                instalment_month=i, note=f"instalment {i + 1} assumed paid in month {i} (month not stated)")
    elif (m := re.search(_PCT, adv)):
        add("advance_instalments", "3.2", m.group(1), "percent", quote=m.group(0), instalment_month=0,
            note="whole advance assumed paid in month 0 (timing not stated)")
    _interest_items(add, "advance_interest_rate_pa", "3.3", answer("3.3"))
    rec = answer("3.4")
    if (m := re.search(_PCT + r"[^;%]*?\b(?:each|every)\b", rec, re.I)):
        add("advance_recovery_rate", "3.4", m.group(1), "percent", quote=m.group(0))
    if (m := re.search(r"\b(?:before|by\s+the\s+time)\s+(\d+(?:\.\d+)?)\s*%", rec, re.I)):
        add("advance_recovery_deadline", "3.4", m.group(1), "percent", quote=m.group(0),
            note="taken as a share of the contract period")

    # C4 delay damages
    ld = answer("4.2")
    if (m := re.search(_PCT + r"[^;]*?\b(?:per|a|each|for each|for every)\s+(day|week|month)", ld, re.I)):
        add("ld_rate_per_day", "4.2", m.group(1), "percent", per=m.group(2).lower(), quote=m.group(0))
    if (m := re.search(r"\bwithin\s+(?:a\s+period\s+of\s+)?(\d+)\s*(?:\(\w+\)\s*)?days", ld, re.I)):
        add("ld_grace_days", "4.2", m.group(1), "days", quote=m.group(0),
            note="damages start only if the date is missed by more than this")
    if (m := re.search(_PCT, answer("4.3"))):
        add("ld_cap", "4.3", m.group(1), "percent", quote=m.group(0))

    # C5 price variation
    pv = answer("5.1")
    if status("5.1") == "NOT_APPLICABLE" or (pv and PV_OFF.search(pv)):
        off = PV_OFF.search(pv)
        add("pv_applies", "5.1", 0, "number", quote=off.group(0) if off else "NOT_APPLICABLE",
            note="fixed price or price variation switched off")
    elif pv and PV_ON.search(pv) and not PV_GATE.search(pv):
        add("pv_applies", "5.1", 1, "number", quote=PV_ON.search(pv).group(0))
    if (m := re.search(r"\b(0\.\d+)\s*[x×*]", answer("5.2"))):
        add("pv_factor", "5.2", m.group(1), "number", quote=m.group(0))

    # C6 guarantees
    if (m := re.search(r"performance\s+(?:security|guarantee)[^;%]*?" + _PCT, answer("6.2"), re.I)):
        add("perf_security_pct", "6.2", m.group(1), "percent", quote=m.group(0))
    return items


def _interest_items(add, field_name: str, qid: str, text: str) -> None:
    """'No interest' -> 0; 'Bank Rate + 3%' -> bank rate + 0.03; 'simple interest 10%' -> 0.10."""
    if not text:
        return
    if (m := NEGATIVE_RATE.search(text)):
        add(field_name, qid, 0, "percent", per="year", quote=m.group(0), negative=True,
            note="the document says no interest")
    elif (m := re.search(r"bank\s+rate\s*\+\s*" + _PCT, text, re.I)):
        add(field_name, qid, m.group(1), "percent", per="year", quote=m.group(0),
            relative_to_bank_rate=True)
    elif (m := re.search(r"interest[^;%]*?" + _PCT, text, re.I)):
        after = text[m.end():m.end() + 20]
        per = "month" if re.search(r"(?:per|a)\s+month", after, re.I) else "year"
        add(field_name, qid, m.group(1), "percent", per=per, quote=m.group(0))


def _release_items(add, text: str, dlp_period: tuple[float, str] | None) -> None:
    """Retention release: half and half / within N days of completion / N months after completion /
    at the end of the defects liability period / on completion."""
    if not text:
        return
    periods = re.findall(_NUM + r"\s*(days?|months?)\b", text, re.I)
    if re.search(r"\bhalf\b", text, re.I) and periods:
        for word, unit in periods[:2]:
            add("retention_release", "2.5", _num(word), "days" if unit.lower().startswith("day") else "months",
                share=50, quote=f"half ... {word} {unit}")
        if len(periods) == 1 and dlp_period and re.search(r"defects?\s+liability|DLP", text, re.I):
            add("retention_release", "2.5", dlp_period[0], dlp_period[1], share=50,
                check_question_id="0.5", quote="balance after the defect liability period",
                note="months taken from the defects liability period (0.5)")
        return
    if (m := re.search(r"within\s+(\d+)\s*(?:\(\w+\)\s*)?(days|months)\s+of\s+(?:the\s+)?completion", text, re.I)):
        add("retention_release", "2.5", m.group(1), m.group(2).lower(), quote=m.group(0))
    elif (m := re.search(_NUM + r"\s*(days|months)\s+after\s+(?:the\s+)?completion", text, re.I)):
        add("retention_release", "2.5", _num(m.group(1)), m.group(2).lower(), quote=m.group(0))
    elif dlp_period and (m := re.search(r"(?:on\s+completion\s+of|after|end\s+of)\s+(?:the\s+)?"
                                        r"(?:defects?\s+liability\s+period|DLP)", text, re.I)):
        add("retention_release", "2.5", dlp_period[0], dlp_period[1], check_question_id="0.5",
            quote=m.group(0), note="released at the end of the defects liability period (0.5)")
    elif (m := re.search(r"\bon\s+completion\b", text, re.I)):
        add("retention_release", "2.5", 0, "months", quote=m.group(0))
