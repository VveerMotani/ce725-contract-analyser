// The large graphics and key points for each of the six money terms.
// Numbers come from the answers (contract text), from cash parameters whose provenance is "extracted"/"user",
// or from the cash model. Anything else shows "—" or a "not stated" state.
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Lock } from "lucide-react";
import { api } from "../api";
import { effective, type Answer, type AnswerEnvelope, type CashInputs, type CashParams, type CashResult } from "../types";
import { money, moneyAxis, num, pct } from "../lib/format";
import { brief, firstPct, rate, usable } from "../lib/terms";
import { daysIn, milestones, pctNum, rupeesIn, seg, segments, validity, weightTables } from "../lib/termDetail";
import type { RuleCheck } from "../types";
import { Figure, InfoTip } from "../components/ui";
import { payDaysText } from "./TermCards";
import { Block, KeyPoints, NoData, Ruler, type KeyPoint, type RulerRow } from "./TermDetailParts";

export interface D {
  runId: string;
  env: (q: string) => AnswerEnvelope | null;
  ans: (q: string) => Answer | null;
  params: CashParams | undefined;
  inp: CashInputs | undefined;
  ok: (field: string) => boolean;
  value: number | null;
  cash: CashResult | undefined;
  checks: RuleCheck[] | undefined;
}

export function makeD(runId: string, answers: AnswerEnvelope[], params: CashParams | undefined, cash: CashResult | undefined, checks: RuleCheck[] | undefined): D {
  const env = (q: string) => answers.find((e) => e.answer.question_id === q) ?? null;
  const ans = (q: string) => { const e = env(q); return e ? effective(e) : null; };
  const inp = params?.inputs;
  const ok = (f: string) => !!inp && usable(params, f) !== null;
  return { runId, env, ans, params, inp, ok, value: inp && ok("contract_value") && inp.contract_value > 0 ? inp.contract_value : null, cash, checks };
}

const tip = { formatter: (v: number) => money(v), labelFormatter: (m: number) => `Month ${m}` };
const notStated = (a: Answer | null): string => !a ? "—" : a.status === "NOT_STATED" ? "Not stated" : a.status === "POINTS_ELSEWHERE" ? "In another document" : a.status === "NOT_APPLICABLE" ? "Switched off" : brief(a.answer_value, 70);
const isNo = (a: Answer | null) => !!a && (a.status === "NOT_APPLICABLE" || (a.status === "FOUND" && /^\s*no\b/i.test(a.answer_value)));

function kp(d: D, label: string, q: string, value?: string, tone?: "bad" | "good"): KeyPoint {
  return { label, env: d.env(q), value: value ?? notStated(d.ans(q)), tone };
}

function Chart({ children, h = 240 }: { children: ReactElement; h?: number }) {
  return <div style={{ height: h }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

function Figs({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">{children}</div>;
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export function PaymentPanel({ d }: { d: D }) {
  const a12 = d.ans("1.2"), a13 = d.ans("1.3"), a14 = d.ans("1.4");
  const rows: RulerRow[] = [{ label: "Bill submitted", end: 0, value: "day 0", env: d.env("1.1") }];
  const partSeg = seg(a12, /part|90 ?%|recommend/i) ?? seg(a13, /part payment|90 ?%/i);
  const part = partSeg ? daysIn(partSeg) : null;
  if (part) rows.push({ label: "Part payment", end: part.days, value: part.label, env: seg(a12, /part|90 ?%|recommend/i) ? d.env("1.2") : d.env("1.3"), note: firstPct(partSeg!) ? `${firstPct(partSeg!)} of the bill` : undefined });
  const certSeg = seg(a12, /certif|IPC|measure|check/i);
  const cert = certSeg && certSeg !== partSeg ? daysIn(certSeg) : d.ok("cert_lag_days") && d.inp!.cert_lag_days > 0 ? { days: d.inp!.cert_lag_days, label: `${d.inp!.cert_lag_days} days` } : null;
  if (cert) rows.push({ label: "Certified", end: cert.days, value: cert.label, env: d.env("1.2") });
  const full = a13?.status === "FOUND" ? payDaysText(a13) : null;
  if (full) rows.push({ label: "Paid in full", end: full, value: `${full} days`, env: d.env("1.3"), tone: "good" });
  const lateSeg = seg(a14, /\d+\s*days/i);
  const hasInterest = a14?.status === "FOUND" && !/\bno interest\b|not payable|\bnil\b/i.test(a14.answer_value);
  if (hasInterest) {
    const ls = lateSeg ? daysIn(lateSeg) : null;
    const at = ls?.days ?? full;
    if (at != null) rows.push({ label: "Late interest starts", end: at, value: ls ? ls.label : "after due date", env: d.env("1.4"), tone: "bad", note: rate(a14!.answer_value) || undefined });
  }
  const max = Math.max(30, ...rows.map((r) => r.end)) * 1.1;

  // money owed to you each month: certified (net) minus paid for work (cash in, less advance and retention released)
  const owed = useMemo(() => {
    const c = d.cash;
    if (!c) return [];
    const inst = d.ok("advance_instalments") && d.value ? d.inp!.advance_instalments : [];
    let cumNet = 0, cumPaid = 0, prevHeld = 0;
    return c.months.map((m) => {
      const adv = inst.filter((i) => i.month === m.month).reduce((x, i) => x + i.share_of_value * d.value!, 0);
      const rel = Math.max(0, prevHeld + m.retention - m.retention_held);
      prevHeld = m.retention_held;
      cumNet += m.net_certified;
      cumPaid += Math.max(0, m.cash_in - adv - rel);
      return { month: m.month, owed: Math.max(0, cumNet - cumPaid) };
    });
  }, [d]);

  const minSeg = d.ans("1.6");
  const minBill = minSeg?.status === "FOUND" ? (/^\s*no\b|no minimum/i.test(minSeg.answer_value) ? "None stated" : rupeesIn(minSeg.answer_value) != null ? money(rupeesIn(minSeg.answer_value)) : brief(minSeg.answer_value, 50)) : notStated(minSeg);
  const deductions = d.ans("1.5")?.status === "FOUND" ? segments(d.ans("1.5")!.answer_value).slice(0, 4).map((s) => brief(s, 42)) : [];
  const r15 = d.checks?.find((c) => c.flag_id === "R15");
  const final = d.ans("1.7");
  return (
    <>
      <Block title="Payment timeline">
        {rows.length > 1 ? <Ruler rows={rows} max={max} unit="days" /> : <NoData>{notStated(a13)}</NoData>}
      </Block>
      <Block title="Money owed to you" aside={<InfoTip>Certified but not yet paid, month by month, from the cash model.</InfoTip>}>
        {owed.length ? (
          <>
            <Chart h={200}>
              <AreaChart data={owed} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} minTickGap={18} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={52} />
                <Tooltip {...tip} />
                {d.cash?.receivable_max ? <ReferenceLine y={d.cash.receivable_max} stroke="var(--ink-2)" strokeDasharray="4 3" label={{ value: `max ${money(d.cash.receivable_max)}`, position: "insideTopRight", fill: "var(--ink-2)", fontSize: 11 }} /> : null}
                <Area type="stepAfter" dataKey="owed" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.15} isAnimationActive={false} />
              </AreaChart>
            </Chart>
          </>
        ) : <NoData>No cash model for this contract</NoData>}
      </Block>
      <Block title="Key points">
        <KeyPoints items={[
          kp(d, "Billing", "1.1", d.ans("1.1")?.status === "FOUND" ? (/month/i.test(d.ans("1.1")!.answer_value) ? "Monthly" : /stage|milestone/i.test(d.ans("1.1")!.answer_value) ? "By stage" : brief(d.ans("1.1")!.answer_value, 40)) : undefined),
          kp(d, "Minimum bill", "1.6", minBill),
          kp(d, "Late interest", "1.4", hasInterest ? (rate(a14!.answer_value) || "Yes") : a14?.status === "FOUND" ? "None" : undefined, hasInterest ? undefined : "bad"),
          kp(d, "Deductions from each bill", "1.5", deductions.length ? deductions.join(" · ") : undefined),
          kp(d, "Pay-when-paid or conditions", "1.8", r15 ? (r15.result === "pass" ? "None found" : r15.result === "flag" ? "Conditions found" : "Not checked") : undefined, r15?.result === "flag" ? "bad" : undefined),
          kp(d, "Final bill", "1.7", final?.status === "FOUND" ? (daysIn(final.answer_value) ? `${daysIn(final.answer_value)!.label} after completion` : brief(final.answer_value, 50)) : undefined),
        ]} />
      </Block>
    </>
  );
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export function RetentionPanel({ d }: { d: D }) {
  const c = d.cash;
  const a22 = d.ans("2.2"), a25 = d.ans("2.5");
  const rate22 = a22?.status === "FOUND" ? (d.ok("retention_rate") && d.inp!.retention_rate > 0 ? d.inp!.retention_rate : pctNum(a22.answer_value)) : null;
  const capRs = d.ok("retention_cap") && d.inp!.retention_cap != null && d.value ? d.inp!.retention_cap * d.value : null;
  const gross = c ? c.months.map((m) => m.gross).filter((g) => g > 0).sort((a, b) => a - b) : [];
  const typical = gross.length ? gross[Math.floor(gross.length / 2)] : null;
  let rel: string = "—";
  if (d.ok("retention_release") && d.inp!.retention_release.length) {
    const m = d.inp!.retention_release[d.inp!.retention_release.length - 1].months_after_completion;
    rel = m < 1 ? `${Math.round(m * 30)} days after completion` : `${+m.toFixed(1)} months after completion`;
  } else if (a25?.status === "FOUND") { const t = daysIn(a25.answer_value); rel = t ? `${t.label} after completion` : brief(a25.answer_value, 40); }
  else rel = notStated(a25);
  if (isNo(d.ans("2.1"))) return <Block title="Retention"><NoData>Nothing is held back from bills</NoData></Block>;
  return (
    <>
      <Block title="Figures">
        <Figs>
          <Figure label="Held from a typical bill" value={rate22 != null && typical ? money(rate22 * typical) : "—"} note={rate22 != null ? `${pct(rate22)} of the bill` : undefined} />
          <Figure label="Most held at once" value={c && c.retention_locked_max > 0 ? money(c.retention_locked_max) : "—"} note={capRs ? `cap ${money(capRs)}` : undefined} />
          <Figure label="Cap reached" value={c?.retention_cap_month ? `month ${c.retention_cap_month}` : "—"} note={d.inp ? `of ${d.inp.duration_months}` : undefined} />
          <Figure label="Financing cost" value={c ? money(c.retention_financing_cost) : "—"} note="interest on money held" />
        </Figs>
        <p className="mt-4 text-[13.5px] text-ink-2"><span className="text-muted">Returned: </span>{rel}</p>
      </Block>
      <Block title="Held back, month by month">
        {c ? (
          <Chart>
            <AreaChart data={c.months} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} minTickGap={18} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={52} />
              <Tooltip {...tip} />
              {capRs ? <ReferenceLine y={capRs} stroke="var(--bad)" strokeDasharray="4 3" label={{ value: "cap", position: "insideTopLeft", fill: "var(--bad)", fontSize: 11 }} /> : null}
              {d.inp ? <ReferenceLine x={d.inp.duration_months} stroke="var(--ink-2)" strokeDasharray="2 3" label={{ value: "completion", position: "top", fill: "var(--muted)", fontSize: 11 }} /> : null}
              <Area type="stepAfter" dataKey="retention_held" name="Held" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.18} isAnimationActive={false} />
            </AreaChart>
          </Chart>
        ) : <NoData>No cash model for this contract</NoData>}
      </Block>
      <Block title="Key points">
        <KeyPoints items={[
          kp(d, "Rate per bill", "2.2", rate22 != null ? `${pct(rate22)} of each bill` : undefined),
          kp(d, "Limit", "2.3"),
          kp(d, "Returned", "2.5", rel),
          kp(d, "Bank guarantee instead", "2.6", d.ans("2.6")?.status === "FOUND" ? (/^\s*no\b/i.test(d.ans("2.6")!.answer_value) ? "No" : "Yes") : undefined, d.ans("2.6")?.status === "FOUND" && !/^\s*no\b/i.test(d.ans("2.6")!.answer_value) ? "good" : undefined),
          kp(d, "Interest on money held", "2.7", d.ans("2.7")?.status === "FOUND" ? (/^\s*no\b|none|without interest/i.test(d.ans("2.7")!.answer_value) ? "None" : brief(d.ans("2.7")!.answer_value, 40)) : undefined),
          kp(d, "Bid security (EMD) link", "2.4", d.ans("2.4")?.status === "FOUND" ? (/^\s*no\b/i.test(d.ans("2.4")!.answer_value) ? "Not counted" : brief(d.ans("2.4")!.answer_value, 40)) : undefined),
        ]} />
      </Block>
    </>
  );
}

// ---------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------

export function AdvancePanel({ d }: { d: D }) {
  const c = d.cash;
  const a31 = d.ans("3.1");
  const inst = d.ok("advance_instalments") ? d.inp!.advance_instalments : [];
  const total = inst.reduce((x, i) => x + i.share_of_value, 0);
  const totalRs = total && d.value ? total * d.value : null;
  const bgPct = d.ans("3.5")?.status === "FOUND" ? pctNum(d.ans("3.5")!.answer_value) : null;
  const deadline = d.ok("advance_recovery_deadline") && d.inp!.advance_recovery_deadline != null && d.inp ? d.inp.advance_recovery_deadline * d.inp.duration_months : null;
  const keys = (
    <Block title="Key points">
      <KeyPoints items={[
        kp(d, "Interest", "3.3", d.ans("3.3")?.status === "FOUND" ? (/interest[- ]free|no interest/i.test(d.ans("3.3")!.answer_value) ? "Interest-free" : rate(d.ans("3.3")!.answer_value) || brief(d.ans("3.3")!.answer_value, 40)) : undefined),
        kp(d, "How it is taken back", "3.4", d.ans("3.4")?.status === "FOUND" ? brief(d.ans("3.4")!.answer_value, 60) : undefined),
        kp(d, "Security needed", "3.5", d.ans("3.5")?.status === "FOUND" ? brief(d.ans("3.5")!.answer_value, 50) : undefined),
        kp(d, "Machinery or materials advance", "3.6", d.ans("3.6")?.status === "FOUND" ? brief(d.ans("3.6")!.answer_value, 60) : undefined),
        kp(d, "Conditions", "3.7", d.ans("3.7")?.status === "FOUND" ? brief(d.ans("3.7")!.answer_value, 60) : undefined),
      ]} />
    </Block>
  );
  if (isNo(a31)) return <><Block title="Advance"><NoData>No mobilisation advance: the start of the work is funded by you</NoData></Block>{keys}</>;
  return (
    <>
      <Block title="Figures">
        <Figs>
          <Figure label="Advance" value={totalRs ? money(totalRs) : total ? pct(total) : "—"} note={total ? `${pct(total)} of value` : undefined} />
          <Figure label="Interest cost" value={c ? money(c.advance_interest) : "—"} note="from the cash model" />
          <Figure label="Guarantee needed" value={bgPct && totalRs ? money(bgPct * totalRs) : bgPct ? pct(bgPct) : "—"} note={bgPct ? `${pct(bgPct)} of the advance` : undefined} />
          <Figure label="Repaid by" value={c?.advance_repaid_month != null ? `month ${c.advance_repaid_month}` : "—"} note={deadline ? `deadline month ${+deadline.toFixed(1)}` : undefined} />
        </Figs>
      </Block>
      {inst.length > 0 && (
        <Block title="Instalments">
          <ul className="divide-y divide-line border-y border-line text-[14px]">
            {inst.map((i, k) => (
              <li key={k} className="grid grid-cols-3 py-2 tnum"><span>Instalment {k + 1}</span><span>{pct(i.share_of_value)}{d.value ? ` · ${money(i.share_of_value * d.value)}` : ""}</span><span className="text-right text-muted">month {i.month}</span></li>
            ))}
          </ul>
        </Block>
      )}
      <Block title="Still owed, month by month" aside={<InfoTip>Line: advance not yet taken back. Bars: amount taken back from each bill.</InfoTip>}>
        {c && total ? (
          <Chart>
            <ComposedChart data={c.months} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} minTickGap={18} />
              <YAxis yAxisId="l" tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={52} />
              <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={44} />
              <Tooltip {...tip} />
              <Bar yAxisId="r" dataKey="advance_recovery" name="Taken back" fill="var(--fair)" isAnimationActive={false} />
              <Area yAxisId="l" type="stepAfter" dataKey="advance_outstanding" name="Still owed" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.15} isAnimationActive={false} />
              {c.advance_repaid_month != null && <ReferenceLine yAxisId="l" x={c.advance_repaid_month} stroke="var(--good)" label={{ value: "repaid", position: "top", fill: "var(--good)", fontSize: 11 }} />}
              {deadline != null && <ReferenceLine yAxisId="l" x={Math.round(deadline)} stroke="var(--bad)" strokeDasharray="4 3" label={{ value: "deadline", position: "insideTopRight", fill: "var(--bad)", fontSize: 11 }} />}
            </ComposedChart>
          </Chart>
        ) : <NoData>Advance amounts are not in the cash model</NoData>}
      </Block>
      {keys}
    </>
  );
}

// ---------------------------------------------------------------------------
// Delay penalty
// ---------------------------------------------------------------------------

export function DelayPanel({ d }: { d: D }) {
  const a41 = d.ans("4.1"), a42 = d.ans("4.2");
  const r = a42?.status === "FOUND" && d.ok("ld_rate_per_day") && d.inp!.ld_rate_per_day > 0 ? d.inp!.ld_rate_per_day : null;
  const cap = d.ok("ld_cap") ? d.inp!.ld_cap : undefined;
  const grace = d.ok("ld_grace_days") ? d.inp!.ld_grace_days : 0;
  const V = d.value;
  const capDays = r && cap != null ? d.cash?.ld_days_to_cap ?? grace + cap / r : null;
  const X = capDays ? Math.max(capDays * 1.3, 90) : 365;
  const [delay, setDelay] = useState(() => Math.min(Math.round(X), Math.max(30, d.inp?.delay_days || 60)));
  const pen = (t: number) => (r && V ? Math.min(cap != null ? cap * V : Infinity, r * V * Math.max(0, t - grace)) : 0);
  const data = useMemo(() => Array.from({ length: 61 }, (_, i) => { const t = Math.round((X * i) / 60); return { day: t, rs: pen(t) }; }), [X, r, V, cap, grace]); // eslint-disable-line react-hooks/exhaustive-deps
  const ms = milestones(d.ans("4.4")?.status === "FOUND" ? d.ans("4.4")!.answer_value : "");
  const ms2 = ms.length ? ms : milestones(d.ans("0.6")?.status === "FOUND" ? d.ans("0.6")!.answer_value : "");
  const keys = (
    <Block title="Key points">
      <KeyPoints items={[
        kp(d, "Milestones", "4.4", d.ans("4.4")?.status === "FOUND" ? brief(d.ans("4.4")!.answer_value, 60) : undefined),
        kp(d, "Extension of time", "4.5", d.ans("4.5")?.status === "FOUND" ? (daysIn(d.ans("4.5")!.answer_value) ? `Notice within ${daysIn(d.ans("4.5")!.answer_value)!.label}` : "Available") : undefined),
        kp(d, "Proof of loss", "4.6", d.ans("4.6")?.status === "FOUND" ? brief(d.ans("4.6")!.answer_value, 50) : undefined),
        kp(d, "Taken from", "4.7", d.ans("4.7")?.status === "FOUND" ? brief(d.ans("4.7")!.answer_value, 50) : undefined),
        kp(d, "Other penalties and bonus", "4.8", d.ans("4.8")?.status === "FOUND" ? `${segments(d.ans("4.8")!.answer_value).length} items` : undefined),
      ]} />
    </Block>
  );
  if (isNo(a41)) return <><Block title="Delay penalty"><NoData>No penalty for finishing late</NoData></Block>{keys}</>;
  return (
    <>
      <Block title="Figures">
        <Figs>
          <Figure label="Per day late" value={r && V ? money(r * V) : r ? pct(r) : "—"} note={r ? `${pct(r)} of value` : notStated(a42)} />
          <Figure label="Per week late" value={r && V ? money(r * V * 7) : "—"} />
          <Figure label="Limit" value={cap != null && V ? money(cap * V) : cap === null ? "No limit" : "—"} note={cap != null ? `${pct(cap)} of value` : undefined} />
          <Figure label="Limit reached" value={capDays ? `day ${num(capDays)}` : "—"} note={grace ? `after ${grace} grace days` : undefined} />
        </Figs>
      </Block>
      <Block title="Penalty by days late">
        {r && V ? (
          <>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <span className="font-serif text-[26px] font-semibold text-ink tnum">{money(pen(delay))}</span>
              <span className="text-[13.5px] text-muted">at {delay} days late</span>
            </div>
            <Chart h={220}>
              <LineChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="day" type="number" domain={[0, Math.round(X)]} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={52} />
                <Tooltip formatter={(v: number) => money(v)} labelFormatter={(t) => `${t} days late`} />
                {capDays ? <ReferenceLine x={Math.round(capDays)} stroke="var(--ink-2)" strokeDasharray="3 3" label={{ value: "limit", position: "top", fill: "var(--muted)", fontSize: 11 }} /> : null}
                <Line type="linear" dataKey="rs" stroke="var(--bad)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <ReferenceDot x={delay} y={pen(delay)} r={5} fill="var(--bad)" stroke="var(--surface)" strokeWidth={2} />
              </LineChart>
            </Chart>
            <label className="mt-3 block max-w-[520px]">
              <span className="text-[13.5px] text-ink">Days late: <span className="tnum">{delay}</span></span>
              <input type="range" min={0} max={Math.round(X)} step={1} value={delay} onChange={(e) => setDelay(+e.target.value)} className="mt-1 w-full" aria-label="Days late" />
            </label>
          </>
        ) : <NoData>{a42?.status === "FOUND" ? "Rate or contract value not in the cash figures" : notStated(a42)}</NoData>}
      </Block>
      {ms2.length > 0 && (
        <Block title="Milestones">
          <ul className="divide-y divide-line border-y border-line text-[14px]">
            {ms2.map((m) => <li key={m.name + m.day} className="grid grid-cols-3 py-2 tnum"><span>{m.name}</span><span>day {m.day}</span><span className="text-right text-muted">{m.share ?? ""}</span></li>)}
          </ul>
        </Block>
      )}
      {keys}
    </>
  );
}

// ---------------------------------------------------------------------------
// Price adjustment
// ---------------------------------------------------------------------------

const W_COLORS: Record<string, string> = {
  Labour: "#1f4f8f", Cement: "#8f8c84", Steel: "#5b7896", Bitumen: "#3b3a36", Fuel: "#c58a12", Materials: "#9fbad8", Plant: "#b9a27a",
};

function useDebounced<T>(v: T, ms: number): T {
  const [x, setX] = useState(v);
  useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return x;
}

export function priceApplies(d: D): boolean | null {
  const a = d.ans("5.1");
  if (!a || a.status === "NOT_STATED" || a.status === "POINTS_ELSEWHERE") return null;
  if (a.status === "NOT_APPLICABLE") return false;
  const r11 = d.checks?.find((c) => c.flag_id === "R11");
  if (r11 && /'off'/.test(r11.reason)) return false;
  if (r11 && /'on'|applies/.test(r11.reason)) return true;
  if (d.ok("pv_applies")) return d.inp!.pv_applies;
  const v = a.answer_value;
  const textApplies = /\b(10CC|10CA|PVC|price variation|price adjustment|escalation)\s+(clause\s+)?(is\s+)?(selected|applicable|applies)\b/i.test(v);
  return textApplies || !/fixed price|no (general )?(index|price|escalation)|not applicable|does not apply/i.test(v);
}

export function PricePanel({ d }: { d: D }) {
  const applies = priceApplies(d);
  const tables = d.ans("5.3")?.status === "FOUND" ? weightTables(d.ans("5.3")!.answer_value) : [];
  const formula = d.ans("5.2");
  const [rise, setRise] = useState(5);
  const dr = useDebounced(rise, 350);
  const [res, setRes] = useState<CashResult>();
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    const x = dr / 100;
    api.cashflow(d.runId, { index_rise_pa: { labour: x, cement: x, steel: x, fuel: x, bitumen: x, materials: x } }).then((r) => { if (my === seq.current) setRes(r.as_written); }, () => { if (my === seq.current) setRes(undefined); });
  }, [dr, d.runId]);
  const costRise = res ? (res.escalation_is_recovery ? (res.escalation_net_burden ?? 0) + res.escalation_amount : res.escalation_amount) : null;
  const recovered = res ? (res.escalation_is_recovery ? res.escalation_amount : 0) : null;
  const scale = Math.max(1, costRise ?? 0, recovered ?? 0);
  const keys = (
    <Block title="Key points">
      <KeyPoints items={[
        kp(d, "Fixed or adjusted", "5.1", applies == null ? undefined : applies ? "Adjusted with indices" : "Fixed price", applies === false ? "bad" : undefined),
        kp(d, "Indices", "5.4", d.ans("5.4")?.status === "FOUND" ? `${segments(d.ans("5.4")!.answer_value).length} indices` : undefined),
        kp(d, "Base date", "5.5", d.ans("5.5")?.status === "FOUND" ? brief(d.ans("5.5")!.answer_value, 50) : undefined),
        kp(d, "Threshold or limit", "5.6", d.ans("5.6") && d.ans("5.6")!.status !== "POINTS_ELSEWHERE" ? brief(d.ans("5.6")!.answer_value, 60) || notStated(d.ans("5.6")) : undefined),
        kp(d, "After the due date", "5.7", d.ans("5.7")?.status === "FOUND" ? brief(d.ans("5.7")!.answer_value, 60) : undefined),
        kp(d, "Employer-supplied materials", "5.8", d.ans("5.8")?.status === "FOUND" ? brief(d.ans("5.8")!.answer_value, 50) : undefined),
      ]} />
    </Block>
  );
  return (
    <>
      {applies === false && (
        <Block title="Fixed price">
          <div className="flex items-start gap-3 rounded-md border border-line-strong px-4 py-4 text-[14px] text-ink-2">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
            <div>
              <div className="text-ink">No adjustment for rising costs</div>
              {d.ans("5.1")?.answer_value && <div className="mt-1 text-[13.5px]">{brief(d.ans("5.1")!.answer_value, 140)}</div>}
            </div>
          </div>
        </Block>
      )}
      {tables.length > 0 && (
        <Block title="Index weights" aside={<InfoTip>Share of each cost in the price adjustment formula, by type of work.</InfoTip>}>
          <ul className="flex flex-col gap-3">
            {tables.map((t) => {
              const tot = t.w.reduce((x, [, v]) => x + v, 0) || 1;
              return (
                <li key={t.name}>
                  <div className="mb-1 text-[13px] text-ink-2">{t.name}</div>
                  <div className="flex h-5 w-full overflow-hidden rounded-sm" role="img" aria-label={`${t.name}: ${t.w.map(([k, v]) => `${k} ${v}%`).join(", ")}`}>
                    {t.w.map(([k, v]) => (
                      <span key={k} title={`${k} ${v}%`} className="flex items-center justify-center overflow-hidden text-[10.5px] text-white" style={{ width: `${(v / tot) * 100}%`, background: W_COLORS[k] ?? "var(--fair)" }}>
                        {v >= 8 ? v : ""}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-muted">
            {Object.entries(W_COLORS).filter(([k]) => tables.some((t) => t.w.some(([n]) => n === k))).map(([k, c]) => (
              <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{k}</span>
            ))}
          </div>
        </Block>
      )}
      {formula?.status === "FOUND" && (
        <Block title="Formula">
          <pre className="scroll-thin overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink">
            {segments(formula.answer_value).join("\n")}
          </pre>
        </Block>
      )}
      <Block title="If prices rise" aside={<InfoTip>Your scenario: every index rises by this much a year. The cash model compares your cost rise with what the price adjustment pays back.</InfoTip>}>
        <label className="block max-w-[520px]">
          <span className="text-[13.5px] text-ink">Rise: <span className="tnum">{rise}%</span> a year</span>
          <input type="range" min={0} max={15} step={0.5} value={rise} onChange={(e) => setRise(+e.target.value)} className="mt-1 w-full" aria-label="Price rise a year" />
        </label>
        {res ? (
          <div className="mt-3 flex flex-col gap-2 text-[13.5px]">
            {[["Your cost rise", costRise ?? 0, "var(--bad)"], ["Paid back to you", recovered ?? 0, "var(--good)"]].map(([l, v, col]) => (
              <div key={l as string} className="grid grid-cols-[120px_1fr_100px] items-center gap-3">
                <span className="text-ink-2">{l}</span>
                <span className="h-3 rounded-sm bg-surface-2"><span className="block h-3 rounded-sm" style={{ width: `${((v as number) / scale) * 100}%`, background: col as string }} /></span>
                <span className="text-right text-ink tnum">{money(v as number)}</span>
              </div>
            ))}
            {applies && recovered === 0 && <span className="text-[12.5px] text-muted">Weights are not in the cash figures, so nothing is paid back in the model.</span>}
          </div>
        ) : <NoData>No cash model for this contract</NoData>}
      </Block>
      {keys}
    </>
  );
}

// ---------------------------------------------------------------------------
// Guarantees
// ---------------------------------------------------------------------------

export function GuaranteePanel({ d }: { d: D }) {
  const c = d.cash;
  const V = d.value;
  const a61 = d.ans("6.1"), a62 = d.ans("6.2"), a65 = d.ans("6.5"), a68 = d.ans("6.8");
  const emdSeg = seg(a61, /EMD|earnest|bid security/i) ?? seg(a62, /EMD|earnest|bid security/i);
  const emd = emdSeg ? rupeesIn(emdSeg) : null;
  const ps = a62?.status === "FOUND" ? (d.ok("perf_security_pct") && d.inp!.perf_security_pct > 0 ? d.inp!.perf_security_pct : pctNum(a62.answer_value, /performance (security|guarantee)/)) : null;
  const extraM = a68?.status === "FOUND" && !/^\s*no\b/i.test(a68.answer_value) ? a68.answer_value.match(/(?:max(?:imum)?|up to|capped at|cap(?:ped)?)\s*(\d+(?:\.\d+)?)\s?%/i) : null;
  const extra = extraM ? +extraM[1] / 100 : null;
  const rc = d.ok("retention_cap") && d.inp!.retention_cap ? d.inp!.retention_cap : null;
  const advTot = d.ok("advance_instalments") ? d.inp!.advance_instalments.reduce((x, i) => x + i.share_of_value, 0) : 0;
  const advBg = advTot && d.ans("3.5")?.status === "FOUND" ? pctNum(d.ans("3.5")!.answer_value) : null;
  const parts: [string, number | null, string, string][] = [
    ["Bid security (EMD)", emd, "#3b3a36", "before award"],
    ["Performance", ps && V ? ps * V : null, "var(--accent)", ps ? pct(ps) : ""],
    ["Extra, low bid (up to)", extra && V ? extra * V : null, "#7fa0c8", extra ? pct(extra) : ""],
    ["Retention (cap)", rc && V ? rc * V : null, "var(--fair)", rc ? pct(rc) : ""],
    ["Advance guarantee", advBg && advTot && V ? advBg * advTot * V : null, "#b9a27a", advBg ? `${pct(advBg)} of advance` : ""],
  ];
  const shown = parts.filter(([, v]) => v != null && v > 0) as [string, number, string, string][];
  const total = shown.reduce((x, [, v]) => x + v, 0);

  const T = d.inp?.duration_months ?? null;
  let dlp = d.ok("dlp_months") ? d.inp!.dlp_months : null;
  if (dlp == null && d.ans("0.5")?.status === "FOUND") { const t = daysIn(d.ans("0.5")!.answer_value); dlp = t ? t.days / 30 : null; }
  const rows: RulerRow[] = [];
  if (T) {
    const pv = validity(seg(a65, /performance|\bPG\b/i) ?? "");
    if (pv) rows.push({ label: "Performance", start: 0, end: (pv.anchor === "dlp" ? T + (dlp ?? 0) : T) + pv.offsetMonths, value: pv.label, env: d.env("6.5"), note: pv.anchor === "dlp" && dlp == null ? "defects period unknown" : undefined });
    const av = validity(seg(a65, /additional/i) ?? "");
    if (av) rows.push({ label: "Extra, low bid", start: 0, end: (av.anchor === "dlp" ? T + (dlp ?? 0) : T) + av.offsetMonths, value: av.label, env: d.env("6.5"), tone: "muted" });
    if (advTot && c?.advance_repaid_month != null) rows.push({ label: "Advance guarantee", start: 0, end: c.advance_repaid_month, value: `to month ${c.advance_repaid_month}`, tone: "muted" });
    if (rc && d.ok("retention_release") && d.inp!.retention_release.length) {
      const m = d.inp!.retention_release[d.inp!.retention_release.length - 1].months_after_completion;
      rows.push({ label: "Retention", start: 0, end: T + m, value: `to month ${+(T + m).toFixed(1)}`, tone: "muted", env: d.env("2.5") });
    }
  }
  const max = Math.max(T ?? 1, ...rows.map((r) => r.end), T && dlp ? T + dlp : 0) * 1.05;
  const marks = T ? [{ at: T, label: "completion" }, ...(dlp ? [{ at: T + dlp, label: "defects end" }] : [])] : [];
  return (
    <>
      <Block title="Securities in rupees">
        {shown.length && V ? (
          <>
            <div className="font-serif text-[26px] font-semibold text-ink tnum">{money(total)} <span className="font-sans text-[13.5px] font-normal text-muted">all securities added up</span></div>
            <div className="mt-3 flex h-5 w-full overflow-hidden rounded-sm" role="img" aria-label={shown.map(([k, v]) => `${k} ${money(v)}`).join(", ")}>
              {shown.map(([k, v, col]) => <span key={k} title={`${k} ${money(v)}`} style={{ width: `${(v / total) * 100}%`, background: col }} />)}
            </div>
            <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[13.5px] sm:grid-cols-2">
              {shown.map(([k, v, col, n]) => (
                <li key={k} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: col }} /><span className="flex-1 text-ink-2">{k}{n ? <span className="text-muted"> · {n}</span> : null}</span><span className="text-ink tnum">{money(v)}</span></li>
              ))}
            </ul>
          </>
        ) : <NoData>{V ? notStated(a62) : "Contract value not set"}</NoData>}
      </Block>
      <Block title="How long each stays valid" aside={<InfoTip>Months from signing. Bars end where the contract says each guarantee may be released.</InfoTip>}>
        {rows.length ? <Ruler rows={rows} max={max} marks={marks} unit="months" /> : <NoData>{a65?.status === "FOUND" ? "Validity not readable as dates" : notStated(a65)}</NoData>}
      </Block>
      <Block title="Figures">
        <Figs>
          <Figure label="Bank commission" value={c ? money(c.guarantee_cost) : "—"} note={d.inp ? `at ${pct(d.inp.bg_commission_pa)} a year${usable(d.params, "bg_commission_pa") ? "" : " (assumed)"}` : undefined} />
          <Figure label="Performance" value={ps ? pct(ps) : "—"} note={ps && V ? money(ps * V) : undefined} />
        </Figs>
      </Block>
      <Block title="Key points">
        <KeyPoints items={[
          kp(d, "Accepted forms", "6.3", d.ans("6.3")?.status === "FOUND" ? brief(d.ans("6.3")!.answer_value, 60) : undefined),
          kp(d, "Accepted banks", "6.4", d.ans("6.4")?.status === "FOUND" ? brief(d.ans("6.4")!.answer_value, 50) : undefined),
          kp(d, "When it can be cashed", "6.6", d.ans("6.6")?.status === "FOUND" ? brief(d.ans("6.6")!.answer_value, 60) : undefined),
          kp(d, "When it is returned", "6.7", d.ans("6.7")?.status === "FOUND" ? brief(d.ans("6.7")!.answer_value, 60) : undefined),
          kp(d, "Low-bid rule", "6.8", a68?.status === "FOUND" ? (/^\s*no\b/i.test(a68.answer_value) ? "None" : brief(a68.answer_value, 60)) : undefined, a68?.status === "FOUND" && !/^\s*no\b/i.test(a68.answer_value) ? "bad" : undefined),
        ]} />
      </Block>
    </>
  );
}

