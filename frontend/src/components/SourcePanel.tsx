// Side panel: the contract page with the quoted sentence highlighted, the answer in words,
// and (collapsed) how the tool checked it.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { pageImageUrl } from "../api";
import { useApp } from "../context";
import { effective } from "../types";
import { STATUS_LONG, TERM_NAME, checkPlain, reasonsPlain, topic } from "../lib/plain";
import { elsewhereTarget } from "../lib/terms";
import { Disclosure, cx } from "./ui";

export function SourcePanel() {
  const { source, closeSource } = useApp();
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [imgError, setImgError] = useState(false);
  /** the highlighted image failed: show the plain page instead */
  const [plain, setPlain] = useState(false);

  useEffect(() => {
    if (source) { setPage(source.page || 1); setImgError(false); setPlain(false); }
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
  const hasPage = (source.page ?? 0) > 0;
  const highlight = page === source.page && !plain ? source.quote : undefined;
  const url = hasPage ? pageImageUrl(source.packageId, source.docId, page, highlight) : "";
  const label = a ? TERM_NAME[a.clause_id] : source.subtitle;
  const title = env ? env.question : source.title ?? `Page ${source.page}`;
  const go = (p: number) => { setPage(Math.max(1, p)); setImgError(false); setPlain(false); };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="The contract page">
      <div className="absolute inset-0 bg-black/25" onClick={closeSource} />
      <aside className="animate-slide-in relative flex h-full w-full max-w-[760px] flex-col bg-page shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            {label && <div className="text-[13px] text-muted">{source.subtitle ?? label}{a ? ` · ${topic(a.question_id)}` : ""}</div>}
            <h2 className="mt-0.5 font-serif text-[19px] font-semibold leading-snug text-ink">{title}</h2>
          </div>
          <button onClick={closeSource} className="rounded p-1.5 text-muted hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {a && env && (
            <div className="border-b border-line px-5 py-4">
              {a.status === "FOUND" ? (
                <p className="text-[16px] text-ink">{a.answer_value || "–"}</p>
              ) : (
                <>
                  <p className="text-[16px] font-medium text-ink">
                    {a.status === "POINTS_ELSEWHERE" && elsewhereTarget(a) ? `In another document: ${elsewhereTarget(a)}` : STATUS_LONG[a.status]}
                  </p>
                  {a.answer_value && <p className="mt-1 text-[14.5px] text-ink-2">{a.answer_value}</p>}
                </>
              )}
              {a.verbatim_quote && (
                <blockquote className="mt-3 border-l-2 border-accent pl-3 font-serif text-[15.5px] leading-relaxed text-ink-2">
                  “{a.verbatim_quote}”
                  <div className="mt-1 font-sans text-[13px] text-muted">{[a.section_ref, a.pdf_page ? `page ${a.pdf_page}` : ""].filter(Boolean).join(", ")}</div>
                </blockquote>
              )}
              {env.review.decision === "edited" && (
                <p className="mt-3 text-[13.5px] text-muted">You corrected this answer. The tool first said: “{env.answer.answer_value || STATUS_LONG[env.answer.status]}”.</p>
              )}
              {env.review.decision === "rejected" && <p className="mt-3 text-[13.5px] text-muted">You rejected this answer, so it is left out of the warnings and the cash model.</p>}
              {a.conflicts.length > 0 && (
                <div className="mt-3 text-[14px]">
                  <div className="font-medium text-ink">The document also says:</div>
                  <ul className="mt-1 flex flex-col gap-1">
                    {a.conflicts.map((c, i) => (
                      <li key={i} className="text-ink-2">
                        {c.value} <button className="text-accent-ink hover:underline" onClick={() => go(c.pdf_page)}>(p. {c.pdf_page})</button>
                        {c.governs === true ? " — this one applies." : c.governs === false ? " — overridden." : " — which one applies is unclear."}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {!env && source.quote && (
            <blockquote className="border-b border-line px-5 py-4 font-serif text-[15.5px] leading-relaxed text-ink-2">“{source.quote}”</blockquote>
          )}

          {hasPage ? (
            <div className="px-3 py-3 sm:px-5">
              <div className="mb-2 flex items-center gap-1 text-[13.5px] text-muted">
                <button className="rounded p-1 hover:text-ink" onClick={() => go(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                <span className="tnum">Page {page}</span>
                <button className="rounded p-1 hover:text-ink" onClick={() => go(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                {page !== source.page && <button className="ml-1 text-accent-ink hover:underline" onClick={() => go(source.page)}>back to page {source.page}</button>}
                <span className="ml-auto flex items-center gap-1">
                  <button className="rounded p-1 hover:text-ink" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))} aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
                  <span className="w-10 text-center tnum">{Math.round(zoom * 100)}%</span>
                  <button className="rounded p-1 hover:text-ink" onClick={() => setZoom((z) => Math.min(2.6, +(z + 0.2).toFixed(1)))} aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
                </span>
              </div>
              <div className="overflow-auto">
                {imgError ? (
                  <div className="py-16 text-center text-[14px] text-muted">The page image is not available.</div>
                ) : (
                  <img src={url} alt={`Contract page ${page}`} onError={() => (highlight ? setPlain(true) : setImgError(true))}
                    className="mx-auto block max-w-none border border-line bg-white" style={{ width: `${zoom * 100}%` }} />
                )}
              </div>
            </div>
          ) : (
            <p className="px-5 py-6 text-[14.5px] text-muted">There is no page to show: the tool found no sentence for this in the document.</p>
          )}

          {env && (v || env.review.reasons.length > 0) && (
            <div className="border-t border-line px-5 py-4">
              <Disclosure summary="How the tool checked this">
                {env.review.reasons.length > 0 && (
                  <ul className="mb-3 flex list-disc flex-col gap-1 pl-5 text-[14px] text-ink-2">
                    {reasonsPlain(env.review.reasons).map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}
                {v && (
                  <ul className="flex flex-col gap-1 text-[14px]">
                    {v.checks.map((c) => (
                      <li key={c.check} className="flex gap-2">
                        <span className={cx("w-4 shrink-0 text-center", c.passed === true ? "text-good" : c.passed === false ? "text-warn" : "text-muted")}>
                          {c.passed === true ? "✓" : c.passed === false ? "!" : "–"}
                        </span>
                        <span className="text-ink-2">{checkPlain(c.check, c.name)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {a && <p className="mt-3 text-[13px] text-muted">The tool’s own confidence: {a.confidence}.</p>}
              </Disclosure>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
