"""The 52 questions, parsed from Contract_Extraction_Questionnaire_v0.1.md."""
from __future__ import annotations

import re
from pathlib import Path

from .. import config

CLAUSE_IDS = ["C0", "C1", "C2", "C3", "C4", "C5", "C6"]

# A table row such as: | 2.2 | At what percentage, and of what base ...? | %, base |
_ROW = re.compile(r"^\|\s*([0-6]\.[1-8])\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*$")


def parse_questionnaire(path: Path = config.QUESTIONNAIRE) -> dict[str, list[dict]]:
    """clause_id -> [{"question_id", "question", "fields"}] in questionnaire order."""
    questions: dict[str, list[dict]] = {cid: [] for cid in CLAUSE_IDS}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = _ROW.match(line.strip())
        if match:
            qid, text, fields = match.groups()
            questions["C" + qid[0]].append({"question_id": qid, "question": text, "fields": fields})
    return questions


QUESTIONS: dict[str, list[dict]] = parse_questionnaire()
QUESTION_TEXT: dict[str, str] = {q["question_id"]: q["question"]
                                 for qs in QUESTIONS.values() for q in qs}


def question_list_text(questions: list[dict]) -> str:
    """Questions as prompt lines: '2.2 At what percentage...? (fields: %, base)'."""
    return "\n".join(f"{q['question_id']} {q['question']} (fields: {q['fields']})"
                     for q in questions)
