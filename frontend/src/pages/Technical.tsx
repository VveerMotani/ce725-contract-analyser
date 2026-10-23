// Technical details: everything a reviewer of the tool (not a bid manager) might want, off the main path.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, exportCsvUrl, isMock, reportPdfUrl } from "../api";
import { useAsync, useRun } from "../context";
import type { DocTag } from "../types";
import { fmtDate, num, tokens } from "../lib/format";
import { runSource, sortFlags, sourceShort } from "../lib/plain";
import { Disclosure, ErrorNote, PageTitle, Spinner } from "../components/ui";

const TAG: Record<DocTag, string> = {
  notice: "Tender notice / RFP", gcc: "General conditions", schedules: "Schedules / contract data", special: "Special conditions",
  amendment: "Amendment", boq: "Bill of quantities / programme", other: "Other",
};

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="break-words text-ink">{v || "–"}</dd>
    </>
  );
}

export default function Technical() {
  const { runId, meta, metaError, openPage } = useRun();
  const pkg = useAsync(() => (meta ? api.package(meta.package_id) : Promise.resolve(undefined)), [meta?.package_id]);
  const flags = useAsync(() => (meta?.stage === "done" ? api.flags(runId) : Promise.resolve([])), [runId, meta?.stage]);
  if (metaError && !meta) return <ErrorNote error={metaError} title="Could not open this run" />;
  if (!meta) return <Spinner />;
  const p = pkg.data;
  const visual = p?.pages.filter((x) => x.needs_visual) ?? [];
  const mock = isMock();

  return (
    <div>
      <PageTitle title="Technical details" intro={<>For the team and reviewers of the tool. <Link className="text-accent-ink hover:underline" to={`/runs/${runId}`}>Back to the report</Link></>} />

      <section className="border-t border-line pt-6">
        <h2 className="font-serif text-[20px] font-semibold text-ink">This run</h2>
        <dl className="mt-3 grid grid-cols-[minmax(120px,200px)_1fr] gap-x-4 gap-y-1.5 text-[14px]">
          <Row k="Source of the answers" v={runSource(meta) === "replay" ? "Answer-key replay (golden answers fed through the pipeline; tests the pipeline, not the AI)" : sourceShort(meta)} />
          <Row k="Model" v={meta.model} />
          <Row k="Reasoning effort" v={meta.effort} />
          <Row k="Prompt / schema version" v={`${meta.prompt_version} / ${meta.schema_version}`} />
          <Row k="Run id" v={<span className="font-mono text-[13px]">{meta.run_id}</span>} />
          <Row k="Package id" v={<span className="font-mono text-[13px]">{meta.package_id}</span>} />
          <Row k="Contract id" v={meta.contract_id} />
          <Row k="Stage" v={`${meta.stage} (${Math.round(meta.progress * 100)}%)`} />
          <Row k="Started / finished" v={`${fmtDate(meta.started_at)}${meta.finished_at ? ` / ${fmtDate(meta.finished_at)}` : ""}`} />
          <Row k="AI calls (cache hits)" v={`${num(meta.llm_calls)} (${num(meta.cache_hits)})`} />
          <Row k="Tokens in / out" v={`${tokens(meta.input_tokens)} / ${tokens(meta.output_tokens)}`} />
          <Row k="Read-only demo" v={meta.frozen ? "yes (review and parameter edits are disabled)" : "no"} />
          {meta.error && <Row k="Error" v={meta.error} />}
        </dl>
        {!mock && meta.stage === "done" && (
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
            <a className="text-accent-ink hover:underline" href={reportPdfUrl(runId)} target="_blank" rel="noreferrer">PDF report</a>
            <a className="text-accent-ink hover:underline" href={exportCsvUrl(runId)} download>Answers as CSV (answer-key columns)</a>
          </p>
        )}
        <Disclosure className="mt-4" summary={`Progress log (${meta.log.length} lines)`} defaultOpen={meta.stage !== "done"}>
          <pre className="scroll-thin max-h-[360px] overflow-auto whitespace-pre-wrap border-y border-line py-3 font-mono text-[12.5px] leading-relaxed text-ink-2">
            {meta.log.length ? meta.log.join("\n") : "No log lines yet."}
          </pre>
        </Disclosure>
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-serif text-[20px] font-semibold text-ink">Documents</h2>
        {pkg.error ? <ErrorNote error={pkg.error} title="Could not load the documents" /> : !p ? <Spinner /> : (
          <>
            <ul className="mt-3 divide-y divide-line border-y border-line text-[14px]">
              {p.files.map((f) => (
                <li key={f.doc_id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2.5">
                  <span className="min-w-0 flex-1 break-all text-ink">{f.filename}</span>
                  <span className="text-ink-2">{TAG[f.tag] ?? f.tag}</span>
                  <span className="tnum text-ink-2">{f.page_count} pages</span>
                  <span className="w-full font-mono text-[12px] text-muted" title="SHA-256 of the file">{f.doc_id} · {f.sha256}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[14px] text-ink-2">
              {visual.length === 0 ? "Every page had usable text." : `${visual.length} page${visual.length === 1 ? "" : "s"} had to be read as images (scans, tick boxes, struck-through words or formulas).`}
            </p>
            {visual.length > 0 && (
              <Disclosure summary="Show those pages">
                <ul className="flex flex-col gap-1 text-[13.5px]">
                  {visual.slice(0, 200).map((x) => (
                    <li key={`${x.doc_id}-${x.page}`}>
                      <button className="text-accent-ink hover:underline" onClick={() => openPage(x.page, "", x.doc_id, `Page ${x.page}`, "Technical details")}>{x.doc_id} p. {x.page}</button>
                      <span className="text-ink-2"> — {x.visual_reasons.join("; ")}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
            {p.missing_references.length > 0 && (
              <>
                <h3 className="mt-6 text-[15px] font-semibold text-ink">Referred to but not supplied</h3>
                <ul className="mt-2 flex flex-col gap-1 text-[14px]">
                  {p.missing_references.map((m, i) => (
                    <li key={i} className="text-ink-2">
                      {m.label}
                      {m.page ? <> — <button className="text-accent-ink hover:underline" onClick={() => openPage(m.page, m.quote, m.doc_id, m.label, "Technical details")}>p. {m.page}</button></> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      {meta.stage === "done" && (
        <section className="mt-10 border-t border-line pt-6">
          <h2 className="font-serif text-[20px] font-semibold text-ink">Risk rules that fired</h2>
          <p className="mt-1 text-[14px] text-muted">Fixed rules in code (backend/analyser/risk/rules_v1.yaml), each with its reference value and source.</p>
          {flags.error ? <ErrorNote error={flags.error} /> : !flags.data ? <Spinner /> : (
            <ul className="mt-3 divide-y divide-line border-y border-line text-[14px]">
              {sortFlags(flags.data).map((f, i) => (
                <li key={`${f.flag_id}-${i}`} className="py-3">
                  <div className="text-ink"><span className="font-mono text-[13px] text-muted">{f.flag_id}</span> {f.title} <span className="text-muted">· {f.severity} · {f.category}</span></div>
                  <div className="mt-0.5 text-ink-2">Rule: {f.rule}</div>
                  <div className="text-ink-2">Found: {f.value_found}</div>
                  <div className="text-ink-2">Reference: {f.reference_value} <span className="text-muted">({f.reference_source})</span></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
