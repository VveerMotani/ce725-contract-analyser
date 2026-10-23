// S10 Export & About: CSV / PDF downloads, disclaimer, how AI is used, assumptions, confidentiality.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BookOpenCheck, Calculator, FileDown, FileSpreadsheet, FileText, Lock, Quote as QuoteIcon, ScanEye, Scale, ShieldCheck } from "lucide-react";
import { exportCsvUrl, isMock, reportPdfUrl } from "../api";
import { useRun } from "../context";
import { effective, type AnswerEnvelope } from "../types";
import { RunGate } from "../components/RunGate";
import { Card, Chip, Collapsible, PageHeader } from "../components/ui";

function csvOf(envs: AnswerEnvelope[]): string {
  const cols = ["contract_id", "clause_id", "question_id", "question", "status", "answer_value", "unit", "base", "value_source", "section_ref", "pdf_page", "verbatim_quote", "points_to", "confidence", "notes", "verification", "review_decision", "ai_answer_value"];
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = envs.map((e) => {
    const a = effective(e);
    return [a.contract_id, a.clause_id, a.question_id, e.question, a.status, a.answer_value, a.unit, a.base, a.value_source, a.section_ref, a.pdf_page, a.verbatim_quote, a.points_to, a.confidence, a.notes, e.verification?.verdict ?? "", e.review.decision, e.answer.answer_value].map(q).join(",");
  });
  return [cols.join(","), ...lines].join("\r\n");
}

function Disclaimer() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line-strong bg-surface-2 p-4">
      <Scale className="mt-0.5 h-5 w-5 shrink-0 text-ink-2" />
      <div className="text-[13px] text-ink-2">
        <div className="text-[14px] font-semibold text-ink">Decision support, not legal advice.</div>
        The tool reads public tender and contract documents and shows what they say, with proof. It does not interpret the law, and its
        thresholds are starting points from the sources shown. A qualified person must check the terms that matter before a bid decision.
      </div>
    </div>
  );
}

function ExportInner() {
  const { runId, answers, pending, meta } = useRun();
  const mock = isMock();
  const downloadMockCsv = () => {
    const blob = new Blob([csvOf(answers!)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${meta?.contract_id ?? "run"}_${runId}_answers_MOCK.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="flex flex-col gap-4">
      {pending > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warn/50 bg-warn-soft p-3 text-[13px] text-warn-ink">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span><b>{pending} answers still pending review.</b> They are exported as the AI gave them and marked "pending".</span>
          <Link to={`/runs/${runId}/review`} className="ml-auto font-semibold underline">Review now</Link>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Answers (CSV)" icon={<FileSpreadsheet className="h-4 w-4 text-good" />}>
          <p className="mb-3 text-[13px] text-ink-2">52 rows in answer-key columns: status, value, unit, base, clause, page, verbatim quote, confidence, verification and your review decision.</p>
          {mock ? (
            <button onClick={downloadMockCsv} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110"><FileDown className="h-4 w-4" /> Download CSV (mock)</button>
          ) : (
            <a href={exportCsvUrl(runId)} download className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110"><FileDown className="h-4 w-4" /> Download CSV</a>
          )}
        </Card>
        <Card title="Report (PDF)" icon={<FileText className="h-4 w-4 text-bad" />}>
          <p className="mb-3 text-[13px] text-ink-2">Key terms with proof, risk flags, cash-flow charts and the review audit trail, for the bid file.</p>
          {mock ? <Chip>Available when the backend is running</Chip> : (
            <a href={reportPdfUrl(runId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-2"><FileDown className="h-4 w-4" /> Open PDF report</a>
          )}
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}

export function ExportPage() {
  return (
    <>
      <PageHeader title="Export" subtitle="Take the results into your bid file." />
      <RunGate><ExportInner /></RunGate>
    </>
  );
}

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">{icon}</span>
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      <div className="text-[13px] text-ink-2">{children}</div>
    </div>
  );
}

const ASSUMPTIONS = [
  "Monthly model: progress follows your S-curve or an even split; bills are monthly; lags are rounded to whole months.",
  "Cost share, overdraft rate, Bank Rate, guarantee commission, expected delay and index rises are your inputs, not contract terms.",
  "Reference values for flags come from the Manual for Procurement of Works 2022, DoE orders of Nov 2020, CPWD GCC 2023 and the benchmark contracts; they are starting points, not law.",
  "Escalation uses the contract's own factor and weights when price variation applies; for fixed-price contracts the figure is an exposure scenario.",
  "Scanned or Hindi pages are read visually, marked low confidence and always sent to review.",
];
const LIMITS = [
  "Only Indian public-works style documents and six financial clause types (plus contract facts).",
  "Values that live in documents not uploaded (for example a GCC incorporated by reference) are reported as 'points elsewhere', not filled in.",
  "The golden answer key was checked four ways, but the six main numbers still need a person to compare against the PDF pages.",
  "AI reading can be wrong: every answer needs a verbatim quote that code finds on the stated page, and failed checks are discarded or queued.",
  "No employer or lender view, no legal advice, no user accounts.",
];

export function About() {
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4">
      <PageHeader title="About, assumptions and limits" subtitle="Tender and Contract Analyser · CE725 Team 2" />
      <Disclaimer />
      <div className="grid gap-3 md:grid-cols-3">
        <Step icon={<ScanEye className="h-5 w-5" />} title="1 · The AI reads">Claude reads page text and, where text is not enough, page images. It returns values with a verbatim quote, clause and page. It never calculates.</Step>
        <Step icon={<Calculator className="h-5 w-5" />} title="2 · Code calculates">Normalising units, risk rules, the cash model and scoring are plain code, so every number can be reproduced and tested.</Step>
        <Step icon={<QuoteIcon className="h-5 w-5" />} title="3 · Every value has proof">Code checks each quote is on the stated page and contains the numbers. Anything unproven goes to the review queue.</Step>
      </div>
      <Card title="Confidentiality" icon={<Lock className="h-4 w-4 text-warn" />}>
        <p className="text-[13px] text-ink-2">Use only public documents. The text and page images of uploaded PDFs are sent to the Anthropic API for reading. Results are stored as files in the
          project's <code className="rounded bg-surface-2 px-1 font-mono text-xs">runs/</code> folder on the machine running the backend; there are no accounts or shared databases.</p>
      </Card>
      <Collapsible summary={<span className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-muted" /> Assumptions</span>} defaultOpen>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-ink-2">{ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}</ul>
      </Collapsible>
      <Collapsible summary={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted" /> Limitations</span>} defaultOpen>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-ink-2">{LIMITS.map((a) => <li key={a}>{a}</li>)}</ul>
      </Collapsible>
    </div>
  );
}
