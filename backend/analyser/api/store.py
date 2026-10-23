"""Run folders on disk: one folder per run, plain JSON files, no database.

Layout (spec WEBSITE_BUILD_PLAN D4, INTERFACES.md):
    runs/<run_id>/meta.json, answers.json, params.json, flags.json, cashflow.json,
                  score.json, user_inputs.json, package.json (package without pages)
    runs/frozen/<run_id>/...   read-only copies kept for the offline demo

Every read and write goes through one lock, because the background run thread
writes meta.json while the web server reads it (on Windows a file being
replaced while open raises PermissionError).
"""
from __future__ import annotations

import json
import re
import shutil
import threading
from pathlib import Path
from typing import Any

from analyser import config
from analyser.models import AnswerEnvelope, RunMeta

_LOCK = threading.RLock()
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]*$")

# Folders under runs/ that are not runs.
_NOT_RUNS = {"_uploads", "packages", "frozen"}


def safe_id(value: str) -> bool:
    """True if value can be used as a folder name (blocks '../' tricks)."""
    return bool(_SAFE_ID.match(value)) and ".." not in value


def runs_dir() -> Path:
    return Path(config.RUNS_DIR)


def frozen_dir() -> Path:
    return runs_dir() / "frozen"


def run_dir(run_id: str) -> Path:
    """Folder of a run: a live run first, else a frozen one. Raises KeyError if unknown."""
    if not safe_id(run_id) or run_id in _NOT_RUNS:
        raise KeyError(run_id)
    for base in (runs_dir(), frozen_dir()):
        d = base / run_id
        if d.is_dir():
            return d
    raise KeyError(run_id)


def is_frozen(run_id: str) -> bool:
    try:
        return run_dir(run_id).parent == frozen_dir()
    except KeyError:
        return False


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------


def write_json(path: Path, data: Any) -> None:
    """Write JSON atomically (temp file then rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, indent=2, ensure_ascii=False, default=str)
    with _LOCK:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)


def read_json(path: Path, default: Any = None) -> Any:
    with _LOCK:
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))


def dump(model: Any) -> Any:
    """pydantic model (or list of them) -> plain JSON data."""
    if isinstance(model, list):
        return [dump(m) for m in model]
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    return model


# ---------------------------------------------------------------------------
# Run files
# ---------------------------------------------------------------------------


def new_run_dir(run_id: str) -> Path:
    d = runs_dir() / run_id
    d.mkdir(parents=True, exist_ok=False)
    return d


def save(run_id: str, name: str, data: Any) -> None:
    """Save runs/<run_id>/<name>.json from a model, list of models or dict."""
    write_json(run_dir(run_id) / f"{name}.json", dump(data))


def load(run_id: str, name: str, default: Any = None) -> Any:
    return read_json(run_dir(run_id) / f"{name}.json", default)


def load_meta(run_id: str) -> RunMeta:
    data = load(run_id, "meta")
    if data is None:
        raise KeyError(run_id)
    return RunMeta.model_validate(data)


def save_meta(meta: RunMeta) -> None:
    save(meta.run_id, "meta", meta)


def load_answers(run_id: str) -> list[AnswerEnvelope]:
    return [AnswerEnvelope.model_validate(e) for e in load(run_id, "answers", [])]


def list_run_ids() -> list[tuple[str, bool]]:
    """All (run_id, frozen) pairs found on disk. Live runs hide frozen runs with the same id."""
    found: dict[str, bool] = {}
    for base, frozen in ((frozen_dir(), True), (runs_dir(), False)):
        if not base.exists():
            continue
        for d in base.iterdir():
            if d.is_dir() and d.name not in _NOT_RUNS and (d / "meta.json").exists():
                found[d.name] = frozen
    return sorted(found.items())


def freeze_run(run_id: str) -> Path:
    """Copy a finished run into runs/frozen/ so the demo works offline and it cannot change."""
    src = runs_dir() / run_id
    dst = frozen_dir() / run_id
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return dst


if __name__ == "__main__":   # python -m analyser.api.store freeze <run_id>
    import sys

    if len(sys.argv) == 3 and sys.argv[1] == "freeze":
        print("Frozen copy at", freeze_run(sys.argv[2]))
    else:
        print("usage: python -m analyser.api.store freeze <run_id>")
