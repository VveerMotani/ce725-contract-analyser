"""Command line: python -m analyser.extract <contract_id|pdf_path> [--dry-run] [--show-prompts]

--dry-run prints the seven clause calls and a token estimate for each, in both context modes,
without calling the API (no key needed).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime

from .. import config
from ..llm.prompts import estimate_tokens
from . import context as ctxmod
from .pipeline import extract_package, plan_clause_calls

PREVIEW_CHARS = 1500


def dry_run(target: str, show_prompts: bool) -> dict:
    package = ctxmod.load_package_for_cli(target)
    text_tokens = estimate_tokens(ctxmod.package_text(package))
    chosen = ctxmod.choose_mode(package)
    print(f"Package {package.contract_id}: {len(package.files)} file(s), {len(package.pages)} pages, "
          f"~{text_tokens:,} tokens of text; mode used: {chosen} "
          f"(full text if < {ctxmod.FULL_TEXT_TOKEN_LIMIT:,})")
    summary = {"contract": package.contract_id, "pages": len(package.pages),
               "text_tokens": text_tokens, "mode_used": chosen}
    for mode in ("full", "retrieval"):
        specs = plan_clause_calls(package, mode=mode)
        print(f"\n=== {mode} mode ===")
        print(f"{'call':<34}{'system':>8}{'document':>10}{'user':>8}{'images':>8}{'total':>9}")
        total = 0
        for spec in specs:
            est = spec.token_estimate()
            total += est["total"]
            print(f"{spec.tag:<34}{est['system']:>8,}{est['document']:>10,}{est['user']:>8,}"
                  f"{est['images']:>8,}{est['total']:>9,}   images: {ctxmod.format_pages(spec.image_refs)}")
        doc = specs[0].token_estimate()["document"]
        print(f"{'TOTAL input (7 calls)':<34}{total:>43,}")
        billed = total
        if doc:
            # 1-hour cache write costs 2x, a cache read 0.05x on Claude Opus 5.5 (prompt-caching notes)
            billed = round(total - 7 * doc + doc * 2.0 + 6 * doc * 0.05)
            print(f"  of which the cached document block (1-hour TTL): {doc:,} x 7 "
                  f"(written once, read from the prompt cache 6 times)")
            print(f"  price-equivalent uncached input with caching: ~{billed:,} tokens")
        summary[mode] = {"total_input_tokens": total, "document_tokens": doc,
                         "price_equivalent_tokens": billed}
        if show_prompts and mode == chosen:
            for spec in specs:
                print(f"\n--- {spec.tag} : user prompt (first {PREVIEW_CHARS} chars) ---")
                print(spec.user_text[:PREVIEW_CHARS])
    print("\nCross-reference and absence calls depend on the answers, so they are not estimated here.")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m analyser.extract")
    parser.add_argument("target", help="benchmark id (BM1..BM4) or path to a PDF")
    parser.add_argument("--dry-run", action="store_true", help="print calls and token estimates only")
    parser.add_argument("--show-prompts", action="store_true", help="with --dry-run, print the prompts")
    args = parser.parse_args(argv)

    if args.dry_run:
        dry_run(args.target, show_prompts=args.show_prompts)
        return 0

    from ..llm import LLMClient, LLMError
    package = ctxmod.load_package_for_cli(args.target)
    llm = LLMClient()
    try:
        envelopes = extract_package(
            package, llm, on_progress=lambda s, f, m: print(f"[{f:5.0%}] {s}: {m}", flush=True))
    except LLMError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    out_dir = config.RUNS_DIR / f"cli-{package.contract_id}-{datetime.now():%Y%m%d-%H%M%S}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "answers.json").write_text(
        json.dumps([e.model_dump() for e in envelopes], indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(envelopes)} answers to {out_dir / 'answers.json'}; LLM stats: {llm.stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
