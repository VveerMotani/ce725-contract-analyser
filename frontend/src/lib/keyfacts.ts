// "Key facts" on the report: key dates, money locked up, number tiles and two chip rows.
// Everything comes from the effective answers (a person's correction if any, else the AI answer),
// cash parameters whose provenance is "extracted" or "user", and the cash model result.
// When nothing usable is found the value is null and the screen shows "—"; nothing is invented.
import type { Answer, AnswerEnvelope, CashParams, CashResult, Package, RiskFlag, RuleCheck } from "../types";
import { effective } from "../types";
import { money, pct } from "./format";
import { brief, rate, usable } from "./terms";

export type Ans = (q: string) => { a: Answer; env: AnswerEnvelope } | null;

export function answerLookup(answers: AnswerEnvelope[]): Ans {
  return (q) => {
    const env = answers.find((e) => e.answer.question_id === q);
    return env ? { a: effective(env), env } : null;
  };
}

const found = (x: ReturnType<Ans>) => (x && x.a.status === "FOUND" ? x : null);

// ---------------------------------------------------------------------------
// Durations and rupees in answer text
// ---------------------------------------------------------------------------

/** "730 days", "05 (five) years", "3 months": value in months (1 month = 30 days, as in the cash model). */
const DUR = /(\d+(?:\.\d+)?)\s*(?:\([a-z\s-]+\)\s*)?(days?|weeks?|months?|years?)\b/i;

export function toMonths(n: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("day")) return n / 30;
  if (u.startsWith("week")) return (n * 7) / 30;
  if (u.startsWith("year")) return n * 12;
  return n;
}

export function duration(text: string): { months: number; n: number; unit: string } | null {
  const m = (text || "").match(DUR);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return { months: toMonths(n, m[2]), n, unit: m[2].toLowerCase().replace(/s$/, "") };
}

/** First rupee amount in the text: "Rs 4,24,547", "Rs. 3.50 lakh", "Rs 188.65 lakh". */
export function rupees(text: string): number | null {
  const m = (text || "").match(/Rs\.?\s?([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?)?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const u = (m[2] || "").toLowerCase();
  return u.startsWith("cr") ? n * 1e7 : u.startsWith("la") ? n * 1e5 : n;
}

function roman(s: string): number {
  const v: Record<string, number> = { I: 1, V: 5, X: 10 };
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]] ?? 0, b = v[s[i + 1]] ?? 0;
    t += a < b ? -a : a;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Key dates
// ---------------------------------------------------------------------------

export type DateKind = "start" | "milestone" | "completion" | "late" | "after";

export interface KeyDate {
  key: string;
  label: string;
  /** months from the start (1 month = 30 days) */
  t: number;
  value: string;
  kind: DateKind;
  env: AnswerEnvelope | null;
}

function fmtMonths(m: number): string {
  return String(Math.abs(m - Math.round(m)) < 0.05 ? Math.round(m) : +m.toFixed(1));
}

/** Time after completion: "+15 days", "+3 months", "+5 years", "+62 months". */
export function relText(m: number): string {
  if (m < 1.95) return `+${Math.round(m * 30)} days`;
  if (Math.abs(m / 12 - Math.round(m / 12)) < 0.01) return `+${Math.round(m / 12)} year${Math.round(m / 12) === 1 ? "" : "s"}`;
  return `+${fmtMonths(m)} months`;
}

export interface Dates {
  list: KeyDate[];
  /** completion as written (months), null when unknown */
  completion: number | null;
  completionInDays: boolean;
  /** end of the defects period, months from start */
  dlpEnd: number | null;
  /** performance guarantee expiry, months from start, and whether it was found in the contract */
  psEnd: number | null;
  psFromContract: boolean;
}

export function keyDates(ans: Ans, params: CashParams | undefined): Dates {
  const inp = params?.inputs;
  const list: KeyDate[] = [];
  const d04 = found(ans("0.4"));
  let completion: number | null = null;
  let inDays = false;
  const cd = d04 ? duration(d04.a.answer_value) : null;
  if (cd) { completion = cd.months; inDays = cd.unit === "day"; }
  else if (inp && usable(params, "duration_months") && inp.duration_months > 0) completion = inp.duration_months;

  const atStart = (m: number, days: boolean) => (days ? `day ${Math.round(m * 30)}` : `month ${fmtMonths(m)}`);

  list.push({ key: "start", label: "Start", t: 0, value: "day 0", kind: "start", env: d04?.env ?? ans("0.4")?.env ?? null });

  // Milestones (0.6): only segments that name a milestone and give a time.
  const ms = found(ans("0.6"));
  if (ms && !/activity periods|no %/i.test(ms.a.answer_value)) {
    for (const seg of ms.a.answer_value.split(/;\s*/)) {
      const nm = seg.match(/\b(Milestone[- ]?([IVX]+|\d+)|MS\s?(\d+)|M\s?(\d+))\b/);
      if (!nm) continue;
      const no = nm[2] ? (/^\d+$/.test(nm[2]) ? +nm[2] : roman(nm[2])) : +(nm[3] ?? nm[4]);
      let t: number | null = null;
      let days = false;
      const dm = seg.match(/(\d+)(?:st|nd|rd|th)?\s*days?\b/i);
      const mm = seg.match(/\((\d+(?:\.\d+)?)\s*months?\)/i) ?? seg.match(/(\d+(?:\.\d+)?)\s*months?\b/i);
      if (dm) { t = +dm[1] / 30; days = true; } else if (mm) t = +mm[1];
      if (t == null || t <= 0) continue;
      if (completion != null && Math.abs(t - completion) < 0.02) continue; // the last milestone is the completion itself
      let share = "";
      const p = seg.match(/(\d+(?:\.\d+)?)\s?%/);
      const f = seg.match(/(\d+)\/(\d+)\s*(of\s*(the\s*)?whole work|before)/i);
      if (p) share = `${p[1]}%`;
      else if (f) share = `${+((100 * +f[1]) / +f[2]).toFixed(1)}%`;
      list.push({ key: `m${no}`, label: share ? `M${no} · ${share}` : `M${no}`, t, value: atStart(t, days), kind: "milestone", env: ms.env });
    }
  }

  let dlpEnd: number | null = null;
  let psEnd: number | null = null;
  let psFromContract = false;
  if (completion != null) {
    list.push({ key: "done", label: "Completion", t: completion, value: atStart(completion, inDays), kind: "completion", env: d04?.env ?? null });

    const delay = inp?.delay_days ?? 0;
    if (delay > 0) list.push({ key: "late", label: "Late finish", t: completion + delay / 30, value: `+${delay} days`, kind: "late", env: null });

    // Defects period end (0.5)
    const dl = ans("0.5");
    let dlp: number | null = null;
    if (inp && usable(params, "dlp_months") && inp.dlp_months > 0) dlp = inp.dlp_months;
    else if (dl && dl.a.status === "FOUND" && !/^\s*no\b/i.test(dl.a.answer_value)) dlp = duration(dl.a.answer_value)?.months ?? null;
    if (dlp != null) {
      dlpEnd = completion + dlp;
      list.push({ key: "dlp", label: "Defects end", t: dlpEnd, value: relText(dlp), kind: "after", env: dl?.env ?? null });
    }

    // Retention release (2.5): the cash parameter if usable, else the answer text.
    const rel = ans("2.5");
    const steps = inp && usable(params, "retention_release") ? inp.retention_release : null;
    if (steps && steps.length && (inp?.retention_rate ?? 0) > 0) {
      steps.forEach((s, i) => list.push({
        key: `ret${i}`, label: s.share < 0.999 ? `Retention back · ${pct(s.share)}` : "Retention back",
        t: completion! + s.months_after_completion, value: relText(s.months_after_completion), kind: "after", env: rel?.env ?? null,
      }));
    } else if (rel && rel.a.status === "FOUND") {
      const txt = rel.a.answer_value;
      let off: number | null = null;
      if (/defects? liability|\bDLP\b|maintenance period/i.test(txt) && !/\d+\s*(days?|months?)\s*(of|from|after)\s*(issue of\s*)?(the\s*)?(certificate|completion)/i.test(txt)) off = dlpEnd != null ? dlpEnd - completion : null;
      else if (/completion/i.test(txt)) off = duration(txt)?.months ?? (/on completion|at completion/i.test(txt) ? 0 : null);
      if (off != null) list.push({ key: "ret", label: "Retention back", t: completion + off, value: relText(off), kind: "after", env: rel.env });
    }

    // Performance guarantee expiry (6.5)
    const v65 = found(ans("6.5"));
    if (v65) {
      const seg = v65.a.answer_value.split(/;\s*|\.\s+/).find((s) => /performance (security|guarantee)|\bPG\b|\bPS\b/i.test(s) && !/^\s*additional/i.test(s));
      if (seg && !/not stated|not in (the )?package/i.test(seg)) {
        const d = duration(seg);
        const base = /defects? liability|\bDLP\b|maintenance period/i.test(seg) ? dlpEnd : /completion/i.test(seg) ? completion : null;
        if (d && base != null) { psEnd = base + d.months; psFromContract = true; }
        else if (base != null && /until|up to|till/i.test(seg) && !d) { psEnd = base; psFromContract = true; }
      }
    }
    if (psEnd == null && inp && usable(params, "perf_security_validity_months_after_completion")) {
      psEnd = completion + inp.perf_security_validity_months_after_completion;
      psFromContract = true;
    }
    if (psEnd != null) list.push({ key: "ps", label: "Guarantee ends", t: psEnd, value: relText(psEnd - completion), kind: "after", env: v65?.env ?? null });
  }

  list.sort((a, b) => a.t - b.t);
  return { list, completion, completionInDays: inDays, dlpEnd, psEnd, psFromContract };
}

// ---------------------------------------------------------------------------
// Money locked up
// ---------------------------------------------------------------------------

export interface LockRow { month: number; retention: number; perf: number; advance: number; total: number }

export interface Locked {
  rows: LockRow[];
  peak: number;
  peakMonth: number;
  hasPerf: boolean;
  hasAdvance: boolean;
  /** the performance guarantee validity was not found; it is shown up to completion */
  perfToCompletion: boolean;
}

export function moneyLocked(cash: CashResult, params: CashParams | undefined, dates: Dates): Locked | null {
  const inp = params?.inputs;
  if (!inp || !cash.months.length) return null;
  const V = usable(params, "contract_value") ? inp.contract_value : 0;
  const ps = V > 0 && usable(params, "perf_security_pct") ? inp.perf_security_pct * V : 0;
  const tc = inp.duration_months + inp.delay_days / 30; // completion in the cash model
  let psEnd = dates.psEnd;
  let perfToCompletion = false;
  if (ps > 0 && psEnd == null) { psEnd = tc; perfToCompletion = true; }
  // timeline drawn in the cash model's months: shift contract dates by the model's completion
  if (ps > 0 && psEnd != null && dates.completion != null && !perfToCompletion) psEnd = tc + (psEnd - dates.completion);
  const hasAdvance = usable(params, "advance_instalments") !== null && inp.advance_instalments.some((a) => a.share_of_value > 0);
  const first = cash.months[0].month;
  const lastCash = cash.months[cash.months.length - 1].month;
  const last = Math.max(lastCash, ps > 0 && psEnd != null ? Math.ceil(psEnd) : 0);
  const byMonth = new Map(cash.months.map((m) => [m.month, m]));
  const rows: LockRow[] = [];
  for (let m = first; m <= last; m++) {
    const r = byMonth.get(m);
    const retention = Math.max(0, r?.retention_held ?? 0);
    const perf = ps > 0 && psEnd != null && m <= psEnd + 1e-9 ? ps : 0;
    const advance = hasAdvance ? 1.1 * Math.max(0, r?.advance_outstanding ?? 0) : 0;
    rows.push({ month: m, retention, perf, advance, total: retention + perf + advance });
  }
  let peak = 0, peakMonth = first;
  for (const r of rows) if (r.total > peak + 1e-6) { peak = r.total; peakMonth = r.month; }
  return { rows, peak, peakMonth, hasPerf: ps > 0, hasAdvance, perfToCompletion };
}

// ---------------------------------------------------------------------------
// Number tiles
// ---------------------------------------------------------------------------

export interface Tile {
  key: string;
  label: string;
  value: string;
  note?: string;
  info: string;
  env?: AnswerEnvelope | null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function numberTiles(ans: Ans, params: CashParams | undefined, cash: CashResult | undefined): Tile[] {
  const inp = params?.inputs;
  const V = inp && usable(params, "contract_value") && inp.contract_value > 0 ? inp.contract_value : 0;
  const out: Tile[] = [];

  // EMD / bid security
  {
    let value = "—", note: string | undefined = "not stated", env: AnswerEnvelope | null = ans("6.2")?.env ?? null;
    for (const q of ["6.2", "6.1", "0.3"]) {
      const x = found(ans(q));
      if (!x) continue;
      const seg = x.a.answer_value.split(/;\s*/).find((s) => /\b(EMD|earnest money|bid security)\b/i.test(s));
      if (!seg) continue;
      const rs = rupees(seg);
      if (rs != null) { value = money(rs); note = /fixed/i.test(seg) ? "fixed amount" : undefined; env = x.env; break; }
      const p = seg.match(/(\d+(?:\.\d+)?)\s?%\s*of\s*([a-z ]{3,30})/i);
      if (p) { value = `${p[1]}%`; note = `of ${p[2].trim()}`; env = x.env; break; }
      if (/per RFP|as per|not stated/i.test(seg)) { note = /RFP/i.test(seg) ? "set in the RFP" : "not stated"; env = x.env; }
    }
    out.push({ key: "emd", label: "EMD / bid security", value, note, env, info: "Earnest money paid with the bid. Returned after the performance guarantee is given (or to losing bidders)." });
  }

  // Delay penalty per day / week
  {
    let value = "—", note: string | undefined;
    const a42 = ans("4.2");
    if (inp && usable(params, "ld_rate_per_day")) {
      if (inp.ld_rate_per_day <= 0) value = "None";
      else if (V) { value = money(inp.ld_rate_per_day * V); note = `${money(inp.ld_rate_per_day * V * 7)} a week`; }
      else note = `${pct(inp.ld_rate_per_day)} of value a day`;
    } else if (a42?.a.status === "POINTS_ELSEWHERE") note = "in another document";
    else if (a42?.a.status === "NOT_STATED") note = "not stated";
    out.push({ key: "ld", label: "Delay penalty a day", value, note, env: a42?.env, info: "Daily delay penalty (liquidated damages) as a share of the contract value, in rupees. Deducted from what you are owed at completion." });
  }

  // Days to the penalty cap
  {
    let value = "—", note: string | undefined;
    if (inp && usable(params, "ld_rate_per_day") && inp.ld_rate_per_day > 0 && usable(params, "ld_cap")) {
      if (inp.ld_cap == null) { value = "No cap"; }
      else if (cash?.ld_days_to_cap != null) {
        value = `${Math.round(cash.ld_days_to_cap)} days`;
        note = V ? `cap ${pct(inp.ld_cap)} · ${money(inp.ld_cap * V)}` : `cap ${pct(inp.ld_cap)}`;
      }
    } else if (ans("4.3")?.a.status === "POINTS_ELSEWHERE") note = "in another document";
    const grace = inp && usable(params, "ld_grace_days") && inp.ld_grace_days > 0 ? ` Includes ${inp.ld_grace_days} days before the penalty starts.` : "";
    out.push({ key: "cap", label: "Days to penalty cap", value, note, env: ans("4.3")?.env, info: `Days late after which the penalty stops growing.${grace}` });
  }

  // Retention per bill
  {
    let value = "—", note: string | undefined;
    if (inp && usable(params, "retention_rate")) {
      if (inp.retention_rate <= 0) value = "None";
      else if (cash) {
        const xs = cash.months.map((m) => m.retention).filter((x) => x > 1);
        if (xs.length) { value = money(median(xs)); note = `${pct(inp.retention_rate)} of each bill`; }
      }
    } else if (ans("2.2")?.a.status === "POINTS_ELSEWHERE") note = "in another document";
    out.push({ key: "ret", label: "Held back per bill", value, note, env: ans("2.2")?.env, info: "Typical retention (security deposit) taken from one running bill in the cash model, until the limit is reached." });
  }

  // Cost of these terms
  {
    const t = cash?.total_cost_of_terms;
    out.push({
      key: "total", label: "Cost of these terms", value: t != null ? money(t) : "—",
      note: t != null && V ? `${pct(t / V, 1)} of contract value` : undefined,
      info: "Overdraft interest + advance interest + guarantee commission + delay penalty + price-rise burden − late-payment interest earned. Uses the assumptions in the cash section.",
    });
  }

  // Financing cost
  {
    const od = cash?.overdraft_interest;
    const ai = cash?.advance_interest ?? 0;
    out.push({
      key: "fin", label: "Financing cost", value: od != null ? money(od) : "—",
      note: ai > 0 ? `+ ${money(ai)} advance interest` : inp ? `overdraft at ${pct(inp.overdraft_rate_pa)}` : undefined,
      info: "Interest on the money you put in before the bills are paid (overdraft), from the cash model.",
    });
  }

  // Guarantee commission
  {
    const g = cash?.guarantee_cost;
    out.push({
      key: "bg", label: "Guarantee commission", value: g != null ? money(g) : "—",
      note: inp ? `at ${pct(inp.bg_commission_pa)} a year` : undefined,
      info: "Bank commission on the performance guarantee (and the advance guarantee, 110% of the advance still owed).",
    });
  }

  // Late-payment interest
  {
    let value = "—", note: string | undefined;
    const li = ans("1.4");
    if (li?.a.status === "FOUND") {
      const v = li.a.answer_value;
      if (/^\s*no\b|no interest|not payable|\bnil\b/i.test(v)) value = "None";
      else {
        const r = rate(v);
        if (inp && usable(params, "late_interest_rate_pa") && inp.late_interest_rate_pa > 0) {
          value = `${pct(inp.late_interest_rate_pa)} a year`;
          if (r && !/^\d/.test(r)) note = r.replace(/ a year$/, "");
        } else if (r) value = r;
        else value = "Yes";
        if (/final bill/i.test(v)) note = note ? `${note} · final bill only` : "final bill only";
      }
    } else if (li?.a.status === "POINTS_ELSEWHERE") note = "in another document";
    else if (li?.a.status === "NOT_STATED") { value = "None"; note = "not stated"; }
    out.push({ key: "late", label: "Late-payment interest", value, note, env: li?.env, info: "Interest the employer pays you when a bill is paid after the contract's time limit." });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export interface Chip { label: string; env?: AnswerEnvelope | null; title?: string; page?: { page: number; quote: string; doc: string } }

/** Things the contractor must do or meet before money is paid or released. */
export function payConditions(ans: Ans, flags: RiskFlag[], params: CashParams | undefined): Chip[] {
  const out: Chip[] = [];
  const add = (label: string, x: ReturnType<Ans>) => { if (!out.some((c) => c.label === label)) out.push({ label, env: x?.env ?? null, title: x ? brief(x.a.answer_value, 200) : undefined }); };
  const txt = (q: string) => found(ans(q))?.a.answer_value ?? "";

  const p18 = found(ans("1.8"));
  if (p18 && !/^\s*no\b/i.test(p18.a.answer_value)) add("Paid only when funds arrive", p18);

  for (const q of ["1.6", "1.1"]) {
    const m = txt(q).match(/minimum\s+(Rs\.?\s?[\d,.]+\s*(lakhs?|lacs?|crores?)?)/i) ?? txt(q).match(/at least\s+(Rs\.?\s?[\d,.]+\s*(lakhs?|lacs?|crores?)?)/i);
    if (m) { const r = rupees(m[1]); if (r) { add(`Bill at least ${money(r)}`, ans(q)); break; } }
  }
  const inp = params?.inputs;
  if (inp && usable(params, "min_bill_value") && inp.min_bill_value > 0 && !out.some((c) => c.label.startsWith("Bill at least"))) add(`Bill at least ${money(inp.min_bill_value)}`, ans("1.6"));

  const by = txt("1.1").match(/by (?:the )?(\d+)(st|nd|rd|th)\s*(?:day\s*)?of (?:the |every |each )?month/i);
  if (by) add(`Bill by the ${by[1]}${by[2]} monthly`, ans("1.1"));
  if (/no claim for incomplete stages|completed stages|on completion of a stage/i.test(txt("1.1") + " " + txt("1.6"))) add("Only finished stages are paid", ans("1.1"));
  if (/measure/i.test(txt("1.1"))) add("Bills on measured work", ans("1.1"));
  if (/strength|cube test|beam/i.test(txt("1.6"))) add("Strength tests before full pay", ans("1.6"));

  const ms = txt("1.5").match(/(\d+(?:\.\d+)?)%[^;]*withh?eld per (missed )?milestone/i);
  if (ms) add(`Meet milestones (${ms[1]}% held)`, ans("1.5"));
  else if (/withh?eld[^;]*milestone|milestone[^;]*(withh?eld|retention)/i.test(txt("1.5") + "; " + txt("4.2"))) add("Meet milestones or money held", /milestone/i.test(txt("1.5")) ? ans("1.5") : ans("4.2"));
  if (/programme not submitted|updated programme/i.test(txt("1.5"))) add("Submit updated programme", ans("1.5"));
  const pf = txt("1.5").match(/(\d+(?:\.\d+)?)%\s*withheld towards Provident Fund/i);
  if (pf) add(`PF no-dues to free ${pf[1]}%`, ans("1.5"));
  else if (/PF no-dues|Provident Fund/i.test(txt("1.5"))) add("PF no-dues certificate", ans("1.5"));
  if (/labour clearance/i.test(txt("2.5"))) add("Labour clearance for retention", ans("2.5"));

  const a31 = found(ans("3.1"));
  const a35 = found(ans("3.5"));
  if (a35 && !(a31 && /^\s*no\b/i.test(a31.a.answer_value))) add(/110\s?%/.test(a35.a.answer_value) ? "110% guarantee for advance" : "Bank guarantee for advance", a35);

  const fb = txt("1.7").match(/final (bill|account|payment statement)[^;]*?within (\d+)\s*(days?|months?)/i);
  if (fb) add(`Final bill within ${fb[2]} ${fb[3].toLowerCase()}`, ans("1.7"));
  if (/written discharge|\bdischarge\b/i.test(txt("1.7"))) add("Written discharge for final pay", ans("1.7"));

  for (const f of flags) {
    if (f.flag_id !== "R15" || !f.value_found) continue;
    const words = brief(f.value_found, 60).split(/\s+/).slice(0, 6).join(" ");
    add(words.charAt(0).toUpperCase() + words.slice(1), f.question_ids[0] ? ans(f.question_ids[0]) : null);
  }
  return out.slice(0, 9);
}

function shortDoc(s: string): string {
  return s.trim().replace(/\s*\([^)]*\)/g, "")
    .replace(/^CPWD General Conditions of Contract\s*(\d{4})?/i, (_m, y) => `CPWD GCC${y ? " " + y : ""}`)
    .replace(/^General Conditions of Contract (for )?(the )?CPWD( works)?\s*(\d{4})?/i, (_m, _a, _b, _c, y) => `CPWD GCC${y ? " " + y : ""}`)
    .replace(/^General Conditions of Contract/i, "GCC")
    .replace(/\s+/g, " ");
}

/** Documents the package refers to but does not include (rule R18 and the package's missing references). */
export function missingDocs(flags: RiskFlag[], checks: RuleCheck[] | undefined, pkg: Package | undefined): { chips: Chip[]; checked: boolean } {
  const names: string[] = [];
  for (const f of flags) if (f.flag_id === "R18" && f.value_found) names.push(...f.value_found.split(/,\s*/));
  const c = checks?.find((x) => x.flag_id === "R18");
  if (!names.length && c?.result === "flag" && c.reason) names.push(...c.reason.split(/,\s*/));
  const refs = pkg?.missing_references ?? [];
  refs.forEach((r) => names.push(r.label));
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const n of names) {
    const label = shortDoc(n);
    const k = label.toLowerCase();
    if (!label || seen.has(k) || /^(incorporated|see |refer|as per|per )/i.test(label)) continue;
    seen.add(k);
    const ref = refs.find((r) => shortDoc(r.label).toLowerCase() === k);
    chips.push({ label, title: ref?.quote, page: ref && ref.page > 0 ? { page: ref.page, quote: ref.quote, doc: ref.doc_id } : undefined });
  }
  return { chips, checked: !!c || !!pkg };
}
