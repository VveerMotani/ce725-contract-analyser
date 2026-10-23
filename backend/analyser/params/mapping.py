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
                                 note=scaling_note(kind, item, value, bank_rate))
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
    if kind == "release":
        share = float(item.get("share", 100))
        if share != 100 and not number_appears(share, text):
            return f"share {share} not in answer"
        if value == 0:
            return ""                      # "on completion": no number to check
    if not number_appears(value, text):
        return f"number {value:g} not in answer {item['question_id']}"
    return ""


# ---------------------------------------------------------------------------- no-LLM mapping

_PCT = r"(\d+(?:\.\d+)?)\s*%"


def regex_items(by_q: dict[str, AnswerEnvelope]) -> list[dict]:
    """Deterministic rules for the obvious numbers (used when there is no LLM)."""
    items: list[dict] = []

    def text_of(qid: str) -> str:
        env = by_q.get(qid)
        return env.effective().answer_value if env and env.effective().status == "FOUND" else ""

    def add(field_name, qid, value, unit, per="", quote="", **extra):
        items.append({"field": field_name, "question_id": qid, "value": float(value), "unit": unit,
                      "per": per, "relative_to_bank_rate": False, "component": "", "share": 100,
                      "instalment_month": -1, "quote": quote, **extra})

    for field_name, qid in (("retention_rate", "2.2"), ("retention_cap", "2.3"), ("ld_cap", "4.3")):
        m = re.search(_PCT, text_of(qid))
        if m:
            add(field_name, qid, m.group(1), "percent", quote=m.group(0))

    m = re.search(_PCT + r"[^;]*?\b(?:per|a|each|for each|for every)\s+(day|week|month)", text_of("4.2"), re.I)
    if m:
        add("ld_rate_per_day", "4.2", m.group(1), "percent", per=m.group(2).lower(), quote=m.group(0))

    adv = text_of("3.2")
    parts = re.search(r"\b(two|three|four|\d+)\s+(?:equal\s+)?instal+ments?\s+of\s+" + _PCT, adv, re.I)
    if parts:
        count = NUMBER_WORDS.get(parts.group(1).lower()) or int(parts.group(1))
        for i in range(count):
            add("advance_instalments", "3.2", parts.group(2), "percent", quote=parts.group(0),
                instalment_month=i)
    elif (m := re.search(_PCT, adv)):
        add("advance_instalments", "3.2", m.group(1), "percent", quote=m.group(0), instalment_month=0)

    # "15% of each bill; repaid before 80% of the period": the words after each % (up to the
    # next % or ;) decide whether it is the per-bill rate or the deadline.
    for m in re.finditer(_PCT + r"(?=([^%;]{0,40}))", text_of("3.4")):
        name = "advance_recovery_deadline" if "period" in m.group(2).lower() else "advance_recovery_rate"
        add(name, "3.4", m.group(1), "percent", quote=(m.group(0) + m.group(2)).strip())

    for field_name, qid in (("cert_lag_days", "1.2"), ("pay_lag_days", "1.3")):
        m = re.search(r"(\d+)\s*(?:working\s+|calendar\s+|clear\s+)?days", text_of(qid), re.I)
        if m:
            add(field_name, qid, m.group(1), "days", quote=m.group(0))

    m = re.search(r"performance\s+(?:security|guarantee)[^;%]*?" + _PCT, text_of("6.2"), re.I)
    if m:
        add("perf_security_pct", "6.2", m.group(1), "percent", quote=m.group(0))
    return items
