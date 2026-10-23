"""Prepare one clean folder per benchmark contract for a Claude Code subagent to read.

Used when there is no API key: a Claude Code subagent plays the role of the
extraction model. The folder holds ONLY what the API pipeline would send to the
model (page text with markers and struck-through words, page images, the 52
questions, the v1 prompts and the output schema), so the answer key cannot leak.

Usage (from backend/):  python -m scripts.prepare_agent_workspaces <out_dir> [BM1 BM2 ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from analyser import config
from analyser.extract import QUESTIONS
from analyser.extract.context import image_tier, package_text, render_pages
from analyser.ingest import benchmark_package
from analyser.models import CLAUSE_NAMES

OUTPUT_RULES = """\
Write your answers to `answers.json` in this folder: a JSON list of exactly 52 records,
one per question id below, each with exactly these keys:

  contract_id      "{contract_id}"
  clause_id        "C0".."C6"
  question_id      e.g. "2.2"
  status           FOUND | NOT_STATED | NOT_APPLICABLE | POINTS_ELSEWHERE
  answer_value     short plain answer; several parts separated by semicolons; every rate, cap, period and base
  unit             e.g. "% of gross bill", "days", "% per day of contract price" ("" if none)
  base             what a percentage is of ("" if none)
  value_source     clause | schedule | contract_data | annexure | amendment | portal_page | other | ""
  section_ref      clause number as printed ("" for NOT_STATED)
  pdf_page         the n of the [[DOC d PAGE n]] marker where the quote is (0 for NOT_STATED)
  verbatim_quote   at most 40 words copied exactly, one run of text, without ~~ marks ("" for NOT_STATED)
  conflicts        list of {{"value", "section_ref", "pdf_page", "verbatim_quote", "governs"}} (usually [])
  points_to        for POINTS_ELSEWHERE: the document or schedule that holds the detail, else ""
  visual_check     none | needed | done
  visual_evidence  what the page image showed, when visual_check is "done", else ""
  confidence       high | medium | low
  notes            under 60 words: traps met, ambiguity, what could not be read
"""

PROCESS = """\
How to work (this mirrors the tool's pipeline: one pass per clause type, then a
cross-reference pass, then an absence check):

1. `package.txt` is the whole contract package, one block per PDF page, each starting
   with a marker [[DOC d PAGE n]]. It is long: search it (Grep) for the terms of each
   clause type and read the pages around the hits; do not try to read it top to bottom.
2. `pages_index.md` lists pages that text cannot fully cover (scans, image-only pages,
   choice fields like "Yes/No", struck-through words, formula images). Their images are
   in `images/` as `d<doc>_p<page>.png`; open the image whenever the answer may be there.
3. For each clause type C0..C6 answer every question, following every "as per Schedule /
   Contract Data / Annexure" pointer to its end.
4. Before answering NOT_STATED, search again with other wordings (e.g. "security deposit"
   for retention, "compensation for delay" for liquidated damages) and check schedules,
   contract data, annexures and footnotes.
5. Write answers.json, then re-open it and check: 52 records, every FOUND quote copied
   exactly from package.txt (or from an image you read, then say so in notes and set
   visual_check "done"), page numbers from the markers.
"""


def write_workspace(contract_id: str, out_root: Path) -> Path:
    package = benchmark_package(contract_id)
    out = out_root / contract_id
    (out / "images").mkdir(parents=True, exist_ok=True)

    (out / "package.txt").write_text(package_text(package), encoding="utf-8")

    visual = [p for p in package.pages if p.needs_visual]
    visual.sort(key=lambda p: (image_tier(p), p.doc_id, p.page))
    images, rendered = render_pages(package, [(p.doc_id, p.page) for p in visual])
    for png, (doc_id, page) in zip(images, rendered):
        (out / "images" / f"{doc_id}_p{page}.png").write_bytes(png)
    lines = ["# Pages that need a look at the image", "",
             "| doc | page | why | image |", "|---|---|---|---|"]
    for p in visual:
        lines.append(f"| {p.doc_id} | {p.page} | {', '.join(p.visual_reasons)} | images/{p.doc_id}_p{p.page}.png |")
    if package.missing_references:
        lines += ["", "# Documents the package refers to but does not include", ""]
        lines += [f"- {m.label} (mentioned on {m.doc_id} page {m.page})" for m in package.missing_references]
    (out / "pages_index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    q_lines = []
    for clause_id, qs in QUESTIONS.items():
        q_lines.append(f"\n## {clause_id} {CLAUSE_NAMES[clause_id]}\n")
        q_lines += [f"- {q['question_id']}: {q['question']} (fields: {q['fields']})" for q in qs]
    files = ", ".join(f"{f.doc_id} = {f.filename}" for f in package.files)
    system = (config.PROMPTS_DIR / config.PROMPT_VERSION / "system.txt").read_text(encoding="utf-8")
    instructions = "\n".join([
        f"# Contract {contract_id}: {config.BENCHMARKS[contract_id]['title']}", "",
        f"Files in the package: {files}", "",
        "## Your role (same system prompt the tool sends to the API)", "", system, "",
        "## Process", "", PROCESS, "## Output", "", OUTPUT_RULES.format(contract_id=contract_id),
        "## The 52 questions", *q_lines, "",
    ])
    (out / "INSTRUCTIONS.md").write_text(instructions, encoding="utf-8")
    return out


if __name__ == "__main__":
    root = Path(sys.argv[1])
    ids = sys.argv[2:] or list(config.BENCHMARKS)
    for cid in ids:
        path = write_workspace(cid, root)
        n_img = len(list((path / "images").glob("*.png")))
        size = (path / "package.txt").stat().st_size
        print(f"{cid}: {path}  package.txt {size/1e3:.0f} kB, {n_img} images")
