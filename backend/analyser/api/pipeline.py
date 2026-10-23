"""The analysis run: a background job that calls the other modules in order.

    ingest -> extract -> verify -> params -> cashflow -> flags -> score -> done

One worker thread runs the jobs one after another, so two runs never compete
for the model's rate limit. After every stage the result is written into
runs/<run_id>/ and meta.json is updated, so the website can poll progress and a
half-finished run still leaves its files behind.

Stages ingest, extract and verify are essential: if one fails the run stops
with a plain-words error in meta.error. Later stages (params, cash flow, flags,
score) are "soft": a failure is written to the log and the run carries on, so
the clause table is never lost because, say, the cash model rejected an input.

Other modules are imported lazily through module(), so this file loads even
while those modules are still being written, and tests can swap in fakes.
"""
from __future__ import annotations

import importlib
import os
import re
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Callable

from analyser import config
from analyser.api import store
from analyser.models import (AnswerEnvelope, CashInputs, CashParams, Package,
                             ParamProvenance, RunMeta)

_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="analyser-run")
_ACTIVE: set[str] = set()            # run ids queued or running in this process
_FUTURES: dict[str, Any] = {}
_LOCK = threading.Lock()
_PACKAGES: dict[str, Package] = {}   # packages never change once built, so cache them
MAX_LOG_LINES = 500


def module(name: str):
    """Import analyser.<name> when needed (looked up in sys.modules first, so tests can fake it)."""
    return importlib.import_module(f"analyser.{name}")


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Packages
# ---------------------------------------------------------------------------


def get_package(package_id: str) -> Package:
    """Load a package (benchmarks are built on first use). Raises if unknown."""
    if package_id not in _PACKAGES:
        ingest = module("ingest")
        if package_id in config.BENCHMARKS:
            pkg = ingest.benchmark_package(package_id)
        else:
            pkg = ingest.load_package(package_id)
        _PACKAGES[package_id] = pkg
    return _PACKAGES[package_id]


def run_package(meta: RunMeta) -> Package:
    """The package of a run; falls back to the copy saved in the run folder (frozen runs)."""
    try:
        return get_package(meta.package_id)
    except Exception:
        data = store.load(meta.run_id, "package")
        if data is None:
            raise
        return Package.model_validate(data)


def clear_caches() -> None:
    _PACKAGES.clear()


# ---------------------------------------------------------------------------
# Starting and watching runs
# ---------------------------------------------------------------------------


def make_run_id(contract_id: str) -> str:
    """<contract_id>_<YYYYMMDD-HHMMSS>, made safe for a folder name."""
    cid = re.sub(r"[^A-Za-z0-9_\-]+", "-", contract_id).strip("-") or "contract"
    return f"{cid}_{datetime.now().strftime('%Y%m%d-%H%M%S')}"


def start_run(package_id: str, contract_id: str, user_inputs: dict) -> RunMeta:
    """Create the run folder, save meta.json and queue the job. Returns at once."""
    with _LOCK:
        base = make_run_id(contract_id)
        run_id, n = base, 1
        while (store.runs_dir() / run_id).exists():
            n += 1
            run_id = f"{base}-{n}"
        store.new_run_dir(run_id)
        _ACTIVE.add(run_id)
    meta = RunMeta(run_id=run_id, package_id=package_id, contract_id=contract_id,
                   prompt_version=config.PROMPT_VERSION, model=config.MODEL,
                   effort=config.EFFORT, started_at=now(), stage="queued",
                   log=[f"{now()} Queued"])
    store.save_meta(meta)
    store.save(run_id, "user_inputs", user_inputs)
    _FUTURES[run_id] = _EXECUTOR.submit(_run_job, meta, user_inputs)
    return meta


REPLAY_MODEL = "answer-key replay (no LLM)"   # set by scripts/make_replay_runs.py


def is_replay(meta: RunMeta) -> bool:
    """Answer-key replay runs hold the golden answers, not AI output."""
    return meta.model == REPLAY_MODEL or "_replay-" in meta.run_id


def is_active(run_id: str) -> bool:
    return run_id in _ACTIVE


def wait_for(run_id: str, timeout: float = 60) -> None:
    """Block until a run finishes (used by tests and scripts)."""
    fut = _FUTURES.get(run_id)
    if fut is not None:
        fut.result(timeout=timeout)


def get_meta(run_id: str) -> RunMeta:
    """Read meta.json. A run left half-done by a server restart is marked as an error."""
    meta = store.load_meta(run_id)
    if (meta.stage not in ("done", "error") and not is_active(run_id)
            and not store.is_frozen(run_id)):
        meta.stage = "error"
        meta.error = "The server stopped while this run was in progress. Start the run again."
        store.save_meta(meta)
    return meta


# ---------------------------------------------------------------------------
# The job
# ---------------------------------------------------------------------------


class _Progress:
    """Keeps RunMeta up to date on disk while the job runs."""

    def __init__(self, meta: RunMeta):
        self.meta = meta
        self.llm = None

    def log(self, message: str) -> None:
        self.meta.log.append(f"{now()} {message}")
        self.meta.log = self.meta.log[-MAX_LOG_LINES:]
        self.save()

    def stage(self, name: str, progress: float, message: str = "") -> None:
        self.meta.stage = name
        self.meta.progress = round(progress, 3)
        self.log(message or f"Stage: {name}")

    def extract_progress(self, stage: str, fraction: float, message: str) -> None:
        """on_progress callback for extract_package; extraction is 10%..70% of the bar."""
        fraction = min(max(float(fraction or 0), 0.0), 1.0)
        self.meta.stage = stage or "extract"
        self.meta.progress = round(0.10 + 0.60 * fraction, 3)
        if message:
            self.log(message)
        else:
            self.save()

    def save(self) -> None:
        if self.llm is not None:
            copy_llm_stats(self.meta, self.llm)
        store.save_meta(self.meta)


def copy_llm_stats(meta: RunMeta, llm: Any) -> None:
    stats = getattr(llm, "stats", None) or {}
    meta.llm_calls = int(stats.get("calls", 0))
    meta.cache_hits = int(stats.get("cache_hits", 0))
    meta.input_tokens = int(stats.get("input_tokens", 0))
    meta.output_tokens = int(stats.get("output_tokens", 0))


def _run_job(meta: RunMeta, user_inputs: dict) -> None:
    p = _Progress(meta)
    run_id = meta.run_id
    current = "ingest"
    try:
        # 1. ingest (F1-F3): build or load the package, report missing documents
        p.stage("ingest", 0.02, "Reading the document package")
        package = get_package(meta.package_id)
        store.save(run_id, "package", package.model_copy(update={"pages": []}))
        p.log(f"Package: {len(package.files)} file(s), {len(package.pages)} pages, "
              f"{len(package.missing_references)} referenced document(s) missing")

        # 2. extract (F5-F8), with live progress
        current = "extract"
        llm = module("llm").LLMClient()
        p.llm = llm
        meta.model = str(getattr(llm, "model", config.MODEL))
        meta.effort = str(getattr(llm, "effort", config.EFFORT))
        p.stage("extract", 0.10, f"Extracting answers with {meta.model} (effort {meta.effort})")
        envelopes = module("extract").extract_package(package, llm,
                                                      on_progress=p.extract_progress)
        store.save(run_id, "answers", envelopes)
        p.log(f"Extracted {len(envelopes)} answers")

        # 3. verify (F9-F11): fills .verification and the review queue
        current = "verify"
        p.stage("verify", 0.70, "Checking every quote against the PDF text")
        v9 = llm if os.getenv("ANALYSER_V9", "0") == "1" else None
        envelopes = module("verify").verify_answers(envelopes, package, v9)
        store.save(run_id, "answers", envelopes)
        pending = sum(1 for e in envelopes if e.review.decision == "pending")
        p.log(f"Verified; {pending} answer(s) wait in the review queue")

        # 4-7. params, cash flow, flags, score (soft stages)
        current = "params"
        p.stage("params", 0.80, "Mapping answers to cash-model inputs")
        params = _soft(p, "params", lambda: build_params(envelopes, user_inputs, llm, p.log))
        if params is not None:
            store.save(run_id, "params", params)
        refresh_downstream(run_id, meta.contract_id, envelopes, package, params, {},
                           log=p.log, on_stage=p.stage)

        p.save()
        meta.finished_at = now()
        p.stage("done", 1.0, "Run finished")
    except Exception as exc:  # noqa: BLE001 - every failure must reach the user
        meta.stage = "error"
        meta.error = friendly_error(exc, current) + f" (details in runs/{run_id}/error.txt)"
        meta.finished_at = now()
        (store.runs_dir() / run_id / "error.txt").write_text(traceback.format_exc(),
                                                             encoding="utf-8")
        p.log(f"ERROR in {current}: {type(exc).__name__}: {exc}")
    finally:
        _ACTIVE.discard(run_id)


def _soft(p_or_log: Any, what: str, fn: Callable[[], Any]) -> Any:
    """Run fn; on failure write a warning to the log and return None."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        log = p_or_log.log if hasattr(p_or_log, "log") else p_or_log
        log(f"WARNING: {what} skipped: {type(exc).__name__}: {exc}")
        return None


# ---------------------------------------------------------------------------
# Cash flow, flags and score (used by the job, the review screen and the cash view)
# ---------------------------------------------------------------------------


# Project inputs the website's "New analysis" form sends (spec §2 B).
USER_INPUT_KEYS = {"contract_value", "duration_months", "progress_curve", "progress",
                   "cost_share", "overdraft_rate_pa", "bank_rate_pa", "bg_commission_pa",
                   "delay_days", "index_rise_pa", "supplier_credit_days"}


def clean_user_inputs(raw: dict | None) -> tuple[dict, str, list[str]]:
    """Form values -> (inputs for the params mapping, progress curve choice, ignored keys).

    Empty fields (None) are dropped so the mapping falls back to extracted or default
    values; 'progress_curve' is not a cash input, it is handled by build_params.
    """
    raw = dict(raw or {})
    curve = raw.pop("progress_curve", None) or "even"
    ignored = sorted(k for k in raw if k not in USER_INPUT_KEYS)
    clean: dict = {}
    for key, value in raw.items():
        if key in ignored or value is None:
            continue
        if key == "index_rise_pa" and isinstance(value, dict):
            value = {name: float(r) for name, r in value.items() if r is not None}
        if key in ("index_rise_pa", "progress") and not value:
            continue
        if key == "duration_months":
            value = max(1, round(float(value)))
        clean[key] = value
    return clean, curve, ignored


def build_params(envelopes: list[AnswerEnvelope], raw_user_inputs: dict | None, llm,
                 log: Callable[[str], None]) -> CashParams:
    """Params mapping (M1) on the cleaned form inputs, plus the S-curve choice.

    The S-curve needs the duration, which may come from the user or from the contract,
    so it is filled in only after the mapping has settled duration_months.
    """
    clean, curve, ignored = clean_user_inputs(raw_user_inputs)
    if ignored:
        log(f"Ignored unknown user input(s): {', '.join(ignored)}")
    if curve not in ("even", "s_curve"):
        log(f"Unknown progress_curve '{curve}'; using even progress")
    params: CashParams = module("params").map_to_cash_params(envelopes, clean, llm)
    if curve == "s_curve" and params.inputs.progress is None:
        months = params.inputs.duration_months
        curve_values = module("cashflow").s_curve(months)
        params = CashParams(
            inputs=params.inputs.model_copy(update={"progress": curve_values}),
            provenance=[p for p in params.provenance if p.field != "progress"]
            + [ParamProvenance(field="progress", source="user",
                               quote=f"S-curve over {months} months chosen by the user")])
    return params


def apply_overrides(inputs: CashInputs, overrides: dict | None) -> CashInputs:
    """Copy of inputs with some fields replaced (e.g. delay_days from a slider)."""
    if not overrides:
        return inputs
    unknown = set(overrides) - set(CashInputs.model_fields)
    if unknown:
        raise ValueError(f"Unknown cash input(s): {', '.join(sorted(unknown))}")
    return CashInputs.model_validate({**inputs.model_dump(), **overrides})


def compute_cash(inputs: CashInputs, overrides: dict | None = None) -> dict:
    """Both views of the cash model: as written and at reference values (spec §8.2 step 11)."""
    cf = module("cashflow")
    used = apply_overrides(inputs, overrides)
    return {"as_written": cf.run_cashflow(used),
            "reference": cf.run_cashflow(cf.reference_view(used)),
            "overrides": overrides or {}}


def score_benchmark(contract_id: str, envelopes: list[AnswerEnvelope], run_id: str):
    """ScoreSummary for a benchmark contract, else None (uploaded contracts have no key)."""
    if contract_id not in config.BENCHMARKS:
        return None
    return module("evaluate").score_run({contract_id: envelopes}, run_id)


def refresh_downstream(run_id: str, contract_id: str, envelopes: list[AnswerEnvelope],
                       package: Package, params: CashParams | None, overrides: dict,
                       log: Callable[[str], None],
                       on_stage: Callable[[str, float, str], None] | None = None) -> None:
    """Recompute and save cashflow.json, flags.json and score.json. Failures only log."""
    stage = on_stage or (lambda *a: None)

    cash = None
    if params is not None:
        stage("cashflow", 0.86, "Running the cash-flow model (as written and at reference values)")
        cash = _soft(log, "cash flow", lambda: compute_cash(params.inputs, overrides))
        if cash is not None:
            store.save(run_id, "cashflow", {k: store.dump(v) for k, v in cash.items()})

    stage("flags", 0.92, "Applying the risk rules")
    flags = _soft(log, "risk flags", lambda: module("risk").flag_risks(
        envelopes, package,
        cash=params.inputs if params is not None else None,
        cash_result=cash["as_written"] if cash else None))
    if flags is not None:
        store.save(run_id, "flags", flags)

    if contract_id in config.BENCHMARKS:
        stage("score", 0.96, "Scoring against the answer key")
        score = _soft(log, "score", lambda: score_benchmark(contract_id, envelopes, run_id))
        if score is not None:
            store.save(run_id, "score", score)


def keep_confirmed(new: CashParams, old: CashParams | None) -> CashParams:
    """Fresh params, but every field the user already confirmed keeps the user's value."""
    if old is None:
        return new
    data = new.inputs.model_dump()
    prov = {p.field: p for p in new.provenance}
    for p in old.provenance:
        if p.confirmed and p.field in CashInputs.model_fields:
            data[p.field] = getattr(old.inputs, p.field)
            prov[p.field] = p
    return CashParams(inputs=CashInputs.model_validate(data), provenance=list(prov.values()))


def confirm_params(submitted: CashParams, stored: CashParams | None) -> CashParams:
    """Store what the user confirmed: every field is marked confirmed.

    The submitted provenance is authoritative (the UI adds or changes items for fields
    the user edited). Fields it leaves out keep their stored provenance, or get source
    'user' if their value changed, else 'default'.
    """
    old_inputs = stored.inputs.model_dump() if stored else {}
    new_inputs = submitted.inputs.model_dump()
    sent = {p.field: p for p in submitted.provenance}
    old_prov = {p.field: p for p in stored.provenance} if stored else {}
    out: list[ParamProvenance] = []
    for field in CashInputs.model_fields:
        if field in sent:
            p = sent[field]
        elif field in old_inputs and old_inputs[field] != new_inputs[field]:
            p = ParamProvenance(field=field, source="user")
        else:
            p = old_prov.get(field) or ParamProvenance(field=field, source="default")
        out.append(p.model_copy(update={"confirmed": True}))
    return CashParams(inputs=submitted.inputs, provenance=out)


def _try_llm():
    try:
        return module("llm").LLMClient()
    except Exception:  # noqa: BLE001 - offline: map params by code only
        return None


def recompute_after_review(run_id: str) -> None:
    """After a review decision: params (keeping confirmed values), cash, flags and score."""
    meta = store.load_meta(run_id)
    log_lines: list[str] = []
    envelopes = store.load_answers(run_id)
    package = run_package(meta)
    user_inputs = store.load(run_id, "user_inputs", {}) or {}
    old_raw = store.load(run_id, "params")
    old = CashParams.model_validate(old_raw) if old_raw else None

    # The LLM call is cached, so unchanged answers cost nothing; without a client, code only.
    llm = _try_llm()
    new = _soft(log_lines.append, "params (with model)",
                lambda: build_params(envelopes, user_inputs, llm, log_lines.append))
    if new is None and llm is not None:
        new = _soft(log_lines.append, "params (code only)",
                    lambda: build_params(envelopes, user_inputs, None, log_lines.append))
    params = keep_confirmed(new, old) if new is not None else old
    if params is not None:
        store.save(run_id, "params", params)

    overrides = (store.load(run_id, "cashflow", {}) or {}).get("overrides", {})
    refresh_downstream(run_id, meta.contract_id, envelopes, package, params, overrides,
                       log=log_lines.append)
    meta = store.load_meta(run_id)
    meta.log += [f"{now()} {line}" for line in ["Recomputed after review"] + log_lines]
    meta.log = meta.log[-MAX_LOG_LINES:]
    store.save_meta(meta)


# ---------------------------------------------------------------------------
# Errors in plain words
# ---------------------------------------------------------------------------


def friendly_error(exc: BaseException, stage: str) -> str:
    name = type(exc).__name__.lower()
    text = f"{type(exc).__name__}: {exc}"
    low = text.lower()
    if ("anthropic_api_key" in low or "api_key" in low or "api key" in low
            or "authentication" in name or "x-api-key" in low):
        return "Add ANTHROPIC_API_KEY to backend/.env and restart the server"
    if "ratelimit" in name or "rate limit" in low or "rate_limit" in low:
        return ("The model's rate limit was reached. Wait a minute and start the run again; "
                "finished calls are cached and are not repeated")
    if "credit balance" in low:
        return "The API account has no credit left. Add credit or use a frozen run for the demo"
    if isinstance(exc, FileNotFoundError) and "claude" in low:
        return ("The 'claude' command was not found. Install Claude Code and log in, "
                "or add ANTHROPIC_API_KEY to backend/.env and restart the server")
    if "connection" in name or "timeout" in name or "connection" in low:
        return ("Could not reach the model. Check the internet connection, "
                "or open a frozen run for the offline demo")
    if any(c.__name__ == "LLMError" for c in type(exc).__mro__):
        return str(exc)        # the LLM module writes these messages for users
    return f"The run stopped during '{stage}': {text}"
