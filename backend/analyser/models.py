"""Shared data models: the frozen interfaces between modules.

Every module reads and writes these types. Change a field only with the
agreement of every module owner (see INTERFACES.md).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

ClauseId = Literal["C0", "C1", "C2", "C3", "C4", "C5", "C6"]
Status = Literal["FOUND", "NOT_STATED", "NOT_APPLICABLE", "POINTS_ELSEWHERE"]
DocTag = Literal["notice", "gcc", "schedules", "special", "amendment", "boq", "other"]

CLAUSE_NAMES: dict[str, str] = {
    "C0": "Contract facts (header)",
    "C1": "Payment terms",
    "C2": "Retention and security deposit",
    "C3": "Advances",
    "C4": "Delay damages (liquidated damages)",
    "C5": "Price escalation or price variation",
    "C6": "Guarantees and securities",
}

# ---------------------------------------------------------------------------
# F1/F2/F3: package intake and page parsing  (owner: M1 ingest)
# ---------------------------------------------------------------------------


class DocumentFile(BaseModel):
    doc_id: str                      # short stable id, e.g. "d1"
    filename: str
    path: str                        # absolute path on disk
    tag: DocTag = "other"
    sha256: str
    page_count: int


class StrikeHit(BaseModel):
    """A word that has a drawn line through it (trap T1)."""
    word: str
    bbox: list[float]                # [x0, y0, x1, y1] in PDF points
    context: str = ""                # the surrounding text, e.g. "Yes/No"


class PageInfo(BaseModel):
    doc_id: str
    page: int                        # 1-based position in the PDF file
    text: str
    char_count: int
    image_count: int = 0
    low_text: bool = False           # almost no text layer (scan or image page)
    garbled: bool = False            # legacy-font Hindi or broken text
    choice_fields: list[str] = []    # e.g. ["Yes/No", "Applicable/Not Applicable"]
    strike_hits: list[StrikeHit] = []
    formula_image: bool = False      # image near formula words (trap T2)
    needs_visual: bool = False
    visual_reasons: list[str] = []


class MissingReference(BaseModel):
    label: str                       # e.g. "General Conditions of Contract 2023"
    doc_id: str
    page: int
    quote: str


class Package(BaseModel):
    package_id: str
    contract_id: str                 # "BM1".."BM4" for benchmarks, free text otherwise
    title: str = ""
    files: list[DocumentFile]
    pages: list[PageInfo] = []       # stored separately on disk as pages.json; may be empty in API responses
    missing_references: list[MissingReference] = []
    created_at: str = ""


# ---------------------------------------------------------------------------
# F4/F5: document map and retrieval  (owner: M1 ingest)
# ---------------------------------------------------------------------------


class SectionEntry(BaseModel):
    doc_id: str
    page: int
    ref: str                         # "Clause 10B(ii)", "Schedule F", "Annexure P"
    title: str = ""
    kind: Literal["clause", "schedule", "contract_data", "annexure", "amendment", "other"] = "clause"


class RetrievalResult(BaseModel):
    clause_id: ClauseId
    pages: list[tuple[str, int]]     # (doc_id, page), in reading order
    image_pages: list[tuple[str, int]] = []   # subset that must be sent as images
    reasons: dict[str, list[str]] = {}        # "d1:64" -> ["term: liquidated damages", "pointer: Schedule J"]


# ---------------------------------------------------------------------------
# F6: the answer record (Interface A = extraction_schema_v1.json)
# ---------------------------------------------------------------------------


class Conflict(BaseModel):
    value: str
    section_ref: str
    pdf_page: int
    verbatim_quote: str = ""
    governs: Optional[bool] = None


class Answer(BaseModel):
    """Exactly the fields of extraction_schema_v1.json."""
    contract_id: str
    clause_id: ClauseId
    question_id: str
    status: Status
    answer_value: str
    unit: str = ""
    base: str = ""
    value_source: Literal["clause", "schedule", "contract_data", "annexure",
                          "amendment", "portal_page", "other", ""] = ""
    section_ref: str
    pdf_page: int
    verbatim_quote: str
    conflicts: list[Conflict] = []
    points_to: str = ""
    visual_check: Literal["none", "needed", "done"] = "none"
    visual_evidence: str = ""
    confidence: Literal["high", "medium", "low"]
    notes: str = ""


# ---------------------------------------------------------------------------
# F9/F10/F11: verification  (owner: M2 verify)
# ---------------------------------------------------------------------------


class CheckResult(BaseModel):
    check: str                       # "V1".."V9"
    name: str
    passed: Optional[bool]           # None = not applicable
    detail: str = ""
    severity: Literal["fail", "warn", "info"] = "info"


class Verification(BaseModel):
    question_id: str
    quote_found: Optional[bool]      # None when there is no quote to check (NOT_STATED)
    found_doc_id: str = ""
    found_page: int = 0
    page_matches: Optional[bool] = None
    checks: list[CheckResult] = []
    normalised: dict = {}            # F10 output, e.g. {"rate_per_day_of_value": 0.0005}
    verdict: Literal["pass", "warn", "fail"] = "pass"
    discard: bool = False            # quote not in text -> answer is discarded


class ReviewState(BaseModel):
    decision: Literal["pending", "accepted", "edited", "rejected", "not_needed"] = "not_needed"
    reasons: list[str] = []          # why it is in the queue
    user_answer: Optional[Answer] = None
    note: str = ""
    decided_at: str = ""


class AnswerEnvelope(BaseModel):
    """What the API and UI pass around: the AI answer plus everything known about it."""
    question: str
    answer: Answer                   # the AI's answer, never edited in place
    doc_id: str = ""                 # which file the quote is in (set by the verifier)
    verification: Optional[Verification] = None
    review: ReviewState = ReviewState()
    raw_call_id: str = ""            # key of the cached LLM call that produced it

    def effective(self) -> Answer:
        """The answer downstream modules should use."""
        if self.review.decision == "edited" and self.review.user_answer is not None:
            return self.review.user_answer
        return self.answer


# ---------------------------------------------------------------------------
# Interface B: cash-model parameters  (owner: M4 cash flow)
# ---------------------------------------------------------------------------


class ReleaseStep(BaseModel):
    share: float                     # share of retention held released at this step (0..1)
    months_after_completion: float   # 0.5 = "within 15 days of completion certificate"


class AdvanceInstalment(BaseModel):
    share_of_value: float            # e.g. 0.05 = 5% of contract value
    month: int                       # month in which cash arrives (1-based; 0 = before start)


class CashInputs(BaseModel):
    """Every number the cash model needs. Shares are fractions (0.05 = 5%)."""
    # project (user inputs)
    contract_value: float                        # Rs
    duration_months: int
    progress: Optional[list[float]] = None       # share of work per month, sums to 1; None = even
    cost_share: float = 0.85                     # contractor cost as share of billed value
    supplier_credit_days: float = 0.0
    overdraft_rate_pa: float = 0.10
    bank_rate_pa: float = 0.0625
    bg_commission_pa: float = 0.015
    delay_days: int = 0
    index_rise_pa: dict[str, float] = {}         # scenario, e.g. {"steel": 0.08}
    # C1 payment
    cert_lag_days: float = 0.0
    pay_lag_days: float = 30.0
    min_bill_value: float = 0.0
    late_interest_rate_pa: float = 0.0           # 0 when "no interest payable"
    # C2 retention
    retention_rate: float = 0.0
    retention_cap: Optional[float] = None        # share of contract value; None = no cap
    retention_release: list[ReleaseStep] = [ReleaseStep(share=1.0, months_after_completion=0.5)]
    dlp_months: float = 12.0
    # C3 advance
    advance_instalments: list[AdvanceInstalment] = []
    advance_recovery_rate: float = 0.0           # share of each gross bill
    advance_recovery_deadline: Optional[float] = None   # share of duration, e.g. 0.8
    advance_interest_rate_pa: float = 0.0
    # C4 delay damages
    ld_rate_per_day: float = 0.0                 # share of contract value per day of delay
    ld_cap: Optional[float] = None               # share of contract value; None = uncapped
    ld_grace_days: int = 0
    # C5 price variation
    pv_applies: bool = False
    pv_factor: float = 0.85
    pv_weights: dict[str, float] = {}            # e.g. {"labour": 0.25, "cement": 0.1}
    # C6 guarantees
    perf_security_pct: float = 0.0               # share of contract value
    perf_security_validity_months_after_completion: float = 0.0
    # optional refinements
    index_lag_months: int = 0
    advance_interest_rate_encashed_pa: Optional[float] = None
    part_payment_share: Optional[float] = None   # e.g. 0.75 paid at part_payment_days, rest at pay_lag_days
    part_payment_days: Optional[float] = None


class ParamProvenance(BaseModel):
    field: str
    source: Literal["extracted", "user", "default"]
    question_id: str = ""
    quote: str = ""
    confirmed: bool = False
    note: str = ""                   # e.g. why an extracted number was rejected and the default used


class CashParams(BaseModel):
    inputs: CashInputs
    provenance: list[ParamProvenance] = []


class MonthRow(BaseModel):
    month: int
    gross: float
    retention: float
    advance_recovery: float
    net_certified: float
    cash_in: float
    cash_out: float
    cum_in: float
    cum_out: float
    gap: float                       # cumulative out - cumulative in (positive = contractor funding it)
    retention_held: float
    advance_outstanding: float
    billed: float = 0.0              # gross value certified this month (differs from gross when a minimum bill applies)


class Sensitivity(BaseModel):
    name: str
    peak_funding: float
    peak_month: int
    interest_cost: float
    total_cost_of_terms: float


class CashResult(BaseModel):
    months: list[MonthRow]
    peak_funding: float
    peak_month: int
    overdraft_interest: float
    advance_interest: float
    guarantee_cost: float
    retention_locked_max: float
    retention_financing_cost: float
    ld_amount: float
    ld_days_to_cap: Optional[float]
    escalation_amount: float         # recovery if PV applies, exposure if fixed price
    escalation_is_recovery: bool
    total_cost_of_terms: float
    sensitivities: list[Sensitivity] = []
    notes: list[str] = []
    retention_cap_month: Optional[int] = None
    advance_repaid_month: Optional[int] = None
    receivable_max: float = 0.0
    late_interest_income: float = 0.0
    escalation_net_burden: float = 0.0


# ---------------------------------------------------------------------------
# F12: risk flags  (owner: M3 risk)
# ---------------------------------------------------------------------------


class RiskFlag(BaseModel):
    flag_id: str                     # "R1".."R18"
    title: str
    severity: Literal["High", "Medium", "Low", "Info", "Needs review"]
    category: Literal["risk", "unclear"]   # high-risk term vs unclear or missing term
    rule: str
    value_found: str
    reference_value: str = ""
    reference_source: str = ""
    question_ids: list[str] = []
    quote: str = ""
    section_ref: str = ""
    pdf_page: int = 0
    explanation: str                 # plain words for a bid manager
    rupee_impact: Optional[float] = None


# ---------------------------------------------------------------------------
# F15: evaluation  (owner: M2 verify / scoring)
# ---------------------------------------------------------------------------

Label = Literal["Correct", "Partial", "Incorrect", "Missed", "Correct absent", "Wrongly present"]


class TestScore(BaseModel):
    test_id: str
    contract_id: str
    question_id: str
    clause_id: str
    core: bool
    expected_status: str
    tool_status: str
    expected_answer: str
    tool_answer: str
    label: Label
    reason: str = ""
    cause_code: str = ""             # filled by a person or a heuristic, see spec §10.6
    quote_verified: Optional[bool] = None
    needs_human_check: bool = False


class ScoreSummary(BaseModel):
    run_id: str
    counts: dict[str, int]
    by_contract: dict[str, dict[str, int]]
    by_clause: dict[str, dict[str, int]]
    precision: float
    recall: float
    core_pass_rate: float
    quote_verification_rate: float
    hallucinations: int
    tests: list[TestScore]


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


class RunMeta(BaseModel):
    run_id: str
    package_id: str
    contract_id: str
    model: str = ""
    prompt_version: str = "v1"
    schema_version: str = "v1"
    effort: str = ""
    started_at: str = ""
    finished_at: str = ""
    stage: str = "queued"            # queued, ingest, retrieve, extract, crossref, absence, visual, verify, flags, done, error
    progress: float = 0.0            # 0..1
    log: list[str] = []
    error: str = ""
    llm_calls: int = 0
    cache_hits: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    frozen: bool = False             # read-only demo run under runs/frozen/
