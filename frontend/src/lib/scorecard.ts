// Red flags / green flags: one row per risk rule from GET /runs/{id}/checks, with the flag details from /flags.
// If /checks is not available (older backend), the scorecard is built from /flags alone.
import type { Answer, ClauseId, RiskFlag, RuleCheck } from "../types";
import { clauseOf, type Tone } from "./terms";

/** Short (≤ 6 words) name for a rule when it fires. */
const RED_LABEL: Record<string, string> = {
  R1: "Retention high or held long",
  R2: "Retention rate above its cap",
  R3: "High performance guarantee",
  R4: "Delay penalty high or uncapped",
  R5: "No extension of time",
  R6: "No interest on late payment",
  R7: "Slow or unclear payment",
  R8: "Costly advance",
  R9: "Advance recovered too fast",
  R10: "Long fixed-price exposure",
  R11: "Gaps in price adjustment",
  R12: "Withholding or termination risk",
  R13: "High minimum bill",
  R14: "Guarantee renewed on extensions",
  R15: "Conditions on payment",
  R16: "Conflicting values",
  R17: "Terms in another document",
  R18: "Documents not supplied",
};

/** Neutral names for rules that need a person to confirm (unclear, not a risk as such). */
const CONFIRM_LABEL: Record<string, string> = {
  R6: "Late-payment interest unclear",
  R7: "Payment time unclear",
};

export interface Row {
  id: string;
  label: string;
  severity: string;
  tone: Tone;
  flags: RiskFlag[];
  check?: RuleCheck;
  rupee: number | null;
  question_ids: string[];
}

export interface Scorecard {
  red: Row[];
  green: Row[];
  notChecked: Row[];
  confirm: Row[];
  tally: { serious: number; watch: number; fine: number; notChecked: number; confirm: number };
  /** true when /checks answered; otherwise passes are unknown */
  hasChecks: boolean;
}

const RANK: Record<string, number> = { High: 5, Medium: 4, Low: 3, "Needs review": 2, Info: 1, "": 0 };

function redLabel(id: string, flags: RiskFlag[], fallback: string): string {
  if (id === "R8") return flags.some((f) => /^no (mobilisation )?advance/i.test(f.explanation)) ? "No advance given" : "Costly advance";
  return RED_LABEL[id] ?? fallback;
}

function toneOf(sev: string): Tone {
  return sev === "High" ? "bad" : sev === "Medium" || sev === "Low" ? "warn" : "none";
}

export function scorecard(checks: RuleCheck[] | undefined, flags: RiskFlag[]): Scorecard {
  const byId = new Map<string, RiskFlag[]>();
  flags.forEach((f) => byId.set(f.flag_id, [...(byId.get(f.flag_id) ?? []), f]));
  const rows: Row[] = [];
  if (checks && checks.length) {
    for (const c of checks) {
      const fs = byId.get(c.flag_id) ?? [];
      const sev = c.result === "flag" ? (c.severity || fs.reduce((a, f) => (RANK[f.severity] > RANK[a] ? f.severity : a), "" as string)) : "";
      rows.push({
        id: c.flag_id, check: c, flags: fs, severity: sev, tone: c.result === "pass" ? "good" : toneOf(sev),
        label: c.result === "flag" ? redLabel(c.flag_id, fs, c.label) : c.result === "pass" ? c.label : RED_LABEL[c.flag_id] ?? c.label,
        rupee: fs.reduce<number | null>((m, f) => (f.rupee_impact != null && f.rupee_impact > (m ?? 0) ? f.rupee_impact : m), null),
        question_ids: [...new Set([...c.question_ids, ...fs.flatMap((f) => f.question_ids)])],
      });
    }
  } else {
    for (const [id, fs] of byId) {
      const sev = fs.reduce((a, f) => (RANK[f.severity] > RANK[a] ? f.severity : a), "" as string);
      rows.push({
        id, flags: fs, severity: sev, tone: toneOf(sev), label: redLabel(id, fs, fs[0].title),
        rupee: fs.reduce<number | null>((m, f) => (f.rupee_impact != null && f.rupee_impact > (m ?? 0) ? f.rupee_impact : m), null),
        question_ids: [...new Set(fs.flatMap((f) => f.question_ids))],
      });
    }
  }
  const isRed = (r: Row) => (r.check ? r.check.result === "flag" : true) && ["High", "Medium", "Low"].includes(r.severity);
  const red = rows.filter(isRed).sort((a, b) => RANK[b.severity] - RANK[a.severity] || (b.rupee ?? 0) - (a.rupee ?? 0));
  const green = rows.filter((r) => r.check?.result === "pass");
  const notChecked = rows.filter((r) => r.check?.result === "not_checked");
  const confirm = rows.filter((r) => !isRed(r) && (r.check ? r.check.result === "flag" : true))
    .map((r) => ({ ...r, label: CONFIRM_LABEL[r.id] ?? r.label }));
  return {
    red, green, notChecked, confirm, hasChecks: !!checks?.length,
    tally: {
      serious: red.filter((r) => r.severity === "High").length,
      watch: red.filter((r) => r.severity !== "High").length,
      fine: green.length,
      notChecked: notChecked.length,
      confirm: confirm.length,
    },
  };
}

/** Card dot: worst red flag on the clause; else grey if the main answer is not here; else green if a rule passed, grey if none checked. */
export function cardTone(c: ClauseId, sc: Scorecard, main: Answer | null): Tone {
  let tone: Tone | null = null;
  for (const r of sc.red) {
    if (!r.question_ids.some((q) => clauseOf(q) === c)) continue;
    if (r.tone === "bad") tone = "bad";
    else if (tone !== "bad") tone = "warn";
  }
  if (tone) return tone;
  if (!main || main.status === "NOT_STATED" || main.status === "POINTS_ELSEWHERE") return "none";
  if (!sc.hasChecks) return "good";
  return sc.green.some((r) => r.question_ids.some((q) => clauseOf(q) === c)) ? "good" : "none";
}

/** Why a rule could not be checked, in ≤ 4 words. */
export function notCheckedWhy(r: Row): string {
  const t = r.check?.reason ?? "";
  if (/POINTS_ELSEWHERE|not in the package|another document/i.test(t)) return "in another document";
  if (/no advance/i.test(t)) return "no advance";
  if (/'off'|switched off|not applicable/i.test(t)) return "clause switched off";
  if (/NOT_STATED|not stated/i.test(t)) return "not stated";
  return "not enough data";
}
