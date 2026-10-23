"""Build the folder that is pushed to the Hugging Face Space (read-only demo).

    python deploy/build_hf_space.py            # writes deploy/hf-space/ and commits it
    cd deploy/hf-space && git push space main  # after adding the Space as remote "space"

The Space gets only what the demo needs: the backend code, the built website, the
four benchmark PDFs (for the page viewer), the files the code reads at start-up and
the frozen Claude-read runs. No .env, no LLM cache, no answer-key replays, no tests.
PDFs and images go through Git LFS, which Hugging Face requires for binary files.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deploy" / "hf-space"

SPACE_README = """---
title: Contract Money Terms
emoji: 📑
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Money terms, red flags and cash flow of public-works contracts
---

# Contract Money Terms (CE725 Team 2, IIT Bombay)

Read-only demo. It shows the saved results of Claude reading four public Indian
public-works contracts: the six money terms with their source pages, red and green
flags, and the cash-flow effect. New uploads and new AI runs are switched off here.

Source code and the validation report are in the team's GitHub repository.
Decision support, not legal advice.
"""

GITATTRIBUTES = "*.pdf filter=lfs diff=lfs merge=lfs -text\n" \
                "*.png filter=lfs diff=lfs merge=lfs -text\n" \
                "*.xlsx filter=lfs diff=lfs merge=lfs -text\n"

IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache", ".env", "cache", "tests",
                                "scripts", "*.xlsx")


def build() -> None:
    if OUT.exists():
        keep_git = OUT / ".git"
        for item in OUT.iterdir():
            if item != keep_git:
                shutil.rmtree(item) if item.is_dir() else item.unlink()
    OUT.mkdir(parents=True, exist_ok=True)

    shutil.copytree(ROOT / "backend", OUT / "backend", ignore=IGNORE, dirs_exist_ok=True)
    (OUT / "backend" / "cache" / "llm").mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / "frontend" / "dist", OUT / "frontend" / "dist", dirs_exist_ok=True)
    for name in ("golden_tests_v1.json", "extraction_schema_v1.json",
                 "Contract_Extraction_Questionnaire_v0.1.md"):
        shutil.copy(ROOT / name, OUT / name)
    bench = OUT / "Benchmark Contracts"
    bench.mkdir(exist_ok=True)
    for pdf in sorted((ROOT / "Benchmark Contracts").glob("BM*.pdf")):
        shutil.copy(pdf, bench / pdf.name)
    frozen = OUT / "runs" / "frozen"
    frozen.mkdir(parents=True, exist_ok=True)
    for run in sorted((ROOT / "runs" / "frozen").glob("BM*_agent-*")):
        shutil.copytree(run, frozen / run.name, dirs_exist_ok=True)

    shutil.copy(ROOT / "deploy" / "Dockerfile", OUT / "Dockerfile")
    (OUT / "README.md").write_text(SPACE_README, encoding="utf-8")
    (OUT / ".gitattributes").write_text(GITATTRIBUTES, encoding="utf-8")
    (OUT / ".gitignore").write_text("__pycache__/\n*.pyc\nruns/packages/\nruns/_uploads/\n", encoding="utf-8")


def commit() -> None:
    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=OUT, check=True)
    if not (OUT / ".git").exists():
        git("init", "-q", "-b", "main")
        git("lfs", "install", "--local")
    git("add", "-A")
    status = subprocess.run(["git", "status", "--porcelain"], cwd=OUT, capture_output=True, text=True)
    if status.stdout.strip():
        git("commit", "-q", "-m", "Update read-only demo")


if __name__ == "__main__":
    build()
    commit()
    files = [p for p in OUT.rglob("*") if p.is_file() and ".git" not in p.parts]
    size = sum(p.stat().st_size for p in files) / 1e6
    print(f"{OUT}: {len(files)} files, {size:.1f} MB")
