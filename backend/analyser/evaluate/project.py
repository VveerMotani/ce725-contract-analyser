"""Data for the website's Project area (proof that the tool works, for the team and the viva).

- Golden tests per contract (the hand-built answer key, with page and quote).
- Judge verdicts from the validation runs (validation/<folder>/*_judge_verdicts.json). A folder's
  score_judged.json names the runs it graded ("BM1_agent-...+BM2_agent-..."), so verdicts are
  only ever applied to the runs they were made for.
- People's spot checks: entries in manual_overrides.json. "Agree" is an override equal to the
  judge's label (reason "confirmed by <name>"), so it changes no number but is counted.
- Re-scoring a run the way it was first scored: code labels, then the judge's verdicts (when the
  run was judged), then manual overrides last. score.json is written to every copy of the run
  (live and frozen), so the hosted copies show the same numbers.
"""
from __future__ import annotations

import json
from pathlib import Path

from analyser import config
from analyser.api import store
from analyser.models import AnswerEnvelope, ScoreSummary

from . import scoring
from .judge import PREFIX
from .scoring import LABELS, apply_overrides, invented_number, load_golden, score_run, summarise

CAUSE_CODES = ("TEXT_LAYER_MISSED_STRIKE IMAGE_NOT_READ SCAN_NOT_READ REFERENCE_NOT_FOLLOWED "
               "SCHEDULE_NOT_USED RATE_CAP_MIXED WRONG_BASE_OR_UNIT ONE_OF_MANY_NUMBERS INVENTED_VALUE "
               "INVENTED_QUOTE WRONG_CLAUSE TERM_NOT_RECOGNISED NEGATIVE_MISREAD CONFLICT_MISSED "
               "CONVENTION_DIFFERENCE RETRIEVAL_MISSED").split()

_HELP = ("Set a label by hand when the automatic scorer is wrong. Each entry: test_id (e.g. BM1-1.3), "
         "label (Correct, Partial, Incorrect, Missed, Correct absent, Wrongly present), reason (required, "
         "why), run_id (optional; empty or * = every run), cause_code (optional), by (optional, your name). "
         "Overrides are applied last and marked 'MANUAL OVERRIDE' in the reason.")


# ---------------------------------------------------------------------------
# Answer key
# ---------------------------------------------------------------------------


def golden_for(contract_id: str) -> list[dict]:
    return [g for g in load_golden() if g["contract_id"] == contract_id]


# ---------------------------------------------------------------------------
# Judge verdicts
# ---------------------------------------------------------------------------


def validation_dirs() -> list[Path]:
    base = Path(config.VALIDATION_DIR)
    return sorted(d for d in base.iterdir() if d.is_dir()) if base.is_dir() else []


def _judged_run_ids(folder: Path) -> list[str]:
    data = store.read_json(folder / "score_judged.json") or {}
    return [r for r in str(data.get("run_id", "")).split("+") if r]


def _folder_verdicts(folder: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for p in sorted(folder.glob("*_judge_verdicts.json")):
        for v in json.loads(p.read_text(encoding="utf-8")):
            out[v["id"]] = v
    return out


def verdicts_for_run(run_id: str) -> dict[str, dict] | None:
    """The judge's verdicts made for this run, or None if the run was not judged."""
    for folder in reversed(validation_dirs()):          # newest folder first
        if run_id in _judged_run_ids(folder):
            v = _folder_verdicts(folder)
            return v or None
    return None


def judge_notes() -> list[dict]:
    """Every judge verdict with the runs it graded: test_id, contract_id, verdict, missing, reason,
    cause_code, scorer_issue, key_issue, run_id, folder."""
    out = []
    for folder in validation_dirs():
        runs = {r.split("_")[0]: r for r in _judged_run_ids(folder)}
        for tid, v in sorted(_folder_verdicts(folder).items()):
            cid = tid.split("-")[0]
            out.append({"test_id": tid, "contract_id": cid, "verdict": v.get("verdict", ""),
                        "missing": [str(x) for x in v.get("missing") or []],
                        "reason": v.get("reason", ""), "cause_code": v.get("cause_code", ""),
                        "scorer_issue": v.get("scorer_issue", ""), "key_issue": v.get("key_issue", ""),
                        "run_id": runs.get(cid, ""), "folder": folder.name})
    return out


def judged_summary(by_contract: dict[str, list[AnswerEnvelope]], run_id: str,
                   verdicts: dict[str, dict], overrides: list[dict] | None = None) -> ScoreSummary:
    """Code labels first; then the judge's verdict replaces the label of every test it graded;
    manual overrides last.

    The judge sees the code's label and reason, the full answer and quote, and the contract
    text, so it can also overturn mistakes of the deterministic comparison. The code's label
    stays in the reason ("[code said ...]") as a cross-check.
    """
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
        t.cause_code = "" if t.label in ("Correct", "Correct absent") else v.get("cause_code", "") \
            if v.get("cause_code") in CAUSE_CODES else t.cause_code
        t.needs_human_check = True
    apply_overrides(summary.tests, run_id, scoring.load_overrides() if overrides is None else overrides)
    return summarise(summary.tests, run_id, invented)


def score_run_judged(run_id: str, envelopes_by_contract: dict[str, list[AnswerEnvelope]]) -> ScoreSummary | None:
    """Judged score of a run that has verdicts, else None (the caller scores by code)."""
    verdicts = verdicts_for_run(run_id)
    return judged_summary(envelopes_by_contract, run_id, verdicts) if verdicts else None


def rescore_run(run_id: str) -> ScoreSummary | None:
    """Score a benchmark run again (judge verdicts if any, then overrides) and save score.json in
    every copy of the run. Returns None for runs without an answer key."""
    meta = store.load_meta(run_id)
    if meta.contract_id not in config.BENCHMARKS:
        return None
    by_contract = {meta.contract_id: store.load_answers(run_id)}
    summary = score_run_judged(run_id, by_contract) or score_run(by_contract, run_id)
    for base in (store.runs_dir(), store.frozen_dir()):
        if (base / run_id / "meta.json").exists():
            store.write_json(base / run_id / "score.json", store.dump(summary))
    return summary


# ---------------------------------------------------------------------------
# People's checks (manual_overrides.json)
# ---------------------------------------------------------------------------


def overrides_path() -> Path:
    return Path(scoring.OVERRIDES_FILE)


def _write_overrides(entries: list[dict]) -> None:
    path = overrides_path()
    data = store.read_json(path) if path.exists() else None
    if not isinstance(data, dict):
        data = {"_help": _HELP}
    data["overrides"] = entries
    # Same layout as the hand-edited file: 2-space indent, LF line ends, final newline.
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(text.encode("utf-8"))
    tmp.replace(path)


def _same_target(o: dict, test_id: str, run_id: str) -> bool:
    return o.get("test_id") == test_id and (o.get("run_id") or "") == (run_id or "")


def add_override(entry: dict) -> dict:
    """Append a person's label; an earlier entry for the same test and run is replaced."""
    clean = {"test_id": entry["test_id"], "label": entry["label"], "reason": entry["reason"]}
    for k in ("run_id", "cause_code", "by"):
        if entry.get(k):
            clean[k] = entry[k]
    entries = [o for o in scoring.load_overrides() if not _same_target(o, clean["test_id"], clean.get("run_id", ""))]
    _write_overrides(entries + [clean])
    return clean


def remove_override(test_id: str, run_id: str | None = None) -> list[dict]:
    """Remove the entries of a test (only those for run_id when given). Returns the removed ones."""
    keep, gone = [], []
    for o in scoring.load_overrides():
        hit = o.get("test_id") == test_id and (run_id is None or (o.get("run_id") or "") == run_id)
        (gone if hit else keep).append(o)
    if gone:
        _write_overrides(keep)
    return gone


def affected_runs(test_id: str, run_id: str | None) -> list[str]:
    """Runs whose score an override of this test changes: the named run, else every finished run
    of the test's contract."""
    cid = test_id.split("-")[0]
    out = []
    for rid, _frozen in store.list_run_ids():
        if run_id and rid != run_id:
            continue
        try:
            meta = store.load_meta(rid)
        except KeyError:
            continue
        if meta.contract_id == cid and meta.stage == "done":
            out.append(rid)
    return out


def checks_progress(golden_total: int | None = None) -> dict:
    """How many tests a person has checked and how often they agreed with the judge."""
    entries = scoring.load_overrides()
    judge: dict[str, str] = {}
    for n in judge_notes():
        judge.setdefault(n["test_id"], n["verdict"])
    checked = {o["test_id"] for o in entries if o.get("label") in LABELS}
    with_judge = [o for o in entries if o.get("label") in LABELS and o["test_id"] in judge]
    agree = sum(o["label"] == judge[o["test_id"]] for o in with_judge)
    total = golden_total if golden_total is not None else len(load_golden())
    return {"total": total, "checked": len(checked), "compared": len(with_judge), "agree": agree,
            "agreement": round(agree / len(with_judge), 4) if with_judge else None}
