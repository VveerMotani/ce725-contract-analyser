"""Grade agent runs with Claude Code subagents as the judge (no API key needed).

    python -m scripts.agent_judge dump  <judge_dir> <run_id> [<run_id> ...]
    python -m scripts.agent_judge apply <judge_dir> <run_id> [<run_id> ...] [--report <out_dir>]

dump   writes <judge_dir>/<contract>/tests.json (every test of that contract with the
       expected answer, the tool answer and the code's label) and RULES.md for a judge agent.
       The judge agent writes verdicts.json: [{"id", "verdict", "missing", "reason",
       "cause_code", "scorer_issue", "key_issue"}].
apply  re-scores the runs: every test the judge graded takes the judge's label (prefixed
       "LLM-judged:", code label kept in the reason). Judge notes, including where the judge
       thinks the scoring code or the answer key is wrong, go to judge_notes.csv.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from analyser.api import store
from analyser.evaluate import export_scores_xlsx, format_table, load_golden, score_run, write_error_log
from analyser.evaluate.judge import load_prompt

CAUSE_CODES = ("TEXT_LAYER_MISSED_STRIKE IMAGE_NOT_READ SCAN_NOT_READ REFERENCE_NOT_FOLLOWED "
               "SCHEDULE_NOT_USED RATE_CAP_MIXED WRONG_BASE_OR_UNIT ONE_OF_MANY_NUMBERS INVENTED_VALUE "
               "INVENTED_QUOTE WRONG_CLAUSE TERM_NOT_RECOGNISED NEGATIVE_MISREAD CONFLICT_MISSED "
               "CONVENTION_DIFFERENCE RETRIEVAL_MISSED").split()


def load_runs(run_ids: list[str]) -> dict:
    return {store.load_meta(r).contract_id: store.load_answers(r) for r in run_ids}


def dump(judge_dir: Path, run_ids: list[str]) -> None:
    by_contract = load_runs(run_ids)
    summary = score_run(by_contract, "+".join(run_ids))
    golden = {g["test_id"]: g for g in load_golden()}
    answers = {(cid, e.answer.question_id): e.effective() for cid, envs in by_contract.items() for e in envs}
    for cid in by_contract:
        rows = []
        for t in summary.tests:
            if t.contract_id != cid:
                continue
            g, a = golden[t.test_id], answers[(cid, t.question_id)]
            rows.append({
                "id": t.test_id, "question": g.get("question", ""), "core": t.core,
                "expected_status": t.expected_status, "expected_answer": g.get("expected_answer", ""),
                "expected_unit": g.get("expected_unit", ""), "expected_section": g.get("section_ref", ""),
                "expected_page": g.get("pdf_page", 0), "key_notes": g.get("notes", ""),
                "accept_also_status": g.get("accept_also_status", []),
                "tool_status": a.status, "tool_answer": a.answer_value, "tool_unit": a.unit,
                "tool_base": a.base, "tool_section": a.section_ref, "tool_page": a.pdf_page,
                "tool_quote": a.verbatim_quote, "tool_points_to": a.points_to, "tool_notes": a.notes,
                "code_label": t.label, "code_reason": t.reason, "quote_verified": t.quote_verified,
            })
        out = judge_dir / cid
        out.mkdir(parents=True, exist_ok=True)
        (out / "tests.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
        rules = load_prompt().split("Return JSON only")[0]
        (out / "RULES.md").write_text(
            "# Grading rules (spec 10.2, as used by the tool's judge)\n\n" + rules +
            "\nStatus rules: Missed = key FOUND, tool NOT_STATED. Wrongly present = key NOT_STATED, tool "
            "gives a value. Correct absent = both NOT_STATED. A different status is Incorrect, except when the "
            "tool's status is in accept_also_status: then at most Partial.\n\n"
            f"Cause codes for every non-Correct verdict (pick the closest): {', '.join(CAUSE_CODES)}.\n",
            encoding="utf-8")
        print(f"{cid}: {len(rows)} tests -> {out}")


def judged_summary(by_contract: dict, run_id: str, verdicts: dict[str, dict]):
    """Code labels first; then the judge's verdict replaces the label of every test it graded.

    The judge sees the code's label and reason, the full answer and quote, and the contract
    text, so it can also overturn mistakes of the deterministic comparison. The code's label
    stays in the reason ("[code said ...]") as a cross-check; manual overrides still win.
    """
    from analyser.evaluate.judge import PREFIX
    from analyser.evaluate.scoring import (LABELS, apply_overrides, invented_number,
                                           load_overrides, summarise)
    summary = score_run(by_contract, run_id, overrides=[])
    invented = set()
    for cid, envs in by_contract.items():
        by_qid = {e.answer.question_id: e for e in envs}
        invented |= {t.test_id for t in summary.tests
                     if t.contract_id == cid and invented_number(by_qid.get(t.question_id))}
    for t in summary.tests:
        v = verdicts.get(t.test_id)
        if not v or v.get("verdict") not in LABELS:
            continue
        missing = "; ".join(map(str, v.get("missing") or []))
        old = f"code said {t.label}" + (f": {t.reason}" if t.reason else "")
        t.label = v["verdict"]
        t.reason = (f"{PREFIX} (subagent judge) {v.get('reason', '')}"
                    + (f" Missing or wrong: {missing}." if missing else "") + f" [{old}]")
        t.cause_code = "" if t.label in ("Correct", "Correct absent") else v.get("cause_code", "")             if v.get("cause_code") in CAUSE_CODES else t.cause_code
        t.needs_human_check = True
    apply_overrides(summary.tests, run_id, load_overrides())
    return summarise(summary.tests, run_id, invented)


def apply(judge_dir: Path, run_ids: list[str], report: Path | None) -> None:
    by_contract = load_runs(run_ids)
    verdicts: dict[str, dict] = {}
    for cid in by_contract:
        path = judge_dir / cid / "verdicts.json"
        if path.exists():
            verdicts.update({v["id"]: v for v in json.loads(path.read_text(encoding="utf-8"))})
    summary = judged_summary(by_contract, "+".join(run_ids), verdicts)
    table = format_table(summary)
    print(table)
    if report:
        report.mkdir(parents=True, exist_ok=True)
        (report / "summary_judged.txt").write_text(table, encoding="utf-8")
        (report / "score_judged.json").write_text(summary.model_dump_json(indent=1), encoding="utf-8")
        export_scores_xlsx(summary, report / "scores_judged.xlsx")
        write_error_log(summary, report / "error_log_judged.csv")
        final = {t.test_id: t for t in summary.tests}
        with (report / "judge_notes.csv").open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["test_id", "final_label", "judge_verdict", "cause_code", "reason",
                        "scorer_issue", "key_issue"])
            for tid, v in sorted(verdicts.items()):
                w.writerow([tid, final[tid].label if tid in final else "", v.get("verdict", ""),
                            v.get("cause_code", ""), v.get("reason", ""), v.get("scorer_issue", ""),
                            v.get("key_issue", "")])
        for rid in run_ids:                       # the website reads score.json per run
            cid = store.load_meta(rid).contract_id
            store.save(rid, "score", judged_summary({cid: by_contract[cid]}, rid, verdicts))


if __name__ == "__main__":
    mode, judge_dir, *rest = sys.argv[1:]
    report = None
    if "--report" in rest:
        i = rest.index("--report")
        report, rest = Path(rest[i + 1]), rest[:i] + rest[i + 2:]
    (dump if mode == "dump" else lambda d, r: apply(d, r, report))(Path(judge_dir), rest)
