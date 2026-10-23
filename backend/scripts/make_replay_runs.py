"""Build "answer-key replay" runs for BM1-BM4 without calling the LLM.

The golden answer key stands in for the extraction step; everything after it
(verification, cash parameters, cash flow, risk flags, scoring) is the real
code. Use these runs to test the website end to end and as an offline demo.
They are NOT AI output: every run is labelled "answer-key replay" in its log.

Usage (from backend/):  python -m scripts.make_replay_runs [--freeze]
"""
from __future__ import annotations

import sys
from datetime import datetime

from analyser import config
from analyser.api import pipeline, store
from analyser.evaluate.golden_check import golden_envelopes
from analyser.extract import QUESTIONS
from analyser.ingest import benchmark_package
from analyser.models import RunMeta
from analyser.params import map_to_cash_params
from analyser.verify import verify_answers

# Project inputs a bid team would type in (spec §2.B). BM1's contract price is
# blank in the draft, so it uses the spec §8.4 illustrative Rs 100 crore.
USER_INPUTS = {
    "BM1": {"contract_value": 1_000_000_000, "duration_months": 24},
    "BM2": {"contract_value": 21_227_336, "duration_months": 9},
    "BM3": {"contract_value": 18_865_000, "duration_months": 12},
    "BM4": {"contract_value": 725_065, "duration_months": 2},
}

QUESTION_TEXT = {q["question_id"]: q["question"] for qs in QUESTIONS.values() for q in qs}


def make_run(contract_id: str) -> str:
    run_id = f"{contract_id}_replay-{datetime.now():%Y%m%d-%H%M%S}"
    store.new_run_dir(run_id)
    meta = RunMeta(run_id=run_id, package_id=contract_id, contract_id=contract_id,
                   model="answer-key replay (no LLM)", started_at=pipeline.now(),
                   stage="verify", progress=0.5)
    meta.log.append("ANSWER-KEY REPLAY: answers come from golden_tests_v1.json, not from the AI.")
    # meta.json is written only at the end, so the server never sees a half-built run

    package = benchmark_package(contract_id)
    store.save(run_id, "package", package.model_copy(update={"pages": []}))
    envelopes = golden_envelopes()[contract_id]
    for env in envelopes:
        env.question = QUESTION_TEXT.get(env.answer.question_id, env.question)
    envelopes = verify_answers(envelopes, package, None)
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
    return run_id


if __name__ == "__main__":
    for cid in config.BENCHMARKS:
        rid = make_run(cid)
        print(rid)
        if "--freeze" in sys.argv:
            print("  frozen ->", store.freeze_run(rid))
