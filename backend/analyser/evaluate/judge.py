"""Optional LLM judge for text-heavy tests (off by default).

The deterministic comparison marks tests whose expected answer is mostly words with
``needs_human_check``. With ``score_run(..., judge=llm)`` those tests are sent to the LLM in
batches of about 15 with the spec 10.2 rules (prompt: prompts/<version>/judge.txt). The judged
label replaces the code's label, the reason starts with "LLM-judged:", and
``needs_human_check`` stays True so a person can still confirm. Manual overrides still win.
"""
from __future__ import annotations

import json
import re

from analyser import config
from analyser.models import Answer, TestScore

BATCH_SIZE = 15
VERDICTS = ("Correct", "Partial", "Incorrect")
PREFIX = "LLM-judged:"

SYSTEM = ("You grade answers extracted from Indian public-works contracts against an answer key. "
          "Apply the rules exactly and return JSON only.")

SCHEMA = {
    "type": "object",
    "properties": {"results": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "verdict": {"enum": list(VERDICTS)},
                       "missing": {"type": "array", "items": {"type": "string"}},
                       "reason": {"type": "string"}},
        "required": ["id", "verdict"]}}},
    "required": ["results"],
}


def load_prompt() -> str:
    path = config.PROMPTS_DIR / config.PROMPT_VERSION / "judge.txt"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return "Grade each test: Correct, Partial or Incorrect (spec 10.2 rules). Return JSON " \
           '{"results": [{"id", "verdict", "missing", "reason"}]}.\nTests:\n{items}'


def build_prompt(batch: list[tuple[dict, TestScore, Answer]]) -> str:
    items = [{
        "id": g["test_id"],
        "question": g.get("question", ""),
        "expected_answer": g.get("expected_answer", ""),
        "expected_unit": g.get("expected_unit", ""),
        "tool_answer": a.answer_value,
        "tool_unit": a.unit,
        "tool_base": a.base,
        "tool_quote": a.verbatim_quote,
    } for g, _t, a in batch]
    text = json.dumps(items, indent=1, ensure_ascii=False)
    # Fill {items} only; JSON braces elsewhere in the prompt stay as they are.
    return re.sub(r"\{items\}", lambda _m: text, load_prompt())


def _validator(ids: list[str]):
    def validate(parsed: object) -> list[str]:
        rows = parsed.get("results") if isinstance(parsed, dict) else parsed
        if not isinstance(rows, list):
            return ['expected {"results": [...]}']
        got = {r.get("id") for r in rows if isinstance(r, dict) and r.get("verdict") in VERDICTS}
        missing = [i for i in ids if i not in got]
        return [f"no valid verdict for: {', '.join(missing)}"] if missing else []
    return validate


def _apply(t: TestScore, row: dict, capped: bool) -> None:
    verdict = row["verdict"]
    if capped and verdict == "Correct":
        verdict = "Partial"                         # accept_also status: at most Partial
    missing = [str(m) for m in row.get("missing") or []]
    old = f"code said {t.label}" + (f": {t.reason}" if t.reason else "")
    detail = str(row.get("reason", "")).strip()
    if missing:
        detail += f" Missing or wrong: {'; '.join(missing)}."
    t.label = verdict
    t.reason = f"{PREFIX} {verdict}. {detail} [{old}]".replace("  ", " ")
    t.needs_human_check = True
    if verdict == "Correct":
        t.cause_code = ""
    elif not t.cause_code:
        t.cause_code = "ONE_OF_MANY_NUMBERS" if verdict == "Partial" else "WRONG_CLAUSE"


def judge_tests(items: list[tuple[dict, TestScore, Answer]], llm, batch_size: int = BATCH_SIZE) -> dict:
    """Judge (golden, score, tool answer) triples in batches. Returns {"judged", "failed_batches"}."""
    stats = {"judged": 0, "failed_batches": 0}
    for start in range(0, len(items), batch_size):
        batch = items[start:start + batch_size]
        ids = [g["test_id"] for g, _t, _a in batch]
        try:
            parsed, _key = llm.call_json(SYSTEM, build_prompt(batch), schema=SCHEMA,
                                         call_tag=f"judge:{ids[0]}..{ids[-1]}",
                                         validate=_validator(ids))
        except Exception:
            stats["failed_batches"] += 1           # keep the code's labels for this batch
            continue
        rows = parsed.get("results", []) if isinstance(parsed, dict) else parsed
        by_id = {r.get("id"): r for r in rows or [] if isinstance(r, dict) and r.get("verdict") in VERDICTS}
        for g, t, _a in batch:
            row = by_id.get(g["test_id"])
            if row is not None:
                _apply(t, row, capped=t.tool_status != t.expected_status)
                stats["judged"] += 1
    return stats


def needs_judging(t: TestScore) -> bool:
    """Tests the code could not settle: text-heavy, status agreed, quote not rejected."""
    return t.needs_human_check and t.label in ("Correct", "Partial") and t.quote_verified is not False \
        and t.tool_status != "NOT_STATED" and t.expected_status != "NOT_STATED"
