"""Turn answers written by Claude Code subagents into normal runs, then score them.

Each workspace made by prepare_agent_workspaces.py holds an answers.json written
by one subagent (the stand-in for the API extraction call). This script checks
every record against extraction_schema_v1.json, then runs the same steps as the
API pipeline: verifier, cash parameters, cash flow, risk flags and scoring.

Usage (from backend/):
    python -m scripts.import_agent_answers <workspaces_dir> [--freeze] [--report <out_dir>]
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

from analyser import config
from analyser.api import pipeline, store
from analyser.evaluate import export_scores_xlsx, format_table, score_run, write_error_log
from analyser.extract import QUESTIONS
from analyser.extract.records import fill_points_to, normalise, not_stated, schema_errors
from analyser.ingest import benchmark_package
from analyser.models import Answer, AnswerEnvelope, RunMeta
from analyser.params import map_to_cash_params

MODEL_LABEL = "claude-opus-5-5 (Claude Code subagent, agentic read)"
USER_INPUTS = {   # same project inputs as the replay runs, so results are comparable
    "BM1": {"contract_value": 1_000_000_000, "duration_months": 24},
    "BM2": {"contract_value": 21_227_336, "duration_months": 9},
    "BM3": {"contract_value": 18_865_000, "duration_months": 12},
    "BM4": {"contract_value": 725_065, "duration_months": 2},
}
QUESTION_OF = {q["question_id"]: (cid, q["question"]) for cid, qs in QUESTIONS.items() for q in qs}


def load_records(path: Path, contract_id: str) -> tuple[list[Answer], list[str]]:
    """Schema-checked Answer records, one per question; problems are returned as log lines."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("answers", [])
    by_qid, log = {}, []
    for item in raw:
        qid = str(item.get("question_id", ""))
        if qid not in QUESTION_OF:
            log.append(f"ignored record with unknown question_id {qid!r}")
            continue
        clause_id = QUESTION_OF[qid][0]
        for conflict in item.get("conflicts") or []:
            governs = conflict.get("governs")
            if isinstance(governs, str):       # a sentence where true/false was asked for
                word = governs.strip().lower()
                conflict["governs"] = True if word in ("true", "yes") else False if word in ("false", "no") else None
                if conflict["governs"] is None:
                    conflict["value"] = f"{conflict.get('value', '')} [governs: {governs}]"
                log.append(f"{qid}: conflict 'governs' was text, coerced")
        rec = normalise(item, contract_id, clause_id)
        fill_points_to(rec)
        errors = schema_errors(rec)
        if errors:
            log.append(f"{qid}: schema problems {errors[:2]}; kept after coercion")
        rec = {k: rec.get(k) for k in Answer.model_fields if k in rec}
        by_qid[qid] = Answer.model_validate(rec)
    for qid, (clause_id, _) in QUESTION_OF.items():
        if qid not in by_qid:
            log.append(f"{qid}: no record from the agent, recorded as NOT_STATED")
            by_qid[qid] = Answer.model_validate(not_stated(contract_id, clause_id, qid,
                                                           "agent returned no record"))
    return [by_qid[q] for q in QUESTION_OF], log


def make_run(contract_id: str, answers_path: Path) -> tuple[str, list[AnswerEnvelope]]:
    run_id = f"{contract_id}_agent-{datetime.now():%Y%m%d-%H%M%S}"
    store.new_run_dir(run_id)
    meta = RunMeta(run_id=run_id, package_id=contract_id, contract_id=contract_id,
                   model=MODEL_LABEL, prompt_version=config.PROMPT_VERSION,
                   effort="subagent default", started_at=pipeline.now())
    meta.log.append("Answers written by a Claude Code subagent that read the same page text, "
                    "page images, questions and v1 system prompt the API pipeline would send.")
    answers, problems = load_records(answers_path, contract_id)
    meta.log += problems

    package = benchmark_package(contract_id)
    store.save(run_id, "package", package.model_copy(update={"pages": []}))
    envelopes = [AnswerEnvelope(question=QUESTION_OF[a.question_id][1], answer=a,
                                raw_call_id=f"agent:{answers_path}") for a in answers]
    envelopes = pipeline.module("verify").verify_answers(envelopes, package, None)
    store.save(run_id, "answers", envelopes)

    user_inputs = USER_INPUTS[contract_id]
    store.save(run_id, "user_inputs", user_inputs)
    params = map_to_cash_params(envelopes, user_inputs, None)
    store.save(run_id, "params", params)
    pipeline.refresh_downstream(run_id, contract_id, envelopes, package, params, {},
                                log=meta.log.append)
    meta.stage, meta.progress, meta.finished_at = "done", 1.0, pipeline.now()
    meta.log.append("Run finished")
    store.save_meta(meta)
    return run_id, envelopes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("workspaces", type=Path)
    ap.add_argument("--freeze", action="store_true")
    ap.add_argument("--report", type=Path, help="folder for scores.xlsx, error_log.csv, summary.txt")
    args = ap.parse_args()

    by_contract, run_ids = {}, {}
    for cid in config.BENCHMARKS:
        path = args.workspaces / cid / "answers.json"
        if not path.exists():
            print(f"{cid}: no answers.json, skipped")
            continue
        run_id, envelopes = make_run(cid, path)
        by_contract[cid], run_ids[cid] = envelopes, run_id
        print(f"{cid}: {run_id}")
        if args.freeze:
            store.freeze_run(run_id)

    if not by_contract:
        return
    summary = score_run(by_contract, "+".join(run_ids.values()))
    table = format_table(summary)
    print(table)
    if args.report:
        args.report.mkdir(parents=True, exist_ok=True)
        export_scores_xlsx(summary, args.report / "scores.xlsx")
        write_error_log(summary, args.report / "error_log.csv")
        (args.report / "summary.txt").write_text(table, encoding="utf-8")
        (args.report / "score.json").write_text(summary.model_dump_json(indent=1), encoding="utf-8")
        for cid in by_contract:   # keep the raw agent output next to the scores
            shutil.copy(args.workspaces / cid / "answers.json", args.report / f"{cid}_agent_answers.json")


if __name__ == "__main__":
    main()
