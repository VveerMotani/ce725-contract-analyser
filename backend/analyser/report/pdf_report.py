"""PDF report of one run (F14, design notes §4), built with reportlab.

Sections: title page with disclaimer, package summary and missing documents,
clause table with quotes and pages, risk flags, cash-flow summary and chart,
review items still pending, score (benchmarks), run metadata, AI-use statement.
"""
from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

from analyser.models import (CLAUSE_NAMES, AnswerEnvelope, CashResult, Package,
                             RiskFlag, RunMeta, ScoreSummary)
from analyser.report.csv_export import question_sort_key

DISCLAIMER = ("Decision support, not legal advice; verify every value against the contract "
              "before you rely on it.")
PAGE = landscape(A4)
WIDTH = PAGE[0] - 30 * mm
SEVERITY_ORDER = {"High": 0, "Medium": 1, "Needs review": 2, "Low": 3, "Info": 4}

# ---------------------------------------------------------------------------
# Fonts and styles
# ---------------------------------------------------------------------------

_FONT = {"normal": "Helvetica", "bold": "Helvetica-Bold"}


def _register_fonts() -> None:
    """Use DejaVu Sans (shipped with matplotlib) so quotes with odd characters print."""
    if _FONT["normal"] != "Helvetica":
        return
    try:
        import matplotlib
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        ttf = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
        pdfmetrics.registerFont(TTFont("DejaVu", str(ttf / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(ttf / "DejaVuSans-Bold.ttf")))
        _FONT.update(normal="DejaVu", bold="DejaVu-Bold")
    except Exception:  # noqa: BLE001 - fall back to the built-in font
        pass


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    n, b = _FONT["normal"], _FONT["bold"]
    return {
        "title": ParagraphStyle("t", parent=base["Title"], fontName=b, fontSize=24, leading=30),
        "subtitle": ParagraphStyle("st", parent=base["Normal"], fontName=n, fontSize=13,
                                   leading=18, alignment=TA_CENTER),
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName=b, fontSize=15,
                             spaceBefore=6, spaceAfter=6),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName=b, fontSize=12,
                             spaceBefore=8, spaceAfter=4),
        "body": ParagraphStyle("b", parent=base["Normal"], fontName=n, fontSize=9.5, leading=13),
        "cell": ParagraphStyle("c", parent=base["Normal"], fontName=n, fontSize=7.5, leading=9.5),
        "cellb": ParagraphStyle("cb", parent=base["Normal"], fontName=b, fontSize=7.5,
                                leading=9.5),
        "box": ParagraphStyle("box", parent=base["Normal"], fontName=b, fontSize=12, leading=17,
                              alignment=TA_CENTER, textColor=colors.HexColor("#7a1f1f")),
    }


def _p(text, style) -> Paragraph:
    """Paragraph from plain text (escaped, control characters removed)."""
    clean = "".join(ch for ch in str(text if text is not None else "")
                    if ch >= " " or ch in "\n\t")
    return Paragraph(escape(clean).replace("\n", "<br/>"), style)


def _table(rows: list[list], widths: list[float], st: dict, header: bool = True) -> Table:
    """Table of plain-text cells, first row as a header."""
    data = [[_p(c, st["cellb"] if header and i == 0 else st["cell"]) for c in row]
            for i, row in enumerate(rows)]
    t = Table(data, colWidths=[w * WIDTH for w in widths], repeatRows=1 if header else 0)
    style = [("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#999999")),
             ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e3e8ef")))
    t.setStyle(TableStyle(style))
    return t


def rupees(x: float | None) -> str:
    """Rs amount in crore or lakh, as Indian contracts quote them."""
    if x is None:
        return "-"
    sign = "-" if x < 0 else ""
    x = abs(x)
    if x >= 1e7:
        return f"{sign}Rs {x / 1e7:,.2f} crore"
    if x >= 1e5:
        return f"{sign}Rs {x / 1e5:,.2f} lakh"
    return f"{sign}Rs {x:,.0f}"


def _short(text: str, n: int) -> str:
    text = text or ""
    return text if len(text) <= n else text[: n - 1] + "…"


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------


def _title_page(meta: RunMeta, package: Package | None, st) -> list:
    from analyser import config
    title = ((package.title if package and package.title else "")
             or config.BENCHMARKS.get(meta.contract_id, {}).get("title") or meta.contract_id)
    box = Table([[_p(DISCLAIMER, st["box"])]], colWidths=[WIDTH * 0.8])
    box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1.2, colors.HexColor("#7a1f1f")),
                             ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fbeeee")),
                             ("TOPPADDING", (0, 0), (-1, -1), 10),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    return [Spacer(1, 30 * mm), _p("Tender and Contract Analyser: Report", st["title"]),
            _p(title, st["subtitle"]), Spacer(1, 4 * mm),
            _p(f"Contract {meta.contract_id}  |  Run {meta.run_id}  |  "
               f"Generated {datetime.now():%d %b %Y %H:%M}", st["subtitle"]),
            Spacer(1, 15 * mm), box, Spacer(1, 10 * mm),
            _p("CE725 course project. Clause types C0 to C6: contract facts, payment, retention, "
               "advances, delay damages, price variation, guarantees.", st["subtitle"]),
            PageBreak()]


def _package_section(package: Package | None, st) -> list:
    out = [_p("1. Package summary", st["h1"])]
    if package is None:
        return out + [_p("Package details were not available for this run.", st["body"])]
    rows = [["Doc", "File", "Tag", "Pages", "SHA-256 (first 16)"]]
    rows += [[f.doc_id, f.filename, f.tag, f.page_count, f.sha256[:16]] for f in package.files]
    out.append(_table(rows, [0.06, 0.48, 0.12, 0.08, 0.26], st))
    if package.pages:
        low = [f"{p.doc_id}:{p.page}" for p in package.pages if p.low_text]
        visual = [f"{p.doc_id}:{p.page}" for p in package.pages if p.needs_visual]
        garbled = [f"{p.doc_id}:{p.page}" for p in package.pages if p.garbled]
        out += [Spacer(1, 3 * mm), _p(
            f"{len(package.pages)} pages parsed. Pages with almost no text: {len(low)}"
            f"{' (' + ', '.join(low[:30]) + ')' if low else ''}. Pages read visually: "
            f"{len(visual)}. Pages with broken text: {len(garbled)}.", st["body"])]
    out.append(_p("Documents referenced but not in the package", st["h2"]))
    if package.missing_references:
        rows = [["Missing document", "Referenced at", "Quote"]]
        rows += [[m.label, f"{m.doc_id} p. {m.page}", _short(m.quote, 300)]
                 for m in package.missing_references]
        out.append(_table(rows, [0.3, 0.12, 0.58], st))
        out.append(_p("Answers that depend on these documents cannot be confirmed from this "
                      "package.", st["body"]))
    else:
        out.append(_p("None detected.", st["body"]))
    return out


def _clause_section(envelopes: list[AnswerEnvelope], st) -> list:
    out = [PageBreak(), _p("2. Clause table", st["h1"]),
           _p("One row per question. Where a reviewer edited an answer, the edited answer is "
              "shown and marked. Page numbers are positions in the PDF file.", st["body"])]
    by_clause: dict[str, list[AnswerEnvelope]] = {}
    for e in envelopes:
        by_clause.setdefault(e.answer.clause_id, []).append(e)
    for cid in sorted(by_clause):
        rows = [["Q", "Question", "Status", "Answer (unit, base)", "Section / page",
                 "Verbatim quote", "Checks / review"]]
        for e in sorted(by_clause[cid], key=lambda e: question_sort_key(e.answer.question_id)):
            a = e.effective()
            value = a.answer_value + "".join(f"\n{k}: {v}" for k, v in
                                             (("unit", a.unit), ("base", a.base)) if v)
            if a.points_to:
                value += f"\npoints to: {a.points_to}"
            v = e.verification
            check = f"conf. {a.confidence}"
            if v:
                check += f"\nquote {'found' if v.quote_found else 'NOT found' if v.quote_found is False else 'n/a'}; {v.verdict}"
            check += f"\nreview: {e.review.decision}" + (" (edited)" if a is not e.answer else "")
            rows.append([a.question_id, e.question, a.status, value,
                         f"{a.section_ref}\np. {a.pdf_page or '-'}" + (f" ({e.doc_id})" if e.doc_id else ""),
                         _short(a.verbatim_quote, 450), check])
        out += [_p(f"{cid}  {CLAUSE_NAMES.get(cid, '')}", st["h2"]),
                _table(rows, [0.04, 0.14, 0.09, 0.22, 0.1, 0.29, 0.12], st)]
    return out


def _flags_section(flags: list[RiskFlag], st) -> list:
    out = [PageBreak(), _p("3. Risk flags", st["h1"])]
    if not flags:
        return out + [_p("No risk flags were produced for this run.", st["body"])]
    for category, heading in (("risk", "High-risk terms"), ("unclear", "Unclear or missing terms")):
        chosen = sorted((f for f in flags if f.category == category),
                        key=lambda f: (SEVERITY_ORDER.get(f.severity, 9), f.flag_id))
        if not chosen:
            continue
        rows = [["Flag", "Severity", "Term", "Found / reference", "Evidence", "Why it matters",
                 "Rupee impact"]]
        for f in chosen:
            ref = f"\nreference: {f.reference_value}" if f.reference_value else ""
            ref += f" ({f.reference_source})" if f.reference_source else ""
            where = f"{f.section_ref} p. {f.pdf_page}" if f.pdf_page else f.section_ref
            rows.append([f.flag_id, f.severity, f"{f.title}\nrule: {f.rule}",
                         f"{f.value_found}{ref}", f"{_short(f.quote, 300)}\n{where}".strip(),
                         f.explanation, rupees(f.rupee_impact) if f.rupee_impact is not None else "-"])
        out += [_p(heading, st["h2"]),
                _table(rows, [0.05, 0.07, 0.16, 0.17, 0.25, 0.22, 0.08], st)]
    return out


def _cash_chart(as_written: CashResult, reference: CashResult | None) -> io.BytesIO:
    """PNG of the cumulative funding gap per month (matplotlib, no pyplot: thread-safe)."""
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    fig = Figure(figsize=(10, 3.4), dpi=150)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)
    for result, label, colour in ((as_written, "As written", "#b03a2e"),
                                  (reference, "At reference values", "#2e6fb0")):
        if result and result.months:
            ax.plot([m.month for m in result.months], [m.gap / 1e5 for m in result.months],
                    label=label, color=colour, linewidth=2)
    ax.axhline(0, color="#888888", linewidth=0.8)
    ax.set_xlabel("Month")
    ax.set_ylabel("Contractor funding gap (Rs lakh)")
    ax.set_title("Cumulative cash out minus cash in")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    buf.seek(0)
    return buf


def _cash_section(cash, st) -> list:
    out = [PageBreak(), _p("4. Cash-flow impact", st["h1"])]
    if isinstance(cash, CashResult):
        cash = {"as_written": cash}
    aw: CashResult | None = (cash or {}).get("as_written")
    ref: CashResult | None = (cash or {}).get("reference")
    if aw is None:
        return out + [_p("The cash model has not been run for this run (confirm the cash "
                         "inputs on the Cash flow screen first).", st["body"])]
    measures = [
        ("Peak funding need", lambda r: rupees(r.peak_funding), lambda r: r.peak_funding),
        ("Month of peak", lambda r: str(r.peak_month), None),
        ("Overdraft interest", lambda r: rupees(r.overdraft_interest), lambda r: r.overdraft_interest),
        ("Interest on advance", lambda r: rupees(r.advance_interest), lambda r: r.advance_interest),
        ("Guarantee commission", lambda r: rupees(r.guarantee_cost), lambda r: r.guarantee_cost),
        ("Most cash locked in retention", lambda r: rupees(r.retention_locked_max),
         lambda r: r.retention_locked_max),
        ("Cost of financing retention", lambda r: rupees(r.retention_financing_cost),
         lambda r: r.retention_financing_cost),
        ("Delay damages for the chosen delay", lambda r: rupees(r.ld_amount), lambda r: r.ld_amount),
        ("Days of delay until the damages cap", lambda r: "-" if r.ld_days_to_cap is None
         else f"{r.ld_days_to_cap:,.0f}", None),
        ("Escalation", lambda r: f"{rupees(r.escalation_amount)} "
         f"({'recovered' if r.escalation_is_recovery else 'exposure'})", None),
        ("Total cost of terms", lambda r: rupees(r.total_cost_of_terms),
         lambda r: r.total_cost_of_terms),
    ]
    rows = [["Measure", "As written", "At reference values", "Difference"]]
    for name, show, num in measures:
        diff = rupees(num(aw) - num(ref)) if (ref is not None and num) else ""
        rows.append([name, show(aw), show(ref) if ref is not None else "-", diff])
    out.append(_table(rows, [0.34, 0.22, 0.22, 0.22], st))
    out += [Spacer(1, 4 * mm), Image(_cash_chart(aw, ref), width=WIDTH, height=WIDTH * 0.34)]
    if aw.sensitivities:
        rows = [["Sensitivity (as written)", "Peak funding", "Peak month", "Interest cost",
                 "Total cost of terms"]]
        rows += [[s.name, rupees(s.peak_funding), s.peak_month, rupees(s.interest_cost),
                  rupees(s.total_cost_of_terms)] for s in aw.sensitivities]
        out += [_p("Sensitivities", st["h2"]), _table(rows, [0.36, 0.16, 0.12, 0.16, 0.2], st)]
    if aw.notes:
        out += [_p("Model notes", st["h2"])] + [_p(f"• {n}", st["body"]) for n in aw.notes]
    return out


def _review_section(envelopes: list[AnswerEnvelope], st) -> list:
    pending = sorted((e for e in envelopes if e.review.decision == "pending"),
                     key=lambda e: (e.answer.clause_id, question_sort_key(e.answer.question_id)))
    out = [PageBreak(), _p("5. Review queue: items still pending", st["h1"])]
    if not pending:
        return out + [_p("No items are waiting for review.", st["body"])]
    out.append(_p(f"{len(pending)} answer(s) still need a person to confirm them against the "
                  "contract.", st["body"]))
    rows = [["Q", "Question", "Status", "AI answer", "Page", "Why it needs review"]]
    rows += [[e.answer.question_id, e.question, e.answer.status, _short(e.answer.answer_value, 250),
              e.answer.pdf_page or "-", "; ".join(e.review.reasons)] for e in pending]
    out.append(_table(rows, [0.05, 0.2, 0.1, 0.3, 0.05, 0.3], st))
    return out


def _score_section(score: ScoreSummary | None, st) -> list:
    if score is None:
        return []
    rows = [["Measure", "Value"],
            ["Precision", f"{score.precision:.1%}"], ["Recall", f"{score.recall:.1%}"],
            ["Core tests passed", f"{score.core_pass_rate:.1%}"],
            ["Quotes verified", f"{score.quote_verification_rate:.1%}"],
            ["Hallucinations", str(score.hallucinations)]]
    rows += [[f"Count: {k}", str(v)] for k, v in score.counts.items()]
    return [_p("6. Score against the answer key (benchmark run)", st["h1"]),
            _table(rows, [0.4, 0.2], st)]


def _meta_section(meta: RunMeta, st) -> list:
    rows = [["Item", "Value"],
            ["Run id", meta.run_id], ["Package id", meta.package_id],
            ["Contract", meta.contract_id], ["Model", meta.model], ["Effort", meta.effort],
            ["Prompt version", meta.prompt_version], ["Schema version", meta.schema_version],
            ["Started", meta.started_at], ["Finished", meta.finished_at],
            ["Final stage", meta.stage + (f" ({meta.error})" if meta.error else "")],
            ["Model calls (cache hits)", f"{meta.llm_calls} ({meta.cache_hits})"],
            ["Tokens in / out", f"{meta.input_tokens:,} / {meta.output_tokens:,}"]]
    return [_p("7. Run metadata", st["h1"]), _table(rows, [0.25, 0.55], st)]


def _ai_statement(meta: RunMeta, st) -> list:
    text = (
        f"Use of AI. The answers in this report were read from the contract PDFs by a large "
        f"language model ({meta.model or 'model not recorded'}, effort {meta.effort or '-'}, "
        f"prompt version {meta.prompt_version}). The model was asked to return a verbatim quote "
        f"and PDF page for every value. Code then checked each quote against the PDF text; an "
        f"answer whose quote could not be found was discarded or sent for review. All "
        f"arithmetic (unit conversion, risk rules, the cash-flow model and scoring) is done by "
        f"ordinary Python code, not by the model. Answers that are not stated, point to another "
        f"document, conflict, were read only from page images, or failed a check are placed in "
        f"the review queue. The model can still misread a clause or miss a document that was "
        f"not uploaded. {DISCLAIMER}")
    return [_p("8. AI-use statement", st["h1"]), _p(text, st["body"])]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def report_pdf(meta: RunMeta, package: Package | None, envelopes: list[AnswerEnvelope],
               flags: list[RiskFlag], cash, score: ScoreSummary | None) -> bytes:
    """The full report as PDF bytes.

    cash: {"as_written": CashResult, "reference": CashResult} (reference optional),
    a single CashResult, or None.
    """
    _register_fonts()
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=PAGE, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"Contract analysis {meta.run_id}",
                            author="Tender and Contract Analyser (CE725)")

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont(_FONT["normal"], 7.5)
        canvas.setFillColor(colors.HexColor("#555555"))
        canvas.drawString(15 * mm, 8 * mm, f"{meta.run_id}  |  {DISCLAIMER}")
        canvas.drawRightString(PAGE[0] - 15 * mm, 8 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    story = (_title_page(meta, package, st) + _package_section(package, st)
             + _clause_section(envelopes, st) + _flags_section(flags, st)
             + _cash_section(cash, st) + _review_section(envelopes, st)
             + [PageBreak()] + _score_section(score, st) + _meta_section(meta, st)
             + [Spacer(1, 6 * mm)] + [KeepTogether(_ai_statement(meta, st))])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
