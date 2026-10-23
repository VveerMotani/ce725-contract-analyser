"""Extraction of the 52 answers from one package (features F3, F6, F7, F8).

Order of work:
  1. retrieve   pages per clause type (F5, from the structure module) -> hints and image pages
  2. extract    one call per clause type C0..C6, one record per question (F6), page images (F3)
  3. crossref   answers that point to a schedule / contract data / annexure get the target pages (F7)
  4. absence    every NOT_STATED is searched again with term lists and second wordings (F8)
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Callable

from ..llm.prompts import IMAGE_TOKENS, estimate_tokens, load_prompt, render
from ..models import CLAUSE_NAMES, Answer, AnswerEnvelope, Package, RetrievalResult, SectionEntry
from . import context as ctxmod
from .questions import CLAUSE_IDS, QUESTIONS, QUESTION_TEXT, question_list_text
from .records import (ABSENCE_EXTRA, answers_schema, fill_points_to, make_validator, normalise,
                      not_stated, schema_errors)
from .terms import SYNONYMS

Progress = Callable[[str, float, str], None]

MAX_POINTER_STEPS = 4         # F7: follow a reference chain up to 4 steps
MAX_TARGET_PAGES = 12         # pages sent per cross-reference call
MAX_ABSENCE_PAGES = 30        # pages listed (or sent, in retrieval mode) per absence call

_LABEL = (r"(?:schedule|annexure|appendix)(?:[\s\-]*(?-i:[A-Z0-9]{1,4})\b)?|contract\s+data"
          r"|bid\s+data\s+sheet|tender\s+data|special\s+conditions|general\s+conditions"
          r"|(?-i:GCC|SCC)")
POINTER_RE = re.compile(
    r"\b(?:as\s+per|see|refer(?:red)?\s+to|as\s+specified\s+in|specified\s+in|given\s+in"
    r"|mentioned\s+in|stated\s+in|as\s+provided\s+in|in\s+accordance\s+with|as\s+indicated\s+in)\b"
    rf"[^.;]{{0,60}}?(?:{_LABEL})", re.I)


# ---------------------------------------------------------------------------- data holders

@dataclass
class Context:
    """Everything about the package that every call needs."""
    package: Package
    doc_map: list[SectionEntry] | None
    mode: str                                  # "full" or "retrieval"
    document: str | None                       # full package text (full mode only)
    retrievals: dict[str, RetrievalResult]
    doc_ids: list[str]


@dataclass
class CallSpec:
    """One planned model call: enough to send it, print it (--dry-run) or estimate its size."""
    tag: str
    clause_id: str
    system: str
    user_text: str
    document: str | None
    image_refs: list[tuple[str, int]]
    schema: dict
    expected: list[str]
    images: list[bytes] = field(default_factory=list)

    def token_estimate(self) -> dict:
        parts = {"system": estimate_tokens(self.system),
                 "document": estimate_tokens(self.document),
                 "user": estimate_tokens(self.user_text),
                 "images": IMAGE_TOKENS * len(self.image_refs)}
        parts["total"] = sum(parts.values())
        return parts


@dataclass
class Slot:
    """Current answer to one question and where it came from."""
    record: dict
    doc_id: str
    key: str


# ---------------------------------------------------------------------------- context

def prepare(package: Package, doc_map: list[SectionEntry] | None = None,
            mode: str | None = None) -> Context:
    """Choose full-text or retrieval mode and run retrieval for every clause type."""
    if doc_map is None:
        doc_map = ctxmod.build_document_map(package)
    mode = mode or ctxmod.choose_mode(package)
    document = ctxmod.package_text(package) if mode == "full" else None
    retrievals = {cid: ctxmod.retrieve(package, cid, doc_map) for cid in CLAUSE_IDS}
    return Context(package, doc_map, mode, document, retrievals, [f.doc_id for f in package.files])


def _pages_section(ctx: Context, pages: list[tuple[str, int]]) -> tuple[str, str, str | None]:
    """(pages_description, page_text, document) for the chosen mode."""
    if ctx.mode == "full":
        desc = (f"the full text of all {len(ctx.package.pages)} pages of the package, "
                "in the document block before this message")
        return desc, "", ctx.document
    desc = f"text of PDF pages {ctxmod.format_pages(pages)}, given below"
    return desc, "\nPage text:\n" + ctxmod.package_text(ctx.package, pages), None


def _attach_images(ctx: Context, refs: list[tuple[str, int]], render_images: bool):
    if not render_images:
        return [], refs
    return ctxmod.render_pages(ctx.package, refs)


# ---------------------------------------------------------------------------- call builders

def build_clause_call(ctx: Context, clause_id: str, render_images: bool = True) -> CallSpec:
    """F6 + F3: the extraction call for one clause type."""
    retrieval = ctx.retrievals[clause_id]
    refs = ctxmod.visual_pages(ctx.package, retrieval.pages, retrieval.image_pages)
    images, refs = _attach_images(ctx, refs, render_images)
    desc, page_text, document = _pages_section(ctx, retrieval.pages)
    questions = QUESTIONS[clause_id]
    user = render(
        load_prompt("extract"),
        contract_id=ctx.package.contract_id, clause_id=clause_id,
        clause_name=CLAUSE_NAMES[clause_id], pages_description=desc,
        hint_pages=ctxmod.format_pages(retrieval.pages),
        image_page_list=ctxmod.format_pages(refs),
        term_list="; ".join(ctxmod.term_list(clause_id)),
        visual_note=("\n" + load_prompt("visual")) if refs else "",
        question_list=question_list_text(questions), page_text=page_text)
    return CallSpec(tag=f"extract:{ctx.package.contract_id}:{clause_id}", clause_id=clause_id,
                    system=load_prompt("system"), user_text=user, document=document,
                    image_refs=refs, schema=answers_schema(),
                    expected=[q["question_id"] for q in questions], images=images)


def build_crossref_call(ctx: Context, clause_id: str, slots: dict[str, Slot],
                        targets: list[tuple[str, int]], render_images: bool = True) -> CallSpec:
    """F7: send the pointer target pages with the answers that point at them."""
    refs = ctxmod.visual_pages(ctx.package, targets)
    images, refs = _attach_images(ctx, refs, render_images)
    # Target pages are always written out: in full mode they repeat a little of the cached
    # document, but they keep the model's attention on the pages the pointers lead to.
    page_text = "\nPointer target pages:\n" + ctxmod.package_text(ctx.package, targets)
    qids = list(slots)
    answers = [dict(s.record, doc_id=s.doc_id) for s in slots.values()]
    user = render(
        load_prompt("crossref"),
        contract_id=ctx.package.contract_id, clause_id=clause_id,
        clause_name=CLAUSE_NAMES[clause_id],
        answers_json=json.dumps(answers, indent=1, ensure_ascii=False),
        pointer_target_pages=ctxmod.format_pages(targets),
        image_page_list=ctxmod.format_pages(refs),
        question_list=question_list_text([q for q in QUESTIONS[clause_id] if q["question_id"] in qids]),
        page_text=page_text)
    return CallSpec(tag=f"crossref:{ctx.package.contract_id}:{clause_id}", clause_id=clause_id,
                    system=load_prompt("system"), user_text=user, document=ctx.document,
                    image_refs=refs, schema=answers_schema(), expected=qids, images=images)


def build_absence_call(ctx: Context, clause_id: str, qids: list[str],
                       render_images: bool = True) -> CallSpec:
    """F8: search the package again for questions answered NOT_STATED."""
    terms = ctxmod.term_list(clause_id)
    synonyms = SYNONYMS[clause_id]
    hits = ctxmod.find_pages(ctx.package, terms + synonyms)[:MAX_ABSENCE_PAGES]
    hits = sorted(hits)
    refs = ctxmod.visual_pages(ctx.package, hits)
    images, refs = _attach_images(ctx, refs, render_images)
    _, page_text, document = _pages_section(ctx, hits)
    user = render(
        load_prompt("absence"),
        contract_id=ctx.package.contract_id, clause_id=clause_id,
        clause_name=CLAUSE_NAMES[clause_id], term_list="; ".join(terms),
        synonyms="; ".join(synonyms), hint_pages=ctxmod.format_pages(hits),
        image_page_list=ctxmod.format_pages(refs),
        question_list=question_list_text([q for q in QUESTIONS[clause_id] if q["question_id"] in qids]),
        page_text=page_text)
    return CallSpec(tag=f"absence:{ctx.package.contract_id}:{clause_id}", clause_id=clause_id,
                    system=load_prompt("system"), user_text=user, document=document,
                    image_refs=refs, schema=answers_schema(ABSENCE_EXTRA), expected=qids,
                    images=images)


def plan_clause_calls(package: Package, mode: str | None = None,
                      doc_map: list[SectionEntry] | None = None) -> list[CallSpec]:
    """The seven extraction calls without sending or rendering anything (for --dry-run)."""
    ctx = prepare(package, doc_map, mode)
    return [build_clause_call(ctx, cid, render_images=False) for cid in CLAUSE_IDS]


# ---------------------------------------------------------------------------- running calls

def run_call(llm, ctx: Context, spec: CallSpec) -> tuple[dict[str, tuple[dict, dict]], str]:
    """Send one call. Returns {question_id: (clean record, raw item)} and the cache key."""
    validate = make_validator(ctx.package.contract_id, spec.clause_id, spec.expected)
    parsed, key = llm.call_json(spec.system, spec.user_text, spec.images, spec.schema,
                                spec.tag, document=spec.document, validate=validate)
    out: dict[str, tuple[dict, dict]] = {}
    items = parsed.get("answers", []) if isinstance(parsed, dict) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        qid = item.get("question_id")
        if qid in spec.expected and qid not in out:
            out[qid] = (_clean(ctx, spec.clause_id, item), item)
    return out, key


def _clean(ctx: Context, clause_id: str, item: dict) -> dict:
    """Normalise one record; a record that still breaks the schema becomes a low-confidence NOT_STATED."""
    record = normalise(item, ctx.package.contract_id, clause_id)
    fill_points_to(record)        # the retry already asked for it; never pass an empty one on
    errors = schema_errors(record)
    if errors:
        return not_stated(ctx.package.contract_id, clause_id, str(item.get("question_id")),
                          "Model record failed the schema check: " + errors[0])
    return record


def _doc_id(ctx: Context, record: dict, item: dict) -> str:
    """Which file the quote is in: the model's doc_id if it is real, else the only file."""
    if record["status"] == "NOT_STATED":
        return ""
    doc_id = str(item.get("doc_id") or "")
    if doc_id in ctx.doc_ids:
        return doc_id
    return ctx.doc_ids[0] if len(ctx.doc_ids) == 1 else ""


def _append_note(record: dict, text: str) -> None:
    notes = (record.get("notes") or "").strip()
    combined = f"{notes} {text}".strip()
    record["notes"] = combined if len(combined) <= 400 else combined[:397] + "..."


# ---------------------------------------------------------------------------- passes

def pointer_texts(record: dict) -> list[str]:
    """Unresolved pointers in an answer ("as per Schedule F", or the points_to of POINTS_ELSEWHERE)."""
    texts = []
    if record["status"] == "POINTS_ELSEWHERE" and record.get("points_to"):
        texts.append(record["points_to"])
    for name in ("answer_value", "notes", "verbatim_quote"):
        texts += [m.group(0) for m in POINTER_RE.finditer(record.get(name) or "")]
    return list(dict.fromkeys(texts))


def crossref_pass(llm, ctx: Context, slots: dict[str, Slot], progress: Progress) -> None:
    """F7: follow pointers up to MAX_POINTER_STEPS times; merge the resolved answers."""
    visited: dict[str, set] = {qid: set() for qid in slots}
    for step in range(1, MAX_POINTER_STEPS + 1):
        work: dict[str, dict[str, list]] = {}
        for qid, slot in slots.items():
            targets = []
            for text in pointer_texts(slot.record):
                targets += ctxmod.resolve_pointer(ctx.package, text, ctx.doc_map)
            new = [t for t in dict.fromkeys(targets) if t not in visited[qid]]
            if new:
                work.setdefault(slot.record["clause_id"], {})[qid] = new
        if not work:
            return
        for n, (cid, by_q) in enumerate(sorted(work.items()), start=1):
            targets = list(dict.fromkeys(t for pages in by_q.values() for t in pages))[:MAX_TARGET_PAGES]
            for qid in by_q:
                visited[qid].update(by_q[qid])
            progress("crossref", 0.65 + 0.15 * (step - 1 + n / len(work)) / MAX_POINTER_STEPS,
                     f"Following references for {cid} (step {step}): {ctxmod.format_pages(targets)}")
            spec = build_crossref_call(ctx, cid, {q: slots[q] for q in by_q}, targets)
            results, key = run_call(llm, ctx, spec)
            for qid, (record, item) in results.items():
                old = slots[qid].record
                if record["status"] == "NOT_STATED" and old["status"] != "NOT_STATED":
                    continue          # never lose an answer to a weaker one
                _append_note(record, f"[cross-reference step {step}]")
                slots[qid] = Slot(record, _doc_id(ctx, record, item), key)


def absence_pass(llm, ctx: Context, slots: dict[str, Slot], progress: Progress) -> None:
    """F8: one call per clause type with every NOT_STATED question in it."""
    todo: dict[str, list[str]] = {}
    for qid, slot in slots.items():
        if slot.record["status"] == "NOT_STATED":
            todo.setdefault(slot.record["clause_id"], []).append(qid)
    for n, (cid, qids) in enumerate(sorted(todo.items()), start=1):
        progress("absence", 0.80 + 0.18 * n / len(todo),
                 f"Absence check for {cid}: {', '.join(qids)}")
        spec = build_absence_call(ctx, cid, qids)
        results, key = run_call(llm, ctx, spec)
        for qid, (record, item) in results.items():
            if item.get("absence_result") == "FOUND_PASSAGE" and record["status"] != "NOT_STATED":
                _append_note(record, "[found by absence check]")
                slots[qid] = Slot(record, _doc_id(ctx, record, item), key)
            else:
                searched = ", ".join(item.get("searched_sections") or []) or "whole package"
                _append_note(slots[qid].record, f"Absence check confirmed: searched {searched}.")


# ---------------------------------------------------------------------------- main entry

def extract_package(package: Package, llm, on_progress: Progress | None = None,
                    doc_map: list[SectionEntry] | None = None) -> list[AnswerEnvelope]:
    """Run F6, F3, F7 and F8 on one package and return 52 answer envelopes (not yet verified)."""
    progress = on_progress or (lambda stage, fraction, message: None)
    progress("retrieve", 0.0, "Finding the pages for each clause type")
    ctx = prepare(package, doc_map)
    progress("retrieve", 0.05, f"Context mode: {ctx.mode} "
                               f"(~{estimate_tokens(ctxmod.package_text(package)):,} tokens of text)")

    slots: dict[str, Slot] = {}
    for i, cid in enumerate(CLAUSE_IDS):
        progress("extract", 0.05 + 0.6 * i / len(CLAUSE_IDS), f"{cid} {CLAUSE_NAMES[cid]}")
        spec = build_clause_call(ctx, cid)
        if spec.image_refs:
            progress("visual", 0.05 + 0.6 * i / len(CLAUSE_IDS),
                     f"{cid}: page images {ctxmod.format_pages(spec.image_refs)}")
        results, key = run_call(llm, ctx, spec)
        for qid in spec.expected:
            if qid in results:
                record, item = results[qid]
                slots[qid] = Slot(record, _doc_id(ctx, record, item), key)
            else:   # the absence pass below still searches for it
                slots[qid] = Slot(not_stated(package.contract_id, cid, qid,
                                             "model returned no record"), "", key)

    progress("crossref", 0.65, "Following references")
    crossref_pass(llm, ctx, slots, progress)
    progress("absence", 0.80, "Checking answers marked NOT_STATED")
    absence_pass(llm, ctx, slots, progress)

    envelopes = []
    for cid in CLAUSE_IDS:
        for q in QUESTIONS[cid]:
            slot = slots[q["question_id"]]
            envelopes.append(AnswerEnvelope(question=QUESTION_TEXT[q["question_id"]],
                                            answer=Answer(**slot.record),
                                            doc_id=slot.doc_id, raw_call_id=slot.key))
    progress("extract", 1.0, f"{len(envelopes)} answers extracted")
    return envelopes
