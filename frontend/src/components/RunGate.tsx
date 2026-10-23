import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertOctagon } from "lucide-react";
import { useRun } from "../context";
import { EmptyState, ErrorBox, Spinner } from "./ui";

/** Renders children only when the run is finished and its answers are loaded. */
export function RunGate({ children, needAnswers = true }: { children: ReactNode; needAnswers?: boolean }) {
  const { meta, metaError, answers, answersError, runId } = useRun();
  if (metaError && !meta) return <ErrorBox error={metaError} title="Could not load this run" />;
  if (!meta) return <Spinner label="Loading run…" />;
  if (meta.stage === "error") {
    return (
      <EmptyState icon={<AlertOctagon className="h-8 w-8 text-bad" />} title="This run stopped with an error">
        <p className="font-medium text-bad-ink">{meta.error || "Unknown error"}</p>
        <Link className="mt-2 inline-block text-accent-ink underline" to={`/runs/${runId}/progress`}>Open run progress</Link>
      </EmptyState>
    );
  }
  if (meta.stage !== "done") {
    return (
      <EmptyState icon={<Activity className="h-8 w-8 text-accent" />} title={`Analysis in progress (${Math.round(meta.progress * 100)}%)`}>
        Results appear here when the run finishes. <Link className="text-accent-ink underline" to={`/runs/${runId}/progress`}>Watch progress</Link>
      </EmptyState>
    );
  }
  if (needAnswers) {
    if (answersError) return <ErrorBox error={answersError} title="Could not load answers" />;
    if (!answers) return <Spinner label="Loading answers…" />;
  }
  return <>{children}</>;
}
