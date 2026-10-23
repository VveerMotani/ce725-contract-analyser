// The ONE key number per clause type for the Overview tiles.
// Prefers the structured cash parameters (Interface B, which code has already checked
// against the quotes); falls back to a number pulled from the answer text.
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

function has(p: CashParams | undefined, field: string) {
  return p?.provenance.find((x) => x.field === field)?.source === "extracted";
}

export function keyFigures(answers: AnswerEnvelope[], params?: CashParams): Record<ClauseId, KeyFigure> {
  const inp = params?.inputs;
  const get = (q: string) => findQ(answers, q);
  const st = (q: string) => { const e = get(q); return e ? effective(e).status : null; };
  const val = (q: string) => { const e = get(q); return e ? effective(e).answer_value : ""; };
  const fallback = (c: ClauseId): KeyFigure => {
    const q = KEY_Q[c][0];
    const e = get(q);
    const s = st(q);
    return { clause: c, headline: s && s !== "FOUND" ? STATUS_HEAD[s] : shortValue(val(q)) || "–", sub: e ? effective(e).answer_value : "", status: s, proof: e };
  };
  const out = {} as Record<ClauseId, KeyFigure>;
  (Object.keys(KEY_Q) as ClauseId[]).forEach((c) => (out[c] = fallback(c)));

  // C1 payment: days to pay + late interest
  const payFound = st("1.3") === "FOUND" && !!inp && has(params, "pay_lag_days");
  if (payFound && inp) out.C1.headline = `${Math.round(inp.pay_lag_days)} days`;
  if (inp) {
    const late = `late interest ${inp.late_interest_rate_pa ? pct(inp.late_interest_rate_pa) + " p.a." : "none"}`;
    out.C1.sub = payFound ? `to pay${inp.cert_lag_days ? ` · ${Math.round(inp.cert_lag_days)} d to certify` : ""} · ${late}` : late;
  }

  // C2 retention: rate / cap
  if (inp && inp.retention_rate > 0 && st("2.2") === "FOUND") {
    out.C2.headline = inp.retention_cap != null && Math.abs(inp.retention_cap - inp.retention_rate) > 1e-9
      ? `${pct(inp.retention_rate)} / cap ${pct(inp.retention_cap)}` : pct(inp.retention_rate);
    out.C2.sub = `of each bill${inp.retention_cap == null ? " · no cap" : ""} · ${shortValue(val("2.5")) || "release per contract"}`;
    out.C2.proof = get("2.2");
  }

  // C3 advance
  const s31 = st("3.1");
  if (inp) {
    const adv = inp.advance_instalments.reduce((a, b) => a + b.share_of_value, 0);
    if (adv > 0) {
      out.C3.headline = `${pct(adv)} advance`;
      out.C3.sub = `${inp.advance_instalments.length} instalment${inp.advance_instalments.length > 1 ? "s" : ""} · ${inp.advance_interest_rate_pa ? `${pct(inp.advance_interest_rate_pa)} p.a. interest` : "interest-free"}`;
      out.C3.proof = get("3.2") ?? get("3.1");
      out.C3.status = st("3.2") ?? s31;
    } else if (s31 === "NOT_APPLICABLE" || s31 === "FOUND") {
      out.C3.headline = "No advance";
      out.C3.sub = val("3.1");
    }
  }

  // C4 delay damages
  if (inp && inp.ld_rate_per_day > 0) {
    const perMonth = Math.abs(inp.ld_rate_per_day * 30 - 0.01) < 1e-6;
    out.C4.headline = `${perMonth ? "1%/month" : pct(inp.ld_rate_per_day, 3) + "/day"}${inp.ld_cap != null ? `, cap ${pct(inp.ld_cap)}` : ", no cap"}`;
    out.C4.sub = has(params, "ld_rate_per_day") ? "of contract price" : "rate from default / referenced GCC";
    out.C4.proof = get("4.2");
  }

  // C5 price variation
  if (inp && st("5.1")) {
    out.C5.headline = inp.pv_applies ? "Price variation" : "Fixed price";
    out.C5.sub = inp.pv_applies ? `factor ${inp.pv_factor}${Object.keys(inp.pv_weights).length ? ` · ${Object.keys(inp.pv_weights).length} components` : ""}` : val("5.1");
    out.C5.status = st("5.1");
  }

  // C6 guarantees
  if (inp && inp.perf_security_pct > 0) {
    out.C6.headline = `${pct(inp.perf_security_pct)} perf. security`;
    out.C6.sub = inp.perf_security_validity_months_after_completion ? `valid ${inp.perf_security_validity_months_after_completion} months after DLP/completion` : val("6.2");
  }
  return out;
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
