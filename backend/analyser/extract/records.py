"""Answer records: the schema sent to the model, and the full check against extraction_schema_v1.json.

Structured outputs accept only a subset of JSON Schema (no if/then, no numeric or length limits),
so the model gets a simplified schema wrapped as {"answers": [...]}. Every record is then checked
with jsonschema against the full extraction_schema_v1.json.
"""
from __future__ import annotations

import copy
import json
import re
from functools import lru_cache

from jsonschema import Draft202012Validator

from .. import config

NOTES_MAX = 400          # extraction_schema_v1.json: notes maxLength
EXTRA_FIELDS = ("doc_id", "absence_result", "searched_sections")   # LLM-only helper fields

_STR = {"type": "string"}


def record_schema(extra: dict | None = None) -> dict:
    """One answer record as the model must return it (all fields required, no extras)."""
    conflict = {
        "type": "object",
        "properties": {"value": _STR, "section_ref": _STR, "pdf_page": {"type": "integer"},
                       "verbatim_quote": _STR, "governs": {"type": "boolean"}},
        "required": ["value", "section_ref", "pdf_page", "verbatim_quote"],
        "additionalProperties": False,
    }
    props = {
        "contract_id": _STR,
        "clause_id": {"type": "string", "enum": ["C0", "C1", "C2", "C3", "C4", "C5", "C6"]},
        "question_id": _STR,
        "doc_id": _STR,
        "status": {"type": "string",
                   "enum": ["FOUND", "NOT_STATED", "NOT_APPLICABLE", "POINTS_ELSEWHERE"]},
        "answer_value": _STR,
        "unit": _STR,
        "base": _STR,
        "value_source": {"type": "string", "enum": ["clause", "schedule", "contract_data", "annexure",
                                                    "amendment", "portal_page", "other", ""]},
        "section_ref": _STR,
        "pdf_page": {"type": "integer"},
        "verbatim_quote": _STR,
        "conflicts": {"type": "array", "items": conflict},
        "points_to": _STR,
        "visual_check": {"type": "string", "enum": ["none", "needed", "done"]},
        "visual_evidence": _STR,
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "notes": _STR,
    }
    props.update(extra or {})
    return {"type": "object", "properties": props, "required": list(props),
            "additionalProperties": False}


def answers_schema(extra: dict | None = None) -> dict:
    """{"answers": [record, ...]} - the shape of every extraction, cross-reference and absence call."""
    return {"type": "object",
            "properties": {"answers": {"type": "array", "items": record_schema(extra)}},
            "required": ["answers"], "additionalProperties": False}


ABSENCE_EXTRA = {
    "absence_result": {"type": "string", "enum": ["FOUND_PASSAGE", "CONFIRMED_ABSENT"]},
    "searched_sections": {"type": "array", "items": _STR},
}


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    schema = json.loads(config.EXTRACTION_SCHEMA.read_text(encoding="utf-8"))
    return Draft202012Validator(schema)


def normalise(record: dict, contract_id: str, clause_id: str) -> dict:
    """Safe, mechanical fixes before validation. Never changes the substance of an answer."""
    rec = copy.deepcopy(record)
    for name in EXTRA_FIELDS:
        rec.pop(name, None)
    rec["contract_id"] = contract_id
    rec["clause_id"] = clause_id
    for conflict in rec.get("conflicts") or []:
        if conflict.get("governs") is None:
            conflict.pop("governs", None)
    if rec.get("status") == "NOT_STATED":
        rec["pdf_page"] = 0
    if isinstance(rec.get("notes"), str) and len(rec["notes"]) > NOTES_MAX:
        rec["notes"] = rec["notes"][:NOTES_MAX - 3] + "..."
    return rec


def schema_errors(record: dict) -> list[str]:
    """Errors against the full extraction_schema_v1.json plus the rules the schema cannot say."""
    qid = record.get("question_id", "?")
    errors = [f"question {qid}: {'/'.join(map(str, e.path)) or 'record'}: {e.message}"
              for e in _validator().iter_errors(record)]
    # The risk module groups POINTS_ELSEWHERE answers by points_to, so it must name a document.
    if record.get("status") == "POINTS_ELSEWHERE" and not str(record.get("points_to") or "").strip():
        errors.append(f"question {qid}: POINTS_ELSEWHERE needs points_to naming the document or "
                      "schedule that holds the detail (for example \"Schedule F\")")
    return errors


_POINTER_LABEL = re.compile(
    r"(General Conditions of Contract[\w\s,]*?\d{4}|(?:Schedule|Annexure|Appendix)[\s\-]*[A-Z0-9]{1,4}\b"
    r"|Contract Data|Bid Data Sheet|Special Conditions of Contract|GCC|SCC)")


def fill_points_to(record: dict) -> None:
    """Last resort after a retry: name the target from the answer text, never leave it empty."""
    if record.get("status") != "POINTS_ELSEWHERE" or str(record.get("points_to") or "").strip():
        return
    text = " ".join(str(record.get(k) or "") for k in ("answer_value", "notes", "verbatim_quote"))
    match = _POINTER_LABEL.search(text)
    record["points_to"] = match.group(0).strip() if match else "unnamed document (see answer)"


def not_stated(contract_id: str, clause_id: str, question_id: str, note: str) -> dict:
    """A schema-valid NOT_STATED record with low confidence (used when the model gave none)."""
    return {"contract_id": contract_id, "clause_id": clause_id, "question_id": question_id,
            "status": "NOT_STATED", "answer_value": "", "unit": "", "base": "", "value_source": "",
            "section_ref": "", "pdf_page": 0, "verbatim_quote": "", "conflicts": [],
            "points_to": "", "visual_check": "none", "visual_evidence": "", "confidence": "low",
            "notes": note[:NOTES_MAX]}


def make_validator(contract_id: str, clause_id: str, expected_qids: list[str]):
    """A check for LLMClient.call_json: lists every problem so the retry can fix them."""
    def validate(parsed: object) -> list[str]:
        if not isinstance(parsed, dict) or not isinstance(parsed.get("answers"), list):
            return ['Reply must be a JSON object {"answers": [...]}']
        errors: list[str] = []
        seen = set()
        for item in parsed["answers"]:
            if not isinstance(item, dict):
                errors.append("every item in answers must be an object")
                continue
            seen.add(item.get("question_id"))
            errors += schema_errors(normalise(item, contract_id, clause_id))
        missing = [q for q in expected_qids if q not in seen]
        if missing:
            errors.append("no record for question(s) " + ", ".join(missing))
        return errors
    return validate
