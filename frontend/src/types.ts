// TypeScript mirror of backend/analyser/models.py (the frozen interfaces).
// Keep field names identical to the Pydantic models.

export type ClauseId = "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
export type Status = "FOUND" | "NOT_STATED" | "NOT_APPLICABLE" | "POINTS_ELSEWHERE";
export type DocTag = "notice" | "gcc" | "schedules" | "special" | "amendment" | "boq" | "other";

export const CLAUSE_NAMES: Record<ClauseId, string> = {
  C0: "Contract facts (header)",
  C1: "Payment terms",
  C2: "Retention and security deposit",
  C3: "Advances",
  C4: "Delay damages (liquidated damages)",
  C5: "Price escalation or price variation",
  C6: "Guarantees and securities",
};

export const CLAUSE_SHORT: Record<ClauseId, string> = {
  C0: "Contract facts",
  C1: "Payment",
  C2: "Retention",
  C3: "Advances",
  C4: "Delay damages",
  C5: "Price variation",
  C6: "Guarantees",
};

export const CLAUSE_IDS: ClauseId[] = ["C0", "C1", "C2", "C3", "C4", "C5", "C6"];

// ---------------------------------------------------------------------------
// F1/F2/F3 package
// ---------------------------------------------------------------------------

export interface DocumentFile {
  doc_id: string;
  filename: string;
  path: string;
  tag: DocTag;
  sha256: string;
  page_count: number;
}

export interface StrikeHit {
  word: string;
  bbox: number[];
  context: string;
}

export interface PageInfo {
  doc_id: string;
  page: number;
  text: string;
  char_count: number;
  image_count: number;
  low_text: boolean;
  garbled: boolean;
  choice_fields: string[];
  strike_hits: StrikeHit[];
  formula_image: boolean;
  needs_visual: boolean;
  visual_reasons: string[];
}

export interface MissingReference {
  label: string;
  doc_id: string;
  page: number;
  quote: string;
}

export interface Package {
  package_id: string;
  contract_id: string;
  title: string;
  files: DocumentFile[];
  pages: PageInfo[];
  missing_references: MissingReference[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// F6 answer (Interface A)
// ---------------------------------------------------------------------------

export interface Conflict {
  value: string;
  section_ref: string;
  pdf_page: number;
  verbatim_quote: string;
  governs: boolean | null;
}

export type ValueSource =
  | "clause" | "schedule" | "contract_data" | "annexure" | "amendment" | "portal_page" | "other" | "";

export interface Answer {
  contract_id: string;
  clause_id: ClauseId;
  question_id: string;
  status: Status;
  answer_value: string;
  unit: string;
  base: string;
  value_source: ValueSource;
  section_ref: string;
  pdf_page: number;
  verbatim_quote: string;
  conflicts: Conflict[];
  points_to: string;
  visual_check: "none" | "needed" | "done";
  visual_evidence: string;
  confidence: "high" | "medium" | "low";
  notes: string;
}

// ---------------------------------------------------------------------------
// F9/F10/F11 verification
// ---------------------------------------------------------------------------

export interface CheckResult {
  check: string;
  name: string;
  passed: boolean | null;
  detail: string;
}

export interface Verification {
  question_id: string;
  quote_found: boolean | null;
  found_doc_id: string;
  found_page: number;
  page_matches: boolean | null;
  checks: CheckResult[];
  normalised: Record<string, unknown>;
  verdict: "pass" | "warn" | "fail";
  discard: boolean;
}

export type ReviewDecision = "pending" | "accepted" | "edited" | "rejected" | "not_needed";

export interface ReviewState {
  decision: ReviewDecision;
  reasons: string[];
  user_answer: Answer | null;
  note: string;
  decided_at: string;
}

export interface AnswerEnvelope {
  question: string;
  answer: Answer;
  doc_id: string;
  verification: Verification | null;
  review: ReviewState;
  raw_call_id: string;
}

/** Mirrors AnswerEnvelope.effective() in models.py. */
export function effective(env: AnswerEnvelope): Answer {
  if (env.review.decision === "edited" && env.review.user_answer) return env.review.user_answer;
  return env.answer;
}

// ---------------------------------------------------------------------------
// Interface B: cash parameters
// ---------------------------------------------------------------------------

export interface ReleaseStep {
  share: number;
  months_after_completion: number;
}

export interface AdvanceInstalment {
  share_of_value: number;
  month: number;
}

export interface CashInputs {
  contract_value: number;
  duration_months: number;
  progress: number[] | null;
  cost_share: number;
  supplier_credit_days: number;
  overdraft_rate_pa: number;
  bank_rate_pa: number;
  bg_commission_pa: number;
  delay_days: number;
  index_rise_pa: Record<string, number>;
  cert_lag_days: number;
  pay_lag_days: number;
  min_bill_value: number;
  late_interest_rate_pa: number;
  retention_rate: number;
  retention_cap: number | null;
  retention_release: ReleaseStep[];
  dlp_months: number;
  advance_instalments: AdvanceInstalment[];
  advance_recovery_rate: number;
  advance_recovery_deadline: number | null;
  advance_interest_rate_pa: number;
  ld_rate_per_day: number;
  ld_cap: number | null;
  ld_grace_days: number;
  pv_applies: boolean;
  pv_factor: number;
  pv_weights: Record<string, number>;
  perf_security_pct: number;
  perf_security_validity_months_after_completion: number;
}

export interface ParamProvenance {
  field: string;
  source: "extracted" | "user" | "default";
  question_id: string;
  quote: string;
  confirmed: boolean;
}

export interface CashParams {
  inputs: CashInputs;
  provenance: ParamProvenance[];
}

export interface MonthRow {
  month: number;
  gross: number;
  retention: number;
  advance_recovery: number;
  net_certified: number;
  cash_in: number;
  cash_out: number;
  cum_in: number;
  cum_out: number;
  gap: number;
  billed?: number;
  retention_held: number;
  advance_outstanding: number;
}

export interface Sensitivity {
  name: string;
  peak_funding: number;
  peak_month: number;
  interest_cost: number;
  total_cost_of_terms: number;
}

export interface CashResult {
  months: MonthRow[];
  peak_funding: number;
  peak_month: number;
  overdraft_interest: number;
  advance_interest: number;
  guarantee_cost: number;
  retention_locked_max: number;
  retention_financing_cost: number;
  ld_amount: number;
  ld_days_to_cap: number | null;
  escalation_amount: number;
  escalation_is_recovery: boolean;
  total_cost_of_terms: number;
  sensitivities: Sensitivity[];
  notes: string[];
  // optional extras from the backend engine
  retention_cap_month?: number | null;
  advance_repaid_month?: number | null;
  receivable_max?: number | null;
  late_interest_income?: number | null;
  escalation_net_burden?: number | null;
}

export interface CashflowResponse {
  as_written: CashResult;
  reference: CashResult;
}

// ---------------------------------------------------------------------------
// F12 risk flags
// ---------------------------------------------------------------------------

export type Severity = "High" | "Medium" | "Low" | "Info" | "Needs review";

export interface RiskFlag {
  flag_id: string;
  title: string;
  severity: Severity;
  category: "risk" | "unclear";
  rule: string;
  value_found: string;
  reference_value: string;
  reference_source: string;
  question_ids: string[];
  quote: string;
  section_ref: string;
  pdf_page: number;
  explanation: string;
  rupee_impact: number | null;
}

// ---------------------------------------------------------------------------
// F15 evaluation
// ---------------------------------------------------------------------------

export type Label = "Correct" | "Partial" | "Incorrect" | "Missed" | "Correct absent" | "Wrongly present";

export const LABELS: Label[] = ["Correct", "Correct absent", "Partial", "Incorrect", "Missed", "Wrongly present"];

export interface TestScore {
  test_id: string;
  contract_id: string;
  question_id: string;
  clause_id: string;
  core: boolean;
  expected_status: string;
  tool_status: string;
  expected_answer: string;
  tool_answer: string;
  label: Label;
  reason: string;
  cause_code: string;
  quote_verified: boolean | null;
  needs_human_check: boolean;
}

export interface ScoreSummary {
  run_id: string;
  counts: Record<string, number>;
  by_contract: Record<string, Record<string, number>>;
  by_clause: Record<string, Record<string, number>>;
  precision: number;
  recall: number;
  core_pass_rate: number;
  quote_verification_rate: number;
  hallucinations: number;
  tests: TestScore[];
}

/** GET /evaluation: ScoreSummary plus which run was used per benchmark. */
export interface EvaluationSummary extends ScoreSummary {
  runs_used?: Record<string, string>;
  missing_benchmarks?: string[];
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export type Stage =
  | "queued" | "ingest" | "retrieve" | "extract" | "crossref" | "absence" | "visual" | "verify" | "flags" | "done" | "error";

export interface RunMeta {
  run_id: string;
  package_id: string;
  contract_id: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  effort: string;
  started_at: string;
  finished_at: string;
  stage: Stage | string;
  progress: number;
  log: string[];
  error: string;
  llm_calls: number;
  cache_hits: number;
  input_tokens: number;
  output_tokens: number;
  /** Read-only demo run: PATCH review and PUT params return 403. */
  frozen?: boolean;
}

export interface Benchmark {
  contract_id: string;
  title: string;
  package_id: string;
  has_run: boolean;
}

/** Body of POST /runs. user_inputs keys follow CashInputs field names where possible. */
export interface UserInputs {
  contract_value: number | null;
  duration_months: number | null;
  progress_curve: "even" | "s_curve";
  progress: number[] | null;
  cost_share: number;
  overdraft_rate_pa: number;
  bank_rate_pa: number;
  bg_commission_pa: number;
  delay_days: number;
  index_rise_pa: Record<string, number>;
  supplier_credit_days: number;
}

export interface ReviewPatch {
  decision: "accepted" | "edited" | "rejected" | "pending";
  /** Only the fields the user changed. */
  user_answer?: Partial<Answer>;
  note?: string;
}
