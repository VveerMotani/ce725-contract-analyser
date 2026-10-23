"""V9 optional second-model check: "does this quote support this answer?" (spec 9.6).

Only runs when an ``LLMClient`` is passed to ``verify_answers``. Any error from the LLM
module is recorded as "not run" so verification never breaks because of V9.
"""
from __future__ import annotations

from collections import defaultdict

from analyser import config
from analyser.models import AnswerEnvelope, CheckResult

SYSTEM = ("You check answers extracted from Indian public-works contracts. "
          "Use only the quote given. Return JSON only.")

# Copy of spec section 9.6, used when prompts/<version>/verifier.txt does not exist.
INLINE_PROMPT = """Question: {question}
Proposed answer: {answer_value} ({unit}, {base})
Quote: "{verbatim_quote}"
Does the quote, read in full, support exactly this answer? Reply SUPPORTED, PARTIAL (say what is missing)
or NOT_SUPPORTED (say why). Watch for: wrong base, wrong unit, a rate given as a cap, a period that is
certification and not payment, or a negative sentence read as a positive."""

JSON_TAIL = '\nReturn JSON: {"verdict": "SUPPORTED" | "PARTIAL" | "NOT_SUPPORTED", "reason": "..."}'

SCHEMA = {
    "type": "object",
    "properties": {"verdict": {"enum": ["SUPPORTED", "PARTIAL", "NOT_SUPPORTED"]},
                   "reason": {"type": "string"}},
    "required": ["verdict"],
}


def load_prompt() -> str:
    path = config.PROMPTS_DIR / config.PROMPT_VERSION / "verifier.txt"
    return path.read_text(encoding="utf-8") if path.exists() else INLINE_PROMPT


def build_prompt(env: AnswerEnvelope) -> str:
    a = env.answer
    fields = defaultdict(str, question=env.question, answer_value=a.answer_value, unit=a.unit,
                         base=a.base, verbatim_quote=a.verbatim_quote,
                         question_id=a.question_id, status=a.status)
    text = load_prompt().format_map(fields)
    return text if "json" in text.lower() else text + JSON_TAIL


def check_with_llm(env: AnswerEnvelope, llm) -> CheckResult:
    """Ask the LLM; SUPPORTED passes, PARTIAL and NOT_SUPPORTED are warnings for a person."""
    try:
        result, _key = llm.call_json(SYSTEM, build_prompt(env), schema=SCHEMA,
                                     call_tag=f"verify:{env.answer.question_id}")
    except Exception as e:  # the LLM module is optional here
        return CheckResult(check="V9", name="Second-model check", passed=None, detail=f"not run: {e}")
    if isinstance(result, list) and result:
        result = result[0]
    if isinstance(result, dict):
        word = str(result.get("verdict", "")).upper()
        reason = str(result.get("reason", ""))
    else:
        text = str(result)
        word = next((w for w in ("NOT_SUPPORTED", "PARTIAL", "SUPPORTED") if w in text.upper()), "")
        reason = text[:200]
    if word == "SUPPORTED":
        return CheckResult(check="V9", name="Second-model check", passed=True, detail=reason or "supported")
    if word in ("PARTIAL", "NOT_SUPPORTED"):
        return CheckResult(check="V9", name="Second-model check", passed=False, detail=f"{word}: {reason}",
                           severity="warn")
    return CheckResult(check="V9", name="Second-model check", passed=None, detail=f"unclear reply: {reason}")
