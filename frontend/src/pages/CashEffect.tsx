// "Effect on your cash": one chart, three numbers, one slider. Assumptions and the month table are behind disclosures.
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useRun } from "../context";
import type { CashInputs, CashParams, CashResult, CashflowResponse, ParamProvenance } from "../types";
import { money, moneyAxis, num, pct } from "../lib/format";
import { Button, Disclosure, ErrorNote, Figure, Spinner, cx, inputCls } from "../components/ui";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Round axis ticks that always include zero. */
function niceTicks(vals: number[]): number[] {
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const raw = span / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((x) => x >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step + step / 2; t += step) out.push(Math.round(t));
  return out;
}

function vsFair(a: number, b: number): string {
  const d = a - b;
  if (Math.abs(d) < 1000) return "same as fair terms";
  return `${d > 0 ? "+" : "−"}${money(Math.abs(d)).replace(/^Rs /, "Rs ")} vs fair terms`;
}

export function CashEffect({ params, base, onParams }: { params: CashParams; base: CashflowResponse; onParams: (p: CashParams) => void }) {
  const { runId } = useRun();
  const inp = params.inputs;
  const [delay, setDelay] = useState(inp.delay_days);
  const dDelay = useDebounced(delay, 300);
  const [res, setRes] = useState<CashflowResponse>(base);
  const [err, setErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => { setRes(base); }, [base]);
  useEffect(() => {
    if (dDelay === inp.delay_days) { setRes(base); setErr(null); return; }
    const my = ++seq.current;
    setLoading(true);
    api.cashflow(runId, { delay_days: dDelay }).then(
      (r) => { if (my === seq.current) { setRes(r); setErr(null); setLoading(false); } },
      (e) => { if (my === seq.current) { setErr(e); setLoading(false); } },
    );
  }, [dDelay, runId, inp.delay_days, base]);

  const w = res.as_written;
  const r = res.reference;
  const data = useMemo(() => w.months.map((m, i) => ({ month: m.month, written: -m.gap, fair: r.months[i] ? -r.months[i].gap : null })), [w, r]);
  const ticks = useMemo(() => niceTicks(data.flatMap((d) => [d.written, d.fair ?? 0])), [data]);

  return (
    <div>
      <div className={cx("grid grid-cols-1 gap-5 sm:grid-cols-3", loading && "opacity-60")}>
        <Figure label="Peak funding" value={money(w.peak_funding)}
          note={w.peak_funding > 0 ? `month ${w.peak_month} · ${vsFair(w.peak_funding, r.peak_funding)}` : "none needed"} />
        <Figure label="Financing cost" value={money(w.overdraft_interest)}
          note={`at ${pct(inp.overdraft_rate_pa)} a year`} />
        <Figure label={`Delay penalty · ${delay} days`} value={money(w.ld_amount)}
          note={w.ld_days_to_cap != null ? `cap reached at day ${num(w.ld_days_to_cap)}` : delay === 0 ? "use the slider" : "no cap found"} />
      </div>

      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-2"><span className="inline-block h-0.5 w-6 bg-accent" />As written</span>
        <span className="inline-flex items-center gap-2"><span className="inline-block w-6 border-t-2 border-dashed" style={{ borderColor: "var(--fair)" }} />Fair terms</span>
        <span className="text-muted">Below 0 = your own money</span>
      </div>
      <div className={cx("mt-2 h-[240px] sm:h-[280px]", loading && "opacity-60")}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} minTickGap={18}
              label={{ value: "month", position: "insideBottomRight", offset: -2, fill: "var(--muted)", fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={52} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} />
            <Tooltip formatter={(v: number, n: string) => [money(v), n === "written" ? "As written" : "Fair terms"]} labelFormatter={(m) => `Month ${m}`} />
            <ReferenceLine y={0} stroke="var(--ink-2)" strokeWidth={1} />
            <Line type="linear" dataKey="fair" stroke="var(--fair)" strokeWidth={1.75} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="written" stroke="var(--accent)" strokeWidth={2.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <label className="mt-5 block max-w-[520px]">
        <span className="text-[14px] font-medium text-ink">Delay: <span className="tnum">{delay}</span> days</span>
        <input type="range" min={0} max={365} step={5} value={delay} onChange={(e) => setDelay(+e.target.value)} className="mt-1.5 w-full" aria-label="Days of delay" />
        <span className="flex justify-between text-[12px] text-muted"><span>on time</span><span>1 year</span></span>
      </label>
      {err ? <div className="mt-3"><ErrorNote error={err} title="Cash model failed" /></div> : null}

      <div className="mt-6 flex flex-col gap-2">
        <Disclosure summary="Assumptions"><Assumptions params={params} onSaved={onParams} /></Disclosure>
        <Disclosure summary="Month by month"><MonthTable w={w} /></Disclosure>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Kind = "money" | "pct" | "days" | "months" | "bool" | "list";
const FIELDS: { key: keyof CashInputs; label: string; kind: Kind; none?: string }[] = [
  { key: "contract_value", label: "Contract value", kind: "money" },
  { key: "duration_months", label: "Time to complete", kind: "months" },
  { key: "progress", label: "Planned progress", kind: "list", none: "not set" },
  { key: "cost_share", label: "Your cost as % of contract value", kind: "pct" },
  { key: "pay_lag_days", label: "Days to pay a bill", kind: "days" },
  { key: "cert_lag_days", label: "Days to certify a bill", kind: "days" },
  { key: "min_bill_value", label: "Minimum bill amount", kind: "money" },
  { key: "late_interest_rate_pa", label: "Interest on late payment (a year)", kind: "pct" },
  { key: "retention_rate", label: "Share of each bill held back", kind: "pct" },
  { key: "retention_cap", label: "Limit on money held back (share of contract)", kind: "pct", none: "no limit" },
  { key: "retention_release", label: "When held-back money is returned", kind: "list" },
  { key: "dlp_months", label: "Defects period", kind: "months" },
  { key: "advance_instalments", label: "Advance", kind: "list" },
  { key: "advance_recovery_rate", label: "Share of each bill taken to repay the advance", kind: "pct" },
  { key: "advance_recovery_deadline", label: "Advance fully repaid by (share of the time)", kind: "pct", none: "no deadline" },
  { key: "advance_interest_rate_pa", label: "Interest on the advance (a year)", kind: "pct" },
  { key: "ld_rate_per_day", label: "Delay penalty per day (share of contract)", kind: "pct" },
  { key: "ld_cap", label: "Limit on the delay penalty", kind: "pct", none: "no limit" },
  { key: "ld_grace_days", label: "Days late before the penalty starts", kind: "days" },
  { key: "pv_applies", label: "Prices adjusted for inflation", kind: "bool" },
  { key: "pv_factor", label: "Share of work value adjusted", kind: "pct" },
  { key: "index_rise_pa", label: "Expected price rise a year", kind: "list" },
  { key: "perf_security_pct", label: "Performance guarantee", kind: "pct" },
  { key: "perf_security_validity_months_after_completion", label: "Guarantee kept after completion", kind: "months" },
  { key: "overdraft_rate_pa", label: "Your overdraft interest rate (a year)", kind: "pct" },
  { key: "bank_rate_pa", label: "RBI Bank Rate", kind: "pct" },
  { key: "bg_commission_pa", label: "Bank guarantee commission (a year)", kind: "pct" },
  { key: "supplier_credit_days", label: "Credit from your suppliers", kind: "days" },
];

function show(v: unknown, kind: Kind, none?: string): string {
  if (v === null || v === undefined) return none ?? "–";
  switch (kind) {
    case "money": return money(v as number);
    case "pct": return pct(v as number);
    case "days": return `${num(v as number)} days`;
    case "months": return `${+(v as number).toFixed(1)} months`;
    case "bool": return v ? "Yes" : "No";
    case "list": {
      if (Array.isArray(v)) {
        if (!v.length) return "none";
        if (typeof v[0] === "number") return `${v.length} months, busiest month ${pct(Math.max(...(v as number[])), 1)} of the work`;
        return (v as Record<string, number>[]).map((x) => "share_of_value" in x
          ? `${pct(x.share_of_value)} in month ${x.month}`
          : `${pct(x.share)} ${x.months_after_completion < 1 ? "about " + Math.round(x.months_after_completion * 30) + " days" : +x.months_after_completion.toFixed(1) + " months"} after completion`).join(", ");
      }
      const e = Object.entries(v as Record<string, number>);
      return e.length ? e.map(([k, x]) => `${k} ${pct(x)}`).join(", ") : "none";
    }
  }
}

function Assumptions({ params, onSaved }: { params: CashParams; onSaved: (p: CashParams) => void }) {
  const { runId, meta, answers, openAnswer } = useRun();
  const frozen = !!meta?.frozen;
  const [draft, setDraft] = useState<CashInputs>(params.inputs);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { setDraft(params.inputs); setEdited(new Set()); }, [params]);
  const prov = (k: string) => params.provenance.find((p) => p.field === k);
  const confirmed = params.provenance.length > 0 && params.provenance.every((p) => p.confirmed);

  const setVal = (k: keyof CashInputs, raw: string, kind: Kind) => {
    let v: unknown;
    if (kind === "bool") v = raw === "true";
    else if (raw.trim() === "") v = null;
    else v = kind === "pct" ? parseFloat(raw) / 100 : parseFloat(raw);
    setDraft((d) => ({ ...d, [k]: v }));
    setEdited((s) => new Set(s).add(k));
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const fields = new Set(params.provenance.map((p) => p.field));
      const provenance: ParamProvenance[] = params.provenance.map((p) => edited.has(p.field) ? { ...p, source: "user", confirmed: true } : { ...p, confirmed: true });
      edited.forEach((f) => { if (!fields.has(f)) provenance.push({ field: f, source: "user", question_id: "", quote: "", confirmed: true }); });
      onSaved(await api.saveParams(runId, { inputs: draft, provenance }));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 text-[12.5px] text-muted">
        <span>{confirmed ? "Confirmed" : frozen ? "Read-only demo" : "Not confirmed yet"}</span>
        <span>“assumed” = not from the contract</span>
      </div>
      <div className="mt-3 divide-y divide-line border-y border-line">
        {FIELDS.map((f) => {
          const p = prov(f.key);
          const v = draft[f.key];
          const src = edited.has(f.key) ? "user" : p?.source ?? "default";
          const env = p?.question_id ? answers?.find((e) => e.answer.question_id === p.question_id) : undefined;
          const editable = !frozen && f.kind !== "list";
          return (
            <div key={f.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[14px]">
              <span className="w-full text-ink sm:w-[44%]">{f.label}</span>
              <span className="w-[190px]">
                {editable ? (
                  f.kind === "bool" ? (
                    <select className={cx(inputCls, "py-1 text-[14px]")} value={String(v)} onChange={(e) => setVal(f.key, e.target.value, f.kind)} aria-label={f.label}>
                      <option value="true">Yes</option><option value="false">No</option>
                    </select>
                  ) : (
                    <span className="relative block">
                      <input type="number" step="any" aria-label={f.label} placeholder={f.none}
                        className={cx(inputCls, "py-1 pr-16 text-[14px] tnum", edited.has(f.key) && "border-accent")}
                        value={v === null || v === undefined ? "" : f.kind === "pct" ? +((v as number) * 100).toFixed(5) : (v as number)}
                        onChange={(e) => setVal(f.key, e.target.value, f.kind)} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-muted">
                        {f.kind === "pct" ? "%" : f.kind === "money" ? "Rs" : f.kind === "days" ? "days" : f.kind === "months" ? "months" : ""}
                      </span>
                    </span>
                  )
                ) : <span className="text-ink">{show(v, f.kind, f.none)}</span>}
              </span>
              <span className="text-[13px] text-muted">
                {src === "extracted" ? (env ? <button className="text-accent-ink hover:underline" onClick={() => openAnswer(env, "Assumption")}>from the contract{env.answer.pdf_page ? ` (p. ${env.answer.pdf_page})` : ""}</button> : "from the contract")
                  : src === "user" ? "your figure" : "assumed"}
              </span>
            </div>
          );
        })}
      </div>
      {err ? <div className="mt-3"><ErrorNote error={err} title="Could not save" /></div> : null}
      {!frozen && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : edited.size ? "Save and recalculate" : "Confirm these figures"}</Button>
          {edited.size > 0 && <Button variant="quiet" onClick={() => { setDraft(params.inputs); setEdited(new Set()); }}>Undo changes</Button>}
          {confirmed && edited.size === 0 && <span className="text-[13.5px] text-muted">Confirmed.</span>}
        </div>
      )}
    </div>
  );
}

function MonthTable({ w }: { w: CashResult }) {
  const cols: [keyof CashResult["months"][number] | "pos", string][] = [
    ["gross", "Work done"], ["retention", "Held back"], ["advance_recovery", "Advance repaid"],
    ["cash_in", "Cash in"], ["cash_out", "Cash out"], ["pos", "Your position"],
  ];
  return (
    <div className="scroll-thin max-h-[440px] overflow-auto border-y border-line">
      <table className="w-full min-w-[640px] text-[13.5px] tnum">
        <thead className="sticky top-0 bg-page">
          <tr className="border-b border-line text-right text-muted">
            <th className="py-2 pr-3 text-left font-medium">Month</th>
            {cols.map(([, l]) => <th key={l} className="py-2 pr-3 font-medium">{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {w.months.map((m) => (
            <tr key={m.month} className={cx("border-b border-line text-right last:border-0", m.month === w.peak_month && w.peak_funding > 0 && "font-medium text-ink")}>
              <td className="py-1.5 pr-3 text-left">{m.month}</td>
              {cols.map(([k]) => <td key={k} className="py-1.5 pr-3">{money(k === "pos" ? -m.gap : (m[k] as number))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CashLoading() {
  return <Spinner label="Working out the cash effect…" />;
}
