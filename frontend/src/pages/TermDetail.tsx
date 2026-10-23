// Detail page for one money term: /runs/:runId/terms/:term
// Header (name, big number, dot, flag summary) -> large graphics and key points -> every question -> flags for the clause.
import { useEffect, useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api";
import { useAsync, useRun } from "../context";
import { effective, type ClauseId } from "../types";
import { TERM_NAME } from "../lib/plain";
import { cardTone, scorecard, type Row, type Scorecard } from "../lib/scorecard";
import { clauseOf } from "../lib/terms";
import { SLUG_TERM, TERM_ORDER, TERM_SLUG } from "../lib/termDetail";
import { RunReady } from "../components/RunReady";
import { ErrorNote, Spinner, StatusDot, cx } from "../components/ui";
import { TermCards } from "./TermCards";
import { Term } from "../components/Term";
import { TERM_GLOSS } from "../lib/glossary";
import { FlagBoard } from "./Flags";
import { Block, QuestionRows } from "./TermDetailParts";
import { AdvancePanel, DelayPanel, GuaranteePanel, PaymentPanel, PricePanel, RetentionPanel, makeD } from "./TermPanels";

const MAIN_Q: Record<string, string> = { C1: "1.3", C2: "2.2", C3: "3.1", C4: "4.2", C5: "5.1", C6: "6.2" };

function clauseScore(sc: Scorecard, c: ClauseId): Scorecard {
  const mine = (r: Row) => r.question_ids.some((q) => clauseOf(q) === c);
  const red = sc.red.filter(mine), green = sc.green.filter(mine), notChecked = sc.notChecked.filter(mine), confirm = sc.confirm.filter(mine);
  return {
    red, green, notChecked, confirm, hasChecks: sc.hasChecks,
    tally: { serious: red.filter((r) => r.severity === "High").length, watch: red.filter((r) => r.severity !== "High").length, fine: green.length, notChecked: notChecked.length, confirm: confirm.length },
  };
}

function Tabs({ current, runId }: { current: Exclude<ClauseId, "C0">; runId: string }) {
  const i = TERM_ORDER.indexOf(current);
  const prev = TERM_ORDER[(i + 5) % 6], next = TERM_ORDER[(i + 1) % 6];
  const to = (c: Exclude<ClauseId, "C0">) => `/runs/${runId}/terms/${TERM_SLUG[c]}`;
  return (
    <div className="flex items-center gap-2 border-b border-line">
      <Link to={to(prev)} className="shrink-0 rounded p-1 text-muted hover:text-ink" aria-label={`Previous: ${TERM_NAME[prev]}`}><ChevronLeft className="h-4 w-4" /></Link>
      <nav className="flex min-w-0 flex-1 gap-5 overflow-x-auto [scrollbar-width:none]" aria-label="Money terms">
        {TERM_ORDER.map((c) => (
          <Link key={c} to={to(c)} aria-current={c === current ? "page" : undefined}
            className={cx("whitespace-nowrap border-b-2 py-2 text-[14px]", c === current ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
            {TERM_NAME[c]}
          </Link>
        ))}
      </nav>
      <Link to={to(next)} className="shrink-0 rounded p-1 text-muted hover:text-ink" aria-label={`Next: ${TERM_NAME[next]}`}><ChevronRight className="h-4 w-4" /></Link>
    </div>
  );
}

function Inner({ clause }: { clause: Exclude<ClauseId, "C0"> }) {
  const { runId, answers } = useRun();
  const flags = useAsync(() => api.flags(runId), [runId]);
  const checks = useAsync(() => api.checks(runId).catch(() => undefined), [runId]);
  const params = useAsync(() => api.params(runId).catch(() => undefined), [runId]);
  const cash = useAsync(() => api.cashflow(runId).catch(() => undefined), [runId]);
  useEffect(() => { window.scrollTo(0, 0); }, [clause]);
  const envs = answers!;
  const sc = useMemo(() => scorecard(checks.data, flags.data ?? []), [checks.data, flags.data]);
  const csc = useMemo(() => clauseScore(sc, clause), [sc, clause]);
  const ready = !flags.loading && !checks.loading && !params.loading && !cash.loading;
  const w = cash.data?.as_written;
  const d = useMemo(() => makeD(runId, envs, params.data, w, checks.data), [runId, envs, params.data, w, checks.data]);
  const qs = envs.filter((e) => effective(e).clause_id === clause).sort((a, b) => parseFloat(a.answer.question_id.split(".")[1]) - parseFloat(b.answer.question_id.split(".")[1]));
  const main = d.ans(MAIN_Q[clause]);
  const summary = [
    csc.red.length ? `${csc.red.length} red` : "", csc.green.length ? `${csc.green.length} green` : "",
    csc.confirm.length ? `${csc.confirm.length} to confirm` : "", csc.notChecked.length ? `${csc.notChecked.length} not checked` : "",
  ].filter(Boolean).join(" · ") || "No rules for this term";

  return (
    <article>
      <Link to={`/runs/${runId}`} className="text-[13.5px] text-accent-ink hover:underline">← Report</Link>
      <div className="mt-3"><Tabs current={clause} runId={runId} /></div>
      {flags.error ? <div className="mt-6"><ErrorNote error={flags.error} title="Could not load the flags" /></div> : !ready ? <Spinner /> : (
        <>
          <header className="pt-6">
            <div className="flex items-center gap-2.5">
              <h1 className="font-serif text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">{TERM_GLOSS[clause] ? <Term k={TERM_GLOSS[clause]!}>{TERM_NAME[clause]}</Term> : TERM_NAME[clause]}</h1>
              <StatusDot tone={cardTone(clause, sc, main)} />
            </div>
            <div className="mt-4"><TermCards answers={envs} params={params.data} cash={w} sc={sc} only={clause} variant="header" /></div>
            <button type="button" className="mt-4 text-[13.5px] text-ink-2 hover:text-ink" onClick={() => document.getElementById("term-flags")?.scrollIntoView({ behavior: "smooth" })}>{summary}</button>
          </header>

          {clause === "C1" && <PaymentPanel d={d} />}
          {clause === "C2" && <RetentionPanel d={d} />}
          {clause === "C3" && <AdvancePanel d={d} />}
          {clause === "C4" && <DelayPanel d={d} />}
          {clause === "C5" && <PricePanel d={d} />}
          {clause === "C6" && <GuaranteePanel d={d} />}

          <Block title="What the contract says"><QuestionRows envs={qs} /></Block>
          <div id="term-flags" className="scroll-mt-6">
            <Block title="Flags">
              {csc.red.length + csc.green.length + csc.confirm.length + csc.notChecked.length === 0
                ? <p className="text-[14px] text-muted">No rules for this term</p>
                : <FlagBoard sc={csc} />}
            </Block>
          </div>
        </>
      )}
    </article>
  );
}

export default function TermDetail() {
  const { term = "", runId = "" } = useParams();
  const clause = SLUG_TERM[term];
  if (!clause) return <Navigate to={`/runs/${runId}`} replace />;
  return <RunReady><Inner clause={clause} /></RunReady>;
}
