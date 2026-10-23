// Shows a calm "reading" state while a run is in progress, and renders children once it is done.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useRun } from "../context";
import { ErrorNote, PageTitle, Spinner } from "./ui";

const STEP: Record<string, string> = {
  queued: "Waiting to start",
  ingest: "Opening the files and reading the page text",
  retrieve: "Finding the pages that talk about money",
  extract: "Reading the money terms",
  crossref: "Following references to schedules and other documents",
  absence: "Searching again for anything that seems missing",
  visual: "Reading tables, tick boxes and scanned pages",
  verify: "Checking every quote against its page",
  flags: "Looking for risky terms",
};

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
  if (meta.stage !== "done") {
    const p = Math.round(meta.progress * 100);
    return (
      <div>
        <PageTitle title={title || "Reading the contract"} intro="Updates by itself · usually a few minutes" />
        <div className="max-w-[520px]">
          <div className="flex items-baseline justify-between text-[14.5px]">
            <span className="text-ink">{STEP[meta.stage] ?? "Working"}…</span>
            <span className="tnum text-muted">{p}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${p}%` }} />
          </div>
          <Link className="mt-4 inline-block text-[13.5px] text-accent-ink hover:underline" to={`/runs/${runId}/technical`}>Progress log</Link>
        </div>
      </div>
    );
  }
  if (answersError) return <ErrorNote error={answersError} title="Could not load the answers" />;
  if (!answers) return <Spinner label="Loading the answers…" />;
  return <>{children}</>;
}
