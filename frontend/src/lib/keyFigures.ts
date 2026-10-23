// The ONE key number per clause type for the Overview tiles.
// Uses a cash parameter (Interface B) only when its provenance is "extracted" or "user";
// otherwise the text comes from the effective answer. Defaults are never shown as contract facts.
import type { AnswerEnvelope, CashParams, ClauseId, RiskFlag, Severity, Status } from "../types";
import { effective } from "../types";
import { pct } from "./format";

export interface KeyFigure {
  clause: ClauseId;
  headline: string;
  sub: string;
  status: Status | null;
  proof: AnswerEnvelope | null;
}

const KEY_Q: Record<ClauseId, string[]> = {
  C0: ["0.3", "0.4", "0.5"],
  C1: ["1.3", "1.2", "1.4"],
  C2: ["2.2", "2.3", "2.5"],
  C3: ["3.1", "3.2", "3.3"],
  C4: ["4.2", "4.3"],
  C5: ["5.1", "5.2"],
  C6: ["6.2", "6.5"],
};

export function clauseOfQuestion(qid: string): ClauseId {
  return `C${qid.split(".")[0]}` as ClauseId;
}

export function findQ(answers: AnswerEnvelope[], qid: string) {
  return answers.find((a) => a.answer.question_id === qid) ?? null;
}

const STATUS_HEAD: Record<Status, string> = {
  FOUND: "",
  NOT_STATED: "Not stated",
  NOT_APPLICABLE: "Not applicable",
  POINTS_ELSEWHERE: "In another document",
};

/** Only the first "number + unit" phrase, or "" when the text has none. */
export function keyNumber(text: string): string {
  if (!text) return "";
  const m = text.match(/(Rs\.?\s?[\d,.]+\s*(lakhs?|crores?)?|\d+(\.\d+)?\s?%(\s?(per|a|of)\s?(day|month|week|year|annum))?|\d+(\.\d+)?\s?(working\s)?(days?|months?|years?|weeks?))/i);
  return m ? m[0] : "";
}

/** First "number + unit" phrase in a sentence, e.g. "30 days", "6%", "Rs 30 lakhs". */
export function shortValue(text: string): string {
  if (!text) return "";
  const m = text.match(/(Rs\.?\s?[\d,.]+\s*(lakhs?|crores?)?|\d+(\.\d+)?\s?%(\s?(per|a|of)\s?(day|month|week|year|annum))?|\d+(\.\d+)?\s?(working\s)?(days?|months?|years?|weeks?))/i);
  if (m) return m[0];
  return text.length > 28 ? text.slice(0, 26).trimEnd() + "…" : text;
}

/** A param may be shown as a contract fact only when it was extracted from the contract or entered by the user. */
export function usable(p: CashParams | undefined, field: string): "extracted" | "user" | null {
  const src = p?.provenance.find((x) => x.field === field)?.source;
  return src === "extracted" || src === "user" ? src : null;
}

function cut(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export interface Fact {
  text: string;
  /** where the text comes from: a usable param, the answer text, or nothing found */
  source: "extracted" | "user" | "answer" | "none";
  proof: AnswerEnvelope | null;
}

export interface Facts { value: Fact; duration: Fact; dlp: Fact }

export function keyFigures(answers: AnswerEnvelope[], params?: CashParams): Record<ClauseId, KeyFigure> {
  const inp = params?.inputs;
  const get = (q: string) => findQ(answers, q);
  const st = (q: string) => { const e = get(q); return e ? effective(e).status : null; };
  const val = (q: string) => { const e = get(q); return e ? effective(e).answer_value : ""; };
  /** Short text from the answer itself: "not stated" etc. for non-FOUND, else the value cut to n chars. */
  const said = (q: string, n = 44): string => {
    const s = st(q);
    if (!s) return "not found";
    if (s !== "FOUND") return STATUS_HEAD[s].toLowerCase();
    return cut(val(q), n);
  };
  const ok = (field: string) => !!inp && usable(params, field) !== null;
  const fallback = (c: ClauseId): KeyFigure => {
    const q = KEY_Q[c][0];
    const e = get(q);
    const s = st(q);
    return { clause: c, headline: s && s !== "FOUND" ? STATUS_HEAD[s] : shortValue(val(q)) || "—", sub: e ? effective(e).answer_value : "", status: s, proof: e };
  };
  const out = {} as Record<ClauseId, KeyFigure>;
  (Object.keys(KEY_Q) as ClauseId[]).forEach((c) => (out[c] = fallback(c)));

  // C1 payment: days to pay + late interest
  const payOk = st("1.3") === "FOUND" && ok("pay_lag_days");
  if (payOk && inp) out.C1.headline = `${Math.round(inp.pay_lag_days)} days`;
  const late = ok("late_interest_rate_pa") && inp
    ? (inp.late_interest_rate_pa ? `${pct(inp.late_interest_rate_pa)} p.a.` : "none")
    : said("1.4", 36);
  out.C1.sub = `${payOk ? "to pay" : ""}${payOk && inp && ok("cert_lag_days") && inp.cert_lag_days ? ` · ${Math.round(inp.cert_lag_days)} d to certify` : ""}${payOk ? " · " : ""}late interest: ${late}`;

  // C2 retention: rate / cap
  if (inp && ok("retention_rate") && inp.retention_rate > 0 && st("2.2") === "FOUND") {
    const capOk = ok("retention_cap");
    out.C2.headline = capOk && inp.retention_cap != null && Math.abs(inp.retention_cap - inp.retention_rate) > 1e-9
      ? `${pct(inp.retention_rate)} / cap ${pct(inp.retention_cap)}` : pct(inp.retention_rate);
    out.C2.sub = `of each bill · release: ${said("2.5", 40)}`;
    out.C2.proof = get("2.2");
  }

  // C3 advance
  const s31 = st("3.1");
  const adv = inp && ok("advance_instalments") ? inp.advance_instalments.reduce((a, b) => a + b.share_of_value, 0) : 0;
  if (inp && adv > 0) {
    const n = inp.advance_instalments.length;
    out.C3.headline = `${pct(adv)} advance`;
    const interest = ok("advance_interest_rate_pa") ? (inp.advance_interest_rate_pa ? `${pct(inp.advance_interest_rate_pa)} p.a.` : "interest-free") : said("3.3", 36);
    out.C3.sub = `${n} instalment${n > 1 ? "s" : ""} · interest: ${interest}`;
    out.C3.proof = get("3.2") ?? get("3.1");
    out.C3.status = st("3.2") ?? s31;
  } else if (s31 === "NOT_APPLICABLE") {
    out.C3.headline = "No advance";
    out.C3.sub = val("3.1");
  }

  // C4 delay damages
  if (inp && ok("ld_rate_per_day") && inp.ld_rate_per_day > 0) {
    const perMonth = Math.abs(inp.ld_rate_per_day * 30 - 0.01) < 1e-6;
    const cap = ok("ld_cap") ? (inp.ld_cap != null ? `, cap ${pct(inp.ld_cap)}` : ", no cap") : "";
    out.C4.headline = `${perMonth ? "1%/month" : pct(inp.ld_rate_per_day, 3) + "/day"}${cap}`;
    out.C4.sub = ok("ld_cap") ? val("4.2") : `cap: ${said("4.3", 40)}`;
    out.C4.proof = get("4.2");
  }

  // C5 price variation
  const s51 = st("5.1");
  if (inp && ok("pv_applies")) {
    out.C5.headline = inp.pv_applies ? "Price variation" : "Fixed price";
    out.C5.sub = inp.pv_applies && ok("pv_factor") ? `factor ${inp.pv_factor}` : val("5.1");
  } else if (s51 === "FOUND") {
    const v = val("5.1");
    out.C5.headline = /fixed price|no (general )?(price|escalation)|not applicable/i.test(v) && !/applies|is applicable/i.test(v.split(/[.;]/)[0])
      ? "Fixed price" : /price (variation|adjustment)|escalation/i.test(v) ? "Price variation" : cut(v, 26);
    out.C5.sub = v;
  }
  out.C5.status = s51;

  // C6 guarantees
  if (inp && ok("perf_security_pct") && inp.perf_security_pct > 0) {
    out.C6.headline = `${pct(inp.perf_security_pct)} perf. security`;
    out.C6.sub = ok("perf_security_validity_months_after_completion") && inp.perf_security_validity_months_after_completion
      ? `valid ${inp.perf_security_validity_months_after_completion} months after completion/DLP`
      : `validity: ${said("6.5", 50)}`;
  }
  return out;
}

/** Contract value, duration and defects period for the facts strip. Defaults are never shown as facts. */
export function contractFacts(answers: AnswerEnvelope[], params: CashParams | undefined, fmtMoney: (n: number) => string): Facts {
  const inp = params?.inputs;
  const fromAnswer = (q: string, n = 40): Fact => {
    const e = findQ(answers, q);
    if (!e) return { text: "—", source: "none", proof: null };
    const a = effective(e);
    if (a.status !== "FOUND") return { text: STATUS_HEAD[a.status], source: a.status === "NOT_STATED" ? "none" : "answer", proof: e };
    return { text: cut(a.answer_value, n), source: "answer", proof: e };
  };
  const fromParam = (field: string, q: string, text: (v: number) => string): Fact => {
    const src = usable(params, field);
    if (inp && src) return { text: text(inp[field as keyof typeof inp] as number), source: src, proof: findQ(answers, q) };
    return fromAnswer(q);
  };
  return {
    value: fromParam("contract_value", "0.3", (v) => fmtMoney(v)),
    duration: fromParam("duration_months", "0.4", (v) => `${v} months`),
    dlp: fromParam("dlp_months", "0.5", (v) => `${+v.toFixed(1)} months`),
  };
}

const RANK: Record<Severity, number> = { High: 5, Medium: 4, Low: 3, "Needs review": 2, Info: 1 };

export function worstFlagByClause(flags: RiskFlag[]): Partial<Record<ClauseId, RiskFlag>> {
  const out: Partial<Record<ClauseId, RiskFlag>> = {};
  for (const f of flags) {
    for (const q of f.question_ids) {
      const c = clauseOfQuestion(q);
      if (!out[c] || RANK[f.severity] > RANK[out[c]!.severity]) out[c] = f;
    }
  }
  return out;
}

export function sortFlags(flags: RiskFlag[]): RiskFlag[] {
  return [...flags].sort((a, b) => RANK[b.severity] - RANK[a.severity] || (b.rupee_impact ?? 0) - (a.rupee_impact ?? 0));
}
