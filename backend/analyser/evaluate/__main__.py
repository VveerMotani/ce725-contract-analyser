"""Command line: score saved runs against the golden tests.

    python -m analyser.evaluate runs/<run_id> [runs/<run_id2> ...]
    python -m analyser.evaluate path/to/answers.json --xlsx scores.xlsx --error-log errors.csv
    python -m analyser.evaluate runs/<run_id> --judge     # LLM grades the text-heavy tests

Each argument is a run folder (with answers.json, and meta.json if present) or an
answers.json file. The file holds a list of AnswerEnvelope or of bare Answer records.
Answers are grouped by contract_id (BM1..BM4) and scored together as one run.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from analyser.models import Answer, AnswerEnvelope

from . import export_scores_xlsx, format_table, score_run, write_error_log


def load_envelopes(path: Path) -> tuple[list[AnswerEnvelope], dict]:
    """Envelopes and meta from a run folder or an answers.json file."""
    meta: dict = {}
    if path.is_dir():
        if (path / "meta.json").exists():
            meta = json.loads((path / "meta.json").read_text(encoding="utf-8"))
        path = path / "answers.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("answers", data.get("envelopes", []))
    envs = []
    for item in data:
        if "answer" in item:
            envs.append(AnswerEnvelope.model_validate(item))
        else:
            envs.append(AnswerEnvelope(question="", answer=Answer.model_validate(item)))
    return envs, meta


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m analyser.evaluate", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", type=Path, help="run folders or answers.json files")
    ap.add_argument("--run-id", default="", help="name for this scoring run")
    ap.add_argument("--save", type=Path, help="write the ScoreSummary JSON here")
    ap.add_argument("--error-log", type=Path, help="write the error log CSV here")
    ap.add_argument("--xlsx", type=Path, help="write the score workbook here")
    ap.add_argument("--no-overrides", action="store_true", help="ignore manual_overrides.json")
    ap.add_argument("--judge", action="store_true",
                    help="grade text-heavy tests with the LLM (prompts/v1/judge.txt); costs API calls")
    args = ap.parse_args(argv)
    judge = None
    if args.judge:
        from analyser.llm import LLMClient
        judge = LLMClient()

    by_contract: dict[str, list[AnswerEnvelope]] = {}
    run_ids = []
    for p in args.paths:
        if not p.exists():
            print(f"not found: {p}", file=sys.stderr)
            return 2
        envs, meta = load_envelopes(p)
        run_ids.append(meta.get("run_id") or (p.name if p.is_dir() else p.stem))
        for env in envs:
            cid = meta.get("contract_id") or env.answer.contract_id
            by_contract.setdefault(cid, []).append(env)

    run_id = args.run_id or "+".join(run_ids)
    summary = score_run(by_contract, run_id, overrides=[] if args.no_overrides else None, judge=judge)
    if not summary.tests:
        print("No golden tests matched these contracts: " + ", ".join(by_contract), file=sys.stderr)
        return 1
    print(format_table(summary))
    if args.save:
        args.save.write_text(summary.model_dump_json(indent=1), encoding="utf-8")
    if args.error_log:
        write_error_log(summary, args.error_log)
    if args.xlsx:
        export_scores_xlsx(summary, args.xlsx)
    return 0


if __name__ == "__main__":
    sys.exit(main())
