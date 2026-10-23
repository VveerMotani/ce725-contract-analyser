// Plain-English words for everything the backend says in codes or enums.
// Screens never show FOUND / NOT_STATED / V3 / R9 as text a reader must decode.
import type { ClauseId, Label, ReviewDecision, RiskFlag, RunMeta, Severity, Status } from "../types";
import { isMock } from "../api";

/** The six money terms (and the contract facts), named the way a bid manager says them. */
export const TERM_NAME: Record<ClauseId, string> = {
  C0: "Contract facts",
  C1: "Payment",
  C2: "Retention",
  C3: "Advance",
  C4: "Delay penalty",
  C5: "Price adjustment",
  C6: "Guarantees",
};
export const TERM_SHORT = TERM_NAME;

export const SIX: ClauseId[] = ["C1", "C2", "C3", "C4", "C5", "C6"];

export const STATUS_WORD: Record<Status, string> = {
  FOUND: "Found",
  NOT_STATED: "Not in document",
  POINTS_ELSEWHERE: "In another document",
  NOT_APPLICABLE: "Switched off",
};

export const STATUS_LONG: Record<Status, string> = {
  FOUND: "Found in the document",
  NOT_STATED: "Not in this document",
  POINTS_ELSEWHERE: "In another document",
  NOT_APPLICABLE: "Switched off for this contract",
};

/** Short topic for each of the 52 questions (used where the full question is too long). */
export const TOPIC: Record<string, string> = {
  "0.1": "Type of contract", "0.2": "Employer and contractor", "0.3": "Contract value", "0.4": "Time to complete",
  "0.5": "Defects period", "0.6": "Milestones",
  "1.1": "How often you can bill", "1.2": "Time to certify a bill", "1.3": "Time to pay a bill", "1.4": "Interest on late payment",
  "1.5": "Deductions from each bill", "1.6": "Minimum bill amount", "1.7": "Final bill and payment", "1.8": "Pay only when the employer is paid",
  "2.1": "Is money held back?", "2.2": "Share of each bill held back", "2.3": "Limit on money held back", "2.4": "Bid security and money held back",
  "2.5": "When held-back money is returned", "2.6": "Bank guarantee instead of held-back money", "2.7": "Interest on held-back money",
  "3.1": "Is an advance given?", "3.2": "Size of the advance", "3.3": "Interest on the advance", "3.4": "How the advance is taken back",
  "3.5": "Guarantee for the advance", "3.6": "Advance for machinery or materials", "3.7": "Conditions for the advance",
  "4.1": "Is there a delay penalty?", "4.2": "Delay penalty rate", "4.3": "Limit on the delay penalty", "4.4": "Penalty for missed milestones",
  "4.5": "Extension of time", "4.6": "Penalty as a pre-estimate of loss", "4.7": "Where the penalty is taken from", "4.8": "Other penalties",
  "5.1": "Fixed price or price variation", "5.2": "Price variation formula", "5.3": "Cost shares in the formula", "5.4": "Price indices used",
  "5.5": "Base date for prices", "5.6": "Threshold or limit on price variation", "5.7": "Price variation after the due date",
  "5.8": "Price variation on materials the employer supplies",
  "6.1": "Securities required", "6.2": "Size of each guarantee", "6.3": "Accepted forms of security", "6.4": "Accepted banks",
  "6.5": "How long guarantees stay valid", "6.6": "When the employer can cash a guarantee", "6.7": "When guarantees are returned",
  "6.8": "Extra guarantee for low bids",
};

export function topic(qid: string): string {
  return TOPIC[qid] ?? `Question ${qid}`;
}

// ---------------------------------------------------------------------------
// Runs: who produced the answers
// ---------------------------------------------------------------------------

export type RunSource = "claude" | "replay" | "other";

export function runSource(m: Pick<RunMeta, "model" | "replay"> | undefined): RunSource {
  if (!m) return "other";
  if (m.replay || /answer-key replay/i.test(m.model)) return "replay";
  if (/subagent|claude|opus|sonnet|haiku/i.test(m.model)) return "claude";
  return "other";
}

/** "claude-opus-5-5 (subagent)" -> "Opus 5.5". */
export function modelName(model: string): string {
  const m = model.match(/(opus|sonnet|haiku|fable)[-\s]?(\d+)(?:[-.](\d+))?/i);
  if (!m) return "Claude";
  const fam = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${fam} ${m[2]}${m[3] ? "." + m[3] : ""}`;
}

export function sourceShort(m: RunMeta): string {
  if (isMock()) return "made-up sample data";
  const s = runSource(m);
  if (s === "replay") return "answer-key replay";
  if (s === "claude") return "read by Claude";
  return m.model || "unknown source";
}

/** Small muted tag under the report title. */
export function sourceNote(m: RunMeta): string {
  if (isMock()) return "Sample data · not a real reading";
  const s = runSource(m);
  if (s === "replay") return "Answer-key replay · pipeline test · every value linked to its page";
  if (s === "claude") return `Read by Claude ${modelName(m.model)} · every value linked to its page`;
  return "Every value linked to its page";
}

// ---------------------------------------------------------------------------
// Risk flags
// ---------------------------------------------------------------------------

const RANK: Record<Severity, number> = { High: 5, Medium: 4, Low: 3, "Needs review": 2, Info: 1 };

/** Flags that are real risks (go in "What needs your attention"). Everything else is "Things you should check". */
export function isAttention(f: RiskFlag): boolean {
  return f.category === "risk" && (f.severity === "High" || f.severity === "Medium" || f.severity === "Low");
}

export function sortFlags(flags: RiskFlag[]): RiskFlag[] {
  return [...flags].sort((a, b) => RANK[b.severity] - RANK[a.severity] || (b.rupee_impact ?? 0) - (a.rupee_impact ?? 0));
}

export function severityTone(s: Severity): "bad" | "warn" | "none" {
  if (s === "High") return "bad";
  if (s === "Medium" || s === "Low") return "warn";
  return "none";
}

export function severityWord(s: Severity): string {
  if (s === "High") return "Serious";
  if (s === "Medium") return "Worth a close look";
  if (s === "Low") return "Minor";
  return "";
}

const FLAG_HEADLINE: Record<string, string> = {
  "Fast advance recovery": "The advance is taken back before most of the work is done",
  "Performance security high": "The performance guarantee is high, or an extra one applies",
  "Price variation with holes": "Protection against price rise has gaps",
  "Progress-linked termination or heavy withholding": "Slow progress can cost you money or the contract",
  "Deduction rate above the cap": "Early bills are cut harder than the limit suggests",
  "Unresolved reference": "Some terms sit in a document you do not have",
  "Missing document": "Documents are mentioned but not supplied",
  "High minimum bill": "A bill is paid only after a large amount of work",
  "Retention or security deposit high or uncapped": "Held-back money is large or kept for a long time",
  "Guarantee validity tied to extensions": "Guarantees must be renewed whenever time is extended",
  "No interest on late payment": "No interest if the employer pays late",
  "Slow or unclear payment": "Payment time is slow or not stated",
};

export function flagHeadline(f: RiskFlag): string {
  if (f.title === "No advance, or a costly one") {
    return /^no (mobilisation )?advance/i.test(f.explanation) ? "No advance: you fund the start of the work yourself" : "The advance is costly";
  }
  return FLAG_HEADLINE[f.title] ?? f.title;
}

/** The explanation without the trailing "Money at stake: ..." sentence (shown separately). */
export function flagWhy(f: RiskFlag): string {
  let t = f.explanation.replace(/\s*Money at stake:[^]*$/i, "").trim();
  t = t.replace(/\b(\d+) answer\(s\)/g, (_, n) => (n === "1" ? "1 answer" : `${n} answers`)).replace(/\bdocument\(s\)/g, "documents")
    .replace(/\b1 documents\b/g, "1 document").replace(/\b1 answer depend\b/g, "1 answer depends");
  // "(questions 1.2, 1.3)" -> "(time to certify a bill, time to pay a bill)"
  t = t.replace(/\(questions ([\d., ]+)\)/g, (_, ids: string) => {
    const names = ids.split(/,\s*/).map((q) => topic(q.trim()).toLowerCase());
    return `(${names.join(", ")})`;
  });
  return t;
}

/** "about Rs 10.00 crore (advance taken back ...)" -> "advance taken back ..." */
export function flagStakeWhat(f: RiskFlag): string {
  const m = f.explanation.match(/Money at stake:[^(]*\(([^)]*)\)/i);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// Review reasons and verification checks
// ---------------------------------------------------------------------------

const CHECK_PLAIN: Record<string, string> = {
  V1: "The quoted sentence is in the document",
  V2: "The quote is on the page given",
  V3: "The numbers in the answer are in the quoted sentence",
  V4: "Units are clear (a percentage of what; which kind of days)",
  V5: "References to schedules were followed",
  V6: "No conflicting values",
  V7: "The value is in a sensible range",
  V8: "A second search confirmed it is not in the document",
};

export function checkPlain(id: string, name: string): string {
  return CHECK_PLAIN[id] ?? name;
}

const CHECK_PROBLEM: Record<string, string> = {
  V1: "Quote not found in the document",
  V2: "Quote is on a different page",
  V3: "Some numbers not in the quote",
  V4: "Unit or base unclear",
  V5: "Schedule reference not followed",
  V6: "Conflicting values",
  V7: "Value looks unusual",
  V8: "Absence not confirmed",
};

/** A few words per review reason. */
export function reasonPlain(r: string): string {
  if (r.startsWith("NOT_STATED")) return "Nothing found: confirm the document is silent";
  if (r.startsWith("POINTS_ELSEWHERE")) {
    const m = r.match(/\(([^)]*)\)\s*$/);
    return `In another document${m ? ` (${m[1]})` : ""}`;
  }
  if (r.startsWith("Discarded")) return "Quote not found: answer set aside";
  if (r.startsWith("Conflict")) return "Different values in different places";
  if (r.startsWith("Visual check needed")) return "Page must be read as an image";
  if (r.startsWith("Visual-only")) return "Read from a page image";
  if (r.startsWith("Low confidence")) return "The tool was not sure";
  const m = r.match(/\b(V\d+)\b/);
  if (m) return CHECK_PROBLEM[m[1]] ?? r.replace(/^V\d+\s*/, "");
  return r;
}

export function reasonsPlain(rs: string[]): string[] {
  return [...new Set(rs.map(reasonPlain))];
}

export const DECISION_WORD: Record<ReviewDecision, string> = {
  pending: "To confirm",
  accepted: "You accepted this",
  edited: "You corrected this",
  rejected: "You rejected this",
  not_needed: "",
};

// ---------------------------------------------------------------------------
// Accuracy labels
// ---------------------------------------------------------------------------

export const LABEL_WORD: Record<Label, string> = {
  Correct: "Correct",
  "Correct absent": "Correctly said “not in document”",
  Partial: "Partly right",
  Incorrect: "Wrong",
  Missed: "Missed",
  "Wrongly present": "Gave an answer that is not in the document",
};

export const LABEL_COLOR: Record<Label, string> = {
  Correct: "var(--good)",
  "Correct absent": "var(--absent)",
  Partial: "var(--warn)",
  Incorrect: "var(--bad)",
  Missed: "var(--missed)",
  "Wrongly present": "var(--odd)",
};

export const LABEL_ORDER: Label[] = ["Correct", "Correct absent", "Partial", "Incorrect", "Missed", "Wrongly present"];

export function isRight(l: Label): boolean {
  return l === "Correct" || l === "Correct absent";
}
