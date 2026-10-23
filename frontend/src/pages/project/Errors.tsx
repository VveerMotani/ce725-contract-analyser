// Where the AI went wrong: one card per test of the Claude-read runs that is not fully right,
// with the tool's answer and the answer key side by side, the cause in words, the judge's reason
// and both pages. Then the answer-key issues the judges found and the verifier's false alarms.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp, useAsync } from "../../context";
import { effective, type AnswerEnvelope, type GoldenTest, type JudgeNote, type RunMeta, type TestScore } from "../../types";
import { LABEL_COLOR, isRight, topic } from "../../lib/plain";
import { ErrorNote, Spinner, cx } from "../../components/ui";
import {
  Head, LABEL_SHORT, PageBtn, Pills, Sub, answerText, causeWord, isClaude, keyTarget, load, reasonOf, selectCls, shortTitle, toolTarget, upper,
} from "./shared";

/** The team's notes on the numbers the verifier could not find in the text layer (VALIDATION_SUMMARY.md). */
const FALSE_ALARM_NOTE: Record<string, string> = {
  "BM1-5.6": "In a formula image, not in the text layer",
  "BM2-1.7": "Rounding of Rs 2,12,27,336",
  "BM3-1.5": "Hindi text in a legacy font",
  "BM3-4.8": "Written in words in the contract",
};

interface Data {
  tests: TestScore[];
  runOf: Record<string, RunMeta>;
  golden: Record<string, GoldenTest>;
  notes: Record<string, JudgeNote>;
  answers: Record<string, AnswerEnvelope[]>;
}

function useData() {
  const { runs } = useApp();
  return useAsync<Data>(async () => {
    if (!runs) return new Promise<Data>(() => {});   // wait for the runs list
    const ev = await load.evaluation();
    const runOf: Record<string, RunMeta> = {};
    for (const [cid, rid] of Object.entries(ev.runs_used ?? {})) {
      const m = runs?.find((r) => r.run_id === rid);
      if (m && isClaude(m)) runOf[cid] = m;
    }
    const cids = Object.keys(runOf).sort();
    const [golden, notes, answers] = await Promise.all([
      load.goldenAll(cids),
      load.judgeNotes().catch(() => [] as JudgeNote[]),
      load.answersOf(cids.map((c) => runOf[c].run_id)),
    ]);
    return {
      tests: ev.tests.filter((t) => runOf[t.contract_id]),
      runOf,
      golden: Object.fromEntries(golden.map((g) => [g.test_id, g])),
      notes: Object.fromEntries(notes.filter((n) => cids.some((c) => runOf[c].run_id === n.run_id)).map((n) => [n.test_id, n])),
      answers: Object.fromEntries(cids.map((c) => [c, answers[runOf[c].run_id] ?? []])),
    };
  }, [runs]);
}

function envOf(d: Data, cid: string, qid: string): AnswerEnvelope | undefined {
  return d.answers[cid]?.find((e) => e.answer.question_id === qid);
}

function CauseChart({ counts, active, onPick }: { counts: [string, number][]; active: string; onPick: (c: string) => void }) {
  const max = Math.max(1, ...counts.map(([, n]) => n));
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Causes">
      {counts.map(([code, n]) => (
        <li key={code}>
          <button type="button" onClick={() => onPick(active === code ? "" : code)} aria-pressed={active === code}
            className={cx("grid w-full grid-cols-[minmax(0,1fr)_28px] items-center gap-x-3 gap-y-1 rounded px-1 py-0.5 text-left text-[13.5px] hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_minmax(60px,42%)_28px]",
              active === code && "bg-accent-soft")}>
            <span className={cx("col-start-1 row-start-1 truncate", active === code ? "font-medium text-ink" : "text-ink-2")}>{causeWord(code)}</span>
            <span className="col-span-2 col-start-1 row-start-2 h-2.5 rounded-sm bg-line sm:col-span-1 sm:col-start-2 sm:row-start-1"><span className="block h-full rounded-sm bg-accent" style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="col-start-2 row-start-1 text-right font-medium text-ink tnum sm:col-start-3">{n}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Side({ who, text, children }: { who: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-surface p-3">
      <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted">{who}</div>
      <p className="mt-1 break-words text-[14px] leading-snug text-ink">{text}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

function ErrorCard({ t, d }: { t: TestScore; d: Data }) {
  const { openSource } = useApp();
  const g = d.golden[t.test_id];
  const n = d.notes[t.test_id];
  const env = envOf(d, t.contract_id, t.question_id);
  const meta = d.runOf[t.contract_id];
  const a = env ? effective(env) : undefined;
  const why = n?.reason || reasonOf(t);
  return (
    <li className="py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[15.5px] font-medium text-ink">{topic(t.question_id)}</span>
        <span className="flex items-center gap-2 text-[12.5px] text-muted">
          <span className="tnum">{t.test_id}</span>{t.core && <span className="rounded border border-line-strong px-1 text-[11px]">core</span>}
          <span className="font-medium" style={{ color: LABEL_COLOR[t.label] }}>{LABEL_SHORT[t.label]}</span>
        </span>
      </div>
      {g?.question && <div className="text-[13px] text-muted">{g.question}</div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Side who="Tool said" text={answerText(t.tool_status, t.tool_answer)}>
          {env && meta && <PageBtn who="Tool’s page" page={a?.pdf_page} onClick={() => openSource(toolTarget(meta, env, `${t.test_id} · tool’s answer`))} />}
        </Side>
        <Side who="Answer key" text={answerText(t.expected_status, t.expected_answer)}>
          {g && <PageBtn who="Key’s page" page={g.pdf_page} onClick={() => openSource(keyTarget(g))} />}
        </Side>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-[13.5px] sm:grid-cols-[90px_1fr]">
        <dt className="text-muted">Cause</dt>
        <dd className="font-medium text-ink">{causeWord(t.cause_code || n?.cause_code || "")}</dd>
        {why && <><dt className="text-muted">Judge</dt><dd className="text-ink-2">{upper(why)}</dd></>}
        {n && n.missing.length > 0 && <><dt className="text-muted">Missing</dt><dd className="text-ink-2">{n.missing.join("; ")}</dd></>}
      </dl>
    </li>
  );
}

function KeyIssues({ d }: { d: Data }) {
  const { openSource } = useApp();
  const rows = Object.values(d.notes).filter((n) => n.key_issue).sort((a, b) => a.test_id.localeCompare(b.test_id, undefined, { numeric: true }));
  if (!rows.length) return <p className="text-[14px] text-muted">The judges raised no answer-key issues.</p>;
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((n) => {
        const t = d.tests.find((x) => x.test_id === n.test_id);
        const g = d.golden[n.test_id];
        const env = t ? envOf(d, t.contract_id, t.question_id) : undefined;
        const meta = d.runOf[n.contract_id];
        // The page the judge cites as evidence ("page 48", "p52", "p.236"), opened without a highlight.
        const ev = n.key_issue.match(/\b(?:page|p\.?)\s?(\d{1,4})\b/i);
        const evPage = ev ? +ev[1] : 0;
        return (
          <li key={n.test_id} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[15px] font-medium text-ink">{topic(n.test_id.split("-")[1])}</span>
              <span className="text-[12.5px] text-muted"><span className="tnum">{n.test_id}</span>{t && <> · final label <span style={{ color: LABEL_COLOR[t.label] }}>{LABEL_SHORT[t.label]}</span></>}</span>
            </div>
            <p className="mt-1 text-[14px] leading-snug text-ink-2">{n.key_issue}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {g && <PageBtn who="Key’s page" page={g.pdf_page} onClick={() => openSource(keyTarget(g))} />}
              {env && meta && <PageBtn who="Tool’s page" page={effective(env).pdf_page} onClick={() => openSource(toolTarget(meta, env, `${n.test_id} · tool’s answer`))} />}
              {evPage > 0 && evPage !== g?.pdf_page && meta && (
                <PageBtn who="Judge’s evidence" page={evPage} onClick={() => openSource({ packageId: meta.package_id, docId: "d1", page: evPage, quote: "", title: `${topic(n.test_id.split("-")[1])}: judge’s evidence`, subtitle: `${n.test_id} · answer key issue` })} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function FalseAlarms({ d }: { d: Data }) {
  const { openSource } = useApp();
  const rows: { tid: string; env: AnswerEnvelope; meta: RunMeta; nums: string }[] = [];
  for (const [cid, envs] of Object.entries(d.answers)) {
    for (const e of envs) {
      const v3 = e.verification?.checks.find((c) => c.check === "V3" && c.passed === false && (c as { severity?: string }).severity === "fail");
      if (!v3 || e.review.decision === "edited") continue;
      rows.push({ tid: `${cid}-${e.answer.question_id}`, env: e, meta: d.runOf[cid], nums: v3.detail.replace(/^[^:]*:[^:]*:\s*/, "") });
    }
  }
  rows.sort((a, b) => a.tid.localeCompare(b.tid, undefined, { numeric: true }));
  if (!rows.length) return <p className="text-[14px] text-muted">The verifier raised no number it could not find.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[13.5px]">
        <thead className="text-[12px] text-muted">
          <tr className="border-b border-line"><th className="py-2 pr-3 font-medium">Test</th><th className="py-2 pr-3 font-medium">Number flagged</th><th className="py-2 pr-3 font-medium">Where it really is</th><th className="py-2 font-medium">Page</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.tid}>
              <td className="py-2.5 pr-3 align-top"><span className="block text-ink">{topic(r.env.answer.question_id)}</span><span className="text-[12px] text-muted tnum">{r.tid}</span></td>
              <td className="py-2.5 pr-3 align-top font-medium text-ink tnum">{r.nums}</td>
              <td className="py-2.5 pr-3 align-top text-ink-2">{FALSE_ALARM_NOTE[r.tid] ? <><span className="mr-1.5 text-good" aria-label="real number">✓</span>{FALSE_ALARM_NOTE[r.tid]}</> : <span className="text-muted">Not yet checked by a person</span>}</td>
              <td className="py-2.5 align-top"><PageBtn who="Tool" page={effective(r.env).pdf_page} onClick={() => openSource(toolTarget(r.meta, r.env, `${r.tid} · verifier flag`))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Errors() {
  const data = useData();
  const { benchmarks } = useApp();
  const [sp, setSp] = useSearchParams();
  const contract = sp.get("contract") ?? "";
  const cause = sp.get("cause") ?? "";
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  const wrong = useMemo(() => (data.data?.tests ?? []).filter((t) => !isRight(t.label)), [data.data]);
  const inContract = wrong.filter((t) => !contract || t.contract_id === contract);
  const causeOf = (t: TestScore) => t.cause_code || data.data?.notes[t.test_id]?.cause_code || "";
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    inContract.forEach((t) => m.set(causeOf(t), (m.get(causeOf(t)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inContract.map((t) => t.test_id).join()]);
  const shown = inContract.filter((t) => !cause || causeOf(t) === cause)
    .sort((a, b) => a.test_id.localeCompare(b.test_id, undefined, { numeric: true }));

  if (data.loading) return <Spinner label="Loading the graded tests…" />;
  if (data.error || !data.data) return <ErrorNote error={data.error} title="Could not load the graded tests" />;
  const d = data.data;
  const cids = Object.keys(d.runOf).sort();
  if (!cids.length) return <><Head title="Where the AI went wrong" /><p className="text-[14.5px] text-muted">No Claude-read runs yet.</p></>;
  const titleOf = (c: string) => shortTitle(benchmarks?.find((b) => b.contract_id === c)?.title ?? c);

  return (
    <div>
      <Head title="Where the AI went wrong"
        note={`Every test of the Claude-read runs that is not fully right: ${wrong.length} of ${d.tests.length}. Labels are the judge’s; causes are the judge’s cause codes.`} />

      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-[12.5px] text-muted">Contract</div>
            <Pills label="Contract" value={contract} onChange={(v) => set("contract", v)}
              options={[{ value: "", label: "All" }, ...cids.map((c) => ({ value: c, label: c }))]} />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted">Cause</span>
            <select className={selectCls} value={cause} onChange={(e) => set("cause", e.target.value)}>
              <option value="">All causes</option>
              {counts.map(([c, n]) => <option key={c} value={c}>{causeWord(c)} ({n})</option>)}
            </select>
          </label>
          {contract && <p className="text-[13px] text-muted">{titleOf(contract)}</p>}
        </div>
        <div>
          <div className="mb-1.5 text-[12.5px] text-muted">Causes{contract ? `, ${contract}` : ""} · click to filter</div>
          <CauseChart counts={counts} active={cause} onPick={(c) => set("cause", c)} />
        </div>
      </div>

      <div className="mt-6 text-[13px] text-muted">{shown.length} test{shown.length === 1 ? "" : "s"}</div>
      <ul className="divide-y divide-line border-y border-line">
        {shown.map((t) => <ErrorCard key={t.test_id} t={t} d={d} />)}
      </ul>

      <Sub title="Answer key issues the judges found" aside="a person must confirm before the key changes">
        <KeyIssues d={d} />
      </Sub>

      <Sub title="Verifier false alarms" aside="numbers the code could not find in the text, checked by the team">
        <FalseAlarms d={d} />
      </Sub>
    </div>
  );
}
