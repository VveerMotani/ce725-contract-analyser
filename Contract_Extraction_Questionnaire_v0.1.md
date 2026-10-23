# Contract Extraction Questionnaire (v0.1 DRAFT)

Team 2 | CE725 | Topic 12: AI Contract Analyser for Financial Risk Clauses | Data Lead: Vveer Motani

## 0. Purpose and how this file is used

One question set, three uses:

1. **Manual answer key (validation benchmark).** A human answers every question for each benchmark contract, with section number and verbatim quote. This is the "ground truth".
2. **LLM prompts.** The same questions, one clause type per call, are sent to the Anthropic API. The model must answer in the JSON format in section 9.
3. **Scoring.** Tool answers are compared with the answer key (section 8) and labelled correct / missed / incorrect.

Scope: Indian contracts only (CPWD GCC, MoRTH EPC/HAM, institute NITs). Real executed contracts are out of scope for now.

**Rules for every answer (human and LLM):**
- Quote the exact text and give the clause/section number. No quote = not an answer.
- If the contract is silent, answer `NOT_STATED`. Never fill in a "usual" value.
- If a value sits in a schedule or tender data sheet (e.g. CPWD Schedule F, MoRTH Schedule), cite that location, not only the general clause.
- If the contract has been amended, record which version is used.

## 1. Fixed clause list (proposed, take to meeting for approval)

The six clause types named in the charter and in the project brief:

| ID | Clause type |
|---|---|
| C1 | Payment terms |
| C2 | Retention / security deposit |
| C3 | Mobilisation and other advances |
| C4 | Liquidated damages (LD) |
| C5 | Price escalation / price variation |
| C6 | Bank guarantees and securities |

Plus a **C0 header block** of contract facts the cash-flow model needs (section 2).

Possible later additions, only if time allows: interest on delayed payment (covered inside C1 for now), taxes, extension of time, variations, termination payments.

## 2. C0: Contract header facts

| # | Question | Fields |
|---|---|---|
| 0.1 | What type and version of contract is this (CPWD GCC 2023, MoRTH EPC, HAM, institute NIT, other)? | form_name, version/date |
| 0.2 | Who are the employer and contractor? | employer, contractor (or NOT_STATED) |
| 0.3 | What is the contract value / estimated cost / tendered amount? | amount, currency, section |
| 0.4 | What is the stipulated completion period and start date basis? | months/days, start trigger |
| 0.5 | What is the defect liability / maintenance period? | months |
| 0.6 | Does the contract state milestones with dates or percentages? | list of milestone, % of work, date |

## 3. C1: Payment terms

| # | Question | Fields |
|---|---|---|
| 1.1 | How often can the contractor bill (monthly running bill, milestones, stage payments)? | billing_basis, frequency |
| 1.2 | Within how many days must the employer certify or measure a bill after submission? | days, section |
| 1.3 | Within how many days must the certified amount be paid? | days, section |
| 1.4 | Is interest payable on delayed payment? At what rate? | yes/no, rate, base |
| 1.5 | What deductions are made from each bill (retention, taxes, recoveries)? | list of deduction, %, section |
| 1.6 | Is there a minimum bill value or a cap on interim payment before work is certified? | amount/% |
| 1.7 | What is the timeline and condition for the final bill and final payment? | days, trigger |
| 1.8 | Is payment conditional on third-party funds ("pay when paid") or similar? | yes/no, quote |

LLM traps to log: confusing certification period with payment period, quoting a general clause when the schedule overrides it.

## 4. C2: Retention / security deposit

| # | Question | Fields |
|---|---|---|
| 2.1 | Is a retention or security deposit deducted from bills? | yes/no |
| 2.2 | At what percentage, and of what base (gross bill, net bill, contract value)? | %, base |
| 2.3 | Is there a cap on total retention? | % or amount |
| 2.4 | Is earnest money or bid security converted into or counted against it? | yes/no, quote |
| 2.5 | When is retention released (completion, end of defect liability period, in parts)? | trigger, %, days |
| 2.6 | Can retention be replaced by a bank guarantee? | yes/no, conditions |
| 2.7 | Is interest paid on retention held? | yes/no, rate |

## 5. C3: Mobilisation and other advances

| # | Question | Fields |
|---|---|---|
| 3.1 | Is a mobilisation advance given? | yes/no |
| 3.2 | What percentage or amount, and in how many instalments? | %, amount, instalments |
| 3.3 | Is it interest-free or interest-bearing? At what rate? | rate |
| 3.4 | How and when is it recovered (per bill %, over a period)? | method, % per bill |
| 3.5 | What security is required for it? | BG %, form |
| 3.6 | Are there advances for plant and machinery or secured advance on materials? | yes/no, % of material value |
| 3.7 | Conditions to receive the advance (BG submitted, work started)? | conditions |

## 6. C4: Liquidated damages (LD)

| # | Question | Fields |
|---|---|---|
| 4.1 | Does the contract impose LD for delay? | yes/no |
| 4.2 | What is the rate, and on what base (per day/week/month, % of contract value or of the delayed portion)? | rate, unit, base |
| 4.3 | What is the maximum (cap) on LD? | % or amount |
| 4.4 | Does LD apply only to final completion, or also to milestone delays? | scope, milestones |
| 4.5 | How can the completion date be extended (extension of time conditions)? | conditions, section |
| 4.6 | Is LD stated as a pre-estimate of loss, and does it require proof of loss? | quote |
| 4.7 | Is LD deductible from bills, retention or guarantee? | quote |
| 4.8 | Are there other LD or penalties (quality, performance, availability)? | list |

Context note for the risk logic (corrected after reading both judgments, see Contract_Source_Register.xlsx, sheet Court Judgments): in Construction & Design Services v DDA (2015) the Supreme Court held that loss can be presumed from delay in a public construction contract and the contractor must show no loss. In Consolidated Construction Consortium v STPI (2025) the Court left standing an arbitral award that refused damages because the employer had extended time and the contractor finished within the extended time. Neither says that every damages clause needs proof of loss.

## 7. C5: Price escalation / price variation

| # | Question | Fields |
|---|---|---|
| 5.1 | Is the contract fixed price, or does it have a price variation clause? | fixed/PVC |
| 5.2 | If PVC: what formula is given? Copy it exactly. | formula text |
| 5.3 | Which components and weights (labour, cement, steel, fuel, bitumen, other)? | component, weight |
| 5.4 | Which index and source for each (WPI, CPI-IW, Labour Bureau, notified rates)? | index, source |
| 5.5 | What is the base date (bid due date, month before)? | date basis |
| 5.6 | Is there a threshold below which no escalation is paid, or a cap? | % |
| 5.7 | Does escalation stop after the original completion date? | yes/no, quote |
| 5.8 | Is escalation payable on materials supplied by the employer? | yes/no |

## 8. C6: Bank guarantees and securities

| # | Question | Fields |
|---|---|---|
| 6.1 | Which securities are required (bid security/EMD, performance security, advance payment guarantee, retention substitution)? | list |
| 6.2 | For each: amount or percentage, and of what base? | %, base |
| 6.3 | What forms are accepted (BG, e-BG, surety bond, FDR, DD)? | list |
| 6.4 | Which issuers are acceptable (scheduled/nationalised bank)? | text |
| 6.5 | What is the validity period, and must it be extended if time is extended? | days, extension rule |
| 6.6 | On what grounds can the employer encash it? | text |
| 6.7 | When is it released? | trigger, days |
| 6.8 | Are there extra guarantee requirements (additional performance security for low bids)? | yes/no, %, quote |

## 9. Answer-key sheet and scoring

**Answer-key columns** (one row per answer; use a spreadsheet or CSV):

`contract_id | clause_id | question_id | answer_value | unit | section_ref | verbatim_quote | status (FOUND / NOT_STATED) | answered_by | checked_by | notes`

**Scoring labels** for each tool answer against the key:

| Label | Meaning |
|---|---|
| Correct | Same value and right section/quote location |
| Incorrect | Clause found but value, unit or section wrong, or the model invented a clause or number |
| Missed | The key has an answer, the tool returned nothing or NOT_STATED |
| Correct absent | Both say NOT_STATED |

Report: counts per label per clause type, plus precision and recall. Log each Incorrect and Missed in the AI usage log with the cause (misread table, schedule override, hallucination, wrong unit).

**Output format the LLM must return** (one JSON object per clause type):

```json
{
  "clause_id": "C2",
  "answers": [
    {
      "question_id": "2.2",
      "status": "FOUND",
      "value": "5",
      "unit": "% of gross bill",
      "section_ref": "Clause 2",
      "verbatim_quote": "...",
      "confidence": "high"
    }
  ]
}
```

## 10. Risk flags (candidates only; thresholds to be fixed from the actual contracts)

Do not hard-code numbers until each is checked against a source in the source register.

- Payment cycle longer than normal (certification plus payment days).
- Retention or security deposit high or released late.
- Advance absent, or interest-bearing, or needs a guarantee.
- LD rate high or no cap stated.
- Fixed price over a long duration, or escalation excluded after the original completion date.
- Guarantee required is large or must be extended with time.
- Silent or contradictory clauses (flag as "needs human review").

## 11. Next steps for the Data Lead

1. Team approves the clause list (section 1) at the meeting.
2. Pick the two benchmark contracts, one long standard form and one real filled-in tender.
3. Answer sections 2 to 8 by hand for both contracts into the answer-key sheet.
4. Keep the source register (URL, download date, version, licence).
5. Hand section 9 JSON format to the AI and Tool Developer.
