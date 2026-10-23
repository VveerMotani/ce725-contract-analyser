// The contract report as a factsheet: key figures and flag tally, six term cards, red/green flags, cash.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "../api";
import { useApp, useAsync, useRun } from "../context";
import { effective, type AnswerEnvelope, type CashParams } from "../types";
import { money } from "../lib/format";
import { sourceNote } from "../lib/plain";
import { scorecard } from "../lib/scorecard";
import { usable } from "../lib/terms";
import { RunReady } from "../components/RunReady";
import { Tally } from "../components/Tally";
import { ErrorNote, Figure, InfoTip, Section, Spinner } from "../components/ui";
import { CashEffect, CashLoading } from "./CashEffect";
import { TermCards } from "./TermCards";
import { FlagBoard } from "./Flags";

function useTitle(): string {
  const { meta } = useRun();
  const { benchmarks } = useApp();
  const bm = benchmarks?.find((b) => b.contract_id === meta?.contract_id);
  const pkg = useAsync(() => (meta && benchmarks && !bm ? api.package(meta.package_id).then((p) => p.title).catch(() => "") : Promise.resolve("")), [meta?.package_id, !!benchmarks, !!bm]);
  return bm?.title ?? (pkg.data || meta?.contract_id || "");
}

/** Contract value, duration and defects period. A default parameter is never shown as a contract fact. */
function keyFacts(answers: AnswerEnvelope[], params: CashParams | undefined) {
  const ans = (q: string) => { const e = answers.find((x) => x.answer.question_id === q); return e ? effective(e) : null; };
  const inp = params?.inputs;
  const v = ans("0.3"), d = ans("0.4"), dl = ans("0.5");
  const vSrc = usable(params, "contract_value");
  let value = "—", valueNote: string | undefined;
  if (inp && vSrc && inp.contract_value > 0) { value = money(inp.contract_value); valueNote = vSrc === "user" ? "your figure" : undefined; }
  else if (v?.status === "FOUND") { const m = v.answer_value.match(/Rs\.?\s?[\d,.]+\s*(lakhs?|lacs?|crores?)?/i); value = m ? m[0] : "—"; }
  let dur = "—", durNote: string | undefined;
  const dm = d?.status === "FOUND" ? d.answer_value.match(/\b\d+(\.\d+)?\s*(days?|months?|years?|weeks?)\b/i) : null;
  if (dm) dur = dm[0];
  else if (inp && usable(params, "duration_months")) { dur = `${inp.duration_months} months`; durNote = usable(params, "duration_months") === "user" ? "your figure" : undefined; }
  const dlNone = dl?.status === "FOUND" && /^\s*no\b|not stated/i.test(dl.answer_value);
  const lm = dl?.status === "FOUND" && !dlNone ? dl.answer_value.match(/\b\d+(\.\d+)?\s*(days?|months?|years?)\b/i) : null;
  return { value, valueNote, dur, durNote, dlp: dlNone ? "None stated" : lm ? lm[0] : "—" };
}

function Inner() {
  const { runId, meta, answers, pending } = useRun();
  const title = useTitle();
  const flags = useAsync(() => api.flags(runId), [runId]);
  const checks = useAsync(() => api.checks(runId).catch(() => undefined), [runId]);
  const params = useAsync(() => api.params(runId), [runId]);
  const [ver, setVer] = useState(0);
  const cash = useAsync(() => api.cashflow(runId), [runId, ver]);
  const envs = answers!;

  const sc = useMemo(() => scorecard(checks.data, flags.data ?? []), [checks.data, flags.data]);
  const k = useMemo(() => keyFacts(envs, params.data), [envs, params.data]);
  const ready = !flags.loading && !checks.loading && !params.loading;
  const toFlags = () => document.getElementById("flags")?.scrollIntoView({ behavior: "smooth" });
  const w = cash.data?.as_written;

  return (
    <article>
      <header className="pb-7">
        <h1 className="font-serif text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">{title}</h1>
        <div className="mt-1.5 text-[12.5px] text-muted">{sourceNote(meta!)}</div>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Figure label="Contract value" value={k.value} note={k.valueNote} />
          <Figure label="Duration" value={k.dur} note={k.durNote} />
          <Figure label="Defects period" value={k.dlp} />
          <Figure label="Peak funding" value={w ? money(w.peak_funding) : "—"} note={w && w.peak_funding > 0 ? `month ${w.peak_month}` : w ? "none needed" : undefined} />
        </div>
        {ready && <Tally t={sc.tally} hasChecks={sc.hasChecks} onClick={toFlags} className="mt-6" />}
      </header>

      <Section title="Money terms">
        {!ready ? <Spinner /> : <TermCards answers={envs} params={params.data} cash={w} sc={sc} />}
      </Section>

      <Section id="flags" className="mt-10" title="Flags">
        {flags.error ? <ErrorNote error={flags.error} title="Could not load the flags" /> : !ready ? <Spinner /> : <FlagBoard sc={sc} />}
      </Section>

      <Section className="mt-10" title="Cash" aside={
        <InfoTip label="How to read the cash chart">
          Cash position each month: money received minus money spent on the work. Below zero, the work is funded from your own pocket.
          The dashed line is the same contract with fair reference terms.
        </InfoTip>
      }>
        {params.error ? <ErrorNote error={params.error} title="No cash figures yet" />
          : cash.error ? <ErrorNote error={cash.error} title="Cash model failed" />
          : !params.data || !cash.data ? <CashLoading />
          : <CashEffect params={params.data} base={cash.data} onParams={(p) => { params.setData(p); setVer((v) => v + 1); }} />}
      </Section>

      <div className="mt-10">
        {pending > 0 ? (
          <Link to={`/runs/${runId}/answers?filter=check`} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-[14px] text-ink hover:border-accent">
            <span className="inline-block h-2 w-2 rounded-full bg-warn" aria-hidden /> {pending} answers to confirm <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link to={`/runs/${runId}/answers`} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-[14px] text-ink hover:border-accent">
            <span className="text-good" aria-hidden>✓</span> All answers confirmed <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </article>
  );
}

export default function Report() {
  return <RunReady><Inner /></RunReady>;
}
