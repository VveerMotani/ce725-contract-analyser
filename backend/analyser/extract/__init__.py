"""M1b: clause extraction (F3 visual pages, F6 structured extraction, F7 references, F8 absence)."""
from .pipeline import CallSpec, extract_package, plan_clause_calls
from .questions import CLAUSE_IDS, QUESTION_TEXT, QUESTIONS

__all__ = ["QUESTIONS", "QUESTION_TEXT", "CLAUSE_IDS", "extract_package", "plan_clause_calls",
           "CallSpec"]
