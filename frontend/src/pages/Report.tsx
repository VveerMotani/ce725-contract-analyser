// The contract report as a factsheet: key figures and flag tally, six term cards, red/green flags, cash.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileText, Lightbulb, X } from "lucide-react";
import { api, contractPdfUrl } from "../api";
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
import { KeyFacts, ToCash } from "./KeyFacts";
import { DocQuality } from "./DocQuality";
import { examplesUsed, overridesFor, stillMissing, useFiguresVersion, withFigures } from "../lib/figures";
import { FiguresNeeded, FiguresUsed } from "../components/FiguresNeeded";

const TIP_KEY = "cmt.reportTipSeen";

/** A one-time tip on how to use the summary, until the visitor closes it. */
function FirstTip() {
  const [show, setShow] = useState(() => { try { return localStorage.getItem(TIP_KEY) !== "1"; } catch { return true; } });
  if (!show) return null;
  const close = () => { setShow(false); try { localStorage.setItem(TIP_KEY, "1"); } catch { /* private mode */ } };
  return (
    <div className="mt-5 flex items-start gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-[14px] text-ink">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
      <p className="flex-1">
        Click any of the six term cards for the full detail. Page numbers like <span className="tnum">“p. 13”</span> open the contract
        with the sentence highlighted. <Link to="/help" className="text-accent-ink underline">How to use this site</Link>
      </p>
      <button onClick={close} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Close the tip"><X className="h-4 w-4" /></button>
    </div>
  );
}

/** "View the contract (PDF)": the file(s) that were read, opened in a new tab. */
function ContractPdfs({ packageId }: { packageId: string }) {
  const pkg = useAsync(() => api.package(packageId).catch(() => undefined), [packageId]);
  const files = (pkg.data?.files ?? []).filter((f) => contractPdfUrl(packageId, f.doc_id));
  if (!files.length) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {files.map((f) => (
        <a key={f.doc_id} href={contractPdfUrl(packageId, f.doc_id)!} target="_blank" rel="noreferrer" title={f.filename}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1 text-[13.5px] text-ink hover:border-accent">
          <FileText className="h-3.5 w-3.5 text-accent-ink" aria-hidden />
          {files.length > 1 ? f.filename.replace(/\.pdf$/i, "") : "View the contract (PDF)"}
        </a>
      ))}
    </span>
  );
}

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
  const params = useAsync(() => api.params(runId), [runId]);
  const [ver, setVer] = useState(0);
  // Cash figures only from the contract and what the visitor typed: none while a figure is missing.
  const figVer = useFiguresVersion();
  const [editing, setEditing] = useState(false);
  const overrides = useMemo(() => overridesFor(runId, params.data), [runId, params.data, figVer]);
  const left = useMemo(() => stillMissing(runId, params.data), [runId, params.data, figVer]);
  const examples = useMemo(() => examplesUsed(runId, params.data), [runId, params.data, figVer]);
  const ready4cash = !!params.data && left.length === 0;
  const cash = useAsync(() => (ready4cash ? api.cashflow(runId, overrides) : Promise.resolve(undefined)),
    [runId, ver, ready4cash, JSON.stringify(overrides)]);
  const flags = useAsync(() => api.flags(runId), [runId, !!cash.data]);
  const checks = useAsync(() => api.checks(runId).catch(() => undefined), [runId, !!cash.data]);
  const envs = answers!;

  const sc = useMemo(() => scorecard(checks.data, flags.data ?? []), [checks.data, flags.data]);
  const shown = useMemo(() => withFigures(params.data, overrides), [params.data, overrides]);
  const k = useMemo(() => keyFacts(envs, shown), [envs, shown]);
  const ready = !flags.loading && !checks.loading && !params.loading;
  const toFlags = () => document.getElementById("flags")?.scrollIntoView({ behavior: "smooth" });
  const w = cash.data?.as_written;

  return (
    <article>
      <header className="pb-7">
        <h1 className="font-serif text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">{title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
          <span>{sourceNote(meta!)}</span>
          <ContractPdfs packageId={meta!.package_id} />
        </div>
        <FirstTip />
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Figure label="Contract value" value={k.value} note={k.valueNote} />
          <Figure label="Duration" value={k.dur} note={k.durNote} />
          <Figure label="Defects period" value={k.dlp} />
          <Figure label="Peak funding" value={w ? money(w.peak_funding) : left.length ? <span className="text-[17px]"><ToCash /></span> : "—"}
            note={w && examples.length ? <span className="text-warn">{w.peak_funding > 0 ? `month ${w.peak_month} · ` : ""}with example figures</span>
              : w && w.peak_funding > 0 ? `month ${w.peak_month}` : w ? "none needed" : left.length ? "your own costs are never in a contract" : undefined} />
        </div>
        {w && examples.length > 0 && (
          <p className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13.5px] text-ink">
            The cash figures on this page use <b className="font-medium">example figures</b> for {examples.length === 1 ? "one input" : `${examples.length} inputs`} the
            contract does not give. They show how the model works, not this contract. <ToCash label="See or change them ↓" />
          </p>
        )}
        <DocQuality />
        {ready && <Tally t={sc.tally} hasChecks={sc.hasChecks} onClick={toFlags} className="mt-6" />}
      </header>

      <Section title="Money terms">
        {!ready ? <Spinner /> : <TermCards answers={envs} params={shown} cash={w} sc={sc} />}
      </Section>

      <Section id="key-facts" className="mt-10" title="Key facts">
        {!ready ? <Spinner /> : <KeyFacts answers={envs} params={shown} cash={w} flags={flags.data ?? []} checks={checks.data} />}
      </Section>

      <Section id="flags" className="mt-10" title="Flags">
        {flags.error ? <ErrorNote error={flags.error} title="Could not load the flags" /> : !ready ? <Spinner /> : <FlagBoard sc={sc} />}
      </Section>

      <Section id="cash" className="mt-10" title="Cash" aside={
        <InfoTip label="How to read the cash chart">
          Cash position each month: money received minus money spent on the work. Below zero, the work is funded from your own pocket.
          The dashed line is the same contract with fair reference terms.
        </InfoTip>
      }>
        {params.error ? <ErrorNote error={params.error} title="No cash figures yet" />
          : !params.data ? <CashLoading />
          : left.length || editing ? <FiguresNeeded key={String(editing)} runId={runId} params={params.data} onDone={() => setEditing(false)} />
          : cash.error ? <ErrorNote error={cash.error} title="Cash model failed" />
          : !cash.data ? <CashLoading />
          : <>
              <CashEffect params={params.data} base={cash.data} extra={overrides} onParams={(p) => { params.setData(p); setVer((v) => v + 1); }} />
              <FiguresUsed runId={runId} params={params.data} onChange={() => setEditing(true)} />
            </>}
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
