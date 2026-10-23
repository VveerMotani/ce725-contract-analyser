"""M2 evaluation harness (F15): score a run against golden_tests_v1.json.

Public interface (INTERFACES.md):
    load_golden() -> list[dict]
    score_run(envelopes_by_contract, run_id) -> ScoreSummary
    write_error_log(summary, path) -> None
Also: export_scores_xlsx(summary, path), format_table(summary), score_test(golden, envelope).

Labels (spec 10.2): Correct, Partial, Incorrect, Missed, Correct absent, Wrongly present.
Optional: score_run(..., judge=llm) lets an LLM grade the text-heavy tests (judge.py).
A person can fix a label in manual_overrides.json; overrides are applied last and marked.
Command line: python -m analyser.evaluate <run_dir or answers.json> ...
"""
from .reports import export_scores_xlsx, format_table, write_error_log
from .scoring import LABELS, load_golden, load_overrides, score_run, score_test

__all__ = ["load_golden", "score_run", "write_error_log", "export_scores_xlsx", "format_table",
           "score_test", "load_overrides", "LABELS"]
