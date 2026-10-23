// S5 Source viewer: right-hand drawer with the rendered PDF page (quote highlighted),
// the verbatim quote, conflicts, pointer path, visual evidence and verification checks.
import { useEffect, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, FileWarning, GitCompareArrows, ImageIcon, Link2, StickyNote, X, ZoomIn, ZoomOut } from "lucide-react";
import { pageImageUrl } from "../api";
import { useApp } from "../context";
import { CLAUSE_SHORT, effective } from "../types";
import { CheckIcon, Chip, Collapsible, ConfidenceBars, Quote, ReviewChip, StatusChip, VerdictChip, cx } from "./ui";

export function SourceDrawer() {
  const { source, closeSource } = useApp();
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (source) { setPage(source.page || 1); setImgError(false); }
  }, [source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeSource(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSource]);

  if (!source) return null;
  const env = source.env;
  const a = env ? effective(env) : undefined;
  const v = env?.verification;
  const highlight = page === source.page ? source.quote : undefined;
  const url = pageImageUrl(source.packageId, source.docId, page, highlight);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Source viewer">
      <div className="absolute inset-0 bg-black/30" onClick={closeSource} />
      <aside className="animate-slide-in relative flex h-full w-full max-w-[1040px] flex-col bg-surface shadow-2xl lg:w-[86vw]">
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="font-semibold uppercase tracking-wide">Source viewer</span>
              {a && <Chip size="xs">{a.clause_id} · {CLAUSE_SHORT[a.clause_id]}</Chip>}
              {a && <span className="tnum">Q {a.question_id}</span>}
            </div>
            <h2 className="mt-0.5 truncate text-[15px] font-semibold text-ink">{env?.question ?? source.title ?? `Page ${source.page}`}</h2>
          </div>
          <button onClick={closeSource} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Page image */}
          <div className="flex min-h-[320px] flex-1 flex-col border-b border-line bg-surface-2 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 text-xs">
              <button className="rounded p-1 hover:bg-surface" onClick={() => { setPage((p) => Math.max(1, p - 1)); setImgError(false); }} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <span className="tnum font-medium text-ink">{source.docId} · page {page}</span>
              <button className="rounded p-1 hover:bg-surface" onClick={() => { setPage((p) => p + 1); setImgError(false); }} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
              {page !== source.page && <button className="ml-1 text-accent-ink hover:underline" onClick={() => setPage(source.page)}>back to p.{source.page}</button>}
              <span className="ml-auto flex items-center gap-1">
                <button className="rounded p-1 hover:bg-surface" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
                <span className="w-10 text-center tnum">{Math.round(zoom * 100)}%</span>
                <button className="rounded p-1 hover:bg-surface" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
              </span>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-auto p-3">
              {imgError ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted">
                  <ImageIcon className="h-8 w-8" />
                  Page image not available (backend not running or page out of range).
                </div>
              ) : (
                <img src={url} alt={`Page ${page}`} onError={() => setImgError(true)}
                  className="mx-auto block max-w-none rounded border border-line bg-white shadow-sm" style={{ width: `${zoom * 100}%` }} />
              )}
            </div>
          </div>

          {/* Evidence */}
          <div className="scroll-thin flex w-full flex-col gap-3 overflow-y-auto p-4 lg:w-[400px]">
            {a && env ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={a.status} />
                  <VerdictChip verdict={v?.verdict} />
                  <ReviewChip decision={env.review.decision} />
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">confidence <ConfidenceBars level={a.confidence} /></span>
                </div>
                <div className="rounded-lg border border-line p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Answer{env.review.decision === "edited" ? " (edited by user)" : ""}</div>
                  <div className="mt-1 text-[14px] font-medium text-ink">{a.answer_value || "–"}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.unit && <Chip size="xs" tone="accent">unit: {a.unit}</Chip>}
                    {a.base && <Chip size="xs">base: {a.base}</Chip>}
                    {a.section_ref && <Chip size="xs">{a.section_ref}</Chip>}
                    {a.value_source && <Chip size="xs">from {a.value_source.replace("_", " ")}</Chip>}
                  </div>
                </div>
                <Quote text={a.verbatim_quote} page={a.pdf_page} section={a.section_ref} collapsed={false} />

                {a.points_to && (
                  <div className="flex items-start gap-2 rounded-lg bg-warn-soft p-2.5 text-[13px] text-warn-ink">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <div><b>Points to</b> <ArrowRight className="inline h-3 w-3" /> {a.points_to}</div>
                  </div>
                )}

                {a.conflicts.length > 0 && (
                  <div className="rounded-lg border border-warn/40 p-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-warn-ink"><GitCompareArrows className="h-4 w-4" /> {a.conflicts.length} conflicting value{a.conflicts.length > 1 ? "s" : ""}</div>
                    <ul className="flex flex-col gap-2">
                      {a.conflicts.map((c, i) => (
                        <li key={i} className="text-[13px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-ink">{c.value}</span>
                            <Chip size="xs">{c.section_ref}</Chip>
                            <button className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => setPage(c.pdf_page)}>p.{c.pdf_page}</button>
                            {c.governs === true && <Chip size="xs" tone="good">governs</Chip>}
                            {c.governs === false && <Chip size="xs">overridden</Chip>}
                            {c.governs === null && <Chip size="xs" tone="warn">governing rule unclear</Chip>}
                          </div>
                          {c.verbatim_quote && <div className="mt-0.5 font-serif text-xs text-ink-2">“{c.verbatim_quote}”</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {a.visual_check !== "none" && (
                  <div className="flex items-start gap-2 rounded-lg bg-violet-soft p-2.5 text-[13px] text-violet-ink">
                    <ImageIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div><b>Visual pass {a.visual_check}</b>{a.visual_evidence ? <>: {a.visual_evidence}</> : null}</div>
                  </div>
                )}

                {env.review.reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {env.review.reasons.map((r) => <Chip key={r} tone="warn" size="xs" icon={<FileWarning className="h-3 w-3" />}>{r}</Chip>)}
                  </div>
                )}

                {v && (
                  <Collapsible summary={<span className="flex items-center gap-2">Verification checks <span className="text-xs font-normal text-muted">{v.checks.filter((c) => c.passed === true).length} pass · {v.checks.filter((c) => c.passed === false).length} fail</span></span>} defaultOpen>
                    <ul className="flex flex-col gap-1.5">
                      {v.checks.map((c) => (
                        <li key={c.check} className="flex items-start gap-2 text-[13px]">
                          <CheckIcon passed={c.passed} />
                          <div className="min-w-0">
                            <span className={cx("font-medium", c.passed === false ? "text-bad-ink" : "text-ink")}>{c.check} · {c.name}</span>
                            {c.detail && <div className="text-xs text-muted">{c.detail}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Collapsible>
                )}

                {a.notes && (
                  <Collapsible summary={<span className="flex items-center gap-2"><StickyNote className="h-4 w-4 text-muted" /> Notes</span>}>
                    <p className="text-[13px] text-ink-2">{a.notes}</p>
                  </Collapsible>
                )}

                {env.review.decision === "edited" && (
                  <Collapsible summary="Audit trail: AI answer before edit">
                    <div className="text-[13px] text-ink-2"><StatusChip status={env.answer.status} size="xs" /> {env.answer.answer_value}</div>
                    <div className="mt-1 text-xs text-muted">p.{env.answer.pdf_page} · {env.answer.section_ref}</div>
                  </Collapsible>
                )}
              </>
            ) : (
              source.quote ? <Quote text={source.quote} page={source.page} collapsed={false} /> : <div className="text-sm text-muted">Page {source.page}</div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
