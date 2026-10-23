# M3 Risk rules (F12)

`flag_risks(envelopes, package, cash=None, cash_result=None) -> list[RiskFlag]` applies R1-R18 from
`rules_v1.yaml` to the effective answers (`AnswerEnvelope.effective()`), from the **contractor's** side.
No LLM calls. Every threshold and phrase list lives in the YAML; edit it there.
`flag_risks_with_trace()` also returns the reason each rule did not fire.

Files: `rules_v1.yaml` (the rule table), `parse.py` (number and phrase parsers), `targets.py` (names the document a pointer refers to), `context.py`
(answers by question id, contract value and duration), `rules.py` (one function per rule), `__init__.py`.

Order of output: High, Medium, Low, Info, Needs review; inside each, larger rupee impact first.
Status handling: `NOT_STATED` and `POINTS_ELSEWHERE` give flags with category `unclear` (R6, R7, R8, R10);
other `POINTS_ELSEWHERE` answers are grouped per target document in R17. Answers the verifier discarded
or the reviewer rejected are not used; a reviewer's edit replaces the AI answer.

| Rule | Raised when | Threshold (YAML) | Status | Source |
|---|---|---|---|---|
| R1 Retention high or uncapped | cap above 5% of value, no cap on a per-bill deduction, or all held to end of defects period | `max_cap_pct: 5.0` | SEEN | Manual for Procurement of Works 2022 |
| R2 Rate above cap | deduction rate > cap (Info, explains effective figure) | none | SEEN | NHAI test agreement (6% / 5%) |
| R3 Performance security high | above 5%, or additional security for low bids applies | `max_pct: 5.0` | SEEN | Manual 2022; DoE OM 12 Nov 2020 (3%) via circular |
| R4 Delay damages | no cap (High); cap above 10%; rate above 0.05%/day (Medium) | `max_cap_pct: 10`, `max_daily_rate_pct: 0.05`, `days_per_month: 30` | cap SEEN; **daily rate and 30-day month ASSUMPTION** | Manual 2022; CPWD GCC 2023 cl. 2; NHAI cl. 10.3 |
| R5 No extension route | damages apply and 4.5 is NOT_STATED or "no" | none | - | each contract's EOT clause |
| R6 No interest on late payment | "no interest payable" (High, risk); silent (High, unclear); points elsewhere (Needs review) | phrase list | SEEN | NHAI cl. 19.9; CPWD cl. 7; MP tender |
| R7 Slow or unclear payment | payment period above 30 calendar days, or not stated | `max_payment_days: 30`, `working_day_factor: 1.4` | **ASSUMPTION (both)** | NHAI 30 days; CPWD 10/28 working days |
| R8 No or costly advance | no advance; interest-bearing; guarantee above 100% of advance | `max_guarantee_pct: 100` | **ASSUMPTION** | Manual 2022 (need-based; interest-free discouraged) |
| R9 Fast advance recovery | advance fully recovered before 80% of planned work (needs `cash` or `cash_result`) | `min_work_share_at_full_recovery: 0.8` | **ASSUMPTION** | CPWD 10B(iii) pattern |
| R10 Fixed price, long contract | no price variation (or gated off) and duration above 18 months | `max_fixed_price_months: 18` | SEEN | Manual 2022 |
| R11 Price variation holes | gate not met (size/duration, T13); gate not evaluable (unclear); no labour; index lag over 3 months; late-billing cut-off | `max_index_lag_months: 3` | **ASSUMPTION** | the contract's own C5 clause |
| R12 Termination / withholding | termination linked to progress or damages; milestone withholding above 1% | `withholding_pct: 1.0` | **ASSUMPTION** | MP tender, MoEF tender |
| R13 High minimum bill | minimum bill above one planned month of billing (value / duration) | `max_months_of_billing: 1.0` | **ASSUMPTION** | IIT Bombay schedule |
| R14 Guarantee tied to extensions | validity must be extended whenever time is extended (Low) | phrase list | SEEN | CPWD GCC 2023 |
| R15 Payment conditions | pay-when-paid or papers before payment (Low) | phrase list | SEEN | CPWD-style Schedule F 7A |
| R16 Conflict | an answer has `conflicts` (Needs review) | none | - | F9 |
| R17 Unresolved reference | `POINTS_ELSEWHERE`, grouped per normalised target (`targets.py`: GCC + issuer + year, Schedule X, Annexure X, Contract Data; taken from points_to, else the answer text); one combined flag when there are more than 3 targets | `max_separate_flags: 3` | **ASSUMPTION** | F7 |
| R18 Missing document | one flag per package listing every `missing_references` entry, money-relevant ones (YAML `priority`) first | none | - | F1 |

**Assumptions to calibrate** (bold above): R4 daily rate 0.05% and 30-day month; R7 30 days and
working-day factor 1.4; R8 100% guarantee line; R9 80% of work; R11 3-month lag; R12 1% withholding;
R13 one month of billing. Not used on purpose (spec 7): GFR Rule 171 combined 3-10%, MSME 45 days,
and "damages need proof of loss" (contested; context only).

**Rupee impact** (only when `cash` / `cash_result` is given): R1 retention locked max (or cap x value);
R3 performance security x value; R4 damages cap x value (or damages for the chosen delay if uncapped);
R7 overdraft interest on value for the extra days; R8 advance interest from the cash model; R9 advance size;
R10 escalation exposure from the cash model; R12 largest withholding x value; R13 the minimum bill amount;
R14 guarantee commission per extra year.

**Contract value and duration**: `cash.contract_value` / `cash.duration_months` first; for gates (R11) and
R13 only, the amount in answer 0.3 and the period in answer 0.4 are used when the user has not entered them.

**Normalised values**: if `Verification.normalised` has these keys they replace text parsing:
`rate_share`, `cap_share_of_value`, `rate_per_day_of_value`, `days`, `months`, `amount_rs` (shares as fractions).

Tests: `python -m pytest tests/test_risk*.py -q` (add `-s` to print the flags for BM1-BM4).
