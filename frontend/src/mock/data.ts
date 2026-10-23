// MOCK DATA for development without the backend.
// Answers are generated from golden_tests_v1.json (copied to golden.json by `npm run gen-mock`)
// with deterministic, made-up "tool mistakes" so every screen has realistic content.
// Nothing here is a real tool output.
import golden from "./golden.json";
import type {
  Answer, AnswerEnvelope, Benchmark, CashInputs, CashParams, CheckResult, ClauseId, Conflict, Label,
  Package, PageInfo, ParamProvenance, RiskFlag, ScoreSummary, Status, TestScore, Verification,
} from "../types";
import { evenCurve, runCash, sCurve } from "./cashEngine";

export interface GoldenTest {
  test_id: string;
  contract_id: string;
  contract: string;
  pdf_file: string;
  clause_id: ClauseId;
  question_id: string;
  question: string;
  expected_status: Status;
  expected_answer: string;
  expected_unit: string;
  section_ref: string;
  pdf_page: number | null;
  verbatim_quote: string;
  core: boolean;
  accept_also_status: string[];
  scanned_or_visual_only: boolean;
  notes: string;
}

export const GOLDEN: GoldenTest[] = (golden as { tests: GoldenTest[] }).tests;

export const BENCH_TITLES: Record<string, string> = {
  BM1: "NHAI Makhu Town EPC Agreement",
  BM2: "IIT Bombay Chemistry Lab Tender",
  BM3: "MP Agro Gwalior Tender",
  BM4: "MoEF Zoological Park NIT",
};
const BENCH_FILES: Record<string, string> = {
  BM1: "BM1_NHAI_Makhu_Town_EPC_Agreement.pdf",
  BM2: "BM2_IIT_Bombay_Chemistry_Lab_Tender.pdf",
  BM3: "BM3_MP_Agro_Gwalior_Tender.pdf",
  BM4: "BM4_MoEF_Zoological_Park_NIT.pdf",
};
const BENCH_PAGES: Record<string, number> = { BM1: 312, BM2: 146, BM3: 92, BM4: 48 };

/** Deterministic pseudo-random in [0,1) from a string. */
export function h01(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return ((x >>> 0) % 10000) / 10000;
}

type Outcome = { label: Label; cause: string };

function outcomeFor(t: GoldenTest): Outcome {
  const h = h01(t.test_id + "outcome");
  const exp = t.expected_status;
  if (t.contract_id === "BM1" && t.core) return { label: "Correct", cause: "" };
  if (exp === "NOT_STATED") {
    if (h < 0.09) return { label: "Wrongly present", cause: "INVENTED_VALUE" };
    return { label: "Correct absent", cause: "" };
  }
  if (exp === "FOUND") {
    if (h < 0.05) return { label: "Missed", cause: ["RETRIEVAL_MISSED", "TERM_NOT_RECOGNISED", "REFERENCE_NOT_FOLLOWED"][Math.floor(h * 60) % 3] };
    if (h < 0.12) return { label: "Partial", cause: ["ONE_OF_MANY_NUMBERS", "WRONG_BASE_OR_UNIT"][Math.floor(h * 100) % 2] };
    if (h < 0.17) return { label: "Incorrect", cause: ["RATE_CAP_MIXED", "SCHEDULE_NOT_USED", "TEXT_LAYER_MISSED_STRIKE", "CONFLICT_MISSED"][Math.floor(h * 100) % 4] };
    return { label: "Correct", cause: "" };
  }
  if (h < 0.12) return { label: "Incorrect", cause: exp === "POINTS_ELSEWHERE" ? "REFERENCE_NOT_FOLLOWED" : "NEGATIVE_MISREAD" };
  return { label: "Correct", cause: "" };
}

function valueSourceOf(ref: string): Answer["value_source"] {
  const r = ref.toLowerCase();
  if (r.includes("schedule")) return "schedule";
  if (r.includes("contract data")) return "contract_data";
  if (r.includes("annexure")) return "annexure";
  if (r.includes("corrigend") || r.includes("amend")) return "amendment";
  if (!r) return "";
  return "clause";
}

function baseOf(unit: string, answer: string): string {
  const m = (unit || answer).match(/of (the )?([A-Za-z ]*(price|value|bill|amount|payment|work)[A-Za-z ]*)/i);
  return m ? m[2].trim() : "";
}

function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:\.\d+)?/g) || []).filter((n) => n.length < 9);
}

const MOCK_CONFLICTS: Record<string, Conflict[]> = {
  "BM1-0.6": [{ value: "Milestone I at day 180", section_ref: "Schedule J worked example", pdf_page: 198, verbatim_quote: "Project Milestone-I shall occur on the date falling on the 180th day", governs: false }],
  "BM2-2.2": [{ value: "5% of tendered value", section_ref: "Schedule E", pdf_page: 105, verbatim_quote: "Security deposit 5% of tendered value", governs: null }],
  "BM3-5.3": [{ value: "Weights 20 / 20", section_ref: "GCC 31 table 2", pdf_page: 57, verbatim_quote: "Percentage of bitumen component 20; percentage of POL component 20", governs: null }],
};

function mutateNumber(s: string): string {
  return s.replace(/\d+(?:\.\d+)?/, (n) => String(+n === 0 ? 1 : +(Number(n) * 2).toFixed(2)));
}

export function buildEnvelope(t: GoldenTest, contractId = t.contract_id): { env: AnswerEnvelope; outcome: Outcome } {
  const o = outcomeFor(t);
  const h = h01(t.test_id + "v");
  let status: Status = t.expected_status;
  let value = t.expected_answer;
  let quote = t.verbatim_quote || "";
  let page = t.pdf_page ?? 0;
  let section = t.section_ref || "";
  if (o.label === "Missed") { status = "NOT_STATED"; value = ""; quote = ""; page = 0; section = ""; }
  if (o.label === "Partial") value = value.split(/;|\. /)[0];
  if (o.label === "Incorrect") {
    if (t.expected_status === "FOUND" && /\d/.test(value)) value = mutateNumber(value);
    else status = t.expected_status === "POINTS_ELSEWHERE" ? "NOT_STATED" : "FOUND";
  }
  if (o.label === "Wrongly present") {
    status = "FOUND";
    value = "30 days (typical value)";
    quote = "shall be paid within 30 days";
    page = 40 + Math.floor(h * 40);
    section = "Clause 7";
  }
  if (status === "NOT_STATED") { quote = ""; }
  const visual = t.scanned_or_visual_only;
  const confidence: Answer["confidence"] = visual ? (h < 0.5 ? "low" : "medium") : status === "POINTS_ELSEWHERE" ? "medium" : h > 0.88 ? "medium" : "high";
  const conflicts = status === "NOT_STATED" ? [] : MOCK_CONFLICTS[t.test_id] ?? [];
  const answer: Answer = {
    contract_id: contractId,
    clause_id: t.clause_id,
    question_id: t.question_id,
    status,
    answer_value: status === "NOT_STATED" ? (value || "Not stated in the package") : value,
    unit: status === "NOT_STATED" ? "" : t.expected_unit || "",
    base: status === "FOUND" ? baseOf(t.expected_unit, value) : "",
    value_source: valueSourceOf(section),
    section_ref: section,
    pdf_page: page,
    verbatim_quote: quote,
    conflicts,
    points_to: status === "POINTS_ELSEWHERE" ? (contractId === "BM4" ? "CPWD GCC 2023 (incorporated by reference, Schedule E)" : "Accepted bid / Letter of Award") : "",
    visual_check: visual ? "done" : "none",
    visual_evidence: visual ? `Page image read (mock): ${t.notes.slice(0, 140)}` : "",
    confidence,
    notes: t.notes.length > 260 ? t.notes.slice(0, 257) + "…" : t.notes,
  };

  // --- verification (mock of F11) ---
  const hasQuote = !!quote;
  const quoteFound = hasQuote ? !(o.label === "Incorrect" && h < 0.3) && o.label !== "Wrongly present" : null;
  const pageOk = hasQuote ? (quoteFound ? h > 0.06 : false) : null;
  const nums = numbersIn(answer.answer_value);
  const numsInQuote = hasQuote && nums.length ? nums.filter((n) => quote.includes(n)).length / nums.length : null;
  const numsOk = numsInQuote === null ? null : numsInQuote >= 0.5;
  const unitOk = status === "FOUND" && /%|day|month|year|rs|inr/i.test(answer.answer_value) ? !!answer.unit || h > 0.3 : null;
  const checks: CheckResult[] = [
    { check: "V1", name: "Quote found in document text", passed: quoteFound, detail: quoteFound === false ? "Closest match 61% (below 90% threshold)" : quoteFound ? "Exact match after whitespace normalising" : "No quote (NOT_STATED)" },
    { check: "V2", name: "Quote is on the stated page", passed: pageOk, detail: pageOk === false ? `Found on page ${page + 1}, answer says ${page}` : pageOk ? `Page ${page}` : "" },
    { check: "V3", name: "Numbers in the answer appear in the quote", passed: numsOk, detail: numsInQuote === null ? "No numbers to check" : `${Math.round(numsInQuote * 100)}% of numbers found in quote` },
    { check: "V4", name: "Base and unit given for every % or period", passed: unitOk, detail: unitOk === false ? "Unit missing" : "" },
    { check: "V5", name: "Status consistent with quote and value", passed: o.label === "Wrongly present" ? false : true, detail: "" },
    { check: "V6", name: "POINTS_ELSEWHERE names its target", passed: status === "POINTS_ELSEWHERE" ? !!answer.points_to : null, detail: answer.points_to },
    { check: "V7", name: "Conflicts reported with governing rule", passed: conflicts.length ? conflicts.some((c) => c.governs !== null) : null, detail: conflicts.length ? `${conflicts.length} other value(s) found` : "" },
    { check: "V8", name: "Schema valid", passed: true, detail: "" },
  ];
  const fails = checks.filter((c) => c.passed === false);
  const verdict: Verification["verdict"] = quoteFound === false ? "fail" : fails.length ? "warn" : "pass";
  const verification: Verification = {
    question_id: t.question_id,
    quote_found: quoteFound,
    found_doc_id: hasQuote ? "d1" : "",
    found_page: pageOk === false ? page + 1 : page,
    page_matches: pageOk,
    checks,
    normalised: {},
    verdict,
    discard: false,
  };

  // --- review queue reasons (F14) ---
  const reasons: string[] = [];
  if (status === "NOT_STATED") reasons.push("Not stated: confirm nothing in the package covers it");
  if (status === "POINTS_ELSEWHERE") reasons.push("Points elsewhere: detail lives in another document");
  if (conflicts.length) reasons.push("Conflicting values in the package");
  if (visual) reasons.push("Read from the page image only");
  if (confidence === "low") reasons.push("Low confidence");
  if (verdict === "fail") reasons.push("Quote not found in the text");
  else if (verdict === "warn") reasons.push(`Verification warning: ${fails.map((f) => f.check).join(", ")}`);

  const env: AnswerEnvelope = {
    question: t.question,
    answer,
    doc_id: "d1",
    verification,
    review: { decision: reasons.length ? "pending" : "not_needed", reasons, user_answer: null, note: "", decided_at: "" },
    raw_call_id: `mock-${t.contract_id}-${t.clause_id}`,
  };
  return { env, outcome: o };
}

export function buildAnswers(contractId: string, asContract?: string): AnswerEnvelope[] {
  const envs = GOLDEN.filter((t) => t.contract_id === contractId).map((t) => buildEnvelope(t, asContract ?? contractId).env);
  // Pretend the team already reviewed a few items so the progress ring is mid-way.
  let n = 0;
  for (const e of envs) {
    if (e.review.decision === "pending" && e.answer.status === "NOT_STATED" && n < 3) {
      e.review = { ...e.review, decision: "accepted", note: "Checked the package: nothing found (mock)", decided_at: "2026-10-23T10:15:00" };
      n++;
    }
  }
  return envs;
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

export function buildPackage(contractId: string): Package {
  const pages = BENCH_PAGES[contractId] ?? 60;
  const tests = GOLDEN.filter((t) => t.contract_id === contractId);
  const visualPages = new Set(tests.filter((t) => t.scanned_or_visual_only && t.pdf_page).map((t) => t.pdf_page as number));
  const quotesByPage = new Map<number, string>();
  tests.forEach((t) => { if (t.pdf_page && t.verbatim_quote) quotesByPage.set(t.pdf_page, t.verbatim_quote); });
  const choicePages: Record<string, number[]> = { BM2: [109, 110], BM4: [23, 24], BM3: [64] };
  const formulaPages: Record<string, number[]> = { BM1: [113, 114, 115] };
  const scanPages: Record<string, number[]> = { BM1: [1], BM2: [140, 141, 142, 143], BM3: [1, 2], BM4: [44, 45, 46] };
  const pageInfos: PageInfo[] = Array.from({ length: pages }, (_, i) => {
    const p = i + 1;
    const h = h01(contractId + ":" + p);
    const scan = (scanPages[contractId] ?? []).includes(p);
    const choice = (choicePages[contractId] ?? []).includes(p);
    const formula = (formulaPages[contractId] ?? []).includes(p);
    const char = scan ? Math.floor(h * 40) : Math.floor(1400 + h * 2600 - (p % 17 === 0 ? 1200 : 0));
    const reasons: string[] = [];
    if (scan) reasons.push("Almost no text layer (scan or image page)");
    if (choice) reasons.push("Choice field 'Yes/No' or 'Applicable/Not Applicable'");
    if (formula) reasons.push("Image near formula words");
    if (visualPages.has(p) && !reasons.length) reasons.push("Answer depends on what the page looks like");
    const strike = choice && contractId === "BM2" ? [{ word: p === 109 ? "No" : "Applicable", bbox: [320, 410, 345, 422], context: p === 109 ? "Yes/No" : "Applicable/Not Applicable" }] : [];
    return {
      doc_id: "d1",
      page: p,
      text: quotesByPage.get(p) ?? (scan ? "" : `MOCK page ${p} text …`),
      char_count: char,
      image_count: scan || formula ? 1 : h > 0.93 ? 1 : 0,
      low_text: scan,
      garbled: contractId === "BM2" && p >= 140,
      choice_fields: choice ? [p % 2 ? "Yes/No" : "Applicable/Not Applicable"] : [],
      strike_hits: strike,
      formula_image: formula,
      needs_visual: reasons.length > 0,
      visual_reasons: reasons,
    };
  });
  const missing: Package["missing_references"] = [];
  if (contractId === "BM1") {
    missing.push({ label: "Schedule H (stage payment weights) - pages blank in this draft", doc_id: "d1", page: 106, quote: "the stage payment shall be determined on the basis of the weightages specified in Schedule-H" });
    missing.push({ label: "Accepted bid (Contract Price is blank)", doc_id: "d1", page: 102, quote: "for an amount of INR … … … …" });
  }
  if (contractId === "BM4") missing.push({ label: "CPWD General Conditions of Contract 2023 (incorporated by reference)", doc_id: "d1", page: 21, quote: "General Conditions of Contract for CPWD works 2023 … shall form part of the contract" });
  if (contractId === "BM3") missing.push({ label: "Bid Data Sheet portal printout (image only)", doc_id: "d1", page: 2, quote: "" });
  return {
    package_id: contractId,
    contract_id: contractId,
    title: BENCH_TITLES[contractId] ?? contractId,
    files: [{
      doc_id: "d1",
      filename: BENCH_FILES[contractId] ?? `${contractId}.pdf`,
      path: `Benchmark Contracts/${BENCH_FILES[contractId] ?? contractId}`,
      tag: contractId === "BM1" ? "gcc" : "notice",
      sha256: Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[Math.floor(h01(contractId + i) * 16)]).join(""),
      page_count: pages,
    }],
    pages: pageInfos,
    missing_references: missing,
    created_at: "2026-10-23T09:00:00",
  };
}

export const BENCHMARKS: Benchmark[] = ["BM1", "BM2", "BM3", "BM4"].map((c) => ({ contract_id: c, title: BENCH_TITLES[c], package_id: c, has_run: true }));

// ---------------------------------------------------------------------------
// Cash parameters (Interface B)
// ---------------------------------------------------------------------------

function base(V: number, T: number, curve: "even" | "s"): CashInputs {
  return {
    contract_value: V, duration_months: T, progress: curve === "s" ? sCurve(T) : evenCurve(T), cost_share: 0.85,
    supplier_credit_days: 0, overdraft_rate_pa: 0.105, bank_rate_pa: 0.0625, bg_commission_pa: 0.015, delay_days: 60,
    index_rise_pa: { labour: 0.06, cement: 0.05, steel: 0.08, fuel: 0.07, bitumen: 0.06 },
    cert_lag_days: 0, pay_lag_days: 30, min_bill_value: 0, late_interest_rate_pa: 0,
    retention_rate: 0, retention_cap: null, retention_release: [{ share: 1, months_after_completion: 0.5 }], dlp_months: 12,
    advance_instalments: [], advance_recovery_rate: 0, advance_recovery_deadline: null, advance_interest_rate_pa: 0,
    ld_rate_per_day: 0, ld_cap: null, ld_grace_days: 0, pv_applies: false, pv_factor: 0.85, pv_weights: {},
    perf_security_pct: 0, perf_security_validity_months_after_completion: 0,
  };
}

const PARAM_SPECS: Record<string, { inputs: Partial<CashInputs>; V: number; T: number; curve: "even" | "s"; prov: [string, ParamProvenance["source"], string][] }> = {
  BM1: {
    V: 250e7, T: 24, curve: "s",
    inputs: {
      cert_lag_days: 15, pay_lag_days: 30, late_interest_rate_pa: 0.0925, retention_rate: 0.06, retention_cap: 0.05,
      retention_release: [{ share: 1, months_after_completion: 0.5 }], dlp_months: 60,
      advance_instalments: [{ share_of_value: 0.05, month: 1 }, { share_of_value: 0.05, month: 3 }], advance_recovery_rate: 0.15,
      advance_recovery_deadline: 0.8, advance_interest_rate_pa: 0.0925, ld_rate_per_day: 0.0005, ld_cap: 0.1, ld_grace_days: 0,
      pv_applies: true, pv_factor: 0.85, pv_weights: { labour: 0.2, cement: 0.05, fuel: 0.15, bitumen: 0.15 }, perf_security_pct: 0.03,
      perf_security_validity_months_after_completion: 2,
    },
    prov: [["contract_value", "user", "0.3"], ["duration_months", "extracted", "0.4"], ["progress", "user", ""], ["cost_share", "user", ""],
      ["cert_lag_days", "extracted", "1.2"], ["pay_lag_days", "extracted", "1.3"], ["late_interest_rate_pa", "extracted", "1.4"],
      ["min_bill_value", "extracted", "1.6"], ["retention_rate", "extracted", "2.2"], ["retention_cap", "extracted", "2.3"],
      ["retention_release", "extracted", "2.5"], ["dlp_months", "extracted", "0.5"], ["advance_instalments", "extracted", "3.2"],
      ["advance_recovery_rate", "extracted", "3.4"], ["advance_recovery_deadline", "extracted", "3.4"], ["advance_interest_rate_pa", "extracted", "3.3"],
      ["ld_rate_per_day", "extracted", "4.2"], ["ld_cap", "extracted", "4.3"], ["pv_applies", "extracted", "5.1"], ["pv_factor", "extracted", "5.2"],
      ["pv_weights", "extracted", "5.3"], ["perf_security_pct", "extracted", "6.2"], ["perf_security_validity_months_after_completion", "extracted", "6.5"],
      ["overdraft_rate_pa", "user", ""], ["bank_rate_pa", "user", ""], ["bg_commission_pa", "default", ""], ["delay_days", "user", ""], ["index_rise_pa", "user", ""]],
  },
  BM2: {
    V: 21227336, T: 12, curve: "s",
    inputs: {
      cert_lag_days: 10, pay_lag_days: 28, min_bill_value: 30e5, late_interest_rate_pa: 0.05, retention_rate: 0.05, retention_cap: 0.05,
      retention_release: [{ share: 1, months_after_completion: 12 }], dlp_months: 12,
      advance_instalments: [{ share_of_value: 0.05, month: 1 }, { share_of_value: 0.05, month: 3 }], advance_recovery_rate: 0.15,
      advance_interest_rate_pa: 0.1, ld_rate_per_day: 0.01 / 30, ld_cap: 0.1, pv_applies: true, pv_factor: 0.85,
      pv_weights: { labour: 0.25, cement: 0.1, steel: 0.1 }, perf_security_pct: 0.05, perf_security_validity_months_after_completion: 6,
    },
    prov: [["contract_value", "extracted", "0.3"], ["duration_months", "extracted", "0.4"], ["min_bill_value", "extracted", "1.6"],
      ["pay_lag_days", "extracted", "1.3"], ["late_interest_rate_pa", "default", "1.4"], ["retention_rate", "extracted", "2.2"], ["retention_cap", "extracted", "2.3"],
      ["advance_instalments", "extracted", "3.2"], ["advance_interest_rate_pa", "extracted", "3.3"], ["ld_rate_per_day", "extracted", "4.2"],
      ["ld_cap", "extracted", "4.3"], ["pv_applies", "extracted", "5.1"], ["perf_security_pct", "extracted", "6.2"],
      ["overdraft_rate_pa", "user", ""], ["bg_commission_pa", "default", ""], ["delay_days", "user", ""]],
  },
  BM3: {
    V: 1.89e7, T: 9, curve: "even",
    inputs: {
      pay_lag_days: 30, late_interest_rate_pa: 0, retention_rate: 0.05, retention_cap: null, retention_release: [{ share: 1, months_after_completion: 12 }],
      dlp_months: 12, ld_rate_per_day: 0.0005, ld_cap: 0.1, pv_applies: false, perf_security_pct: 0.05, perf_security_validity_months_after_completion: 3,
    },
    prov: [["contract_value", "extracted", "0.3"], ["duration_months", "extracted", "0.4"], ["pay_lag_days", "default", "1.3"],
      ["late_interest_rate_pa", "extracted", "1.4"], ["retention_rate", "extracted", "2.2"], ["retention_cap", "default", "2.3"],
      ["ld_rate_per_day", "extracted", "4.2"], ["ld_cap", "extracted", "4.3"], ["pv_applies", "extracted", "5.1"], ["perf_security_pct", "extracted", "6.2"],
      ["overdraft_rate_pa", "user", ""], ["delay_days", "user", ""]],
  },
  BM4: {
    V: 725065, T: 6, curve: "even",
    inputs: {
      cert_lag_days: 10, pay_lag_days: 28, late_interest_rate_pa: 0, retention_rate: 0.025, retention_cap: 0.025,
      retention_release: [{ share: 1, months_after_completion: 12 }], ld_rate_per_day: 0.01 / 30, ld_cap: 0.1, pv_applies: false, perf_security_pct: 0.05,
      perf_security_validity_months_after_completion: 6,
    },
    prov: [["contract_value", "extracted", "0.3"], ["duration_months", "extracted", "0.4"], ["pay_lag_days", "default", "1.3"], ["cert_lag_days", "default", "1.2"],
      ["retention_rate", "extracted", "2.2"], ["ld_rate_per_day", "default", "4.2"], ["ld_cap", "default", "4.3"], ["pv_applies", "extracted", "5.1"],
      ["perf_security_pct", "extracted", "6.2"], ["overdraft_rate_pa", "user", ""], ["delay_days", "user", ""]],
  },
};

export function buildParams(contractId: string): CashParams {
  const spec = PARAM_SPECS[contractId] ?? PARAM_SPECS.BM1;
  const inputs = { ...base(spec.V, spec.T, spec.curve), ...spec.inputs } as CashInputs;
  const provenance: ParamProvenance[] = spec.prov.map(([field, source, qid]) => {
    const g = qid ? GOLDEN.find((t) => t.contract_id === contractId && t.question_id === qid) : undefined;
    return { field, source, question_id: source === "extracted" ? qid : source === "default" && qid ? qid : "", quote: source === "extracted" ? g?.verbatim_quote ?? "" : "", confirmed: false };
  });
  return { inputs, provenance };
}

// ---------------------------------------------------------------------------
// Risk flags (F12) - hand-written mock flags per benchmark
// ---------------------------------------------------------------------------

function q(contractId: string, qid: string) {
  return GOLDEN.find((t) => t.contract_id === contractId && t.question_id === qid);
}

function flag(contractId: string, f: Omit<RiskFlag, "quote" | "section_ref" | "pdf_page"> & { quote?: string }): RiskFlag {
  const g = q(contractId, f.question_ids[0] ?? "");
  return { quote: f.quote ?? g?.verbatim_quote ?? "", section_ref: g?.section_ref ?? "", pdf_page: g?.pdf_page ?? 0, ...f };
}

export function buildFlags(contractId: string): RiskFlag[] {
  const p = buildParams(contractId).inputs;
  const cash = runCash(p, false);
  const V = p.contract_value;
  const M = "Manual for Procurement of Works 2022 (DoE)";
  const flags: Record<string, RiskFlag[]> = {
    BM1: [
      flag("BM1", { flag_id: "R8", title: "Mobilisation advance is interest-bearing", severity: "Medium", category: "risk", rule: "Advance carries interest, or guarantee above 100% of advance", value_found: "10% at Bank Rate + 3% p.a.; e-BG 110%", reference_value: "Need-based; interest-free discouraged", reference_source: M, question_ids: ["3.3", "3.5"], explanation: "You pay interest on the advance and must post a bank guarantee worth more than the advance, so the advance is far less useful as working capital.", rupee_impact: cash.advance_interest }),
      flag("BM1", { flag_id: "R9", title: "Advance recovered fast", severity: "Medium", category: "risk", rule: "Recovery completes before planned work can repay it", value_found: "15% of each bill; repaid before 80% of period", reference_value: "Recovery in line with S-curve", reference_source: "Spec §7 R9 (compare with F13)", question_ids: ["3.4"], explanation: "15% of every bill goes back to the employer from the first bill, which squeezes cash in the early months when costs are highest.", rupee_impact: null }),
      flag("BM1", { flag_id: "R3", title: "Extra security for low bids", severity: "Medium", category: "risk", rule: "Performance security above 3% or additional security applies", value_found: "3% + up to 3% additional", reference_value: "3%", reference_source: "DoE OM 12 Nov 2020", question_ids: ["6.2", "6.8"], explanation: "If your bid is well below the estimate you must post up to another 3% of the bid price as security, doubling guarantee cost.", rupee_impact: 0.03 * V * 0.015 * 3 }),
      flag("BM1", { flag_id: "R14", title: "Guarantee held through a 5-year defects period", severity: "Low", category: "risk", rule: "Guarantee validity tied to extensions or long DLP", value_found: "Valid till 60 days after DLP (5 years)", reference_value: "Completion + 6 months", reference_source: "CPWD GCC 2023", question_ids: ["6.5"], explanation: "The bank guarantee stays live for more than seven years in total, so commission keeps running long after the work ends.", rupee_impact: cash.guarantee_cost }),
      flag("BM1", { flag_id: "R12", title: "Termination when damages hit the cap", severity: "Medium", category: "risk", rule: "Progress-linked termination or heavy withholding", value_found: "Default and termination above 10% damages", reference_value: "No standard reference", reference_source: "Read from clause", question_ids: ["4.3"], explanation: "Once delay damages reach 10% of the price (200 days late) the employer may treat you as in default and terminate.", rupee_impact: 0.1 * V }),
      flag("BM1", { flag_id: "R2", title: "Retention rate above its cap", severity: "Info", category: "risk", rule: "Deduction rate higher than stated cap", value_found: "6% per bill, cap 5% of price", reference_value: "Effective 5% of price", reference_source: "Spec §7 R2", question_ids: ["2.2", "2.3"], explanation: "6% comes off each bill until 5% of the price is held (around month 20); after that bills are paid without retention.", rupee_impact: cash.retention_locked_max }),
      flag("BM1", { flag_id: "R18", title: "Schedule H stage weights not in the package", severity: "Needs review", category: "unclear", rule: "Schedules referred to but not supplied", value_found: "Schedule H blank", reference_value: "", reference_source: "", question_ids: ["1.1"], explanation: "Stage payment percentages live in Schedule H, which is blank in this draft; the billing pattern is assumed.", rupee_impact: null }),
      flag("BM1", { flag_id: "R17", title: "Contract price left blank", severity: "Needs review", category: "unclear", rule: "POINTS_ELSEWHERE and target not in package", value_found: "INR … (blank)", reference_value: "", reference_source: "", question_ids: ["0.3"], explanation: "The price is filled from the accepted bid; the cash model uses your entered contract value.", rupee_impact: null }),
      flag("BM1", { flag_id: "R16", title: "Milestone I date differs", severity: "Needs review", category: "unclear", rule: "Two places give different values", value_found: "Day 145 vs day 180", reference_value: "", reference_source: "", question_ids: ["0.6"], explanation: "Schedule J says day 145 but a worked example says day 180; confirm which governs.", rupee_impact: null }),
    ],
    BM2: [
      flag("BM2", { flag_id: "R13", title: "High minimum bill value", severity: "Medium", category: "risk", rule: "Minimum interim bill above one planned month of billing", value_found: "Rs 30 lakh", reference_value: `~Rs ${(V / 12 / 1e5).toFixed(0)} lakh per month planned`, reference_source: "Your S-curve (F13)", question_ids: ["1.6"], explanation: "In slow months you cannot bill until Rs 30 lakh of work is done, so payment waits longer.", rupee_impact: null }),
      flag("BM2", { flag_id: "R3", title: "Performance guarantee 5%", severity: "Medium", category: "risk", rule: "Performance security above 3%", value_found: "5% of tendered amount", reference_value: "3%", reference_source: "DoE OM 12 Nov 2020", question_ids: ["6.2"], explanation: "Guarantee is above the 3% the 2020 order recommends, so more bank limit is blocked.", rupee_impact: 0.02 * V }),
      flag("BM2", { flag_id: "R1", title: "Security deposit plus guarantee 10%", severity: "Medium", category: "risk", rule: "Retention cap above 5% or held to end of DLP", value_found: "5% SD + 5% PG; SD released after DLP", reference_value: "5%, half at taking-over", reference_source: M, question_ids: ["2.2"], explanation: "Security deposit is held for the whole defects period with no stage release.", rupee_impact: cash.retention_financing_cost }),
      flag("BM2", { flag_id: "R8", title: "Advance carries 10% interest", severity: "Medium", category: "risk", rule: "Advance is interest-bearing", value_found: "10% simple interest", reference_value: "Need-based", reference_source: M, question_ids: ["3.3"], explanation: "The mobilisation advance costs 10% a year until recovered.", rupee_impact: cash.advance_interest }),
      flag("BM2", { flag_id: "R16", title: "Price variation switched by strike-through", severity: "Needs review", category: "unclear", rule: "Answer depends on a visual read", value_found: "10CA off, 10CC on", reference_value: "", reference_source: "", question_ids: ["5.1"], explanation: "Schedule F choices are struck through on the page image; confirm the reading.", rupee_impact: null }),
    ],
    BM3: [
      flag("BM3", { flag_id: "R6", title: "No interest on late payment", severity: "High", category: "risk", rule: "'No interest payable' or silent", value_found: "No interest payable", reference_value: "Interest after 45 days", reference_source: "CPWD GCC 2023", question_ids: ["1.4"], explanation: "If the employer pays late you carry the cost yourself; there is no compensation at all.", rupee_impact: cash.overdraft_interest * 0.4 }),
      flag("BM3", { flag_id: "R12", title: "Withholding for milestone slippage", severity: "Medium", category: "risk", rule: "Large percentages withheld for missed milestones", value_found: "2.5% to 10% of unexecuted work", reference_value: "", reference_source: "Read from clause", question_ids: ["4.2"], explanation: "Missing a milestone lets the employer hold back up to 10% of the remaining work value.", rupee_impact: 0.05 * V }),
      flag("BM3", { flag_id: "R3", title: "Performance security 5% (+5% road works)", severity: "Medium", category: "risk", rule: "Performance security above 3%", value_found: "5% + 5% additional", reference_value: "3%", reference_source: "DoE OM 12 Nov 2020", question_ids: ["6.2"], explanation: "Up to 10% of the contract can be tied up in guarantees.", rupee_impact: 0.07 * V }),
      flag("BM3", { flag_id: "R11", title: "Price adjustment only above Rs 10 crore", severity: "Info", category: "risk", rule: "Applies only above a size this contract does not reach", value_found: "Gate Rs 10 crore; tender Rs 1.89 crore", reference_value: "", reference_source: "Read from clause", question_ids: ["5.1"], explanation: "The contract is effectively fixed price; short duration keeps exposure small.", rupee_impact: cash.escalation_amount }),
      flag("BM3", { flag_id: "R7", title: "Payment period not stated", severity: "Needs review", category: "unclear", rule: "Payment period above 30 days or not stated", value_found: "Not stated", reference_value: "30 days", reference_source: "NHAI / CPWD practice", question_ids: ["1.3"], explanation: "Neither certification nor payment days are given, so payment timing is open.", rupee_impact: null }),
    ],
    BM4: [
      flag("BM4", { flag_id: "R12", title: "1.25% withheld per missed milestone", severity: "Medium", category: "risk", rule: "Heavy withholding for missed milestones", value_found: "1.25% of tendered amount each", reference_value: "", reference_source: "Read from clause", question_ids: ["4.2"], explanation: "Four milestones; each miss withholds 1.25% of the contract amount.", rupee_impact: 0.05 * V }),
      flag("BM4", { flag_id: "R3", title: "Performance guarantee 5%", severity: "Medium", category: "risk", rule: "Performance security above 3%", value_found: "5% of tendered amount", reference_value: "3%", reference_source: "DoE OM 12 Nov 2020", question_ids: ["6.2"], explanation: "Above the 3% recommended in 2020.", rupee_impact: 0.02 * V }),
      flag("BM4", { flag_id: "R8", title: "No mobilisation advance", severity: "Medium", category: "risk", rule: "No mobilisation advance", value_found: "Clause 10B(ii) not applicable", reference_value: "Need-based", reference_source: M, question_ids: ["3.1"], explanation: "All start-up costs are funded by you until the first bill is paid.", rupee_impact: null }),
      flag("BM4", { flag_id: "R18", title: "CPWD GCC 2023 not in the package", severity: "Needs review", category: "unclear", rule: "Conditions referred to but not supplied", value_found: "Incorporated by reference", reference_value: "", reference_source: "", question_ids: ["1.3"], explanation: "Payment days, delay rate and many other terms live in the GCC; upload it to resolve them.", rupee_impact: null }),
      flag("BM4", { flag_id: "R17", title: "Delay damages rate points to GCC", severity: "Needs review", category: "unclear", rule: "POINTS_ELSEWHERE and target missing", value_found: "GCC clause 2", reference_value: "Up to 1% per month, cap 10%", reference_source: "CPWD GCC 2023", question_ids: ["4.2"], explanation: "The cash model uses the GCC default (1% per month) until confirmed.", rupee_impact: null }),
    ],
  };
  return flags[contractId] ?? flags.BM1;
}

// ---------------------------------------------------------------------------
// Evaluation (F15)
// ---------------------------------------------------------------------------

export function buildScore(): ScoreSummary {
  const tests: TestScore[] = GOLDEN.map((t) => {
    const { env, outcome } = buildEnvelope(t);
    return {
      test_id: t.test_id,
      contract_id: t.contract_id,
      question_id: t.question_id,
      clause_id: t.clause_id,
      core: t.core,
      expected_status: t.expected_status,
      tool_status: env.answer.status,
      expected_answer: t.expected_answer,
      tool_answer: env.answer.status === "NOT_STATED" && outcome.label !== "Correct absent" ? "" : env.answer.answer_value,
      label: outcome.label,
      reason: outcome.label === "Partial" ? "Missing part of a multi-part answer" : outcome.label === "Incorrect" ? "Number or status differs" : outcome.label === "Missed" ? "Tool said NOT_STATED" : outcome.label === "Wrongly present" ? "Value given where key says not stated" : "",
      cause_code: outcome.cause,
      quote_verified: env.verification?.quote_found ?? null,
      needs_human_check: t.scanned_or_visual_only,
    };
  });
  const counts: Record<string, number> = {};
  const byContract: Record<string, Record<string, number>> = {};
  const byClause: Record<string, Record<string, number>> = {};
  for (const s of tests) {
    counts[s.label] = (counts[s.label] ?? 0) + 1;
    (byContract[s.contract_id] ??= {})[s.label] = (byContract[s.contract_id][s.label] ?? 0) + 1;
    (byClause[s.clause_id] ??= {})[s.label] = (byClause[s.clause_id][s.label] ?? 0) + 1;
  }
  const given = tests.filter((s) => s.tool_status !== "NOT_STATED");
  const correctGiven = given.filter((s) => s.label === "Correct").length;
  const inKey = tests.filter((s) => s.expected_status !== "NOT_STATED");
  const correctInKey = inKey.filter((s) => s.label === "Correct").length;
  const core = tests.filter((s) => s.core);
  const quoted = tests.filter((s) => s.quote_verified !== null);
  return {
    run_id: "mock-eval-20261023",
    counts,
    by_contract: byContract,
    by_clause: byClause,
    precision: given.length ? correctGiven / given.length : 0,
    recall: inKey.length ? correctInKey / inKey.length : 0,
    core_pass_rate: core.length ? core.filter((s) => s.label === "Correct" || s.label === "Correct absent").length / core.length : 0,
    quote_verification_rate: quoted.length ? quoted.filter((s) => s.quote_verified).length / quoted.length : 0,
    hallucinations: tests.filter((s) => s.label === "Wrongly present" || s.cause_code === "INVENTED_VALUE").length,
    tests,
  };
}
