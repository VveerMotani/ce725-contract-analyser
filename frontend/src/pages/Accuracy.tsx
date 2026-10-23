// Accuracy (Project area, for the team and the professor): per contract, how many of the 52 answers match the answer key,
// then a plain list of the mistakes. Precision, recall and the rest are secondary, behind a disclosure.
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp, useAsync } from "../context";
import { CLAUSE_IDS, labelCounts, type Label, type Status, type TestScore } from "../types";
import { LABEL_COLOR, LABEL_ORDER, LABEL_WORD, STATUS_WORD, TERM_NAME, isRight, runSource, topic } from "../lib/plain";
import { ChevronRight } from "lucide-react";
import { Disclosure, ErrorNote, InfoTip, Spinner } from "../components/ui";
import { Head, load } from "./project/shared";

function Bar({ counts, total }: { counts: Record<Label, number>; total: number }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line" role="img"
      aria-label={LABEL_ORDER.filter((l) => counts[l]).map((l) => `${counts[l]} ${LABEL_WORD[l]}`).join(", ")}>
      {LABEL_ORDER.map((l) => counts[l] > 0 && (
        <span key={l} title={`${LABEL_WORD[l]}: ${counts[l]}`} style={{ width: `${(counts[l] / Math.max(1, total)) * 100}%`, background: LABEL_COLOR[l] }} />
      ))}
    </div>
  );
}

function statusWord(s: string): string {
  return STATUS_WORD[s as Status] ?? s;
}

/** "value | unit | base" -> value, then the unit and base quietly. */
function Val({ text }: { text: string }) {
  const [v, ...rest] = (text || "").split(" | ");
  return <>{v}{rest.filter(Boolean).length > 0 && <span className="text-muted"> ({rest.filter(Boolean).join("; ")})</span>}</>;
}

function upper(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function Mistakes({ tests, runId }: { tests: TestScore[]; runId: string | undefined }) {
  const ans = useAsync(() => (runId ? api.answers(runId).catch(() => []) : Promise.resolve([])), [runId]);
  const q = (id: string) => ans.data?.find((e) => e.answer.question_id === id)?.question;
  if (tests.length === 0) return <p className="text-[15px] text-ink-2">No mistakes on this contract.</p>;
  return (
    <ol className="divide-y divide-line border-y border-line">
      {tests.map((t) => (
        <li key={t.test_id} className="py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[15.5px] font-medium text-ink">{topic(t.question_id)}</span>
            <span className="text-[13.5px]" style={{ color: LABEL_COLOR[t.label] }}>{LABEL_WORD[t.label]}</span>
          </div>
          {q(t.question_id) && <div className="text-[13.5px] text-muted">{q(t.question_id)}</div>}
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[14.5px] sm:grid-cols-[100px_1fr]">
            <dt className="text-muted">Tool</dt>
            <dd className="text-ink">{t.tool_status && t.tool_status !== "FOUND" ? `${statusWord(t.tool_status)}. ` : ""}<Val text={t.tool_answer} />{!t.tool_answer && !t.tool_status ? "No answer." : ""}</dd>
            <dt className="text-muted">Answer key</dt>
            <dd className="text-ink">{t.expected_status && t.expected_status !== "FOUND" ? `${statusWord(t.expected_status)}. ` : ""}<Val text={t.expected_answer} /></dd>
            {t.reason && <><dt className="text-muted">Why</dt><dd className="text-ink-2">{upper(t.reason)}.</dd></>}
          </dl>
        </li>
      ))}
    </ol>
  );
}

export default function Accuracy() {
  const ev = useAsync(() => load.evaluation(), []);
  const { runs, benchmarks } = useApp();
  const [sp, setSp] = useSearchParams();
  const s = ev.data;
  const contracts = useMemo(() => (s ? Object.keys(s.by_contract).sort() : []), [s]);

  if (ev.loading) return <Spinner label="Loading the scores…" />;
  if (ev.error || !s) {
    return (
      <div>
        <Head title="Accuracy" />
        <ErrorNote error={ev.error} title="No scores yet: read at least one of the four test contracts first" />
      </div>
    );
  }

  const titleOf = (c: string) => benchmarks?.find((b) => b.contract_id === c)?.title ?? c;
  const runOf = (c: string) => s.runs_used?.[c];
  const metaOf = (c: string) => runs?.find((r) => r.run_id === runOf(c));
  const srcOf = (c: string) => {
    const m = metaOf(c);
    const rs = m ? runSource(m) : s.replay_contracts?.includes(c) ? "replay" : "other";
    return rs === "replay" ? "Answer-key replay · pipeline test" : rs === "claude" ? "Read by Claude" : "Read by the tool";
  };
  const allCounts = labelCounts(s.counts);
  const total = s.tests.length;
  const right = allCounts.Correct + allCounts["Correct absent"];

  return (
    <div>
      <Head title="Accuracy">
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          Against the team’s hand-checked answer key
          <InfoTip label="About the answer key">
            52 questions per contract, answered and checked by hand from the same PDFs. Answer-key replays feed the key itself
            through the tool, so they test the pipeline, not Claude’s reading.
          </InfoTip>
        </div>
      </Head>

      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-serif text-[34px] font-semibold leading-none text-ink tnum">{right}/{total}</span>
        <span className="text-[14px] text-muted">correct, all contracts</span>
      </div>
      <div className="mt-3 max-w-[520px]"><Bar counts={allCounts} total={total} /></div>

      <ul className="mt-8 divide-y divide-line border-y border-line">
        {contracts.map((c) => {
          const k = labelCounts(s.by_contract[c]);
          const n = Object.values(k).reduce((x, y) => x + y, 0);
          const ok = k.Correct + k["Correct absent"];
          const wrong = s.tests.filter((t) => t.contract_id === c && !isRight(t.label));
          return (
            <li key={c} className="py-4">
              <div className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[1fr_90px_220px]">
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-ink">{titleOf(c)}</span>
                  <span className="block text-[12.5px] text-muted">{srcOf(c)}{runOf(c) && <> · <Link className="text-accent-ink hover:underline" to={`/runs/${runOf(c)}`}>report</Link></>}</span>
                </span>
                <span className="font-serif text-[24px] font-semibold leading-none text-ink tnum">{ok}/{n}</span>
                <Bar counts={k} total={n} />
              </div>
              {wrong.length > 0 && (
                <details className="group mt-2" open={sp.get("contract") === c}>
                  <summary className="inline-flex cursor-pointer items-center gap-1 text-[13.5px] text-accent-ink hover:underline"
                    onClick={() => setSp(sp.get("contract") === c ? {} : { contract: c }, { replace: true })}>
                    <ChevronRight className="disclosure-caret h-4 w-4 transition-transform" aria-hidden />{wrong.length} mistake{wrong.length === 1 ? "" : "s"}
                  </summary>
                  <div className="mt-2"><Mistakes tests={wrong} runId={runOf(c)} /></div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
        {LABEL_ORDER.map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LABEL_COLOR[l] }} />{LABEL_WORD[l]}</span>
        ))}
      </p>
      {(s.missing_benchmarks ?? []).length > 0 && (
        <p className="mt-3 text-[13px] text-muted">Not read yet: {s.missing_benchmarks!.map(titleOf).join(", ")}</p>
      )}

      <section className="mt-12">
        <Disclosure summary="More measures">
          <dl className="grid gap-x-6 gap-y-3 text-[14.5px] sm:grid-cols-[220px_1fr]">
            <dt className="text-ink">Precision {Math.round(s.precision * 100)}%</dt>
            <dd className="text-ink-2">Of the answers the tool gave, the share that were right.</dd>
            <dt className="text-ink">Recall {Math.round(s.recall * 100)}%</dt>
            <dd className="text-ink-2">Of the answers in the key, the share the tool got right.</dd>
            <dt className="text-ink">Key questions {Math.round(s.core_pass_rate * 100)}%</dt>
            <dd className="text-ink-2">Share right on the {s.tests.filter((t) => t.core).length} questions that drive the cash model.</dd>
            <dt className="text-ink">Quotes found {Math.round(s.quote_verification_rate * 100)}%</dt>
            <dd className="text-ink-2">Share of quoted sentences the code found on the stated page.</dd>
            <dt className="text-ink">Invented answers: {s.hallucinations}</dt>
            <dd className="text-ink-2">Answers given for something that is not in the document, or with a number found nowhere in it.</dd>
          </dl>
          <h3 className="mt-6 text-[15px] font-semibold text-ink">By term</h3>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {CLAUSE_IDS.filter((k) => s.by_clause[k]).map((k) => {
              const c = labelCounts(s.by_clause[k]);
              const n = Object.values(c).reduce((a, b) => a + b, 0);
              return (
                <li key={k} className="grid gap-2 py-2.5 text-[14px] sm:grid-cols-[1fr_120px_200px] sm:items-center">
                  <span className="text-ink">{TERM_NAME[k]}</span>
                  <span className="text-ink-2">{c.Correct + c["Correct absent"]} of {n}</span>
                  <Bar counts={c} total={n} />
                </li>
              );
            })}
          </ul>
        </Disclosure>
      </section>
    </div>
  );
}
