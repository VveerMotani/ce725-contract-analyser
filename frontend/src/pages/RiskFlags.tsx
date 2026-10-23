// S7 Risk flags: ranked cards, high-risk terms separate from unclear or missing terms.
import { useState } from "react";
import { AlertTriangle, BookMarked, HelpCircle, IndianRupee, Scale } from "lucide-react";
import { api } from "../api";
import { useApp, useAsync, useRun } from "../context";
import type { RiskFlag, Severity } from "../types";
import { money } from "../lib/format";
import { sortFlags } from "../lib/keyFigures";
import { RunGate } from "../components/RunGate";
import { Chip, ClampText, EmptyState, ErrorBox, KpiTile, PageHeader, Quote, SEVERITY_META, SeverityChip, Spinner, TONE_SOLID, cx } from "../components/ui";

function ClampLines({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <div className={cx("break-words", className, !open && "line-clamp-2")} title={open ? undefined : text}>{text}</div>
      {text.length > 70 && <button onClick={() => setOpen(!open)} className="text-[11.5px] font-medium text-accent-ink hover:underline">{open ? "less" : "more"}</button>}
    </div>
  );
}

function FlagCard({ f, onOpen }: { f: RiskFlag; onOpen: () => void }) {
  const { fullMoney } = useApp();
  const tone = SEVERITY_META[f.severity].tone;
  return (
    <article className="relative flex min-w-0 overflow-hidden rounded-xl border border-line bg-surface">
      <span className={cx("w-1.5 shrink-0", TONE_SOLID[tone])} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <SeverityChip severity={f.severity} />
          <h3 className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug text-ink">{f.title}</h3>
          <span className="font-mono text-[11px] text-muted" title={f.rule}>{f.flag_id}</span>
        </div>

        <div className="flex flex-wrap items-stretch gap-2">
          <div className="min-w-[220px] flex-1 rounded-lg bg-surface-2 px-3 py-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Found in contract</div>
            <ClampLines text={f.value_found || "–"} className="mt-0.5 text-[14px] font-semibold text-ink" />
          </div>
          <div className="min-w-[220px] flex-1 rounded-lg border border-dashed border-line-strong px-3 py-2">
            <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted"><Scale className="h-3 w-3" /> Reference</div>
            <ClampLines text={f.reference_value || "–"} className="mt-0.5 text-[14px] font-semibold text-ink-2" />
            {f.reference_source && <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted" title={f.reference_source}><BookMarked className="h-3 w-3 shrink-0" /><span className="truncate">{f.reference_source}</span></div>}
          </div>
          {f.rupee_impact != null && f.rupee_impact > 0 && (
            <div className="flex shrink-0 flex-col justify-center rounded-lg bg-bad-soft/60 px-3 py-2">
              <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-bad-ink"><IndianRupee className="h-3 w-3" />Impact</div>
              <div className="whitespace-nowrap text-[15px] font-semibold text-ink tnum">{money(f.rupee_impact, fullMoney)}</div>
            </div>
          )}
        </div>

        <ClampText text={f.explanation} />
        {f.quote ? <Quote text={f.quote} page={f.pdf_page} section={f.section_ref} onOpen={onOpen} /> : null}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span className="truncate" title={f.rule}>Rule: {f.rule}</span>
          {f.question_ids.map((q) => <Chip key={q} size="xs">Q {q}</Chip>)}
        </div>
      </div>
    </article>
  );
}

const ORDER: Severity[] = ["High", "Medium", "Low", "Info", "Needs review"];

function Inner() {
  const { runId, answers, openAnswer, openPage } = useRun();
  const { fullMoney } = useApp();
  const flags = useAsync(() => api.flags(runId), [runId]);
  const [sev, setSev] = useState<Severity | "all">("all");
  if (flags.loading) return <Spinner />;
  if (flags.error) return <ErrorBox error={flags.error} />;
  const all = sortFlags(flags.data!);
  const filt = sev === "all" ? all : all.filter((f) => f.severity === sev);
  const risk = filt.filter((f) => f.category === "risk");
  const unclear = filt.filter((f) => f.category === "unclear");
  const impact = all.reduce((a, f) => a + (f.rupee_impact ?? 0), 0);
  const open = (f: RiskFlag) => {
    const env = answers!.find((e) => f.question_ids.includes(e.answer.question_id) && e.answer.pdf_page === f.pdf_page) ?? answers!.find((e) => e.answer.question_id === f.question_ids[0]);
    if (env) openAnswer(env); else openPage(f.pdf_page, f.quote, "d1", f.title);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ORDER.map((s) => {
          const n = all.filter((f) => f.severity === s).length;
          return (
            <KpiTile key={s} label={s} value={n} tone={n ? SEVERITY_META[s].tone : undefined} onClick={() => setSev(sev === s ? "all" : s)}
              className={cx(sev === s && "ring-2 ring-accent")} />
          );
        })}
        <KpiTile label="Rupee impact" value={money(impact, fullMoney)} sub="sum of quantified flags" icon={<IndianRupee className="h-3.5 w-3.5" />} />
      </div>
      {sev !== "all" && <div><button onClick={() => setSev("all")}><Chip tone="accent">Showing {sev} only · clear</Chip></button></div>}

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink"><AlertTriangle className="h-4 w-4 text-bad" /> High-risk terms <span className="text-xs font-normal text-muted">{risk.length}</span></h2>
        {risk.length ? <div className="grid gap-3 min-[1600px]:grid-cols-2">{risk.map((f, i) => <FlagCard key={f.flag_id + i} f={f} onOpen={() => open(f)} />)}</div>
          : <EmptyState title="No high-risk terms">No rule fired at this filter.</EmptyState>}
      </section>
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink"><HelpCircle className="h-4 w-4 text-violet" /> Unclear or missing terms <span className="text-xs font-normal text-muted">{unclear.length}</span></h2>
        {unclear.length ? <div className="grid gap-3 min-[1600px]:grid-cols-2">{unclear.map((f, i) => <FlagCard key={f.flag_id + i} f={f} onOpen={() => open(f)} />)}</div>
          : <EmptyState title="Nothing unclear">Every term was found or confirmed absent.</EmptyState>}
      </section>
      <p className="text-xs text-muted">Thresholds are starting points from the sources shown, not law. Flags are written from the contractor's side.</p>
    </div>
  );
}

export default function RiskFlags() {
  return (
    <>
      <PageHeader title="Risk flags" subtitle="Contract terms that cost the contractor cash or certainty, ranked by severity." />
      <RunGate><Inner /></RunGate>
    </>
  );
}
