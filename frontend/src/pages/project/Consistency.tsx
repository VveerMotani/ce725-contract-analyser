// Consistency: repeat readings of the same contract by Claude (spec §10.4 asks for three).
// Lights up as soon as a contract has two or more Claude-read runs (model names a subagent,
// live or frozen): per question, do the readings give the same status and the same numbers?
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, useAsync } from "../../context";
import { effective, type AnswerEnvelope, type RunMeta } from "../../types";
import { fmtDay } from "../../lib/format";
import { topic } from "../../lib/plain";
import { ErrorNote, Figure, Spinner, cx } from "../../components/ui";
import { Head, Pills, Sub, load, shortTitle, statusWord } from "./shared";

const isRepeatable = (m: RunMeta) => m.stage === "done" && /subagent/i.test(m.model);

/** Numbers in an answer, normalised ("1,00,000" -> "100000", "5.0" -> "5"), sorted and unique. */
export function numbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (!Number.isNaN(n)) out.add(String(n));
  }
  return [...out].sort((a, b) => Number(a) - Number(b));
}

export interface QuestionRow {
  qid: string;
  cells: { status: string; value: string; nums: string[] }[];
  statusSame: boolean;
  numsSame: boolean | null; // null: no numbers in any reading
}

export interface Agreement { rows: QuestionRow[]; status: number; numbers: number | null; withNumbers: number }

/** Agreement of several readings of one contract, question by question. */
export function agreement(readings: AnswerEnvelope[][]): Agreement {
  const qids = [...new Set(readings.flatMap((r) => r.map((e) => e.answer.question_id)))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = qids.map((qid) => {
    const cells = readings.map((r) => {
      const e = r.find((x) => x.answer.question_id === qid);
      const a = e ? effective(e) : null;
      return { status: a?.status ?? "", value: a?.answer_value ?? "", nums: a && a.status === "FOUND" ? numbersIn(a.answer_value) : [] };
    });
    const statusSame = cells.every((c) => c.status === cells[0].status);
    const anyNums = cells.some((c) => c.nums.length > 0);
    const numsSame = anyNums ? cells.every((c) => c.nums.join("|") === cells[0].nums.join("|")) : null;
    return { qid, cells, statusSame, numsSame };
  });
  const withNums = rows.filter((r) => r.numsSame !== null);
  return {
    rows,
    status: rows.length ? rows.filter((r) => r.statusSame).length / rows.length : 0,
    numbers: withNums.length ? withNums.filter((r) => r.numsSame).length / withNums.length : null,
    withNumbers: withNums.length,
  };
}

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-muted">–</span>;
  return ok ? <span className="text-good" aria-label="same">✓</span> : <span className="font-semibold text-bad" aria-label="differs">≠</span>;
}

function ContractTable({ runs, readings }: { runs: RunMeta[]; readings: AnswerEnvelope[][] }) {
  const ag = useMemo(() => agreement(readings), [readings]);
  const [only, setOnly] = useState<"diff" | "all">("diff");
  const rows = only === "diff" ? ag.rows.filter((r) => !r.statusSame || r.numsSame === false) : ag.rows;
  return (
    <div>
      <div className="grid grid-cols-3 gap-4">
        <Figure label="Readings" value={runs.length} />
        <Figure label="Same status" value={`${Math.round(ag.status * 100)}%`} note={`${ag.rows.filter((r) => r.statusSame).length} of ${ag.rows.length}`} />
        <Figure label="Same numbers" value={ag.numbers == null ? "—" : `${Math.round(ag.numbers * 100)}%`} note={`${ag.rows.filter((r) => r.numsSame).length} of ${ag.withNumbers} with numbers`} />
      </div>
      <div className="mt-4">
        <Pills label="Rows" value={only} onChange={setOnly} options={[{ value: "diff", label: "Only differences" }, { value: "all", label: "All questions" }]} />
      </div>
      {rows.length === 0 ? <p className="mt-3 text-[14px] text-ink-2">Every reading agrees on every question.</p> : (
        <div className="scroll-thin mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Question</th>
                {runs.map((r, i) => <th key={r.run_id} className="py-2 pr-3 font-medium"><Link className="hover:text-accent-ink" to={`/runs/${r.run_id}`}>Reading {i + 1}</Link><span className="block font-normal">{fmtDay(r.started_at)}</span></th>)}
                <th className="py-2 pr-2 font-medium">Status</th>
                <th className="py-2 font-medium">Numbers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.qid}>
                  <td className="py-2 pr-3 align-top"><span className="block text-ink">{topic(r.qid)}</span><span className="text-[11.5px] text-muted">{r.qid}</span></td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="max-w-[220px] py-2 pr-3 align-top">
                      <span className={cx("block", !r.statusSame && "font-medium text-ink")}>{statusWord(c.status) || "—"}</span>
                      {c.nums.length > 0 && <span className="block truncate text-[12px] text-ink-2 tnum" title={c.value}>{c.nums.join(", ")}</span>}
                    </td>
                  ))}
                  <td className="py-2 pr-2 align-top"><Mark ok={r.statusSame} /></td>
                  <td className="py-2 align-top"><Mark ok={r.numsSame} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Consistency() {
  const { runs, benchmarks } = useApp();
  const groups = useMemo(() => {
    const g: Record<string, RunMeta[]> = {};
    (runs ?? []).filter(isRepeatable).forEach((r) => (g[r.contract_id] ??= []).push(r));
    Object.values(g).forEach((l) => l.sort((a, b) => (a.started_at + a.run_id).localeCompare(b.started_at + b.run_id)));
    return g;
  }, [runs]);
  const repeated = Object.keys(groups).filter((c) => groups[c].length > 1).sort();
  const readings = useAsync(async () => {
    const out: Record<string, AnswerEnvelope[][]> = {};
    for (const c of repeated) {
      const by = await load.answersOf(groups[c].map((r) => r.run_id));
      out[c] = groups[c].map((r) => by[r.run_id] ?? []);
    }
    return out;
  }, [repeated.join(), runs]);
  const titleOf = (c: string) => shortTitle(benchmarks?.find((b) => b.contract_id === c)?.title ?? c);
  const cids = (benchmarks ?? []).map((b) => b.contract_id);

  return (
    <div>
      <Head title="Consistency" note="The spec asks for three readings of each contract, to show the answers do not change from run to run." />
      <ul className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {cids.map((c) => (
          <li key={c}>
            <div className="truncate text-[12.5px] text-muted">{c} · {titleOf(c)}</div>
            <div className="mt-1 font-serif text-[24px] font-semibold leading-none text-ink tnum">{groups[c]?.length ?? 0}<span className="font-sans text-[13px] font-normal text-muted"> / 3 readings</span></div>
          </li>
        ))}
      </ul>

      {!runs ? <Spinner /> : repeated.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong px-5 py-8 text-center">
          <div className="font-serif text-[18px] font-semibold text-ink">1 reading per contract so far</div>
          <p className="mt-1 text-[14px] text-muted">Repeat readings not yet run. Each extra Claude-read run of a contract appears here with its agreement.</p>
        </div>
      ) : readings.loading ? <Spinner label="Comparing the readings…" /> : readings.error || !readings.data ? <ErrorNote error={readings.error} /> : (
        repeated.map((c) => (
          <Sub key={c} title={<>{titleOf(c)} <span className="font-sans text-[13px] font-normal text-muted">{c}</span></>}>
            <ContractTable runs={groups[c]} readings={readings.data![c]} />
          </Sub>
        ))
      )}
    </div>
  );
}
