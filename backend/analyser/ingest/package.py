"""F1 package intake: hash files, parse pages, store package.json and pages.json.

On disk:  runs/packages/<package_id>/package.json  (Package without pages)
          runs/packages/<package_id>/pages.json    (list of PageInfo)
          runs/packages/<package_id>/ingest_meta.json  (parser version, used for cache checks)
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from .. import config
from ..models import DocumentFile, Package, PageInfo
from .missing import find_missing_references
from .parse import parse_document

PACKAGES_DIR = config.RUNS_DIR / "packages"
# Bump when parsing or trigger rules change: cached benchmark packages are then rebuilt.
PARSER_VERSION = "m1a-2"


def sha256_file(path: str | Path) -> str:
    """Hex SHA-256 of a file, read in 1 MB blocks."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def package_dir(package_id: str) -> Path:
    return PACKAGES_DIR / package_id


def _safe_id(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or "package"


def build_package(files: list[tuple[str, str]], contract_id: str, title: str = "",
                  package_id: str | None = None) -> Package:
    """Hash, parse and store a package. files = [(absolute_pdf_path, DocTag)]."""
    docs: list[DocumentFile] = []
    pages: list[PageInfo] = []
    for i, (path, tag) in enumerate(files, start=1):
        doc_id = f"d{i}"
        doc_pages = parse_document(str(path), doc_id)
        docs.append(DocumentFile(doc_id=doc_id, filename=Path(path).name, path=str(Path(path).resolve()),
                                 tag=tag, sha256=sha256_file(path), page_count=len(doc_pages)))
        pages.extend(doc_pages)
    if package_id is None:
        combined = hashlib.sha256("".join(d.sha256 for d in docs).encode()).hexdigest()[:10]
        package_id = f"{_safe_id(contract_id)}_{combined}"
    pkg = Package(package_id=package_id, contract_id=contract_id, title=title, files=docs,
                  pages=pages, missing_references=find_missing_references(docs, pages),
                  created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    save_package(pkg)
    return pkg


def _write_atomic(path: Path, text: str) -> None:
    """Write to a temp file then rename, so a reader never sees a half-written file."""
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def save_package(pkg: Package) -> None:
    """Write package.json (without pages), pages.json and ingest_meta.json."""
    d = package_dir(pkg.package_id)
    d.mkdir(parents=True, exist_ok=True)
    head = pkg.model_dump(exclude={"pages"})
    head["pages"] = []
    _write_atomic(d / "pages.json", json.dumps([p.model_dump() for p in pkg.pages], ensure_ascii=False))
    _write_atomic(d / "package.json", json.dumps(head, indent=1, ensure_ascii=False))
    _write_atomic(d / "ingest_meta.json", json.dumps({"parser_version": PARSER_VERSION}))


def load_package(package_id: str) -> Package:
    """Read a stored package back, with pages filled."""
    d = package_dir(package_id)
    pkg = Package.model_validate_json((d / "package.json").read_text(encoding="utf-8"))
    raw = json.loads((d / "pages.json").read_text(encoding="utf-8"))
    pkg.pages = [PageInfo.model_validate(p) for p in raw]
    return pkg


def _cached(package_id: str, files: list[tuple[Path, str]]) -> Package | None:
    """Stored package if it exists, was built by this parser version and from the same files and tags."""
    d = package_dir(package_id)
    try:
        meta = json.loads((d / "ingest_meta.json").read_text(encoding="utf-8"))
        if meta.get("parser_version") != PARSER_VERSION:
            return None
        pkg = load_package(package_id)
    except (OSError, ValueError):
        return None
    if [(f.filename, f.tag) for f in pkg.files] != [(p.name, tag) for p, tag in files]:
        return None
    return pkg


def benchmark_package(contract_id: str) -> Package:
    """Build or load benchmark BM1..BM4 (package_id == contract_id)."""
    spec = config.BENCHMARKS[contract_id]
    files = [(config.BENCHMARK_DIR / name, tag) for name, tag in spec["files"]]
    pkg = _cached(contract_id, files)
    if pkg is not None:
        return pkg
    return build_package([(str(p), tag) for p, tag in files],
                         contract_id=contract_id, title=spec["title"], package_id=contract_id)


def dev_package(filename: str, tag: str = "gcc") -> Package:
    """Build or load a single development document (package_id 'DEV_<stem>').

    Looks in Dev Documents/ first, then Benchmark Contracts/ (for Reference_CPWD_GCC_2023.pdf).
    Benchmark test PDFs (BM1..BM4) are refused: they are the test set.
    """
    if filename in config.TEST_PDF_NAMES:
        raise ValueError(f"{filename} is a benchmark test document; use benchmark_package()")
    for folder in (config.DEV_DOCS_DIR, config.BENCHMARK_DIR):
        path = folder / filename
        if path.exists():
            break
    else:
        raise FileNotFoundError(filename)
    stem = Path(filename).stem
    package_id = stem if stem.startswith("DEV_") else f"DEV_{stem}"
    pkg = _cached(package_id, [(path, tag)])
    if pkg is not None:
        return pkg
    return build_package([(str(path), tag)], contract_id=package_id, title=stem, package_id=package_id)
