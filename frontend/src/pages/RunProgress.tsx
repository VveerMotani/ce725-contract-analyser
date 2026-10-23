// S3 Run progress: stage stepper, progress bar (polled every 2 s by RunProvider), log, model and usage.
import { Link } from "react-router-dom";
import { AlertOctagon, ArrowRight, Check, Cpu, Database, Loader2, Terminal, Zap } from "lucide-react";
import { useRun } from "../context";
import { fmtDate, tokens } from "../lib/format";
import { Card, Chip, Collapsible, ErrorBox, KpiTile, PageHeader, Spinner, cx } from "../components/ui";

const STAGES: { id: string; label: string; hint: string }[] = [
  { id: "ingest", label: "Ingest", hint: "Hash files, read page text" },
  { id: "retrieve", label: "Retrieve", hint: "Candidate pages per clause type" },
  { id: "extract", label: "Extract", hint: "One AI call per clause type" },
  { id: "crossref", label: "Cross-references", hint: "Follow 'as per Schedule' pointers" },
  { id: "absence", label: "Absence check", hint: "Search again before 'not stated'" },
  { id: "visual", label: "Visual pass", hint: "Read flagged pages as images" },
  { id: "verify", label: "Verify", hint: "Quotes, pages, numbers" },
  { id: "flags", label: "Flags", hint: "Risk rules R1–R18" },
  { id: "done", label: "Done", hint: "Results ready" },
];

export default function RunProgress() {
  const { meta, metaError, runId } = useRun();
  if (metaError && !meta) return <ErrorBox error={metaError} title="Could not load run" />;
  if (!meta) return <Spinner />;

  const isErr = meta.stage === "error";
  const idx = STAGES.findIndex((s) => s.id === meta.stage);
  const errIdx = isErr ? Math.max(0, STAGES.findIndex((s) => meta.log.at(-1)?.includes(`[${s.id}]`))) : -1;
  const current = isErr ? errIdx : meta.stage === "queued" ? -1 : idx;
  const pctDone = Math.round(meta.progress * 100);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Run progress" subtitle={<span className="font-mono text-xs">{meta.run_id}</span>}
        actions={meta.stage === "done" ? <Link to={`/runs/${runId}/overview`} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110">See results <ArrowRight className="h-4 w-4" /></Link> : undefined} />

      {isErr && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-bad/40 bg-bad-soft p-4 text-bad-ink">
          <AlertOctagon className="mt-0.5 h-6 w-6 shrink-0" />
          <div>
            <div className="text-[15px] font-semibold">The run stopped</div>
            <div className="mt-0.5 text-[14px]">{meta.error || "Unknown error. See the log below."}</div>
          </div>
        </div>
      )}

      <Card className="mb-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="text-3xl font-semibold text-ink tnum">{pctDone}%</div>
          <div className="flex-1">
            <div className="h-2.5 overflow-hidden rounded-full bg-line">
              <div className={cx("h-full rounded-full transition-all duration-700", isErr ? "bg-bad" : meta.stage === "done" ? "bg-good" : "bg-accent")} style={{ width: `${pctDone}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>{meta.stage === "done" ? "Finished" : isErr ? "Stopped" : meta.stage === "queued" ? "Queued" : `Stage: ${STAGES[idx]?.label ?? meta.stage}`}</span>
              <span>started {fmtDate(meta.started_at)}{meta.finished_at ? ` · finished ${fmtDate(meta.finished_at)}` : ""}</span>
            </div>
          </div>
        </div>
        <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {STAGES.map((s, i) => {
            const state = i < current || meta.stage === "done" ? "done" : i === current ? (isErr ? "error" : "active") : "todo";
            return (
              <li key={s.id} className={cx("flex flex-col items-center gap-1 rounded-lg border p-2 text-center",
                state === "done" && "border-good/30 bg-good-soft", state === "active" && "border-accent bg-accent-soft", state === "error" && "border-bad bg-bad-soft", state === "todo" && "border-line")}>
                <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                  state === "done" ? "bg-good text-white" : state === "active" ? "bg-accent text-white" : state === "error" ? "bg-bad text-white" : "bg-line text-muted")}>
                  {state === "done" ? <Check className="h-3.5 w-3.5" /> : state === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "error" ? "!" : i + 1}
                </span>
                <span className="text-[12px] font-medium text-ink">{s.label}</span>
                <span className="hidden text-[10.5px] leading-tight text-muted xl:block">{s.hint}</span>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="AI calls" value={meta.llm_calls} icon={<Zap className="h-3.5 w-3.5" />} />
        <KpiTile label="Cache hits" value={meta.cache_hits} sub={meta.llm_calls ? `${Math.round((meta.cache_hits / Math.max(1, meta.llm_calls)) * 100)}% of calls` : undefined} icon={<Database className="h-3.5 w-3.5" />} />
        <KpiTile label="Input tokens" value={tokens(meta.input_tokens)} icon={<Cpu className="h-3.5 w-3.5" />} />
        <KpiTile label="Output tokens" value={tokens(meta.output_tokens)} icon={<Cpu className="h-3.5 w-3.5" />} />
      </div>

      <Card title="Run settings" className="mb-4">
        <div className="flex flex-wrap gap-2">
          <Chip tone="accent">model: {meta.model || "–"}</Chip>
          <Chip>prompt {meta.prompt_version}</Chip>
          <Chip>schema {meta.schema_version}</Chip>
          <Chip>effort: {meta.effort || "–"}</Chip>
          <Chip>package: {meta.package_id}</Chip>
          {meta.frozen && <Chip>frozen demo run</Chip>}
        </div>
      </Card>

      <Collapsible defaultOpen={meta.stage !== "done"} summary={<span className="flex items-center gap-2"><Terminal className="h-4 w-4 text-muted" /> Log <span className="text-xs font-normal text-muted">{meta.log.length} lines</span></span>}>
        <pre className="scroll-thin max-h-[320px] overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink-2">
          {meta.log.length ? meta.log.join("\n") : "No log lines yet."}
        </pre>
      </Collapsible>
    </div>
  );
}
