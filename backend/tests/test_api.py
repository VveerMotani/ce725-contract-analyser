"""API tests (M5a). Other modules are replaced by fakes, so no PDFs and no model calls."""
from __future__ import annotations

import re
import shutil

import pytest
from fastapi.testclient import TestClient

from analyser import config
from analyser.api import pipeline, store
from analyser.api.app import app, create_app
from analyser.models import RunMeta
from tests.test_api_fakes import FAKE_PNG, install_fakes


@pytest.fixture
def env(monkeypatch, tmp_path):
    calls = install_fakes(monkeypatch, tmp_path)
    return TestClient(app), calls


def start_and_wait(client, package_id="BM1", **user_inputs) -> dict:
    user_inputs = user_inputs or {"contract_value": 1e7, "duration_months": 12}
    r = client.post("/api/runs", json={"package_id": package_id, "user_inputs": user_inputs})
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    pipeline.wait_for(run_id, timeout=30)
    return client.get(f"/api/runs/{run_id}").json()


def upload(client, name="contract.pdf", data=b"%PDF-1.4 fake", tag="gcc", cid="MyCo"):
    return client.post("/api/packages",
                       data={"contract_id": cid, "title": "My contract", "tags[]": [tag]},
                       files=[("files[]", (name, data, "application/pdf"))])


def test_benchmarks_list(env):
    client, _ = env
    rows = client.get("/api/benchmarks").json()
    assert [r["contract_id"] for r in rows] == ["BM1", "BM2", "BM3", "BM4"]
    assert all(r["package_id"] == r["contract_id"] and r["has_run"] is False for r in rows)
    assert rows[0]["title"] == config.BENCHMARKS["BM1"]["title"]


def test_upload_package_and_page(env):
    client, calls = env
    r = upload(client)
    assert r.status_code == 200, r.text
    pkg = r.json()
    assert pkg["contract_id"] == "MyCo" and pkg["pages"] == []
    assert pkg["files"][0]["tag"] == "gcc" and calls["build"] == 1

    full = client.get(f"/api/packages/{pkg['package_id']}").json()
    assert len(full["pages"]) == 3 and all(len(p["text"]) <= 300 for p in full["pages"])

    png = client.get(f"/api/packages/{pkg['package_id']}/page/d1/2.png",
                     params={"highlight": "some quote"})
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    assert png.content == FAKE_PNG
    assert client.get(f"/api/packages/{pkg['package_id']}/page/d1/99.png").status_code == 404
    assert client.get("/api/packages/nope").status_code == 404


def test_upload_rejects_bad_input(env):
    client, _ = env
    assert upload(client, name="a.txt", data=b"hello").status_code == 400
    assert upload(client, tag="poem").status_code == 400
    assert upload(client, cid="").status_code == 400


def test_run_benchmark_to_done(env):
    client, calls = env
    meta = start_and_wait(client, "BM1")
    run_id = meta["run_id"]
    assert re.fullmatch(r"BM1_\d{8}-\d{6}", run_id)
    assert meta["stage"] == "done", meta
    assert meta["progress"] == 1.0 and meta["error"] == ""
    assert meta["model"] == "fake-model" and meta["effort"] == "low"
    assert meta["llm_calls"] == 7 and meta["input_tokens"] == 1000
    assert meta["prompt_version"] == config.PROMPT_VERSION and meta["frozen"] is False
    assert any("absence step" in line for line in meta["log"])

    folder = config.RUNS_DIR / run_id
    for name in ("meta", "answers", "params", "flags", "cashflow", "score", "package"):
        assert (folder / f"{name}.json").exists(), name

    answers = client.get(f"/api/runs/{run_id}/answers").json()
    assert len(answers) == 4 and answers[0]["verification"] is not None
    assert len(client.get(f"/api/runs/{run_id}/flags").json()) == 2
    assert client.get(f"/api/runs/{run_id}/score").json()["counts"] == {"Correct": 4}
    assert calls["score"] == [["BM1"]]
    assert [m["run_id"] for m in client.get("/api/runs").json()] == [run_id]
    assert client.get("/api/benchmarks").json()[0]["has_run"] is True
    assert client.get("/api/runs/nope").status_code == 404


def test_uploaded_run_has_no_score(env):
    client, _ = env
    pid = upload(client).json()["package_id"]
    meta = start_and_wait(client, pid)
    assert meta["stage"] == "done" and meta["contract_id"] == "MyCo"
    assert meta["run_id"].startswith("MyCo_")
    assert client.get(f"/api/runs/{meta['run_id']}/score").status_code == 404
    assert client.post("/api/runs", json={"package_id": "missing"}).status_code == 404


def test_missing_api_key_gives_friendly_error(env, monkeypatch):
    client, _ = env

    def no_key(*a, **k):
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    monkeypatch.setattr(pipeline.module("llm"), "LLMClient", no_key)
    meta = start_and_wait(client, "BM2")
    assert meta["stage"] == "error"
    assert meta["error"].startswith("Add ANTHROPIC_API_KEY to backend/.env and restart the server")
    assert (config.RUNS_DIR / meta["run_id"] / "error.txt").exists()


def test_soft_stage_failure_keeps_run(env, monkeypatch):
    client, _ = env

    def broken(*a, **k):
        raise ValueError("cash model exploded")

    monkeypatch.setattr(pipeline.module("cashflow"), "run_cashflow", broken)
    meta = start_and_wait(client, "BM3")
    assert meta["stage"] == "done"
    assert any("cash flow skipped" in line for line in meta["log"])


def test_review_patch_changes_answer_and_recomputes(env):
    client, calls = env
    run_id = start_and_wait(client)["run_id"]
    flags_before, score_before = calls["flags"], len(calls["score"])
    assert client.get(f"/api/runs/{run_id}/params").json()["inputs"]["ld_rate_per_day"] == 0.0005

    r = client.patch(f"/api/runs/{run_id}/review/4.1",
                     json={"decision": "edited", "user_answer": {"answer_value": "0.1"},
                           "note": "Schedule J says 0.1%"})
    assert r.status_code == 200, r.text
    env_ = r.json()
    assert env_["review"]["decision"] == "edited" and env_["review"]["decided_at"]
    assert env_["review"]["user_answer"]["answer_value"] == "0.1"
    assert env_["answer"]["answer_value"] == "0.05"          # AI answer is never edited
    assert env_["review"]["note"] == "Schedule J says 0.1%"

    saved = {a["answer"]["question_id"]: a for a in client.get(f"/api/runs/{run_id}/answers").json()}
    assert saved["4.1"]["review"]["user_answer"]["answer_value"] == "0.1"
    params = client.get(f"/api/runs/{run_id}/params").json()
    assert params["inputs"]["ld_rate_per_day"] == pytest.approx(0.001)
    assert calls["flags"] > flags_before and len(calls["score"]) > score_before

    ok = client.patch(f"/api/runs/{run_id}/review/1.10", json={"decision": "accepted"})
    assert ok.json()["review"]["decision"] == "accepted"
    assert client.patch(f"/api/runs/{run_id}/review/9.9",
                        json={"decision": "accepted"}).status_code == 404
    assert client.patch(f"/api/runs/{run_id}/review/4.1",
                        json={"decision": "edited"}).status_code == 422
    assert client.patch(f"/api/runs/{run_id}/review/4.1",
                        json={"decision": "maybe"}).status_code == 422


def test_params_put_confirms_and_survives_review(env):
    client, _ = env
    run_id = start_and_wait(client)["run_id"]
    params = client.get(f"/api/runs/{run_id}/params").json()
    params["inputs"]["contract_value"] = 2.5e7
    params["inputs"]["ld_rate_per_day"] = 0.0007
    r = client.put(f"/api/runs/{run_id}/params", json=params)
    assert r.status_code == 200, r.text
    prov = {p["field"]: p for p in r.json()["provenance"]}
    assert all(p["confirmed"] for p in prov.values())
    assert prov["contract_value"]["source"] == "user"
    assert prov["ld_rate_per_day"]["source"] == "extracted"   # submitted provenance wins
    assert prov["retention_rate"]["source"] == "default"

    # A later review recomputes params but keeps the user's confirmed values.
    client.patch(f"/api/runs/{run_id}/review/4.1",
                 json={"decision": "edited", "user_answer": {"answer_value": "0.2"}})
    after = client.get(f"/api/runs/{run_id}/params").json()["inputs"]
    assert after["contract_value"] == 2.5e7 and after["ld_rate_per_day"] == 0.0007


def test_cashflow_returns_both_views(env):
    client, calls = env
    run_id = start_and_wait(client)["run_id"]
    flags_before = calls["flags"]
    r = client.post(f"/api/runs/{run_id}/cashflow", json={"overrides": {"delay_days": 30}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"as_written", "reference"}
    assert body["as_written"]["ld_amount"] == pytest.approx(1e7 * 0.0005 * 30)
    assert body["reference"]["retention_locked_max"] == 0
    assert body["as_written"]["retention_locked_max"] > 0
    saved = store.load(run_id, "cashflow")
    assert saved["overrides"] == {"delay_days": 30}
    assert calls["flags"] == flags_before + 1
    assert client.get(f"/api/runs/{run_id}/flags").json()[0]["rupee_impact"] == pytest.approx(1.5e5)

    assert client.post(f"/api/runs/{run_id}/cashflow", json={}).status_code == 200
    assert client.post(f"/api/runs/{run_id}/cashflow",
                       json={"overrides": {"colour": 1}}).status_code == 422


def test_frozen_runs_are_listed_and_read_only(env):
    client, _ = env
    run_id = start_and_wait(client)["run_id"]
    store.freeze_run(run_id)
    shutil.rmtree(config.RUNS_DIR / run_id)

    runs = client.get("/api/runs").json()
    assert runs[0]["run_id"] == run_id and runs[0]["frozen"] is True
    assert len(client.get(f"/api/runs/{run_id}/answers").json()) == 4
    assert client.patch(f"/api/runs/{run_id}/review/4.1",
                        json={"decision": "accepted"}).status_code == 403
    params = client.get(f"/api/runs/{run_id}/params").json()
    assert client.put(f"/api/runs/{run_id}/params", json=params).status_code == 403
    assert client.post(f"/api/runs/{run_id}/cashflow", json={}).status_code == 200  # what-if only
    assert not (config.RUNS_DIR / run_id).exists()


def test_evaluation_combines_latest_benchmark_runs(env):
    client, calls = env
    assert client.get("/api/evaluation").status_code == 404
    first = start_and_wait(client, "BM1")["run_id"]
    store.freeze_run(first)
    shutil.rmtree(config.RUNS_DIR / first)
    second = start_and_wait(client, "BM2")["run_id"]
    r = client.get("/api/evaluation").json()
    assert r["runs_used"] == {"BM1": first, "BM2": second}
    assert r["missing_benchmarks"] == ["BM3", "BM4"]
    assert calls["score"][-1] == ["BM1", "BM2"] and r["counts"] == {"Correct": 8}


def test_interrupted_run_is_marked_error(env):
    client, _ = env
    store.new_run_dir("BM1_20260101-000000")
    store.save_meta(RunMeta(run_id="BM1_20260101-000000", package_id="BM1",
                            contract_id="BM1", stage="extract"))
    meta = client.get("/api/runs/BM1_20260101-000000").json()
    assert meta["stage"] == "error" and "Start the run again" in meta["error"]


def test_exports(env):
    client, _ = env
    run_id = start_and_wait(client)["run_id"]
    csv = client.get(f"/api/runs/{run_id}/export.csv")
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    header = csv.content.decode("utf-8-sig").splitlines()[0]
    assert header.startswith("Contract,Clause,Q,Question,Status,Answer,Unit,Section,PDF page,"
                             "Verbatim quote,Notes")
    pdf = client.get(f"/api/runs/{run_id}/report.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_spa_fallback(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    client = TestClient(create_app(dist))
    for path in ("/", "/runs/BM1_x/review", "/runs/BM1_replay-20261023-120000", "/evaluation",
                 "/about", "/new", "/packages/BM1"):
        r = client.get(path)
        assert r.status_code == 200 and r.text == "<html>app</html>", path
    assert client.get("/assets/app.js").text == "console.log(1)"
    assert client.get("/favicon.svg").text == "<svg/>"
    assert client.get("/api/not-a-route").status_code == 404
    assert client.options("/api/benchmarks", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"}
    ).headers["access-control-allow-origin"] == "http://localhost:5173"


def test_params_put_keeps_submitted_provenance(env):
    client, _ = env
    run_id = start_and_wait(client)["run_id"]
    params = client.get(f"/api/runs/{run_id}/params").json()
    params["inputs"]["cost_share"] = 0.9
    params["provenance"].append({"field": "cost_share", "source": "user", "quote": "edited in UI"})
    params["inputs"]["delay_days"] = 60          # changed but no provenance item sent
    prov = {p["field"]: p for p in client.put(f"/api/runs/{run_id}/params",
                                              json=params).json()["provenance"]}
    assert prov["cost_share"]["quote"] == "edited in UI" and prov["cost_share"]["confirmed"]
    assert prov["delay_days"]["source"] == "user"
    assert prov["ld_rate_per_day"]["question_id"] == "4.1"


def test_user_inputs_cleaned_and_s_curve(env):
    client, calls = env
    form = {"contract_value": 2e7, "duration_months": 10.0, "progress_curve": "s_curve",
            "progress": None, "cost_share": 0.8, "overdraft_rate_pa": None,
            "bank_rate_pa": 0.065, "bg_commission_pa": None, "delay_days": 0,
            "index_rise_pa": {"cement": 0.05, "steel": None, "fuel": None, "labour": 0.06,
                              "bitumen": None},
            "supplier_credit_days": None, "favourite_colour": "blue"}
    meta = start_and_wait(client, "BM1", **form)
    assert meta["stage"] == "done"
    assert calls["user_inputs"][-1] == {
        "contract_value": 2e7, "duration_months": 10, "cost_share": 0.8, "bank_rate_pa": 0.065,
        "delay_days": 0, "index_rise_pa": {"cement": 0.05, "labour": 0.06}}
    assert any("Ignored unknown user input(s): favourite_colour" in line for line in meta["log"])
    params = client.get(f"/api/runs/{meta['run_id']}/params").json()
    assert params["inputs"]["progress"] == [0.1] * 10
    assert {p["field"]: p for p in params["provenance"]}["progress"]["source"] == "user"

    # The S-curve is also applied when a review triggers a recompute.
    before = calls["params"]
    client.patch(f"/api/runs/{meta['run_id']}/review/4.1", json={"decision": "accepted"})
    assert calls["params"] > before
    after = client.get(f"/api/runs/{meta['run_id']}/params").json()
    assert after["inputs"]["progress"] == [0.1] * 10


def test_explicit_progress_beats_s_curve(env):
    client, calls = env
    meta = start_and_wait(client, "BM1", contract_value=1e7, duration_months=2,
                          progress_curve="s_curve", progress=[0.3, 0.7])
    assert meta["stage"] == "done"
    assert calls["user_inputs"][-1]["progress"] == [0.3, 0.7]


def test_review_pending_is_undo(env):
    client, _ = env
    run_id = start_and_wait(client)["run_id"]
    client.patch(f"/api/runs/{run_id}/review/4.1",
                 json={"decision": "edited", "user_answer": {"answer_value": "0.1"},
                       "note": "my note"})
    ld = client.get(f"/api/runs/{run_id}/params").json()["inputs"]["ld_rate_per_day"]
    assert ld == pytest.approx(0.001)
    r = client.patch(f"/api/runs/{run_id}/review/4.1", json={"decision": "pending", "note": "x"})
    review = r.json()["review"]
    assert review["decision"] == "pending" and review["user_answer"] is None
    assert review["note"] == "" and review["decided_at"] == ""
    ld = client.get(f"/api/runs/{run_id}/params").json()["inputs"]["ld_rate_per_day"]
    assert ld == pytest.approx(0.0005)


def test_errors_are_json_detail_strings(env, monkeypatch):
    client, _ = env
    run_id = start_and_wait(client)["run_id"]
    bad = client.patch(f"/api/runs/{run_id}/review/4.1", json={"decision": "maybe"})
    assert bad.status_code == 422 and isinstance(bad.json()["detail"], str)
    assert "decision" in bad.json()["detail"]
    assert isinstance(client.post("/api/runs", json={}).json()["detail"], str)
    assert isinstance(client.get("/api/runs/nope").json()["detail"], str)

    pipeline._ACTIVE.add(run_id)                       # pretend it is still running
    try:
        busy = client.patch(f"/api/runs/{run_id}/review/4.1", json={"decision": "accepted"})
        assert busy.status_code == 409 and isinstance(busy.json()["detail"], str)
    finally:
        pipeline._ACTIVE.discard(run_id)

    store.freeze_run(run_id)
    shutil.rmtree(config.RUNS_DIR / run_id)
    frozen = client.patch(f"/api/runs/{run_id}/review/4.1", json={"decision": "accepted"})
    assert frozen.status_code == 403 and "frozen" in frozen.json()["detail"]

    def crash(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(pipeline, "compute_cash", crash)
    err = client.post(f"/api/runs/{run_id}/cashflow", json={})
    assert err.status_code == 500
    assert err.json() == {"detail": "Internal error: RuntimeError: boom"}


def test_evaluation_prefers_ai_runs_over_replays(env):
    client, _ = env
    ai = start_and_wait(client, "BM1")["run_id"]
    for cid in ("BM1", "BM2"):                         # replays made later than the AI run
        rid = f"{cid}_replay-20991231-000000"
        store.new_run_dir(rid)
        store.save_meta(RunMeta(run_id=rid, package_id=cid, contract_id=cid,
                                model=pipeline.REPLAY_MODEL, started_at="2099-12-31T00:00:00",
                                stage="done", progress=1.0))
        store.save(rid, "answers", [])
    r = client.get("/api/evaluation").json()
    assert r["runs_used"] == {"BM1": ai, "BM2": "BM2_replay-20991231-000000"}
    assert r["replay"] is True and r["replay_contracts"] == ["BM2"]
    runs = {m["run_id"]: m for m in client.get("/api/runs").json()}
    assert runs["BM1_replay-20991231-000000"]["replay"] is True and runs[ai]["replay"] is False
    assert client.get("/api/runs/BM1_replay-20991231-000000/answers").json() == []


def test_checks_classifies_rule_outcomes():
    """/checks: fired rules are "flag"; a rule that checked and passed is "pass"; a rule that
    could not be checked (term missing or elsewhere) is "not_checked", never a green flag."""
    from analyser.api.app import _NOT_CHECKED
    assert _NOT_CHECKED.search("rate and cap not in the package (4.2 POINTS_ELSEWHERE)")
    assert _NOT_CHECKED.search("minimum bill answer is MISSING")
    assert not _NOT_CHECKED.search("no POINTS_ELSEWHERE answers")
    assert not _NOT_CHECKED.search("damages capped at or below the reference")


def test_read_only_demo_blocks_new_analysis(monkeypatch):
    """ANALYSER_READ_ONLY=1 (hosted copy): no uploads and no new runs."""
    monkeypatch.setattr(config, "READ_ONLY", True)
    from fastapi.testclient import TestClient
    from analyser.api.app import app as real_app
    c = TestClient(real_app)
    assert c.post("/api/runs", json={"package_id": "BM1", "user_inputs": {}}).status_code == 403
    r = c.post("/api/packages", data={"contract_id": "X"})
    assert r.status_code == 403 and "saved results only" in r.json()["detail"]
