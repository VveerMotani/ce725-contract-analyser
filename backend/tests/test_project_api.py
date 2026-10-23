"""Project-area endpoints: answer key, judge notes, people's checks (manual overrides), reference changes.

Uses the real modules on a copy of the frozen BM1 Claude-read run and its judge verdicts, in tmp_path,
so manual_overrides.json and the run folders of the repository are never touched.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from analyser import config
from analyser.api import pipeline, store
from analyser.api.app import create_app
from analyser.evaluate import project, scoring

RUN = "BM1_agent-20261023-231019"
SRC_RUN = config.RUNS_DIR / "frozen" / RUN
SRC_VAL = config.PROJECT_DIR / "validation" / "agent_run_2026-10-23"

pytestmark = pytest.mark.skipif(not SRC_RUN.is_dir() or not SRC_VAL.is_dir(),
                                reason="frozen BM1 Claude-read run or its validation folder not present")


@pytest.fixture
def proj(monkeypatch, tmp_path):
    runs = tmp_path / "runs"
    shutil.copytree(SRC_RUN, runs / "frozen" / RUN)
    shutil.copytree(SRC_RUN, runs / RUN)                       # live copy hides the frozen one
    val = tmp_path / "validation" / SRC_VAL.name
    val.mkdir(parents=True)
    shutil.copy(SRC_VAL / "BM1_judge_verdicts.json", val)
    shutil.copy(SRC_VAL / "score_judged.json", val)
    overrides = tmp_path / "manual_overrides.json"
    overrides.write_bytes((json.dumps({"_help": "x", "overrides": []}, indent=2) + "\n").encode("utf-8"))
    monkeypatch.setattr(config, "RUNS_DIR", runs)
    monkeypatch.setattr(config, "UPLOADS_DIR", runs / "_uploads")
    monkeypatch.setattr(config, "VALIDATION_DIR", tmp_path / "validation")
    monkeypatch.setattr(scoring, "OVERRIDES_FILE", overrides)
    monkeypatch.setattr(config, "READ_ONLY", False)
    pipeline.clear_caches()
    return TestClient(create_app(frontend_dist=None)), runs, overrides


def score_file(runs: Path, frozen: bool = False) -> dict:
    return json.loads((runs / ("frozen" if frozen else "") / RUN / "score.json").read_text(encoding="utf-8"))


def test_golden_per_contract(proj):
    client, _, _ = proj
    rows = client.get("/api/golden/BM1").json()
    assert len(rows) == 52 and all(r["contract_id"] == "BM1" for r in rows)
    assert {"expected_answer", "pdf_page", "verbatim_quote", "core"} <= set(rows[0])
    assert client.get("/api/golden/XX").status_code == 404


def test_judge_notes_carry_run_and_key_issues(proj):
    client, _, _ = proj
    notes = client.get("/api/project/judge-notes").json()
    assert len(notes) == 52
    assert all(n["run_id"] == RUN and n["verdict"] for n in notes)
    assert any(n["key_issue"] for n in notes)          # BM1-1.5: the key's note is inaccurate


def test_rescore_reproduces_saved_judged_score(proj):
    _, runs, _ = proj
    before = score_file(runs)
    project.rescore_run(RUN)
    assert score_file(runs) == before == score_file(runs, frozen=True)


def test_agree_records_override_and_keeps_judged_labels(proj):
    client, runs, overrides = proj
    before = score_file(runs)
    original = overrides.read_bytes()
    judge = {n["test_id"]: n["verdict"] for n in client.get("/api/project/judge-notes").json()}
    tid = "BM1-0.4"
    r = client.post("/api/project/overrides", json={"test_id": tid, "label": judge[tid],
                                                    "reason": "confirmed by Asha", "by": "Asha", "run_id": RUN})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rescored"] == [RUN]
    assert body["progress"] == {"total": 208, "checked": 1, "compared": 1, "agree": 1, "agreement": 1.0}
    saved = json.loads(overrides.read_text(encoding="utf-8"))
    assert saved["_help"] == "x"
    assert saved["overrides"] == [{"test_id": tid, "label": judge[tid], "reason": "confirmed by Asha",
                                   "run_id": RUN, "by": "Asha"}]

    after = score_file(runs)
    assert after == score_file(runs, frozen=True)                 # both copies re-saved
    assert after["counts"] == before["counts"]                    # agreeing changes no number
    t = next(x for x in after["tests"] if x["test_id"] == tid)
    assert t["reason"].startswith("MANUAL OVERRIDE by Asha: confirmed by Asha [auto label")
    assert "LLM-judged:" in t["reason"]                           # the judge's label was kept underneath
    others = [x for x in after["tests"] if x["test_id"] != tid]
    assert others == [x for x in before["tests"] if x["test_id"] != tid]

    # The evaluation reads the re-saved score.
    ev = client.get("/api/evaluation").json()
    assert next(x for x in ev["tests"] if x["test_id"] == tid)["reason"].startswith("MANUAL OVERRIDE")

    # Removing the check restores the original score exactly.
    r = client.delete(f"/api/project/overrides/{tid}", params={"run_id": RUN})
    assert r.status_code == 200 and r.json()["progress"]["checked"] == 0
    assert overrides.read_bytes() == original                      # file byte-for-byte as before
    assert score_file(runs) == before == score_file(runs, frozen=True)
    assert client.delete(f"/api/project/overrides/{tid}").status_code == 404


def test_change_label_counts_as_disagreement_and_replaces_earlier_check(proj):
    client, runs, _ = proj
    judge = {n["test_id"]: n["verdict"] for n in client.get("/api/project/judge-notes").json()}
    tid = "BM1-1.7"
    other = "Partial" if judge[tid] != "Partial" else "Correct"
    base = {"test_id": tid, "by": "Ravi", "run_id": RUN}
    assert client.post("/api/project/overrides", json={**base, "label": judge[tid], "reason": "confirmed by Ravi"}).status_code == 200
    r = client.post("/api/project/overrides", json={**base, "label": other, "reason": "clause number is not a value"})
    assert r.status_code == 200
    assert len(r.json()["overrides"]) == 1                        # replaced, not duplicated
    assert r.json()["progress"]["agree"] == 0 and r.json()["progress"]["agreement"] == 0.0
    t = next(x for x in score_file(runs)["tests"] if x["test_id"] == tid)
    assert t["label"] == other


def test_override_input_is_checked(proj):
    client, _, _ = proj
    ok = {"test_id": "BM1-0.4", "label": "Correct", "reason": "confirmed by A", "by": "A", "run_id": RUN}
    assert client.post("/api/project/overrides", json={**ok, "label": "Fine"}).status_code == 422
    assert client.post("/api/project/overrides", json={**ok, "test_id": "BM1-9.9"}).status_code == 404
    assert client.post("/api/project/overrides", json={**ok, "by": "  "}).status_code == 422
    assert client.post("/api/project/overrides", json={**ok, "run_id": "nope"}).status_code == 404


def test_read_only_blocks_checks(proj, monkeypatch):
    client, _, overrides = proj
    monkeypatch.setattr(config, "READ_ONLY", True)
    r = client.post("/api/project/overrides", json={"test_id": "BM1-0.4", "label": "Correct",
                                                    "reason": "confirmed by A", "by": "A"})
    assert r.status_code == 403 and "saved results only" in r.json()["detail"]
    assert client.delete("/api/project/overrides/BM1-0.4").status_code == 403
    assert json.loads(overrides.read_text(encoding="utf-8"))["overrides"] == []
    assert client.get("/api/project/overrides").status_code == 200   # reading still works


def test_reference_changes(proj):
    client, _, _ = proj
    rows = client.get(f"/api/runs/{RUN}/reference-changes").json()
    assert isinstance(rows, list)
    assert all({"field", "as_written", "reference", "reason"} <= set(r) for r in rows)
    assert client.get("/api/runs/nope/reference-changes").status_code == 404


def test_review_rescore_keeps_judge_labels(proj):
    """A review decision re-scores the run; a judged run keeps the judge's labels."""
    _, runs, _ = proj
    before = score_file(runs)
    s = pipeline.score_benchmark("BM1", store.load_answers(RUN), RUN)
    assert json.loads(s.model_dump_json()) == before
