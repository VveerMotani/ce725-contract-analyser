// Plain sentences for the six money terms, built from the effective answers
// (a person's edit if any, else the AI answer). A cash parameter is used only when it was
// extracted from the contract or entered by the user; a default is never shown as a contract fact.
// When the wording is unclear the answer text itself is shown rather than an invented number.
import type { Answer, AnswerEnvelope, CashParams, ClauseId, RiskFlag } from "../types";
import { effective } from "../types";
import { money, pct } from "./format";
import { TERM_NAME, isAttention, severityTone } from "./plain";

export type Tone = "good" | "warn" | "bad" | "none";

export interface TermRow {
  clause: ClauseId;
  name: string;
  sentence: string;
  detail?: string;
  tone: Tone;
  proof: AnswerEnvelope | null;
}

export function clauseOf(qid: string): ClauseId {
  return `C${qid.split(".")[0]}` as ClauseId;
}

export function usable(p: CashParams | undefined, field: string): "extracted" | "user" | null {
  const src = p?.provenance.find((x) => x.field === field)?.source;
  return src === "extracted" || src === "user" ? src : null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** First clause of an answer: cut at "; " or " (" (when that leaves enough), then at `max` characters. */
export function brief(text: string, max = 120): string {
  let s = (text || "").trim().replace(/\s+/g, " ");
  for (const sep of ["; ", " ("]) {
    const i = s.indexOf(sep);
    if (i >= 20) s = s.slice(0, i);
  }
  s = s.replace(/[.;:,]+$/, "");
  if (s.length > max) s = s.slice(0, s.lastIndexOf(" ", max - 1)).replace(/[,;:]$/, "") + "…";
  return s;
}

/** Lower-case the first letter unless the first word looks like an acronym ("NHAI", "EPC"). */
export function lowerFirst(s: string): string {
  if (!s) return s;
  if (/^[A-Z]{2,}/.test(s)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

function upperFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function end(s: string): string {
  return /[.!?…]$/.test(s) ? s : s + ".";
}

export function firstPct(s: string): string {
  const m = (s || "").match(/\d+(\.\d+)?\s?%/);
  return m ? m[0].replace(/\s/, "") : "";
}

export function days(s: string): string {
  const m = (s || "").match(/\b(\d+)\s*(working |business |calendar )?days?\b/i);
  return m ? `${m[1]} ${(m[2] ?? "").toLowerCase()}days` : "";
}

export function rate(s: string): string {
  const br = (s || "").match(/(Bank Rate|Base Rate|MCLR|SBI[^+;,]{0,20})(\s*\([^)]*\))?\s*\+\s*\d+(\.\d+)?\s?%/i);
  if (br) return `${br[0].replace(/\s*\([^)]*\)/, "").replace(/\s+/g, " ").replace(/\s?%/, "%")} a year`;
  const m = (s || "").match(/\d+(\.\d+)?\s?%\s*(a year|per annum|p\.\s?a\.|per year)?/i);
  if (!m) return "";
  return `${m[0].replace(/\s?%/, "%").replace(/per annum|p\.\s?a\.|per year/i, "a year").trim()}`;
}

/** Name of the other document an answer points to, if the text says. */
export function elsewhereTarget(a: Answer): string {
  if (a.points_to) return brief(a.points_to, 70);
  const t = a.answer_value || "";
  const pats = [
    /CPWD GCC \d{4}/i,
    /General Conditions of Contract[^.;,()]*/i,
    /\bGCC \d{4}/i,
    /\bGCC\b[^.;,()]*/,
    /Schedule [A-Z]\b/,
    /Annexure [A-Z0-9]+/,
  ];
  for (const p of pats) {
    const m = t.match(p);
    if (m) return m[0].trim();
  }
  return "";
}

export function elsewhereSentence(a: Answer): string {
  const t = elsewhereTarget(a);
  return t ? `Not in this document — it refers to ${t}.` : "Not in this document — it refers to another document.";
}

function isNo(a: Answer | null): boolean {
  return !!a && (a.status === "NOT_APPLICABLE" || (a.status === "FOUND" && /^\s*no\b/i.test(a.answer_value)));
}

// ---------------------------------------------------------------------------
// The six rows
// ---------------------------------------------------------------------------

export function termRows(answers: AnswerEnvelope[], params: CashParams | undefined, flags: RiskFlag[]): TermRow[] {
  const env = (q: string) => answers.find((e) => e.answer.question_id === q) ?? null;
  const ans = (q: string): Answer | null => { const e = env(q); return e ? effective(e) : null; };
  const inp = params?.inputs;
  const ok = (field: string) => !!inp && usable(params, field) !== null;
  const proofOf = (...qs: string[]) => {
    for (const q of qs) { const a = ans(q); if (a && a.status === "FOUND" && a.pdf_page > 0) return env(q); }
    for (const q of qs) { const a = ans(q); if (a && a.pdf_page > 0) return env(q); }
    return env(qs[0]);
  };

  // --- C1 payment ---------------------------------------------------------
  const c1 = (): Omit<TermRow, "tone" | "clause" | "name"> => {
    const a = ans("1.3"), li = ans("1.4");
    let s: string;
    let detail: string | undefined;
    if (!a || a.status === "NOT_STATED") s = "The contract does not say how soon you are paid.";
    else if (a.status === "POINTS_ELSEWHERE") s = elsewhereSentence(a);
    else if (a.status === "NOT_APPLICABLE") {
      s = "No time limit for paying your bills applies: that clause is switched off for this contract.";
      if (a.answer_value) detail = end(`The contract says: ${lowerFirst(brief(a.answer_value, 140))}`);
    }
    else {
      // Several periods are common ("90% part payment within 10 days; full payment within 30 days"): use the full payment.
      const segs = a.answer_value.split(/;\s*/);
      const main = segs.find((g) => days(g) && !/\bpart\b|final|maintenance|quarter/i.test(g)) ?? segs.find((g) => days(g));
      const d = main ? days(main) : "";
      s = d ? `You are paid within ${d} of each bill.` : end(`Payment: ${brief(a.answer_value)}`);
      const part = segs.find((g) => /part payment/i.test(g) && g !== main);
      if (d && part) detail = end(`Part payment: ${lowerFirst(brief(part, 110))}`);
    }
    let t = "";
    if (li?.status === "FOUND") {
      if (/\bno interest\b|not payable|\bnil\b/i.test(li.answer_value)) t = "No interest is paid if they pay late.";
      else { const r = rate(li.answer_value); t = r ? `If they pay late, you get interest of ${r}.` : end(`Late payment: ${brief(li.answer_value)}`); }
    } else if (li?.status === "NOT_STATED") t = "Nothing is said about interest on late payment.";
    else if (li?.status === "POINTS_ELSEWHERE" && a?.status !== "POINTS_ELSEWHERE") t = "Interest on late payment is in another document.";
    return { sentence: [s, t].filter(Boolean).join(" "), detail, proof: proofOf("1.3", "1.4") };
  };

  // --- C2 retention -------------------------------------------------------
  const c2 = (): Omit<TermRow, "tone" | "clause" | "name"> => {
    const a1 = ans("2.1"), a = ans("2.2"), cap = ans("2.3"), rel = ans("2.5");
    if (isNo(a1)) return { sentence: "Nothing is held back from your bills.", proof: proofOf("2.1") };
    if (!a || a.status === "NOT_STATED") return { sentence: "The contract does not say how much is held back from each bill.", proof: proofOf("2.1", "2.2") };
    if (a.status === "POINTS_ELSEWHERE") return { sentence: elsewhereSentence(a), proof: proofOf("2.2") };
    if (a.status === "NOT_APPLICABLE") return { sentence: "Nothing is held back from your bills.", proof: proofOf("2.2") };
    const r = ok("retention_rate") && inp!.retention_rate > 0 ? pct(inp!.retention_rate) : firstPct(a.answer_value);
    let s = r ? `${r} of every bill is held back` : `Held back from each bill: ${brief(a.answer_value)}`;
    if (cap?.status === "FOUND") {
      if (/no (separate )?(cap|limit|ceiling|maximum)/i.test(cap.answer_value)) s += ", with no upper limit stated";
      else {
        const c = ok("retention_cap") && inp!.retention_cap != null ? pct(inp!.retention_cap) : firstPct(cap.answer_value);
        if (c && c !== r) s += `, up to ${c} of the contract value`;
      }
    } else if (cap?.status === "NOT_STATED") s += ", with no upper limit stated";
    s = end(s);
    if (rel?.status === "FOUND") s += " " + end(`Returned: ${lowerFirst(brief(rel.answer_value, 110))}`);
    else if (rel?.status === "POINTS_ELSEWHERE") s += ` When it is returned is in another document${elsewhereTarget(rel) ? ` (${elsewhereTarget(rel)})` : ""}.`;
    else if (rel?.status === "NOT_STATED") s += " The contract does not say when it is returned.";
    return { sentence: s, proof: proofOf("2.2", "2.3", "2.5") };
  };

  // --- C3 advances --------------------------------------------------------
  const c3 = (): Omit<TermRow, "tone" | "clause" | "name"> => {
    const a1 = ans("3.1"), amt = ans("3.2"), intr = ans("3.3"), rec = ans("3.4");
    if (isNo(a1)) return { sentence: "No advance is given, so you pay for mobilisation and the first months of work yourself.", proof: proofOf("3.1") };
    if (!a1 || a1.status === "NOT_STATED") return { sentence: "The contract does not mention an advance.", proof: proofOf("3.1") };
    if (a1.status === "POINTS_ELSEWHERE") return { sentence: elsewhereSentence(a1), proof: proofOf("3.1") };
    const inst = ok("advance_instalments") ? inp!.advance_instalments : [];
    const total = inst.reduce((x, i) => x + i.share_of_value, 0);
    let s: string;
    if (total > 0) s = `You can get an advance of ${pct(total)} of the contract value${inst.length > 1 ? ` in ${inst.length} instalments` : ""}.`;
    else if (amt?.status === "FOUND") s = end(`You can get an advance: ${lowerFirst(brief(amt.answer_value))}`);
    else s = "An advance is given.";
    if (intr?.status === "FOUND") {
      if (/interest[- ]free|no interest|without interest/i.test(intr.answer_value)) s += " It is interest-free.";
      else { const r = rate(intr.answer_value); s += r ? ` It carries interest of ${r}.` : " " + end(`Interest: ${brief(intr.answer_value)}`); }
    }
    const detail = rec?.status === "FOUND" ? end(`Taken back: ${lowerFirst(brief(rec.answer_value, 130))}`) : undefined;
    return { sentence: s, detail, proof: proofOf("3.2", "3.1", "3.3") };
  };

  // --- C4 delay penalty ---------------------------------------------------
  const c4 = (): Omit<TermRow, "tone" | "clause" | "name"> => {
    const a1 = ans("4.1"), a = ans("4.2"), cap = ans("4.3");
    if (isNo(a1)) return { sentence: "There is no penalty for finishing late.", proof: proofOf("4.1") };
    if (!a || a.status === "NOT_STATED") return { sentence: "The contract does not state a penalty rate for finishing late.", proof: proofOf("4.2", "4.1") };
    if (a.status === "POINTS_ELSEWHERE") return { sentence: elsewhereSentence(a), proof: proofOf("4.2") };
    if (a.status === "NOT_APPLICABLE") return { sentence: "There is no penalty for finishing late.", proof: proofOf("4.2") };
    let s: string;
    if (ok("ld_rate_per_day") && inp!.ld_rate_per_day > 0) {
      const r = inp!.ld_rate_per_day;
      const dayPct = r * 100;
      const messyDay = Math.abs(dayPct * 1000 - Math.round(dayPct * 1000)) > 1e-6;
      const monthPct = r * 30 * 100;
      const cleanMonth = Math.abs(monthPct * 100 - Math.round(monthPct * 100)) < 1e-6;
      s = messyDay && cleanMonth
        ? `If you finish late, you pay ${pct(r * 30)} of the contract value for each month of delay`
        : `If you finish late, you pay ${pct(r)} of the contract value for each day of delay`;
    } else s = `If you finish late: ${lowerFirst(brief(a.answer_value))}`;
    if (cap?.status === "FOUND") {
      if (/no (cap|limit|maximum|ceiling)/i.test(cap.answer_value)) s += ", with no upper limit";
      else {
        const c = ok("ld_cap") && inp!.ld_cap != null ? pct(inp!.ld_cap) : firstPct(cap.answer_value);
        if (c) s += `, up to ${c} of the contract value`;
      }
      s = end(s);
    } else if (cap?.status === "NOT_STATED") s = end(s) + " No upper limit is stated.";
    else if (cap?.status === "POINTS_ELSEWHERE") s = end(s) + " The upper limit is in another document.";
    else s = end(s);
    return { sentence: s, proof: proofOf("4.2", "4.3") };
  };

  // --- C5 price variation -------------------------------------------------
  const c5 = (): Omit<TermRow, "tone" | "clause" | "name"> => {
    const a = ans("5.1");
    if (!a || a.status === "NOT_STATED") return { sentence: "The contract does not say whether prices are adjusted when costs rise.", proof: proofOf("5.1") };
    if (a.status === "POINTS_ELSEWHERE") return { sentence: elsewhereSentence(a), proof: proofOf("5.1") };
    if (a.status === "NOT_APPLICABLE") return { sentence: "No protection against price rise: it is a fixed-price contract.", proof: proofOf("5.1") };
    const v = a.answer_value;
    const textApplies = /\b(10CC|10CA|PVC|price variation|price adjustment|escalation)\s+(clause\s+)?(is\s+)?(selected|applicable|applies)\b/i.test(v);
    const textFixed = !textApplies && /fixed price|no (general )?(index|price|escalation)|not applicable|does not apply/i.test(v);
    const applies = ok("pv_applies") ? inp!.pv_applies : !textFixed;
    let s: string;
    if (applies) {
      s = "You are protected against price rise: bills are adjusted with price indices.";
      if (ok("pv_factor") && inp!.pv_factor > 0 && inp!.pv_factor < 1) s += ` The adjustment covers ${pct(inp!.pv_factor)} of the work value.`;
    } else if (textApplies) {
      s = "A price variation clause is printed, but it does not apply to this contract, so in practice the price is fixed and higher costs are yours.";
    } else s = "No protection against price rise: it is a fixed price, so higher material and labour costs are yours.";
    const detail = v.length > 60 ? end(`The contract says: ${lowerFirst(brief(v, 160))}`) : undefined;
    return { sentence: s, detail, proof: proofOf("5.1", "5.2") };
  };

  // --- C6 guarantees ------------------------------------------------------
  const c6 = (): Omit<TermRow, "tone" | "clause" | "name"> => {
    const a = ans("6.2"), val = ans("6.5");
    if (!a || a.status === "NOT_STATED") return { sentence: "The contract does not say how large the guarantees are.", proof: proofOf("6.2", "6.1") };
    if (a.status === "POINTS_ELSEWHERE") return { sentence: elsewhereSentence(a), proof: proofOf("6.2") };
    let ps = ok("perf_security_pct") && inp!.perf_security_pct > 0 ? pct(inp!.perf_security_pct) : "";
    if (!ps) { const m = a.answer_value.match(/performance (security|guarantee)[^;]*?(\d+(\.\d+)?\s?%)/i); ps = m ? m[2].replace(/\s/, "") : ""; }
    let s = ps ? `You must give a performance guarantee of ${ps} of the contract value.` : end(`Guarantees: ${brief(a.answer_value)}`);
    if (val?.status === "FOUND") {
      const parts = val.answer_value.split(/(?:;|\.)\s+/);
      const perf = parts.find((p) => /performance/i.test(p) || /\bPG\b/.test(p));
      if (perf) s += " " + end(upperFirst(brief(perf, 120)));
    }
    return { sentence: s, proof: proofOf("6.2", "6.5") };
  };

  const build: Record<Exclude<ClauseId, "C0">, () => Omit<TermRow, "tone" | "clause" | "name">> = { C1: c1, C2: c2, C3: c3, C4: c4, C5: c5, C6: c6 };
  const MAIN: Record<string, string> = { C1: "1.3", C2: "2.2", C3: "3.1", C4: "4.2", C5: "5.1", C6: "6.2" };

  return (Object.keys(build) as Exclude<ClauseId, "C0">[]).map((c) => {
    const row = build[c]();
    const main = ans(MAIN[c]);
    return { clause: c, name: TERM_NAME[c], ...row, tone: termTone(c, flags, main) };
  });
}

/** Dot colour: the worst risk flag on the clause; grey when the main answer was not found here. */
export function termTone(c: ClauseId, flags: RiskFlag[], main: Answer | null): Tone {
  let tone: Tone | null = null;
  for (const f of flags) {
    if (!isAttention(f)) continue;
    if (!f.question_ids.some((q) => clauseOf(q) === c)) continue;
    const t = severityTone(f.severity);
    if (t === "bad") tone = "bad";
    else if (t === "warn" && tone !== "bad") tone = "warn";
  }
  if (tone) return tone;
  if (!main || main.status === "NOT_STATED" || main.status === "POINTS_ELSEWHERE") return "none";
  return "good";
}

// ---------------------------------------------------------------------------
// Header facts
// ---------------------------------------------------------------------------

export interface HeaderFact { label: string; text: string; note?: string; proof: AnswerEnvelope | null }

export function headerFacts(answers: AnswerEnvelope[], params: CashParams | undefined): HeaderFact[] {
  const env = (q: string) => answers.find((e) => e.answer.question_id === q) ?? null;
  const ans = (q: string) => { const e = env(q); return e ? effective(e) : null; };
  const inp = params?.inputs;
  const out: HeaderFact[] = [];

  const v = ans("0.3");
  const vSrc = usable(params, "contract_value");
  if (inp && vSrc && inp.contract_value > 0) out.push({ label: "Value", text: money(inp.contract_value), note: vSrc === "user" ? "your figure" : undefined, proof: env("0.3") });
  else if (v?.status === "FOUND") {
    const m = v.answer_value.match(/Rs\.?\s?[\d,.]+\s*(lakhs?|lacs?|crores?)?/i);
    out.push({ label: "Value", text: m ? m[0] : brief(v.answer_value, 50), proof: env("0.3") });
  }

  const d = ans("0.4");
  if (d?.status === "FOUND") {
    const m = d.answer_value.match(/\b\d+\s*(days|months|years|weeks)\b/i);
    out.push({ label: "Time to complete", text: m ? m[0] : brief(d.answer_value, 40), proof: env("0.4") });
  } else if (inp && usable(params, "duration_months")) {
    out.push({ label: "Time to complete", text: `${inp.duration_months} months`, note: usable(params, "duration_months") === "user" ? "your figure" : undefined, proof: null });
  }

  const dl = ans("0.5");
  if (dl?.status === "FOUND") {
    const m = dl.answer_value.match(/\b\d+\s*(days|months|years)\b/i);
    if (m) out.push({ label: "Defects period", text: m[0], proof: env("0.5") });
  }
  return out;
}

const ISSUER: Record<string, string> = {
  BM1: "National Highways Authority of India",
  BM2: "IIT Bombay",
  BM3: "MP State Agro Industries Development Corporation",
  BM4: "Ministry of Environment, Forest and Climate Change (CPWD form)",
};

export function issuerOf(contractId: string, answers?: AnswerEnvelope[]): string {
  if (ISSUER[contractId]) return ISSUER[contractId];
  const e = answers?.find((x) => x.answer.question_id === "0.2");
  if (!e) return "";
  const a = effective(e);
  if (a.status !== "FOUND") return "";
  const m = a.answer_value.match(/Employer:\s*([^;]+)/i);
  return brief(m ? m[1] : a.answer_value, 70);
}
