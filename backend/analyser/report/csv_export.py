"""CSV export of the 52 answers (F14), in the answer-key column layout.

The first 11 columns are those of the 'Answer Key' sheet in
Contract_Answer_Key_v2_verified.xlsx, so the export can be pasted next to the
key. The columns after that carry the verification and review results.
Main columns hold the *effective* answer (the reviewer's edit if there is one);
the AI's original value is kept in the 'AI ... (before review)' columns.
"""
from __future__ import annotations

import csv
import io
import json

from analyser.models import AnswerEnvelope

ANSWER_KEY_COLUMNS = ["Contract", "Clause", "Q", "Question", "Status", "Answer", "Unit",
                      "Section", "PDF page", "Verbatim quote", "Notes"]
EXTRA_COLUMNS = ["Base", "Value source", "Points to", "Conflicts", "Visual check",
                 "Visual evidence", "Confidence", "Document", "Quote found", "Found on page",
                 "Page matches", "Verdict", "Failed checks", "Normalised", "Review decision",
                 "Review reasons", "Reviewer note", "Decided at", "AI status (before review)",
                 "AI answer (before review)", "LLM call id"]
COLUMNS = ANSWER_KEY_COLUMNS + EXTRA_COLUMNS


def question_sort_key(question_id: str) -> tuple:
    """'2.10' sorts after '2.9'."""
    parts = []
    for p in question_id.split("."):
        parts.append((0, int(p), "") if p.isdigit() else (1, 0, p))
    return tuple(parts)


def _yes_no(value) -> str:
    return "" if value is None else ("Yes" if value else "No")


def _row(env: AnswerEnvelope) -> dict:
    a = env.effective()
    v = env.verification
    r = env.review
    conflicts = "; ".join(
        f"{c.value} ({c.section_ref}, p. {c.pdf_page})" + (" [governs]" if c.governs else "")
        for c in a.conflicts)
    edited = a is not env.answer
    return {
        "Contract": a.contract_id, "Clause": a.clause_id, "Q": a.question_id,
        "Question": env.question, "Status": a.status, "Answer": a.answer_value,
        "Unit": a.unit, "Section": a.section_ref, "PDF page": a.pdf_page or "",
        "Verbatim quote": a.verbatim_quote, "Notes": a.notes,
        "Base": a.base, "Value source": a.value_source, "Points to": a.points_to,
        "Conflicts": conflicts, "Visual check": a.visual_check,
        "Visual evidence": a.visual_evidence, "Confidence": a.confidence,
        "Document": env.doc_id,
        "Quote found": _yes_no(v.quote_found) if v else "",
        "Found on page": (v.found_page or "") if v else "",
        "Page matches": _yes_no(v.page_matches) if v else "",
        "Verdict": v.verdict if v else "",
        "Failed checks": ", ".join(f"{c.check} {c.name}" for c in v.checks
                                   if c.passed is False) if v else "",
        "Normalised": json.dumps(v.normalised, ensure_ascii=False) if v and v.normalised else "",
        "Review decision": r.decision, "Review reasons": "; ".join(r.reasons),
        "Reviewer note": r.note, "Decided at": r.decided_at,
        "AI status (before review)": env.answer.status if edited else "",
        "AI answer (before review)": env.answer.answer_value if edited else "",
        "LLM call id": env.raw_call_id,
    }


def answers_csv(envelopes: list[AnswerEnvelope]) -> str:
    """All answers as CSV text, sorted by contract, clause and question number."""
    ordered = sorted(envelopes, key=lambda e: (e.answer.contract_id, e.answer.clause_id,
                                               question_sort_key(e.answer.question_id)))
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS)
    writer.writeheader()
    for env in ordered:
        writer.writerow(_row(env))
    return buf.getvalue()
