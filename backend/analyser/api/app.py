"""FastAPI web API for the contract analyser (module M5, table in INTERFACES.md).

Start with:  python run_server.py   (or uvicorn analyser.api.app:app --port 8000)
All endpoints live under /api. If frontend/dist exists (built React app), it is
served at / with every non-/api path falling back to index.html.
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional, get_args

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

from analyser import config
from analyser.api import pipeline, store
from analyser.models import (Answer, AnswerEnvelope, CashParams, CashResult, DocTag,
                             Package, RiskFlag, RunMeta, ScoreSummary)

FRONTEND_DIST = config.PROJECT_DIR / "frontend" / "dist"
DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

api = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class RunRequest(BaseModel):
    package_id: str
    user_inputs: dict[str, Any] = {}


class ReviewRequest(BaseModel):
    decision: Literal["pending", "accepted", "edited", "rejected", "not_needed"]
    user_answer: Optional[dict[str, Any]] = None   # full Answer or only the changed fields
    note: Optional[str] = None


class CashflowRequest(BaseModel):
    overrides: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _meta(run_id: str) -> RunMeta:
    try:
        return pipeline.get_meta(run_id)
    except KeyError:
        raise HTTPException(404, f"No run called {run_id}")


def _meta_json(meta: RunMeta) -> dict:
    """RunMeta plus a 'frozen' flag (frozen runs are read-only demo copies)."""
    return {**meta.model_dump(mode="json"), "frozen": store.is_frozen(meta.run_id)}


def _editable(run_id: str) -> RunMeta:
    """Meta of a run that may be changed: not frozen and not still running."""
    meta = _meta(run_id)
    if store.is_frozen(run_id):
        raise HTTPException(403, "This is a frozen run and cannot be changed. Start a new run to edit.")
    if pipeline.is_active(run_id):
        raise HTTPException(409, "The run is still in progress. Wait until it is done.")
    return meta


def _package(package_id: str) -> Package:
    if not store.safe_id(package_id):
        raise HTTPException(404, "Unknown package")
    try:
        return pipeline.get_package(package_id)
    except Exception:
        raise HTTPException(404, f"No package called {package_id}")


def _package_contract_id(package_id: str) -> str:
    """contract_id of a package, read from runs/packages/<id>/package.json if possible."""
    if package_id in config.BENCHMARKS:
        return package_id
    data = store.read_json(store.runs_dir() / "packages" / package_id / "package.json")
    if data and data.get("contract_id"):
        return data["contract_id"]
    return _package(package_id).contract_id


def _all_metas() -> list[RunMeta]:
    out = []
    for run_id, _frozen in store.list_run_ids():
        try:
            out.append(pipeline.get_meta(run_id))
        except Exception:  # noqa: BLE001 - a broken folder must not hide the others
            continue
    return out


def _latest_done_runs() -> dict[str, RunMeta]:
    """Latest finished run of each benchmark contract (live or frozen)."""
    best: dict[str, RunMeta] = {}
    for m in _all_metas():
        if m.stage == "done" and m.contract_id in config.BENCHMARKS:
            if m.contract_id not in best or (m.started_at, m.run_id) > (
                    best[m.contract_id].started_at, best[m.contract_id].run_id):
                best[m.contract_id] = m
    return best


def _load_model(run_id: str, name: str, model: type[BaseModel]):
    data = store.load(run_id, name)
    return model.model_validate(data) if data is not None else None


# ---------------------------------------------------------------------------
# Benchmarks and packages
# ---------------------------------------------------------------------------


@api.get("/benchmarks")
def list_benchmarks() -> list[dict]:
    done = {m.contract_id for m in _all_metas() if m.stage == "done"}
    return [{"contract_id": cid, "title": b["title"], "package_id": cid, "has_run": cid in done}
            for cid, b in config.BENCHMARKS.items()]


@api.post("/packages")
async def upload_package(request: Request) -> dict:
    """Multipart: files[] (PDFs), tags[] (one DocTag per file), contract_id, title."""
    form = await request.form()
    uploads = form.getlist("files[]") + form.getlist("files")
    tags = [str(t) for t in form.getlist("tags[]") + form.getlist("tags")]
    contract_id = str(form.get("contract_id") or "").strip()
    title = str(form.get("title") or "").strip()
    if not contract_id:
        raise HTTPException(400, "Give the contract a name (contract_id).")
    if not uploads:
        raise HTTPException(400, "Choose at least one PDF file.")
    if not tags:
        tags = ["other"] * len(uploads)
    if len(tags) != len(uploads):
        raise HTTPException(400, "Each file needs exactly one tag.")
    allowed = get_args(DocTag)
    for t in tags:
        if t not in allowed:
            raise HTTPException(400, f"Unknown tag '{t}'. Use one of: {', '.join(allowed)}")

    safe_cid = re.sub(r"[^A-Za-z0-9_\-]+", "-", contract_id).strip("-") or "contract"
    folder = Path(config.UPLOADS_DIR) / f"{safe_cid}_{datetime.now():%Y%m%d-%H%M%S-%f}"
    folder.mkdir(parents=True, exist_ok=True)
    files: list[tuple[str, str]] = []
    for upload, tag in zip(uploads, tags):
        name = re.sub(r"[^A-Za-z0-9_.\- ]+", "_", Path(upload.filename or "file.pdf").name)
        data = await upload.read()
        if not data.startswith(b"%PDF"):
            raise HTTPException(400, f"{upload.filename} is not a PDF file.")
        path = folder / name
        path.write_bytes(data)
        files.append((str(path.resolve()), tag))

    ingest = pipeline.module("ingest")
    try:
        pkg: Package = await run_in_threadpool(ingest.build_package, files, contract_id, title)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not read the package: {type(exc).__name__}: {exc}")
    pipeline._PACKAGES[pkg.package_id] = pkg
    return pkg.model_copy(update={"pages": []}).model_dump(mode="json")


@api.get("/packages/{package_id}")
def get_package(package_id: str) -> dict:
    pkg = _package(package_id)
    pages = [p.model_copy(update={"text": p.text[:300]}) for p in pkg.pages]
    return pkg.model_copy(update={"pages": pages}).model_dump(mode="json")


@api.get("/packages/{package_id}/page/{doc_id}/{page}.png")
def page_png(package_id: str, doc_id: str, page: int, highlight: Optional[str] = None):
    pkg = _package(package_id)
    doc = next((f for f in pkg.files if f.doc_id == doc_id), None)
    if doc is None or not 1 <= page <= doc.page_count:
        raise HTTPException(404, "No such page")
    png = pipeline.module("ingest").render_page_png(doc.path, page, highlight=highlight or None)
    headers = {} if highlight else {"Cache-Control": "max-age=3600"}
    return Response(content=png, media_type="image/png", headers=headers)


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


@api.post("/runs")
def start_run(body: RunRequest) -> dict:
    if not store.safe_id(body.package_id):
        raise HTTPException(404, "Unknown package")
    contract_id = _package_contract_id(body.package_id)
    meta = pipeline.start_run(body.package_id, contract_id, body.user_inputs)
    return _meta_json(meta)


@api.get("/runs")
def list_runs() -> list[dict]:
    metas = sorted(_all_metas(), key=lambda m: (m.started_at, m.run_id), reverse=True)
    return [_meta_json(m) for m in metas]


@api.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    return _meta_json(_meta(run_id))


@api.get("/runs/{run_id}/answers")
def get_answers(run_id: str) -> list[dict]:
    _meta(run_id)
    return store.load(run_id, "answers", []) or []


@api.patch("/runs/{run_id}/review/{question_id}")
def review_answer(run_id: str, question_id: str, body: ReviewRequest) -> dict:
    """Record a reviewer's decision, then recompute params, cash, flags and score."""
    _editable(run_id)
    envelopes = store.load_answers(run_id)
    env = next((e for e in envelopes if e.answer.question_id == question_id), None)
    if env is None:
        raise HTTPException(404, f"No question {question_id} in this run")

    review = env.review.model_copy()
    if body.decision == "edited":
        if not body.user_answer:
            raise HTTPException(422, "An edited answer needs user_answer.")
        merged = {**env.effective().model_dump(), **body.user_answer,
                  "contract_id": env.answer.contract_id, "clause_id": env.answer.clause_id,
                  "question_id": env.answer.question_id}
        try:
            review.user_answer = Answer.model_validate(merged)
        except ValidationError as exc:
            raise HTTPException(422, f"user_answer is not a valid answer: {exc.errors()}")
    else:
        review.user_answer = None
    review.decision = body.decision
    if body.note is not None:
        review.note = body.note
    review.decided_at = "" if body.decision == "pending" else pipeline.now()
    env.review = review

    store.save(run_id, "answers", envelopes)
    pipeline.recompute_after_review(run_id)
    return env.model_dump(mode="json")


@api.get("/runs/{run_id}/params")
def get_params(run_id: str) -> dict:
    _meta(run_id)
    data = store.load(run_id, "params")
    if data is None:
        raise HTTPException(404, "No cash-model inputs for this run yet")
    return data


@api.put("/runs/{run_id}/params")
def put_params(run_id: str, body: CashParams) -> dict:
    """Store the user-confirmed inputs; every field the user saw is marked confirmed."""
    _editable(run_id)
    stored = _load_model(run_id, "params", CashParams)
    params = pipeline.confirm_params(body, stored)
    store.save(run_id, "params", params)
    return params.model_dump(mode="json")


@api.post("/runs/{run_id}/cashflow")
def run_cashflow(run_id: str, body: CashflowRequest | None = None) -> dict:
    """Cash model on the stored params (+ optional what-if overrides), both views.

    Frozen runs compute the result but save nothing, so the demo sliders still work.
    """
    meta = _meta(run_id)
    params = _load_model(run_id, "params", CashParams)
    if params is None:
        raise HTTPException(404, "No cash-model inputs for this run yet")
    overrides = (body.overrides if body else None) or {}
    try:
        cash = pipeline.compute_cash(params.inputs, overrides)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, str(exc))
    result = {"as_written": store.dump(cash["as_written"]),
              "reference": store.dump(cash["reference"])}

    if not store.is_frozen(run_id) and not pipeline.is_active(run_id):
        store.save(run_id, "cashflow", {**result, "overrides": overrides})
        try:   # flags use the cash result for rupee impacts
            flags = pipeline.module("risk").flag_risks(
                store.load_answers(run_id), pipeline.run_package(meta),
                cash=pipeline.apply_overrides(params.inputs, overrides),
                cash_result=cash["as_written"])
            store.save(run_id, "flags", flags)
        except Exception:  # noqa: BLE001 - keep the old flags if the rules fail
            pass
    return result


@api.get("/runs/{run_id}/flags")
def get_flags(run_id: str) -> list[dict]:
    _meta(run_id)
    return store.load(run_id, "flags", []) or []


@api.get("/runs/{run_id}/score")
def get_score(run_id: str) -> dict:
    meta = _meta(run_id)
    data = store.load(run_id, "score")
    if meta.contract_id not in config.BENCHMARKS or data is None:
        raise HTTPException(404, "Only benchmark runs have a score")
    return data


@api.get("/evaluation")
def evaluation() -> dict:
    """One ScoreSummary over the latest finished run of each benchmark, plus which runs."""
    latest = _latest_done_runs()
    if not latest:
        raise HTTPException(404, "No finished benchmark runs yet")
    envelopes = {cid: store.load_answers(m.run_id) for cid, m in sorted(latest.items())}
    run_ids = {cid: m.run_id for cid, m in sorted(latest.items())}
    summary: ScoreSummary = pipeline.module("evaluate").score_run(
        envelopes, "+".join(run_ids.values()))
    missing = [cid for cid in config.BENCHMARKS if cid not in run_ids]
    return {**summary.model_dump(mode="json"), "runs_used": run_ids, "missing_benchmarks": missing}


# ---------------------------------------------------------------------------
# Exports (F14)
# ---------------------------------------------------------------------------


@api.get("/runs/{run_id}/export.csv")
def export_csv(run_id: str) -> Response:
    _meta(run_id)
    from analyser.report import answers_csv
    text = answers_csv(store.load_answers(run_id))
    return Response(content="﻿" + text, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{run_id}_answers.csv"'})


@api.get("/runs/{run_id}/report.pdf")
def export_pdf(run_id: str) -> Response:
    meta = _meta(run_id)
    from analyser.report import report_pdf
    try:
        package = pipeline.run_package(meta)
    except Exception:  # noqa: BLE001 - the report still works without the package
        package = None
    flags = [RiskFlag.model_validate(f) for f in store.load(run_id, "flags", []) or []]
    cash_raw = store.load(run_id, "cashflow") or {}
    cash = {k: CashResult.model_validate(v) for k, v in cash_raw.items()
            if k in ("as_written", "reference") and v}
    score = _load_model(run_id, "score", ScoreSummary)
    pdf = report_pdf(meta, package, store.load_answers(run_id), flags, cash or None, score)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{run_id}_report.pdf"'})


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------


def create_app(frontend_dist: Path | None = FRONTEND_DIST) -> FastAPI:
    """Build the app; serves the built website too when frontend_dist exists."""
    app = FastAPI(title="Tender and Contract Analyser API", version="1.0")
    app.add_middleware(CORSMiddleware, allow_origins=DEV_ORIGINS, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(api)

    if frontend_dist is not None and (frontend_dist / "index.html").exists():
        dist = frontend_dist.resolve()
        if (dist / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            """Real files from dist/, else index.html so React routes work on reload."""
            if full_path == "api" or full_path.startswith("api/"):
                return JSONResponse({"detail": "Not Found"}, status_code=404)
            target = (dist / full_path).resolve()
            if full_path and target.is_file() and dist in target.parents:
                return FileResponse(target)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
