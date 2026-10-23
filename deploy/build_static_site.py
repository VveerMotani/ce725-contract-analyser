"""Build a fully static, read-only copy of the website (for Cloudflare Pages; no Python server).

    python deploy/build_static_site.py            # from the project root; writes deploy/static-site/
    python deploy/build_static_site.py --no-pages # skip the page images (quick JSON-only rebuild)

The copy shows only the four frozen Claude-read runs (runs/frozen/BM*_agent-*), the same
selection as deploy/build_hf_space.py. Every saved response is produced by the real FastAPI
app through TestClient (ANALYSER_READ_ONLY=1, RUNS_DIR pointing at a temporary folder that
holds only those runs), so the files equal what the server returns:

    /                          the website, built with VITE_STATIC=1
    /static-api/<path>.json    every GET the site can ask for (benchmarks, runs, run, answers,
                               params, flags, checks, score, evaluation, packages)
    /static-api/runs/<id>/export.csv, report.pdf
    /static-api/runs/<id>/cashflow/<key>.json   POST /cashflow precomputed on the grid
    /static-pages/<pkg>/<doc>/<page>.png        every page of the four PDFs
    /static-pages/<pkg>/<doc>/<page>-<hash>.png pages with a quote highlighted
    /static-api/pages.json     which highlighted images exist

The grid and the file keys are defined once in frontend/src/staticGrid.json, which the site
reads too. See deploy/STATIC_SITE.md.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deploy" / "static-site"
FRONTEND = ROOT / "frontend"
GRID = json.loads((FRONTEND / "src" / "staticGrid.json").read_text(encoding="utf-8"))

MAX_FILES = 20_000            # Cloudflare Pages limit per deployment
MAX_FILE_BYTES = 25 * 2**20   # Cloudflare Pages limit per file


# ---------------------------------------------------------------------------
# Keys (same scheme as frontend/src/staticSite.ts)
# ---------------------------------------------------------------------------


def grid_values(g: dict) -> list[float]:
    n = round((g["max"] - g["min"]) / g["step"])
    return [round(g["min"] + i * g["step"], 3) for i in range(n + 1)]


def num_text(x: float) -> str:
    """Number as JavaScript prints it for these grid values: 5 -> '5', 7.5 -> '7.5'."""
    return str(int(x)) if float(x).is_integer() else repr(float(x))


def cashflow_requests() -> list[tuple[str, dict]]:
    """(key, overrides) for every precomputed POST /runs/{id}/cashflow."""
    out: list[tuple[str, dict]] = [("base", {})]
    for d in grid_values(GRID["delay_days"]):
        out.append((f"delay-{num_text(d)}", {"delay_days": int(d)}))
    for p in grid_values(GRID["rise_pct"]):
        x = p / 100   # the site sends rise / 100
        out.append((f"rise-{num_text(p)}", {"index_rise_pa": {k: x for k in GRID["rise_pct"]["indices"]}}))
    return out


def js_slice(s: str, n: int) -> str:
    """s.slice(0, n) as JavaScript does it (UTF-16 code units); a cut surrogate pair becomes U+FFFD,
    which is what TextEncoder writes for a lone surrogate."""
    units = s.encode("utf-16-le")[: 2 * n]
    cut = units.decode("utf-16-le", errors="surrogatepass")
    return "".join("�" if 0xD800 <= ord(c) <= 0xDFFF else c for c in cut)


def text_key(s: str) -> str:
    """FNV-1a 32-bit hash of the UTF-8 bytes, 8 lowercase hex characters."""
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def highlight_key(quote: str) -> str:
    return text_key(js_slice(quote, GRID["highlight_max_chars"]))


# ---------------------------------------------------------------------------
# Website
# ---------------------------------------------------------------------------


def build_website(saved_on: str) -> None:
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        sys.exit("npm not found; install Node 20+")
    env = {**os.environ, "VITE_STATIC": "1", "VITE_STATIC_SAVED": saved_on}
    # Arguments after -- go to `vite build`, so frontend/dist (served by the backend) is untouched.
    subprocess.run([npm, "run", "build", "--", "--outDir", str(OUT), "--emptyOutDir"],
                   cwd=FRONTEND, env=env, check=True)


# ---------------------------------------------------------------------------
# Saved API responses
# ---------------------------------------------------------------------------


def frozen_runs() -> list[Path]:
    return sorted((ROOT / "runs" / "frozen").glob("BM*_agent-*"))


def make_client(tmp: Path):
    """The real app on a RUNS_DIR that holds only the four frozen Claude-read runs."""
    os.environ["ANALYSER_READ_ONLY"] = "1"
    sys.path.insert(0, str(ROOT / "backend"))
    from analyser import config
    config.READ_ONLY = True
    config.RUNS_DIR = tmp
    config.UPLOADS_DIR = tmp / "_uploads"
    (tmp / "frozen").mkdir(parents=True)
    for run in frozen_runs():
        shutil.copytree(run, tmp / "frozen" / run.name)
    # Reuse parsed benchmark packages if present (checked against the parser version on load).
    cache = ROOT / "runs" / "packages"
    for cid in config.BENCHMARKS:
        if (cache / cid).is_dir():
            shutil.copytree(cache / cid, tmp / "packages" / cid)
    from analyser.ingest import package as ingest_package
    ingest_package.PACKAGES_DIR = tmp / "packages"
    from fastapi.testclient import TestClient
    from analyser.api.app import create_app
    return TestClient(create_app(frontend_dist=None))


class Writer:
    def __init__(self, root: Path):
        self.root = root

    def write(self, rel: str, data: bytes) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def save_get(client, w: Writer, path: str, rel: str | None = None, required: bool = True) -> bytes | None:
    r = client.get(f"/api{path}")
    if r.status_code != 200:
        if required:
            raise RuntimeError(f"GET {path}: {r.status_code} {r.text[:200]}")
        print(f"  skipped GET {path}: {r.status_code}")
        return None
    w.write(rel or f"static-api{path}.json", r.content)
    return r.content


def save_api(client, w: Writer) -> dict:
    """All GET responses, exports and precomputed cash flows. Returns what the page step needs."""
    save_get(client, w, "/benchmarks")
    runs = json.loads(save_get(client, w, "/runs"))
    save_get(client, w, "/evaluation")
    info: dict = {"runs": {}, "packages": set()}
    for meta in runs:
        rid = meta["run_id"]
        save_get(client, w, f"/runs/{rid}")
        answers = json.loads(save_get(client, w, f"/runs/{rid}/answers"))
        params = save_get(client, w, f"/runs/{rid}/params", required=False)
        flags = json.loads(save_get(client, w, f"/runs/{rid}/flags"))
        save_get(client, w, f"/runs/{rid}/checks")
        save_get(client, w, f"/runs/{rid}/score", required=False)
        save_get(client, w, f"/runs/{rid}/export.csv", f"static-api/runs/{rid}/export.csv")
        save_get(client, w, f"/runs/{rid}/report.pdf", f"static-api/runs/{rid}/report.pdf")
        if params is not None:
            for key, overrides in cashflow_requests():
                r = client.post(f"/api/runs/{rid}/cashflow", json={"overrides": overrides})
                if r.status_code != 200:
                    raise RuntimeError(f"POST cashflow {rid} {key}: {r.status_code} {r.text[:200]}")
                w.write(f"static-api/runs/{rid}/cashflow/{key}.json", r.content)
        info["runs"][rid] = {"package_id": meta["package_id"], "answers": answers, "flags": flags}
        info["packages"].add(meta["package_id"])
    for pkg in sorted(info["packages"]):
        info.setdefault("package_data", {})[pkg] = json.loads(save_get(client, w, f"/packages/{pkg}"))
    return info


# ---------------------------------------------------------------------------
# Page images
# ---------------------------------------------------------------------------


def highlights_by_page(info: dict) -> dict[tuple[str, str, int], set[str]]:
    """Every (package, doc, page) -> quotes the site can highlight there (same doc rules as the site)."""
    out: dict[tuple[str, str, int], set[str]] = {}

    def add(pkg: str, doc: str, page: int, quote: str) -> None:
        if page and page > 0 and quote:
            out.setdefault((pkg, doc or "d1", int(page)), set()).add(quote)

    for run in info["runs"].values():
        pkg = run["package_id"]
        by_qid = {e["answer"]["question_id"]: e for e in run["answers"]}
        for e in run["answers"]:
            # context.tsx openAnswer: the corrected answer if edited, else the AI answer
            doc = e.get("doc_id") or (e.get("verification") or {}).get("found_doc_id") or "d1"
            for a in (e["answer"], (e.get("review") or {}).get("user_answer")):
                if a:
                    add(pkg, doc, a.get("pdf_page", 0), a.get("verbatim_quote", ""))
        for f in run["flags"]:   # Flags.tsx: doc of the flag's first question
            env = by_qid.get((f.get("question_ids") or [""])[0])
            add(pkg, (env or {}).get("doc_id") or "d1", f.get("pdf_page", 0), f.get("quote", ""))
    for pkg, data in info.get("package_data", {}).items():   # Technical / Key facts: missing documents
        for m in data.get("missing_references", []):
            add(pkg, m.get("doc_id"), m.get("page", 0), m.get("quote", ""))
    return out


def shrink_png(png: bytes) -> bytes:
    """Same image with a small palette (text pages compress 2-3x); the size is unchanged."""
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert("RGB")
    q = im.quantize(colors=GRID["page_colors"], method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    buf = io.BytesIO()
    q.save(buf, "PNG", optimize=True)
    return buf.getvalue() if len(buf.getvalue()) < len(png) else png


def save_pages(info: dict, w: Writer) -> None:
    from analyser.api import pipeline
    from analyser.ingest import render_page_png
    zoom = GRID["page_zoom"]
    wanted = highlights_by_page(info)
    index: dict[str, list[str]] = {}
    n_plain = n_hl = n_same = n_missing = 0
    for pkg in sorted(info["packages"]):
        package = pipeline.get_package(pkg)
        for doc in package.files:
            for page in range(1, doc.page_count + 1):
                plain = render_page_png(doc.path, page, zoom=zoom)
                w.write(f"static-pages/{pkg}/{doc.doc_id}/{page}.png", shrink_png(plain))
                n_plain += 1
                for quote in sorted(wanted.pop((pkg, doc.doc_id, page), ())):
                    cut = js_slice(quote, GRID["highlight_max_chars"])
                    png = render_page_png(doc.path, page, zoom=zoom, highlight=cut)
                    if png == plain:      # quote not located on the page: the plain image is the same
                        n_same += 1
                        continue
                    key = text_key(cut)
                    w.write(f"static-pages/{pkg}/{doc.doc_id}/{page}-{key}.png", shrink_png(png))
                    index.setdefault(f"{pkg}/{doc.doc_id}/{page}", []).append(key)
                    n_hl += 1
    for (pkg, doc, page), quotes in wanted.items():   # cited page outside the document
        n_missing += len(quotes)
        print(f"  no such page: {pkg}/{doc}/{page}")
    w.write("static-api/pages.json", json.dumps(index, sort_keys=True).encode("utf-8"))
    print(f"  pages: {n_plain} plain, {n_hl} highlighted, {n_same} quotes not located "
          f"(plain page used), {n_missing} cited pages outside the PDF")


# ---------------------------------------------------------------------------
# Cloudflare Pages extras
# ---------------------------------------------------------------------------


def write_headers(info: dict, w: Writer) -> None:
    """_headers: download names for the CSV and PDF; long caching for hashed assets and pages."""
    lines = ["/assets/*", "  Cache-Control: public, max-age=31536000, immutable", "",
             "/static-pages/*", "  Cache-Control: public, max-age=86400", ""]
    for rid in sorted(info["runs"]):
        lines += [f"/static-api/runs/{rid}/export.csv",
                  f'  Content-Disposition: attachment; filename="{rid}_answers.csv"', "",
                  f"/static-api/runs/{rid}/report.pdf",
                  f'  Content-Disposition: attachment; filename="{rid}_report.pdf"', ""]
    w.write("_headers", "\n".join(lines).encode("utf-8"))


def summary() -> None:
    files = [p for p in OUT.rglob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in files)
    biggest = max(files, key=lambda p: p.stat().st_size)
    print(f"{OUT}: {len(files)} files, {total / 2**20:.1f} MiB "
          f"(largest {biggest.relative_to(OUT)} {biggest.stat().st_size / 2**20:.2f} MiB)")
    by_top: dict[str, list[int]] = {}
    for p in files:
        top = p.relative_to(OUT).parts[0] if len(p.relative_to(OUT).parts) > 1 else "(root)"
        by_top.setdefault(top, []).append(p.stat().st_size)
    for top, sizes in sorted(by_top.items()):
        print(f"  {top}: {len(sizes)} files, {sum(sizes) / 2**20:.1f} MiB")
    if len(files) > MAX_FILES:
        sys.exit(f"Too many files for Cloudflare Pages: {len(files)} > {MAX_FILES}")
    if biggest.stat().st_size > MAX_FILE_BYTES:
        sys.exit(f"File too big for Cloudflare Pages: {biggest}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--no-pages", action="store_true", help="skip rendering page images")
    ap.add_argument("--skip-npm", action="store_true", help="reuse the website already in deploy/static-site")
    args = ap.parse_args()
    if not frozen_runs():
        sys.exit("No runs/frozen/BM*_agent-* runs found")

    t0 = time.time()
    if args.skip_npm:
        for sub in ("static-api", "static-pages"):
            shutil.rmtree(OUT / sub, ignore_errors=True)
    else:
        print("Building the website (VITE_STATIC=1) ...")
        build_website(date.today().isoformat())
    w = Writer(OUT)
    with tempfile.TemporaryDirectory(prefix="static-site-runs-") as tmp:
        client = make_client(Path(tmp))
        print("Saving API responses and cash-flow grid ...")
        info = save_api(client, w)
        if not args.no_pages:
            print("Rendering page images ...")
            save_pages(info, w)
        write_headers(info, w)
        client.close()
    print(f"Done in {time.time() - t0:.0f} s")
    summary()


if __name__ == "__main__":
    main()
