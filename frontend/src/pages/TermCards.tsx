// The six money terms as factsheet cards: label, one big number, a small inline-SVG graphic, a status dot, a page link.
// Graphics use cash parameters only when their provenance is "extracted" or "user", plus the cash model result.
// Anything else shows a quiet "—" state; nothing is invented.
import { createContext, useContext, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { useRun } from "../context";
import { effective, type Answer, type AnswerEnvelope, type CashParams, type CashResult, type ClauseId } from "../types";
import { money, pct } from "../lib/format";
import { TERM_SHORT } from "../lib/plain";
import { cardTone, type Scorecard } from "../lib/scorecard";
import { TERM_SLUG } from "../lib/termDetail";
import { brief, days, elsewhereTarget, firstPct, rate, usable, type Tone } from "../lib/terms";
import { StatusDot, cx } from "../components/ui";

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

export function Chip({ children, tone }: { children: ReactNode; tone?: "bad" | "good" }) {
  return (
    <span className={cx("inline-flex max-w-full items-center truncate rounded border px-1.5 py-px text-[12px]",
      tone === "bad" ? "border-bad/40 text-bad" : tone === "good" ? "border-good/40 text-good" : "border-line-strong text-ink-2")}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center text-[13px] text-muted">{children}</div>;
}

const VariantCtx = createContext<"card" | "header">("card");

function Card({ clause, label, tone, big, unit, visual, chips, env }: {
  clause: ClauseId; label: string; tone: Tone; big: ReactNode; unit?: ReactNode; visual: ReactNode; chips?: ReactNode; env: AnswerEnvelope | null;
}) {
  const { openAnswer, runId } = useRun();
  const nav = useNavigate();
  const variant = useContext(VariantCtx);
  const a = env ? effective(env) : null;
  const href = `/runs/${runId}/terms/${TERM_SLUG[clause as Exclude<ClauseId, "C0">]}`;
  if (variant === "header") {
    return (
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[40px] font-semibold leading-none text-ink tnum sm:text-[48px]">{big}</span>
          {unit && <span className="text-[14px] text-muted">{unit}</span>}
        </div>
        {chips && <div className="mt-3 flex flex-wrap gap-1.5">{chips}</div>}
      </div>
    );
  }
  return (
    <li role="link" tabIndex={0} aria-label={`${label}: details`} onClick={() => nav(href)}
      onKeyDown={(e) => { if (e.key === "Enter") nav(href); }}
      className="group flex min-w-0 cursor-pointer flex-col rounded-lg border border-line bg-surface p-4 transition hover:border-accent focus:outline-none focus-visible:border-accent">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted group-hover:text-accent-ink">{label} <span aria-hidden className="opacity-0 transition group-hover:opacity-100">→</span></span>
        <StatusDot tone={tone} />
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="font-serif text-[27px] font-semibold leading-none text-ink tnum">{big}</span>
        {unit && <span className="text-[13px] text-muted">{unit}</span>}
      </div>
      <div className="mt-3 h-[68px]">{visual}</div>
      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
        <span className="flex min-w-0 flex-wrap gap-1">{chips}</span>
        {env && a && a.pdf_page > 0 && (
          <button className="shrink-0 text-[12.5px] text-accent-ink hover:underline" onClick={(e) => { e.stopPropagation(); openAnswer(env, label); }}>p. {a.pdf_page}</button>
        )}
      </div>
    </li>
  );
}

const T = { fontSize: 9, fill: "var(--muted)" } as const;
const W = 240;

function Svg({ children, h = 64, label }: { children: ReactNode; h?: number; label: string }) {
  return <svg viewBox={`0 0 ${W} ${h}`} className="h-full w-full" role="img" aria-label={label}>{children}</svg>;
}

// ---------------------------------------------------------------------------
// Graphics
// ---------------------------------------------------------------------------

function PayTimeline({ cert, pay }: { cert: number | null; pay: number }) {
  const max = Math.max(pay, cert ?? 0, 1) * 1.12;
  const x = (d: number) => 10 + (d / max) * (W - 24);
  return (
    <Svg label={`Bill, certified after ${cert ?? "?"} days, paid after ${pay} days`}>
      <line x1={x(0)} x2={x(max)} y1={32} y2={32} stroke="var(--line-strong)" strokeWidth={2} />
      <line x1={x(0)} x2={x(pay)} y1={32} y2={32} stroke="var(--accent)" strokeWidth={2} />
      <circle cx={x(0)} cy={32} r={4} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={1.5} />
      <text x={x(0)} y={18} {...T} textAnchor="start">bill</text>
      <text x={x(0)} y={52} {...T} textAnchor="start">day 0</text>
      {cert != null && cert > 0 && cert < pay && (
        <>
          <line x1={x(cert)} x2={x(cert)} y1={26} y2={38} stroke="var(--ink-2)" strokeWidth={1.5} />
          <text x={x(cert)} y={18} {...T} textAnchor="middle">certified</text>
          <text x={x(cert)} y={52} {...T} textAnchor="middle">{cert} d</text>
        </>
      )}
      <circle cx={x(pay)} cy={32} r={5} fill="var(--accent)" />
      <text x={x(pay)} y={18} {...T} textAnchor="middle" fill="var(--ink)">paid</text>
      <text x={x(pay)} y={52} {...T} textAnchor="middle" fill="var(--ink)">{pay} d</text>
    </Svg>
  );
}

function RetentionBar({ months, capMonth, releaseAfter }: { months: number; capMonth: number | null; releaseAfter: number | null }) {
  const end = months + Math.max(releaseAfter ?? 0, months * 0.08);
  const x = (m: number) => 6 + (m / (end * 1.04)) * (W - 12);
  const fillTo = capMonth && capMonth < months ? capMonth : months;
  return (
    <Svg label="Money held back over the contract">
      <rect x={x(0)} y={22} width={x(end) - x(0)} height={12} fill="var(--surface-2)" />
      <rect x={x(0)} y={22} width={x(fillTo) - x(0)} height={12} fill="var(--accent)" />
      <rect x={x(fillTo)} y={22} width={x(releaseAfter != null ? months + releaseAfter : months) - x(fillTo)} height={12} fill="var(--accent)" opacity={0.35} />
      <text x={x(0)} y={15} {...T}>filling</text>
      {capMonth && capMonth < months ? <text x={x(capMonth)} y={15} {...T} textAnchor="middle">cap · month {capMonth}</text> : null}
      <line x1={x(months)} x2={x(months)} y1={18} y2={38} stroke="var(--ink-2)" strokeDasharray="2 2" />
      <text x={x(months)} y={50} {...T} textAnchor="end">done</text>
      {releaseAfter != null && (
        <>
          <line x1={x(months + releaseAfter)} x2={x(months + releaseAfter)} y1={18} y2={38} stroke="var(--good)" strokeWidth={2} />
          <text x={Math.min(x(months + releaseAfter), W - 4)} y={62} {...T} textAnchor="end" fill="var(--good)">
            returned {releaseAfter < 1 ? `+${Math.round(releaseAfter * 30)} d` : `+${+releaseAfter.toFixed(1)} mo`}
          </text>
        </>
      )}
    </Svg>
  );
}

function AdvanceArea({ outstanding, months, inMonths, repaid }: { outstanding: number[]; months: number[]; inMonths: number[]; repaid: number | null }) {
  const n = outstanding.length;
  const max = Math.max(1, ...outstanding);
  const x = (i: number) => 6 + (i / Math.max(1, n - 1)) * (W - 12);
  const y = (v: number) => 50 - (v / max) * 38;
  const line = outstanding.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const ri = repaid != null ? months.indexOf(repaid) : -1;
  return (
    <Svg label="Advance still owed, month by month">
      <polygon points={`${x(0)},${y(0)} ${line} ${x(n - 1)},${y(0)}`} fill="var(--accent)" opacity={0.18} />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={2} />
      <line x1={x(0)} x2={x(n - 1)} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
      {inMonths.map((m) => { const i = months.indexOf(m); return i >= 0 ? <circle key={m} cx={x(i)} cy={y(outstanding[i])} r={3} fill="var(--accent)" /> : null; })}
      <text x={x(0)} y={9} {...T}>owed</text>
      {ri >= 0 && (
        <>
          <circle cx={x(ri)} cy={y(0)} r={3.5} fill="var(--good)" />
          <text x={Math.min(Math.max(x(ri), 50), W - 4)} y={62} {...T} textAnchor={x(ri) > W - 60 ? "end" : "middle"} fill="var(--ink)">repaid · month {repaid}</text>
        </>
      )}
    </Svg>
  );
}

function PenaltyLine({ ratePerDay, cap, grace, capDays }: { ratePerDay: number; cap: number | null; grace: number; capDays: number | null }) {
  const cd = cap != null ? capDays ?? grace + cap / ratePerDay : null;
  const X = cd != null ? Math.max(cd * 1.3, 60) : 365;
  const Y = (cap ?? ratePerDay * (X - grace)) * 1.25;
  const x = (d: number) => 8 + (d / X) * (W - 16);
  const y = (v: number) => 50 - (v / Y) * 42;
  const pts = cd != null ? [[0, 0], [grace, 0], [cd, cap!], [X, cap!]] : [[0, 0], [grace, 0], [X, ratePerDay * (X - grace)]];
  return (
    <Svg label="Delay penalty against days late">
      <line x1={x(0)} x2={x(X)} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
      <polyline points={pts.map(([a, b]) => `${x(a)},${y(b)}`).join(" ")} fill="none" stroke="var(--bad)" strokeWidth={2} />
      {cd != null && (
        <>
          <circle cx={x(cd)} cy={y(cap!)} r={3.5} fill="var(--bad)" />
          <text x={x(cd) > W * 0.55 ? x(cd) : x(cd) + 4} y={y(cap!) - 6} {...T} textAnchor={x(cd) > W * 0.55 ? "end" : "start"} fill="var(--ink)">cap {pct(cap!)} · day {Math.round(cd)}</text>
        </>
      )}
      {cd == null && <text x={W - 6} y={12} {...T} textAnchor="end" fill="var(--bad)">no cap</text>}
      <text x={x(0)} y={62} {...T}>0</text>
      <text x={x(X)} y={62} {...T} textAnchor="end">{Math.round(X)} days late</text>
    </Svg>
  );
}

const W_COLORS: Record<string, string> = {
  Labour: "#1f4f8f", Cement: "#8f8c84", Steel: "#5b7896", Bitumen: "#3b3a36", Fuel: "#c58a12", Materials: "#9fbad8", Plant: "#b9a27a",
};

function WeightBar({ w, caption }: { w: [string, number][]; caption: string }) {
  const tot = w.reduce((a, [, v]) => a + v, 0) || 1;
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <div className="flex h-3.5 w-full overflow-hidden rounded-sm" role="img" aria-label={`Index weights: ${w.map(([k, v]) => `${k} ${v}%`).join(", ")}`}>
        {w.map(([k, v]) => <span key={k} title={`${k} ${v}%`} style={{ width: `${(v / tot) * 100}%`, background: W_COLORS[k] ?? "var(--fair)" }} />)}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0 text-[10.5px] leading-tight text-muted">
        {w.map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: W_COLORS[k] ?? "var(--fair)" }} />{k} {v}</span>)}
      </div>
      <div className="text-[10.5px] text-muted">{caption}</div>
    </div>
  );
}

function SecurityBar({ parts, scale }: { parts: [string, number, string][]; scale: number }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <div className="flex h-3.5 w-full overflow-hidden rounded-sm bg-surface-2" role="img" aria-label={parts.map(([k, v]) => `${k} ${pct(v)}`).join(", ")}>
        {parts.map(([k, v, c]) => <span key={k} title={`${k} ${pct(v)}`} style={{ width: `${(v / scale) * 100}%`, background: c }} />)}
      </div>
      <div className="flex flex-wrap gap-x-2.5 text-[10.5px] leading-tight text-muted">
        {parts.map(([k, v, c]) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: c }} />{k} {pct(v)}</span>)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parsing helpers (answer text, never invented)
// ---------------------------------------------------------------------------

const CODE: Record<string, string> = { L: "Labour", C: "Cement", S: "Steel", B: "Bitumen", F: "Fuel", M: "Materials", A: "Plant", P: "Plant" };

/** Index weights for the first work type: "L20 C5 S0 B0 F10 M50 A15" or "Labour 20…; cement 5…". */
export function parseWeights(text: string): { w: [string, number][]; caption: string } | null {
  if (!text) return null;
  const code = text.match(/(?:([A-Za-z/ ]{3,40}):\s*)?((?:\b[LCSBFMAP]\d+(?:\.\d+)?\s*){3,})/);
  if (code) {
    const w = [...code[2].matchAll(/\b([LCSBFMAP])(\d+(?:\.\d+)?)/g)].map(([, k, v]) => [CODE[k], +v] as [string, number]).filter(([, v]) => v > 0);
    if (w.length >= 2) return { w, caption: code[1] ? `${brief(code[1].trim(), 30)} weights` : "Index weights" };
  }
  const named = [...text.matchAll(/\b(labour|cement|steel|bitumen|fuel|other materials|materials|plant)\b\s*:?\s*(nil|\d+(?:\.\d+)?)/gi)];
  if (named.length >= 2) {
    const map = new Map<string, number>();
    named.forEach(([, k, v]) => {
      const key = /material/i.test(k) ? "Materials" : k[0].toUpperCase() + k.slice(1).toLowerCase();
      if (!map.has(key)) map.set(key, v.toLowerCase() === "nil" ? 0 : +v);
    });
    const w = [...map.entries()].filter(([, v]) => v > 0);
    if (w.length >= 2) return { w, caption: /\//.test(text) ? "Index weights, first work type" : "Index weights" };
  }
  return null;
}

/** Days to pay a bill from the answer: prefer the full payment over a part payment. */
export function payDaysText(a: Answer): number | null {
  const segs = a.answer_value.split(/;\s*/);
  const main = segs.find((g) => days(g) && !/\bpart\b|final|maintenance|quarter/i.test(g)) ?? segs.find((g) => days(g));
  const d = main ? days(main) : "";
  return d ? parseInt(d) : null;
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export function TermCards({ answers, params, cash, sc, only, variant = "card" }: {
  answers: AnswerEnvelope[]; params: CashParams | undefined; cash: CashResult | undefined; sc: Scorecard; only?: ClauseId; variant?: "card" | "header";
}) {
  const env = (q: string) => answers.find((e) => e.answer.question_id === q) ?? null;
  const ans = (q: string) => { const e = env(q); return e ? effective(e) : null; };
  const inp = params?.inputs;
  const ok = (f: string) => !!inp && usable(params, f) !== null;
  const value = inp && ok("contract_value") ? inp.contract_value : null;
  const tone = (c: ClauseId, q: string) => cardTone(c, sc, ans(q));
  const pick = (...qs: string[]) => { for (const q of qs) { const a = ans(q); if (a && a.status === "FOUND" && a.pdf_page > 0) return env(q); } for (const q of qs) { const a = ans(q); if (a && a.pdf_page > 0) return env(q); } return env(qs[0]); };
  const notHere = (a: Answer | null): ReactNode => {
    if (!a || a.status === "NOT_STATED") return <Empty>Not stated</Empty>;
    if (a.status === "POINTS_ELSEWHERE") return <Empty>In {elsewhereTarget(a) || "another document"}</Empty>;
    return <Empty>Switched off</Empty>;
  };
  const cards: ReactNode[] = [];

  // Payment ----------------------------------------------------------------
  {
    const a = ans("1.3"), li = ans("1.4");
    const d = a?.status === "FOUND" ? (ok("pay_lag_days") && inp!.pay_lag_days > 0 ? Math.round(inp!.pay_lag_days) : payDaysText(a)) : null;
    const cert = ok("cert_lag_days") && inp!.cert_lag_days > 0 ? Math.round(inp!.cert_lag_days) : null;
    let chip: ReactNode = null;
    if (li?.status === "FOUND") {
      if (/\bno interest\b|not payable|\bnil\b/i.test(li.answer_value)) chip = <Chip tone="bad">No late interest</Chip>;
      else { const r = rate(li.answer_value); chip = <Chip>Late interest {r ? r.replace(/ a year$/, "") : "yes"}</Chip>; }
    } else if (li?.status === "NOT_STATED") chip = <Chip tone="bad">Late interest not stated</Chip>;
    else if (li?.status === "POINTS_ELSEWHERE") chip = <Chip>Late interest elsewhere</Chip>;
    cards.push(
      <Card key="C1" clause="C1" label={TERM_SHORT.C1} tone={tone("C1", "1.3")} env={pick("1.3", "1.4")}
        big={d ?? "—"} unit={d ? "days to pay" : undefined}
        visual={d ? <PayTimeline cert={cert} pay={d} /> : notHere(a)} chips={chip} />,
    );
  }

  // Retention --------------------------------------------------------------
  {
    const a1 = ans("2.1"), a = ans("2.2"), cap = ans("2.3");
    const none = a1?.status === "NOT_APPLICABLE" || (a1?.status === "FOUND" && /^\s*no\b/i.test(a1.answer_value));
    const r = a?.status === "FOUND" ? (ok("retention_rate") && inp!.retention_rate > 0 ? pct(inp!.retention_rate) : firstPct(a.answer_value)) : "";
    const c = cap?.status === "FOUND" ? (ok("retention_cap") && inp!.retention_cap != null ? pct(inp!.retention_cap) : firstPct(cap.answer_value)) : "";
    const relA = ans("2.5");
    let rel = ok("retention_release") && inp!.retention_release.length ? inp!.retention_release[inp!.retention_release.length - 1].months_after_completion : null;
    if (rel == null && relA?.status === "FOUND") {
      const dm = relA.answer_value.match(/\b(\d+)\s*(days?|months?|years?)\b/i);
      if (dm) rel = /day/i.test(dm[2]) ? +dm[1] / 30 : /year/i.test(dm[2]) ? +dm[1] * 12 : +dm[1];
    }
    const visual = none ? <Empty>Nothing held back</Empty>
      : r && inp && cash ? <RetentionBar months={inp.duration_months} capMonth={cash.retention_cap_month ?? null} releaseAfter={rel} />
      : r ? <Empty>See contract</Empty> : notHere(a);
    cards.push(
      <Card key="C2" clause="C2" label={TERM_SHORT.C2} tone={tone("C2", "2.2")} env={pick("2.2", "2.3", "2.5")}
        big={none ? "None" : r || "—"} unit={!none && r ? (c && c !== r ? `per bill · cap ${c}` : "per bill") : undefined}
        visual={visual} chips={cash && r && cash.retention_locked_max > 0 ? <Chip>Up to {money(cash.retention_locked_max)} held</Chip> : null} />,
    );
  }

  // Advance ----------------------------------------------------------------
  {
    const a1 = ans("3.1"), intr = ans("3.3");
    const none = a1?.status === "NOT_APPLICABLE" || (a1?.status === "FOUND" && /^\s*no\b/i.test(a1.answer_value));
    const inst = ok("advance_instalments") ? inp!.advance_instalments : [];
    const tot = inst.reduce((x, i) => x + i.share_of_value, 0);
    let visual: ReactNode;
    if (none) visual = <Empty><span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-none" />No advance</span></Empty>;
    else if (tot > 0 && inp && cash) {
      visual = <AdvanceArea outstanding={cash.months.map((m) => m.advance_outstanding)} months={cash.months.map((m) => m.month)}
        inMonths={inst.map((i) => i.month)} repaid={cash.advance_repaid_month ?? null} />;
    } else visual = a1?.status === "FOUND" ? <Empty>See contract</Empty> : notHere(a1);
    let chip: ReactNode = null;
    if (!none && intr?.status === "FOUND") {
      if (/interest[- ]free|no interest|without interest/i.test(intr.answer_value)) chip = <Chip tone="good">Interest-free</Chip>;
      else { const r = rate(intr.answer_value); chip = <Chip>Interest {r ? r.replace(/ a year$/, "") : "charged"}</Chip>; }
    }
    const amt = !none && !tot ? firstPct(ans("3.2")?.status === "FOUND" ? ans("3.2")!.answer_value : "") : "";
    cards.push(
      <Card key="C3" clause="C3" label={TERM_SHORT.C3} tone={tone("C3", "3.1")} env={pick("3.2", "3.1", "3.3")}
        big={none ? "None" : tot ? pct(tot) : amt || "—"} unit={!none && (tot || amt) ? `of value${inst.length > 1 ? ` · ${inst.length} parts` : ""}` : undefined}
        visual={visual} chips={chip} />,
    );
  }

  // Delay penalty ----------------------------------------------------------
  {
    const a1 = ans("4.1"), a = ans("4.2");
    const none = a1?.status === "NOT_APPLICABLE" || (a1?.status === "FOUND" && /^\s*no\b/i.test(a1.answer_value));
    const r = a?.status === "FOUND" && ok("ld_rate_per_day") && inp!.ld_rate_per_day > 0 ? inp!.ld_rate_per_day : null;
    let big: ReactNode = "—", unit: string | undefined;
    if (none) big = "None";
    else if (r) {
      const dayPct = r * 100, monthPct = r * 3000;
      const perMonth = Math.abs(dayPct * 1000 - Math.round(dayPct * 1000)) > 1e-6 && Math.abs(monthPct * 100 - Math.round(monthPct * 100)) < 1e-6;
      big = perMonth ? pct(r * 30) : pct(r);
      unit = perMonth ? "of value / month" : "of value / day";
    } else if (a?.status === "FOUND") { big = firstPct(a.answer_value) || "—"; unit = big !== "—" ? "see contract" : undefined; }
    const capOk = ok("ld_cap");
    const cap = capOk ? inp!.ld_cap : null;
    cards.push(
      <Card key="C4" clause="C4" label={TERM_SHORT.C4} tone={tone("C4", "4.2")} env={pick("4.2", "4.3")} big={big} unit={unit}
        visual={none ? <Empty>No penalty</Empty> : r && capOk ? <PenaltyLine ratePerDay={r} cap={cap} grace={ok("ld_grace_days") ? inp!.ld_grace_days : 0} capDays={cash?.ld_days_to_cap ?? null} /> : r ? <Empty>Limit: see contract</Empty> : notHere(a)}
        chips={r && capOk ? <Chip tone={cap == null ? "bad" : undefined}>{cap == null ? "No upper limit" : `Limit ${pct(cap)} of value`}</Chip> : null} />,
    );
  }

  // Price adjustment -------------------------------------------------------
  {
    const a = ans("5.1"), wq = ans("5.3");
    let big = "—";
    let visual: ReactNode = notHere(a);
    let chip: ReactNode = null;
    if (a?.status === "FOUND" || a?.status === "NOT_APPLICABLE") {
      const v = a.answer_value;
      const textApplies = /\b(10CC|10CA|PVC|price variation|price adjustment|escalation)\s+(clause\s+)?(is\s+)?(selected|applicable|applies)\b/i.test(v);
      const textFixed = !textApplies && /fixed price|no (general )?(index|price|escalation)|not applicable|does not apply/i.test(v);
      const applies = a.status === "NOT_APPLICABLE" ? false : ok("pv_applies") ? inp!.pv_applies : !textFixed;
      if (applies) {
        big = "Indexed";
        const pw = ok("pv_weights") && inp && Object.keys(inp.pv_weights).length >= 2
          ? { w: Object.entries(inp.pv_weights).map(([k, x]) => [k[0].toUpperCase() + k.slice(1), +(x * 100).toFixed(1)] as [string, number]).filter(([, x]) => x > 0), caption: "Index weights" }
          : wq?.status === "FOUND" ? parseWeights(wq.answer_value) : null;
        visual = pw ? <WeightBar w={pw.w} caption={pw.caption} /> : <Empty>Index formula; weights: see contract</Empty>;
        if (ok("pv_factor") && inp!.pv_factor > 0 && inp!.pv_factor < 1) chip = <Chip>On {pct(inp!.pv_factor)} of work value</Chip>;
      } else {
        big = "Fixed";
        visual = <Empty><span className="inline-flex items-center gap-2"><Lock className="h-4 w-4" aria-hidden />{textApplies || a.status === "NOT_APPLICABLE" ? "Clause switched off" : "Fixed price"}</span></Empty>;
        chip = <Chip tone="bad">Price rise is yours</Chip>;
      }
    }
    cards.push(<Card key="C5" clause="C5" label={TERM_SHORT.C5} tone={tone("C5", "5.1")} env={pick("5.1", "5.3")} big={big} visual={visual} chips={chip} />);
  }

  // Guarantees -------------------------------------------------------------
  {
    const a = ans("6.2"), extra = ans("6.8");
    let ps = a?.status === "FOUND" && ok("perf_security_pct") && inp!.perf_security_pct > 0 ? inp!.perf_security_pct : null;
    if (ps == null && a?.status === "FOUND") { const m = a.answer_value.match(/performance (security|guarantee)[^;]*?(\d+(\.\d+)?)\s?%/i); ps = m ? +m[2] / 100 : null; }
    const parts: [string, number, string][] = [];
    if (ps) parts.push(["Performance", ps, "var(--accent)"]);
    if (extra?.status === "FOUND" && !/^\s*no\b/i.test(extra.answer_value)) {
      const m = extra.answer_value.match(/(?:max(?:imum)?|up to|capped at|cap(?:ped)?)\s*(\d+(?:\.\d+)?)\s?%/i);
      if (m) parts.push(["Extra, low bid", +m[1] / 100, "#7fa0c8"]);
    }
    const rc = ok("retention_cap") && inp!.retention_cap ? inp!.retention_cap : null;
    if (rc) parts.push(["Retention", rc, "var(--fair)"]);
    const total = parts.reduce((x, [, v]) => x + v, 0);
    cards.push(
      <Card key="C6" clause="C6" label={TERM_SHORT.C6} tone={tone("C6", "6.2")} env={pick("6.2", "6.5", "6.8")}
        big={ps ? pct(ps) : "—"} unit={ps ? "performance" : undefined}
        visual={parts.length ? <SecurityBar parts={parts} scale={Math.max(total * 1.05, 0.1)} /> : notHere(a)}
        chips={total > 0 && value ? <Chip>Up to {money(total * value)} locked</Chip> : total > 0 ? <Chip>Up to {pct(total)} locked</Chip> : null} />,
    );
  }

  const list = only ? cards.filter((c) => (c as { key?: string }).key === only) : cards;
  if (variant === "header") return <VariantCtx.Provider value="header">{list}</VariantCtx.Provider>;
  return <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{list}</ul>;
}
