// Shows a live "reading" screen while a run is in progress, and renders children once it is done.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { useRun } from "../context";
import type { RunMeta } from "../types";
import { ErrorNote, PageTitle, Spinner, cx } from "./ui";

/** The steps a visitor sees, and which pipeline stages belong to each. */
const STEPS: { label: string; stages: string[] }[] = [
  { label: "Opening the PDF and reading the page text", stages: ["queued", "ingest"] },
  { label: "Finding the pages that talk about money", stages: ["retrieve"] },
  { label: "Reading the contract facts and the six money terms", stages: ["extract"] },
  { label: "Following references and looking again for anything missing", stages: ["crossref", "absence", "visual"] },
  { label: "Checking every quote against its page", stages: ["verify"] },
  { label: "Working out the cash effect and the flags", stages: ["params", "cashflow", "flags", "score"] },
];
const CLAUSE_GROUPS = 7;   // C0 contract facts + C1..C6

function stepOf(stage: string): number {
  const i = STEPS.findIndex((s) => s.stages.includes(stage));
  return i < 0 ? 0 : i;
}

/** What the latest log line says, in plain words, e.g. "Advances (4 of 7)". */
function detailOf(meta: RunMeta): string {
  const last = (meta.log[meta.log.length - 1] || "").replace(/^\S+\s/, "");
  const c = last.match(/^C(\d) (.+)$/);
  if (c) return `${c[2]} (${+c[1] + 1} of ${CLAUSE_GROUPS})`;
  if (/^Absence check/i.test(last)) return "double-checking answers marked as not found";
  return "";
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

/** Seconds since the run started, ticking every second. Uses the server's clock for both ends. */
function useElapsed(meta: RunMeta): number {
  const offset = useMemo(() => (meta.server_now ? seconds(meta.server_now) - Date.now() / 1000 : 0), [meta]);
  const [nowS, setNowS] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNowS(Date.now() / 1000), 1000); return () => clearInterval(t); }, []);
  const start = seconds(meta.started_at);
  return Number.isFinite(start) ? Math.max(0, nowS + offset - start) : 0;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Time left. Reading the terms (10–70% of the bar) takes almost all the time; the steps after it take about half a minute. */
function timeLeft(elapsed: number, p: number): string {
  if (p < 0.12 || elapsed < 20) return "usually 5–15 minutes in all";
  const rest = p < 0.7 ? (elapsed * (0.7 - p)) / (p - 0.08) + 30 : 30 * (1 - p) / 0.3;
  const min = Math.ceil(rest / 60);
  return rest < 50 ? "less than a minute left" : `about ${min} min left`;
}

function Reading({ meta, title, runId }: { meta: RunMeta; title?: string; runId: string }) {
  const p = Math.max(0, Math.min(1, meta.progress));
  const elapsed = useElapsed(meta);
  const cur = stepOf(meta.stage);
  const detail = cur === 2 || cur === 3 ? detailOf(meta) : "";
  return (
    <div>
      <PageTitle title={title || "Reading the contract"}
        intro="This page updates by itself. You can leave and come back later: the reading carries on, and the contract is under “Open a contract” in the top bar." />
      <div className="max-w-[560px]" role="status" aria-live="polite">
        <div className="flex items-baseline justify-between gap-4 text-[14.5px]">
          <span className="flex items-center gap-2 text-ink">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
            {STEPS[cur].label}…
          </span>
          <span className="tnum text-muted">{Math.round(p * 100)}%</span>
        </div>
        <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.max(p * 100, 2)}%` }} />
          <div className="absolute inset-y-0 left-0 w-1/4 animate-sweep rounded-full bg-white/30" aria-hidden />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-[13.5px] text-muted">
          <span className="tnum">Time taken {clock(elapsed)}</span>
          <span>{timeLeft(elapsed, p)}</span>
        </div>
        {detail && <p className="mt-1 text-[13.5px] text-ink-2">Now: {detail}</p>}

        <ol className="mt-6 flex flex-col gap-2.5 text-[14.5px]">
          {STEPS.map((s, i) => (
            <li key={s.label} className={cx("flex items-center gap-3", i < cur ? "text-ink-2" : i === cur ? "font-medium text-ink" : "text-muted")}>
              <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                i < cur ? "border-good bg-good text-white" : i === cur ? "border-accent" : "border-line-strong")} aria-hidden>
                {i < cur ? <Check className="h-3 w-3" /> : i === cur ? <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> : null}
              </span>
              <span>{s.label}<span className="sr-only">{i < cur ? " (done)" : i === cur ? " (now)" : ""}</span></span>
            </li>
          ))}
        </ol>
        <Link className="mt-6 inline-block text-[13.5px] text-accent-ink hover:underline" to={`/runs/${runId}/technical`}>Progress log</Link>
      </div>
    </div>
  );
}

export function RunReady({ children, title }: { children: ReactNode; title?: string }) {
  const { meta, metaError, answers, answersError, runId } = useRun();
  if (metaError && !meta) return <ErrorNote error={metaError} title="Could not open this contract" />;
  if (!meta) return <Spinner label="Opening the contract…" />;
  if (meta.stage === "error") {
    return (
      <div>
        <PageTitle title="Reading stopped" intro={meta.error || "Error"} />
        <Link className="text-[14.5px] text-accent-ink hover:underline" to={`/runs/${runId}/technical`}>Technical details</Link>
      </div>
    );
  }
  if (meta.stage !== "done") return <Reading meta={meta} title={title} runId={runId} />;
  if (answersError) return <ErrorNote error={answersError} title="Could not load the answers" />;
  if (!answers) return <Spinner label="Loading the answers…" />;
  return <>{children}</>;
}
