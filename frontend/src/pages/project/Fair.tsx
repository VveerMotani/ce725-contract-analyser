// As written vs fair terms: each contract's cash model run twice, on the terms as written and with the
// risky terms set to reference values (backend/analyser/cashflow/reference.py). The project's comparison,
// not advice.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useApp, useAsync } from "../../context";
import type { CashResult, CashflowResponse, ReferenceChange, RunMeta } from "../../types";
import { money, pct } from "../../lib/format";
import { ErrorNote, Spinner, cx } from "../../components/ui";
import { Head, Sub, cached, latestByContract, shortTitle } from "./shared";

type Key = "peak_funding" | "overdraft_interest" | "guarantee_cost" | "retention_locked_max" | "ld_amount" | "total_cost_of_terms";
const ITEMS: [Key, string][] = [
  ["peak_funding", "Peak funding"],
  ["overdraft_interest", "Financing cost"],
  ["guarantee_cost", "Guarantee cost"],
  ["retention_locked_max", "Retention locked"],
  ["ld_amount", "Delay penalty"],
  ["total_cost_of_terms", "Total cost of terms"],
];

const FIELD_WORD: Record<string, string> = {
  retention_rate: "Retention per bill",
  retention_cap: "Retention cap",
  retention_release: "Retention released",
  "cert_lag_days + pay_lag_days": "Days to be paid",
  ld_rate_per_day: "Delay penalty per day",
  ld_cap: "Delay penalty cap",
  perf_security_pct: "Performance guarantee",
  pv_applies: "Price adjustment",
};

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (field === "pv_applies") return v ? "Indexed" : "Fixed price";
  if (field === "cert_lag_days + pay_lag_days") return `${Math.round(Number(v))} days`;
  if (field === "ld_rate_per_day") return `${pct(Number(v))} / day`;
  if (field === "retention_release" && Array.isArray(v)) {
    return (v as { share: number; months_after_completion: number }[])
      .map((s) => `${pct(s.share)} ${s.months_after_completion > 0 ? `${+s.months_after_completion.toFixed(1)} months after completion` : "at completion"}`).join(", ") || "never";
  }
  if (typeof v === "number") return pct(v);
  return String(v);
}

interface Col { meta: RunMeta; title: string; cash?: CashflowResponse; changes: ReferenceChange[] }

function Pair({ a, b, max }: { a: number; b: number; max: number }) {
  const w = (x: number) => `${Math.max(0, (x / Math.max(max, 1)) * 100)}%`;
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={`As written ${money(a)}, fair terms ${money(b)}`}>
      <span className="h-2.5 rounded-sm bg-surface-2"><span className="block h-full rounded-sm bg-accent" style={{ width: w(a) }} /></span>
      <span className="h-2.5 rounded-sm bg-surface-2"><span className="block h-full rounded-sm" style={{ width: w(b), background: "var(--fair)" }} /></span>
    </div>
  );
}

function Delta({ d }: { d: number }) {
  if (Math.abs(d) < 1) return <span className="text-muted">same</span>;
  return <span className={cx("font-medium tnum", d > 0 ? "text-bad" : "text-good")}>{money(d, false, { sign: true })}</span>;
}

function Legend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />As written</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--fair)" }} />Fair reference terms</span>
      <span>Difference: <span className="text-bad">red</span> = the contract costs more</span>
    </p>
  );
}

function ContractBlock({ c }: { c: Col }) {
  const w = c.cash?.as_written, r = c.cash?.reference;
  if (!w || !r) return <p className="text-[14px] text-muted">No cash figures for this contract.</p>;
  return (
    <div>
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <ul className="flex flex-col gap-3">
          {ITEMS.map(([k, label]) => {
            const a = (w as CashResult)[k] as number, b = (r as CashResult)[k] as number;
            return (
              <li key={k} className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-x-3 gap-y-1 sm:grid-cols-[140px_minmax(0,1fr)_96px]">
                <span className={cx("text-[13.5px]", k === "total_cost_of_terms" ? "font-semibold text-ink" : "text-ink-2")}>{label}</span>
                <span className="order-3 col-span-2 sm:order-none sm:col-span-1"><Pair a={a} b={b} max={Math.max(a, b)} /></span>
                <span className="text-right text-[13px] leading-tight">
                  <span className="block text-ink tnum">{money(a)}</span>
                  <span className="block text-[12px]"><Delta d={a - b} /></span>
                </span>
              </li>
            );
          })}
        </ul>
        <div>
          <div className="text-[12.5px] font-medium text-muted">Terms set to reference</div>
          {c.changes.length === 0 ? (
            <p className="mt-2 text-[14px] text-ink-2">None: every modelled term is already at or better than the reference.</p>
          ) : (
            <table className="mt-1 w-full text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {c.changes.map((ch) => {
                  const [code, ...why] = ch.reason.split(":");
                  return (
                    <tr key={ch.field}>
                      <td className="py-2 pr-2 align-top">
                        <span className="block text-ink">{FIELD_WORD[ch.field] ?? ch.field}</span>
                        <span className="text-[11.5px] text-muted">{code}{why.length ? ` ·${why.join(":")}` : ""}</span>
                      </td>
                      <td className="py-2 align-top text-ink-2">
                        <span className="text-ink">{fmtValue(ch.field, ch.as_written)}</span>
                        <span className="text-muted"> → </span>{fmtValue(ch.field, ch.reference)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Overall({ cols }: { cols: Col[] }) {
  const rows = cols.filter((c) => c.cash).map((c) => ({ c, a: c.cash!.as_written.total_cost_of_terms, b: c.cash!.reference.total_cost_of_terms, v: c.cash!.as_written }));
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(({ c, a, b }) => {
        const d = a - b;
        const share = b > 0 ? d / b : null;
        return (
          <li key={c.meta.run_id} className="min-w-0 rounded-lg border border-line bg-surface p-3.5">
            <div className="truncate text-[12.5px] text-muted">{c.meta.contract_id} · {c.title}</div>
            <div className="mt-1 font-serif text-[22px] font-semibold leading-none tnum"><Delta d={d} /></div>
            <div className="mt-1 text-[12px] text-muted">cost of terms vs fair{share != null && Math.abs(d) >= 1 ? ` (${share > 0 ? "+" : ""}${pct(share, 0)})` : ""}</div>
            <div className="mt-3"><Pair a={a} b={b} max={Math.max(a, b)} /></div>
            <div className="mt-1 flex justify-between text-[11.5px] text-muted tnum"><span>{money(a)}</span><span>{money(b)}</span></div>
          </li>
        );
      })}
    </ul>
  );
}

export default function Fair() {
  const { runs, benchmarks } = useApp();
  const cids = useMemo(() => (benchmarks ?? []).map((b) => b.contract_id), [benchmarks]);
  const data = useAsync(async () => {
    const latest = latestByContract(runs, cids);
    return Promise.all(cids.filter((c) => latest[c]).map(async (cid): Promise<Col> => {
      const m = latest[cid];
      const [cash, changes] = await Promise.all([
        cached(`cash/${m.run_id}`, () => api.cashflow(m.run_id)).catch(() => undefined),
        cached(`refchanges/${m.run_id}`, () => api.referenceChanges(m.run_id)).catch(() => [] as ReferenceChange[]),
      ]);
      return { meta: m, title: shortTitle(benchmarks?.find((b) => b.contract_id === cid)?.title ?? cid), cash, changes };
    }));
  }, [runs, cids]);

  if (!runs || !benchmarks || data.loading) return <Spinner label="Running the cash model twice…" />;
  if (data.error || !data.data) return <ErrorNote error={data.error} title="Could not load the cash figures" />;
  const cols = data.data;

  return (
    <div>
      <Head title="As written vs fair terms"
        note="The project’s comparison, not advice: the same cash model run on each contract as written, and again with its risky terms set to reference values (CPWD, NHAI and Manual for Procurement of Works 2022). Only terms worse than the reference are changed." />
      <Legend />
      <div className="mt-4"><Overall cols={cols} /></div>
      {cols.map((c) => (
        <Sub key={c.meta.run_id} title={<>{c.title} <span className="font-sans text-[13px] font-normal text-muted">{c.meta.contract_id}</span></>}
          aside={<Link className="text-accent-ink hover:underline" to={`/runs/${c.meta.run_id}`}>report</Link>}>
          <ContractBlock c={c} />
        </Sub>
      ))}
      <p className="mt-8 text-[12.5px] text-muted">Inputs are each run’s illustrative project figures (shown under Cash → assumptions on its report). Scenarios, not predictions.</p>
    </div>
  );
}
