// S8 Cash flow: confirm parameters (Interface B), then KPIs, cumulative gap, cash in vs out,
// "as written" vs "at reference value", sliders that re-run the model, sensitivity.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend as RLegend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  BadgeCheck, CalendarClock, Gavel, Landmark, Lock, PiggyBank, RotateCcw, ShieldCheck, SlidersHorizontal, TrendingUp, Wallet,
} from "lucide-react";
import { api, ApiError } from "../api";
import { useApp, useAsync, useRun } from "../context";
import type { CashInputs, CashParams, CashResult, CashflowResponse, ParamProvenance } from "../types";
import { money, moneyAxis, num, pct } from "../lib/format";
import { RunGate } from "../components/RunGate";
import { Button, Card, Chip, Collapsible, ErrorBox, KpiTile, PageHeader, Segmented, Spinner, Tip, type Tone, cx, inputCls } from "../components/ui";

type Kind = "money" | "pct" | "days" | "months" | "num" | "bool" | "share" | "list";
const FIELDS: { key: keyof CashInputs; label: string; kind: Kind; group: string; nullLabel?: string }[] = [
  { key: "contract_value", label: "Contract value", kind: "money", group: "Project" },
  { key: "duration_months", label: "Duration", kind: "months", group: "Project" },
  { key: "progress", label: "Monthly progress", kind: "list", group: "Project" },
  { key: "cost_share", label: "Cost as share of value", kind: "pct", group: "Project" },
  { key: "delay_days", label: "Expected delay", kind: "days", group: "Project" },
  { key: "cert_lag_days", label: "Certification lag", kind: "days", group: "C1 Payment" },
  { key: "pay_lag_days", label: "Payment lag", kind: "days", group: "C1 Payment" },
  { key: "min_bill_value", label: "Minimum bill value", kind: "money", group: "C1 Payment" },
  { key: "late_interest_rate_pa", label: "Interest on late payment", kind: "pct", group: "C1 Payment" },
  { key: "retention_rate", label: "Retention rate", kind: "pct", group: "C2 Retention" },
  { key: "retention_cap", label: "Retention cap (share of value)", kind: "pct", group: "C2 Retention", nullLabel: "no cap" },
  { key: "retention_release", label: "Retention release", kind: "list", group: "C2 Retention" },
  { key: "dlp_months", label: "Defects liability period", kind: "months", group: "C2 Retention" },
  { key: "advance_instalments", label: "Advance instalments", kind: "list", group: "C3 Advance" },
  { key: "advance_recovery_rate", label: "Recovery per bill", kind: "pct", group: "C3 Advance" },
  { key: "advance_recovery_deadline", label: "Recovery deadline (share of duration)", kind: "pct", group: "C3 Advance", nullLabel: "none" },
  { key: "advance_interest_rate_pa", label: "Interest on advance", kind: "pct", group: "C3 Advance" },
  { key: "ld_rate_per_day", label: "Delay damages per day", kind: "pct", group: "C4 Delay damages" },
  { key: "ld_cap", label: "Damages cap", kind: "pct", group: "C4 Delay damages", nullLabel: "uncapped" },
  { key: "ld_grace_days", label: "Grace days", kind: "days", group: "C4 Delay damages" },
  { key: "pv_applies", label: "Price variation applies", kind: "bool", group: "C5 Price variation" },
  { key: "pv_factor", label: "PV factor", kind: "num", group: "C5 Price variation" },
  { key: "pv_weights", label: "PV weights", kind: "list", group: "C5 Price variation" },
  { key: "index_rise_pa", label: "Index rise scenario", kind: "list", group: "C5 Price variation" },
  { key: "perf_security_pct", label: "Performance security", kind: "pct", group: "C6 Guarantees" },
  { key: "perf_security_validity_months_after_completion", label: "Guarantee validity after completion/DLP", kind: "months", group: "C6 Guarantees" },
  { key: "overdraft_rate_pa", label: "Overdraft rate", kind: "pct", group: "Finance (your inputs)" },
  { key: "bank_rate_pa", label: "RBI Bank Rate", kind: "pct", group: "Finance (your inputs)" },
  { key: "bg_commission_pa", label: "BG commission", kind: "pct", group: "Finance (your inputs)" },
  { key: "supplier_credit_days", label: "Supplier credit", kind: "days", group: "Finance (your inputs)" },
];

const PROV_TONE: Record<ParamProvenance["source"], Tone> = { extracted: "good", user: "accent", default: "warn" };

function fmtField(v: unknown, kind: Kind, full: boolean, nullLabel?: string): string {
  if (v === null || v === undefined) return nullLabel ?? "–";
  switch (kind) {
    case "money": return money(v as number, full);
    case "pct": return pct(v as number, 2);
    case "days": return `${num(v as number)} days`;
    case "months": return `${+(v as number).toFixed(1)} months`;
    case "bool": return v ? "Yes" : "No";
    case "num": return String(v);
    case "list": {
      if (Array.isArray(v)) {
        if (!v.length) return "none";
        if (typeof v[0] === "number") return `${v.length} months, peak ${pct(Math.max(...(v as number[])), 1)}`;
        return (v as Record<string, number>[]).map((x) => "share_of_value" in x ? `${pct(x.share_of_value)} in M${x.month}` : `${pct(x.share)} at +${x.months_after_completion} mo`).join(", ");
      }
      const e = Object.entries(v as Record<string, number>);
      return e.length ? e.map(([k, x]) => `${k} ${pct(x)}`).join(", ") : "none";
    }
    default: return String(v);
  }
}

function ParamsTable({ params, frozen, onSaved }: { params: CashParams; frozen: boolean; onSaved: (p: CashParams) => void }) {
  const { runId, answers, openAnswer } = useRun();
  const { fullMoney } = useApp();
  const [draft, setDraft] = useState<CashInputs>(params.inputs);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const prov = (k: string) => params.provenance.find((p) => p.field === k);
  const allConfirmed = params.provenance.length > 0 && params.provenance.every((p) => p.confirmed);

  const setVal = (k: keyof CashInputs, raw: string, kind: Kind) => {
    let v: unknown;
    if (kind === "bool") v = raw === "true";
    else if (raw.trim() === "") v = null;
    else v = kind === "pct" ? parseFloat(raw) / 100 : parseFloat(raw);
    setDraft((d) => ({ ...d, [k]: v }));
    setEdited((s) => new Set(s).add(k));
  };

  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      const fields = new Set(params.provenance.map((p) => p.field));
      const provenance: ParamProvenance[] = params.provenance.map((p) => edited.has(p.field) ? { ...p, source: "user", confirmed: true } : { ...p, confirmed: true });
      edited.forEach((f) => { if (!fields.has(f)) provenance.push({ field: f, source: "user", question_id: "", quote: "", confirmed: true }); });
      onSaved(await api.saveParams(runId, { inputs: draft, provenance }));
      setEdited(new Set());
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const counts = { extracted: 0, user: 0, default: 0 } as Record<ParamProvenance["source"], number>;
  params.provenance.forEach((p) => counts[p.source]++);

  return (
    <Card title="Confirm parameters" icon={<BadgeCheck className="h-4 w-4 text-muted" />}
      subtitle="Numbers the cash model will use. Extracted values carry their source; check defaults before relying on the result."
      actions={<div className="flex items-center gap-1.5">
        <Chip tone="good" size="xs">{counts.extracted} extracted</Chip><Chip tone="accent" size="xs">{counts.user} yours</Chip><Chip tone="warn" size="xs">{counts.default} default</Chip>
      </div>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3 font-semibold">Parameter</th><th className="w-[200px] py-1.5 pr-3 font-semibold">Value</th>
              <th className="py-1.5 pr-3 font-semibold">Source</th><th className="py-1.5 font-semibold">Proof</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FieldGroup key={g} g={g}>
                {FIELDS.filter((f) => f.group === g).map((f) => {
                  const p = prov(f.key);
                  const v = draft[f.key];
                  const env = p?.question_id ? answers?.find((e) => e.answer.question_id === p.question_id) : undefined;
                  const editable = !frozen && f.kind !== "list";
                  const src = edited.has(f.key) ? "user" : p?.source ?? "default";
                  return (
                    <tr key={f.key} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3 text-ink">{f.label}</td>
                      <td className="py-1.5 pr-3">
                        {editable ? (
                          f.kind === "bool" ? (
                            <select className={cx(inputCls, "py-1")} value={String(v)} onChange={(e) => setVal(f.key, e.target.value, f.kind)}><option value="true">Yes</option><option value="false">No</option></select>
                          ) : (
                            <div className="relative">
                              <input type="number" step="any" className={cx(inputCls, "py-1 pr-12 tnum", edited.has(f.key) && "border-accent")}
                                value={v === null || v === undefined ? "" : f.kind === "pct" ? +((v as number) * 100).toFixed(5) : (v as number)}
                                placeholder={f.nullLabel} onChange={(e) => setVal(f.key, e.target.value, f.kind)} />
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted">
                                {f.kind === "pct" ? "%" : f.kind === "money" ? "Rs" : f.kind === "days" ? "days" : f.kind === "months" ? "mo" : ""}
                              </span>
                            </div>
                          )
                        ) : <span className="font-medium text-ink">{fmtField(v, f.kind, fullMoney, f.nullLabel)}</span>}
                        {editable && f.kind === "money" && v ? <div className="mt-0.5 text-[11px] text-muted">{money(v as number, fullMoney)}</div> : null}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="flex items-center gap-1">
                          <Chip size="xs" tone={PROV_TONE[src]}>{src}</Chip>
                          {p?.confirmed && !edited.has(f.key) && <Tip tip="Confirmed"><ShieldCheck className="h-3.5 w-3.5 text-good" /></Tip>}
                        </span>
                      </td>
                      <td className="max-w-[340px] py-1.5">
                        <div className="flex items-center gap-2">
                          {p?.question_id && (env ? (
                            <button onClick={() => openAnswer(env)} className="shrink-0 rounded bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-ink hover:underline">Q {p.question_id} · p.{env.answer.pdf_page}</button>
                          ) : <Chip size="xs">Q {p.question_id}</Chip>)}
                          {p?.quote && <span className="truncate font-serif text-xs text-ink-2" title={p.quote}>“{p.quote}”</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </FieldGroup>
            ))}
          </tbody>
        </table>
      </div>
      {err ? <div className="mt-3"><ErrorBox error={err} title="Could not save parameters" /></div> : null}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {frozen ? <Chip icon={<Lock className="h-3 w-3" />}>Frozen demo run: parameters are read-only (sliders below still work)</Chip> : (
          <>
            {edited.size > 0 && <Button variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { setDraft(params.inputs); setEdited(new Set()); }}>Undo edits</Button>}
            {allConfirmed && edited.size === 0 ? <Chip tone="good" icon={<ShieldCheck className="h-3 w-3" />}>All parameters confirmed</Chip> : null}
            <Button variant="primary" icon={<BadgeCheck className="h-4 w-4" />} disabled={busy} onClick={confirm}>{busy ? "Saving…" : edited.size ? `Save ${edited.size} edit(s) and confirm` : "Confirm parameters"}</Button>
          </>
        )}
      </div>
    </Card>
  );
}

function FieldGroup({ g, children }: { g: string; children: ReactNode }) {
  return (
    <>
      <tr><td colSpan={4} className="pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-accent-ink">{g}</td></tr>
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Delta({ a, b }: { a: number; b: number }) {
  const { fullMoney } = useApp();
  const d = a - b;
  if (Math.abs(d) < 1) return <span className="text-muted">same as reference</span>;
  return <span className={d > 0 ? "text-bad-ink" : "text-good-ink"}>{money(d, fullMoney, { sign: true })} vs reference</span>;
}

function Results({ params }: { params: CashParams }) {
  const { runId } = useRun();
  const { fullMoney } = useApp();
  const base = params.inputs;
  const hasAdvance = base.advance_instalments.length > 0;
  const [delay, setDelay] = useState(base.delay_days);
  const [lag, setLag] = useState(base.pay_lag_days);
  const [advance, setAdvance] = useState(hasAdvance);
  const [sensMetric, setSensMetric] = useState<"total_cost_of_terms" | "peak_funding">("total_cost_of_terms");
  const ov = useDebounced({ delay, lag, advance }, 400);
  const [res, setRes] = useState<CashflowResponse>();
  const [err, setErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    const overrides: Partial<CashInputs> = {};
    if (ov.delay !== base.delay_days) overrides.delay_days = ov.delay;
    if (ov.lag !== base.pay_lag_days) overrides.pay_lag_days = ov.lag;
    if (hasAdvance && !ov.advance) { overrides.advance_instalments = []; overrides.advance_recovery_rate = 0; }
    setLoading(true);
    api.cashflow(runId, overrides).then(
      (r) => { if (my === seq.current) { setRes(r); setErr(null); setLoading(false); } },
      (e) => { if (my === seq.current) { setErr(e); setLoading(false); } },
    );
  }, [ov.delay, ov.lag, ov.advance, runId, base.delay_days, base.pay_lag_days, hasAdvance]);

  const w = res?.as_written;
  const r = res?.reference;
  const chart = useMemo(() => {
    if (!w) return [];
    return w.months.map((m, i) => ({ ...m, ref_gap: r?.months[i]?.gap ?? null, cash_out_neg: m.cash_out }));
  }, [w, r]);
  const reset = () => { setDelay(base.delay_days); setLag(base.pay_lag_days); setAdvance(hasAdvance); };

  return (
    <div className="flex flex-col gap-4">
      {/* Sliders */}
      <Card bodyClass="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><SlidersHorizontal className="h-4 w-4 text-muted" /> What if</span>
        <label className="flex min-w-[220px] flex-1 items-center gap-3 text-[13px]">
          <span className="w-[86px] shrink-0 text-ink-2">Delay</span>
          <input type="range" min={0} max={365} step={5} value={delay} onChange={(e) => setDelay(+e.target.value)} className="flex-1" aria-label="Delay days" />
          <span className="w-[64px] text-right font-semibold text-ink tnum">{delay} d</span>
        </label>
        <label className="flex min-w-[220px] flex-1 items-center gap-3 text-[13px]">
          <span className="w-[86px] shrink-0 text-ink-2">Payment lag</span>
          <input type="range" min={0} max={180} step={5} value={lag} onChange={(e) => setLag(+e.target.value)} className="flex-1" aria-label="Payment lag days" />
          <span className="w-[64px] text-right font-semibold text-ink tnum">{lag} d</span>
        </label>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-ink-2">Advance</span>
          {hasAdvance ? <Segmented value={advance ? "on" : "off"} onChange={(v) => setAdvance(v === "on")} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} />
            : <Tip tip="The contract gives no mobilisation advance"><Chip size="xs">none in contract</Chip></Tip>}
        </div>
        <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3 w-3" />} onClick={reset}>Reset</Button>
        {loading && <span className="text-xs text-muted">updating…</span>}
      </Card>

      {err ? <ErrorBox error={err} title="Cash model failed" /> : null}
      {!w || !r ? (!err && <Spinner label="Running the cash model…" />) : (
        <>
          {/* KPI tiles */}
          <div className={cx("grid grid-cols-2 gap-3 md:grid-cols-4", loading && "opacity-70")}>
            <KpiTile label="Peak funding" icon={<Wallet className="h-3.5 w-3.5" />} tone="serious" value={money(w.peak_funding, fullMoney)} sub={<>month {w.peak_month} · <Delta a={w.peak_funding} b={r.peak_funding} /></>} />
            <KpiTile label="Overdraft interest" icon={<Landmark className="h-3.5 w-3.5" />} value={money(w.overdraft_interest, fullMoney)} sub={<Delta a={w.overdraft_interest} b={r.overdraft_interest} />} />
            <KpiTile label="Guarantee cost" icon={<ShieldCheck className="h-3.5 w-3.5" />} value={money(w.guarantee_cost, fullMoney)} sub={<Delta a={w.guarantee_cost} b={r.guarantee_cost} />} />
            <KpiTile label="Retention locked" icon={<PiggyBank className="h-3.5 w-3.5" />} value={money(w.retention_locked_max, fullMoney)} sub={w.retention_cap_month ? `cap reached in month ${w.retention_cap_month}` : `financing cost ${money(w.retention_financing_cost, fullMoney)}`} />
            <KpiTile label={`Damages · ${delay} days late`} icon={<Gavel className="h-3.5 w-3.5" />} tone={w.ld_amount > 0 ? "bad" : undefined} value={money(w.ld_amount, fullMoney)} sub={<Delta a={w.ld_amount} b={r.ld_amount} />} />
            <KpiTile label="Days to damages cap" icon={<CalendarClock className="h-3.5 w-3.5" />} value={w.ld_days_to_cap == null ? "No cap" : `${Math.round(w.ld_days_to_cap)} days`} sub={w.ld_days_to_cap == null ? "damages uncapped" : `≈ ${(w.ld_days_to_cap / 30).toFixed(1)} months of delay`} tone={w.ld_days_to_cap == null ? "bad" : undefined} />
            <KpiTile label={w.escalation_is_recovery ? "Escalation recovery" : "Escalation exposure"} icon={<TrendingUp className="h-3.5 w-3.5" />} tone={w.escalation_is_recovery ? "good" : "warn"} value={money(w.escalation_amount, fullMoney)} sub={w.escalation_is_recovery ? "paid to you under price variation" : "fixed price: your risk"} />
            <KpiTile label="Total cost of terms" icon={<Wallet className="h-3.5 w-3.5" />} tone="accent" value={money(w.total_cost_of_terms, fullMoney)} sub={<Delta a={w.total_cost_of_terms} b={r.total_cost_of_terms} />} />
          </div>

          {/* Cumulative gap */}
          <Card title="Funding gap over time" subtitle="Cumulative cash out minus cash in. Above zero, the contractor is funding the work.">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 22, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickFormatter={(m) => `M${m}`} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={56} />
                  <Tooltip formatter={(v: number, n: string) => [money(v, fullMoney), n]} labelFormatter={(m) => `Month ${m}`} />
                  <RLegend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="var(--line-strong)" />
                  {w.retention_cap_month ? <ReferenceLine x={w.retention_cap_month} stroke="var(--muted)" strokeDasharray="3 3" label={{ value: `retention cap M${w.retention_cap_month}`, position: "insideTopLeft", fill: "var(--muted)", fontSize: 11 }} /> : null}
                  {w.advance_repaid_month ? <ReferenceLine x={w.advance_repaid_month} stroke="var(--muted)" strokeDasharray="3 3" label={{ value: `advance repaid M${w.advance_repaid_month}`, position: "insideBottomLeft", fill: "var(--muted)", fontSize: 11 }} /> : null}
                  <ReferenceLine x={base.duration_months} stroke="var(--line-strong)" label={{ value: "completion", position: "top", fill: "var(--muted)", fontSize: 11 }} />
                  <Line type="monotone" dataKey="ref_gap" name="At reference values" stroke="var(--s3)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="gap" name="Contract as written" stroke="var(--s2)" strokeWidth={2.25} dot={false} isAnimationActive={false} />
                  <ReferenceDot x={w.peak_month} y={w.peak_funding} r={5} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2}
                    label={{ value: `peak ${money(w.peak_funding)}`, position: "top", fill: "var(--ink)", fontSize: 11, fontWeight: 600 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Monthly bars */}
            <Card title="Monthly cash in vs cash out" subtitle="Contract as written">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={w.months} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} barGap={2} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickFormatter={(m) => `M${m}`} minTickGap={12} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={52} />
                    <Tooltip cursor={{ fill: "var(--accent-soft)" }} formatter={(v: number, n: string) => [money(v, fullMoney), n]} labelFormatter={(m) => `Month ${m}`} />
                    <RLegend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="cash_in" name="Cash in" fill="var(--s1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="cash_out" name="Cash out" fill="var(--s2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* As written vs reference */}
            <Card title="As written vs at reference values" subtitle="Same project with risky terms set to the reference values from the flags.">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barGap={2}
                    data={[
                      { name: "Peak funding", w: w.peak_funding, r: r.peak_funding },
                      { name: "Overdraft interest", w: w.overdraft_interest, r: r.overdraft_interest },
                      { name: "Guarantee cost", w: w.guarantee_cost, r: r.guarantee_cost },
                      { name: "Delay damages", w: w.ld_amount, r: r.ld_amount },
                      { name: "Total cost of terms", w: w.total_cost_of_terms, r: r.total_cost_of_terms },
                    ]}>
                    <CartesianGrid horizontal={false} stroke="var(--grid)" />
                    <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={moneyAxis} />
                    <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={120} />
                    <Tooltip cursor={{ fill: "var(--accent-soft)" }} formatter={(v: number, n: string) => [money(v, fullMoney), n]} />
                    <RLegend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="w" name="As written" fill="var(--s2)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                    <Bar dataKey="r" name="At reference" fill="var(--s3)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Sensitivity */}
          {w.sensitivities.length > 0 && (
            <Card title="Sensitivity" subtitle="How each change moves the result (from the inputs above)"
              actions={<Segmented value={sensMetric} onChange={setSensMetric} options={[{ value: "total_cost_of_terms", label: "Total cost" }, { value: "peak_funding", label: "Peak funding" }]} />}>
              <div style={{ height: 40 + w.sensitivities.length * 32 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={w.sensitivities} margin={{ top: 4, right: 70, left: 8, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="var(--grid)" />
                    <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={moneyAxis} />
                    <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={170} />
                    <Tooltip cursor={{ fill: "var(--accent-soft)" }} formatter={(v: number) => [money(v, fullMoney), sensMetric === "peak_funding" ? "Peak funding" : "Total cost of terms"]} />
                    <ReferenceLine x={w[sensMetric]} stroke="var(--ink-2)" strokeDasharray="4 3" label={{ value: "current", position: "top", fill: "var(--muted)", fontSize: 11 }} />
                    <Bar dataKey={sensMetric} fill="var(--s1)" radius={[0, 3, 3, 0]} isAnimationActive={false}
                      label={{ position: "right", formatter: (v: number) => moneyAxis(v), fill: "var(--ink-2)", fontSize: 11 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Collapsible className="mt-3" summary="Show sensitivity numbers">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted"><th className="py-1 pr-3">Scenario</th><th className="py-1 pr-3 text-right">Peak funding</th><th className="py-1 pr-3 text-right">Peak month</th><th className="py-1 pr-3 text-right">Interest</th><th className="py-1 text-right">Total cost</th></tr></thead>
                  <tbody>{w.sensitivities.map((s) => (
                    <tr key={s.name} className="border-b border-line last:border-0 tnum"><td className="py-1 pr-3">{s.name}</td><td className="py-1 pr-3 text-right">{money(s.peak_funding, fullMoney)}</td><td className="py-1 pr-3 text-right">M{s.peak_month}</td><td className="py-1 pr-3 text-right">{money(s.interest_cost, fullMoney)}</td><td className="py-1 text-right">{money(s.total_cost_of_terms, fullMoney)}</td></tr>
                  ))}</tbody>
                </table>
              </Collapsible>
            </Card>
          )}

          {w.notes.length > 0 && <div className="flex flex-wrap gap-1.5">{w.notes.map((n) => <Chip key={n} size="xs">{n}</Chip>)}</div>}

          <MonthTable w={w} />
        </>
      )}
    </div>
  );
}

function MonthTable({ w }: { w: CashResult }) {
  const { fullMoney } = useApp();
  const cols: [keyof CashResult["months"][number], string][] = [
    ["gross", "Gross work"], ["retention", "Retention"], ["advance_recovery", "Adv. recovery"], ["net_certified", "Net certified"],
    ["cash_in", "Cash in"], ["cash_out", "Cash out"], ["gap", "Cum. gap"], ["retention_held", "Retention held"], ["advance_outstanding", "Advance o/s"],
  ];
  return (
    <Collapsible summary="Show numbers: month-by-month table">
      <div className="scroll-thin max-h-[420px] overflow-auto">
        <table className="w-full min-w-[900px] text-[12.5px] tnum">
          <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-right text-[11px] uppercase tracking-wide text-muted"><th className="py-1 pr-3 text-left">Month</th>{cols.map(([, l]) => <th key={l} className="py-1 pr-3">{l}</th>)}</tr></thead>
          <tbody>
            {w.months.map((m) => (
              <tr key={m.month} className={cx("border-b border-line text-right last:border-0", m.month === w.peak_month && "bg-serious-soft")}>
                <td className="py-1 pr-3 text-left">M{m.month}</td>
                {cols.map(([k]) => <td key={k} className="py-1 pr-3">{money(m[k] as number, fullMoney)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Collapsible>
  );
}

function Inner() {
  const { runId, meta } = useRun();
  const params = useAsync(() => api.params(runId), [runId]);
  const [preview, setPreview] = useState(false);
  const frozen = !!meta?.frozen;
  if (params.loading) return <Spinner label="Loading parameters…" />;
  if (params.error) {
    const nf = params.error instanceof ApiError && params.error.status === 404;
    return <ErrorBox error={params.error} title={nf ? "No cash parameters for this run yet" : "Could not load parameters"} />;
  }
  const p = params.data!;
  const confirmed = p.provenance.length > 0 && p.provenance.every((x) => x.confirmed);
  const showResults = confirmed || frozen || preview;
  return (
    <div className="flex flex-col gap-4">
      {showResults ? (
        <Collapsible summary={<span className="flex items-center gap-2">Parameters {confirmed ? <Chip tone="good" size="xs" icon={<ShieldCheck className="h-3 w-3" />}>confirmed</Chip> : frozen ? <Chip size="xs" icon={<Lock className="h-3 w-3" />}>frozen</Chip> : <Chip tone="warn" size="xs">not confirmed</Chip>}</span>}>
          <ParamsTable params={p} frozen={frozen} onSaved={(np) => params.setData(np)} />
        </Collapsible>
      ) : (
        <>
          <ParamsTable params={p} frozen={frozen} onSaved={(np) => params.setData(np)} />
          <div className="text-right"><button className="text-xs font-medium text-accent-ink hover:underline" onClick={() => setPreview(true)}>Preview charts without confirming</button></div>
        </>
      )}
      {showResults && <Results key={JSON.stringify(p.inputs)} params={p} />}
    </div>
  );
}

export default function CashFlow() {
  return (
    <>
      <PageHeader title="Cash flow" subtitle="How the payment, retention, advance, damages, escalation and guarantee terms change the contractor's cash. All arithmetic is plain code." />
      <RunGate><Inner /></RunGate>
    </>
  );
}
