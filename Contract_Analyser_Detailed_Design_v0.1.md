# Contract Analyser: Detailed Design Notes (v0.1 DRAFT)

Team 2 | CE725 | Topic 12 | Builds on `Contract_Extraction_Questionnaire_v0.1.md` and `Contract_Data_Manual.html`.
Scope: Indian civil / infrastructure contracts (CPWD GCC, MoRTH EPC/HAM, institute NITs).

Items marked **[VERIFIED]** were checked against a primary text during this session. **[UNVERIFIED]** means a secondary source or an assumption.

---

## Problem statement (as submitted)

The tool is an AI-assisted contract analyser that (1) extracts key financial clauses (payment schedules, retention, mobilisation advances, liquidated damages, price escalation, bank guarantees), (2) presents them with references to the relevant contract sections, (3) highlights potential financial risks, and (4) estimates their impact on the **contractor's** cash flow. The pasted text ended mid-word at "cash flo"; confirm the full final sentence.

---

## 0. Two corrections to make first

### 0.1 The Supreme Court LD note in the questionnaire (section 6) is wrong as written  [VERIFIED]

The questionnaire says a judgment of 28 April 2025 "is reported to say LD cannot be deducted where the delay caused no loss". I read the judgment text.

- The case is **Consolidated Construction Consortium Ltd v. Software Technology Parks of India, Civil Appeal No. 5383 of 2024, 2025 INSC 574**. "1837/2020" is a diary number in the court's file path, not the case number.
- "No LD if the delay caused no loss" is the **appellant's argument** (para 8.3), not the court's holding.
- The court **dismissed the appeal** (paras 28 and 29). It held the High Court's single judge went beyond Section 34 of the Arbitration Act by setting aside the award. The arbitrator's decision to uphold the LD deduction (about Rs 82.4 lakh on a Rs 16.49 crore contract, about 10 months late) therefore stood.
- The discussion of Sections 55, 73 and 74 (para 20) says compensation under Section 74 is payable "whether or not actual damage or loss is proved", capped at the stipulated amount.

Action: replace the note with the correct citation and holding. Treat "LD needs proof of loss" as a **contested legal question that depends on the facts and the forum**, not a settled rule. Do not hard-code it into a risk flag. Have the team read paras 13 to 20 themselves; I read the arguments, the Section 74 passage and the conclusion, not every paragraph.

### 0.2 Some secondary sources contradict the primary text

One commentary site summarised the same judgment as saying the deduction was "not justified". The primary text says the opposite outcome (appeal dismissed). Lesson for the project: **cite primary text only** in the source register and flag secondary summaries as such.

---

## 1. What exactly are we reading?

### 1.1 Document types in scope

| Type | Examples | What it contains | Where the money terms live |
|---|---|---|---|
| Standard general conditions | CPWD GCC 2023 (Form of contract, 10 CC etc.), MoRTH Model EPC / HAM agreement | Generic clauses, same for every project | Clause text, with blanks filled by a schedule |
| Filled-in tender (NIT + bid documents) | Institute NIT with CPWD Form 8 | Project-specific numbers | Schedules A to F, NIT, special conditions |
| Special / particular conditions | Addenda, "Special Conditions of Contract" | Overrides to the general conditions | Often a separate PDF |
| Amendments, corrigenda, circulars | MoRTH/NHAI circulars | Later changes to values | Separate file, later date |
| BOQ / schedule of rates | Priced bill of quantities | Quantities and rates | Contract value, escalation base |
| Programme / milestones | Gantt, S-curve, milestone table | Dates and % progress | Needed for LD and cash flow |

The tool must treat these as **one contract package**, not one PDF. A single general-conditions PDF is only half the answer.

### 1.2 Real example from CPWD GCC 2023  [VERIFIED, from the IIT Kanpur copy of the PDF]

| Topic | What the text says | Where |
|---|---|---|
| Security deposit | Deducted at **2.5%** of each running and final bill until it reaches 2.5% of the tendered amount. Can be given as bank guarantee, FDR, surety bond or DD instead | Clause 1 and the Security Deposit clause |
| Performance guarantee | Percentage is **not in the clause**. It says "as mentioned in Schedule E", due within the period in Schedule F | Clause 11(i) |
| Delay compensation | Max **1% per month**, computed per day, **capped at 10%** of tendered value | Clause 2 |
| Payment of running bills | Ad-hoc payment of at least **75% of net bill within 10 working days**; balance within **28 working days** | Clause 7 area (running account payments) |
| Interest on late payment | Simple interest **5% per annum**, but only after **45 days** and only if the bill is in order | Same clause |
| Price adjustment | Clause 10 CC. Base date = last stipulated date of receipt of tenders. Escalation only for work done in the stipulated period plus justified extensions. Weights from Schedule F | Clause 10 CC |
| Advances | Secured advance on materials up to 75% of assessed value; interest 10% p.a. on interim advance payments made without full measurement | Clause 10 B and the running-account clause |

Why this table matters for design:

- Three different payment numbers (10, 28, 45 days) sit in **one paragraph**. A model that returns "10 days" has answered question 1.3 wrongly (that is partly the certification/ad-hoc payment, not the full payment).
- The performance guarantee value sits in **another document location** (Schedule E). This is the "schedule override" problem in your questionnaire, shown for real.
- Escalation depends on a **base date, a weights table and an index source**, spread over several places.

### 1.3 Document quality issues seen in the real GCC 2023 PDF  [VERIFIED]

I extracted text from the PDF. It has about 12,000 text lines, but the text layer is messy:

- Hindi side headings come out as garbled characters (legacy font encoding).
- Heading text is polluted with repeated digit strings (a watermark or page-number layer interleaved into the headings, e.g. "CLAUSES OF CONTR1111...A222...").
- Side-margin clause titles (like "Mobilization advance") can sit next to the wrong body paragraph after extraction, because the PDF is laid out in two columns (title column and body column).
- At least one image stream is a pure scan.

So even a "text PDF" from a government site needs layout-aware parsing and a cleaning step. This is a core technical risk, not an edge case.

---

## 2. How we do it: pipeline, stage by stage

```
Upload -> Intake -> Parse -> Structure -> Retrieve -> Extract -> Normalise -> Verify -> Risk -> Cash impact -> Report -> Human review -> Export
```

### Stage 1. Upload and package

- Accept: PDF (text or scanned), DOCX, optionally images.
- User tags each file: general conditions / tender data / schedules / amendment / BOQ / programme.
- User (contractor / project team) gives a few inputs: contract value, start date, completion period, planned monthly progress.
- Store file hash, upload time, and version so every answer can be traced.

### Stage 2. Intake checks (fail early, tell the user why)

| Check | Rule | If it fails |
|---|---|---|
| Is there a text layer? | Chars per page above a threshold | Route to OCR, warn about lower accuracy |
| Page count / size | Warn above a limit | Offer to process only chosen sections |
| Password / corrupt | Open test | Ask for another file |
| Language | Detect English / Hindi mix | Ignore Hindi margin text, warn |
| Duplicate / older version | Hash, date, title match | Ask which version applies |

### Stage 3. Parse (the hardest engineering part)

- Extract text **with page number and position** for every block, so a quote can point to a page.
- Detect headings and clause numbers (1, 2.1, 10 CC (ii)(a)) and build a section tree.
- Extract tables as structured rows (schedules, escalation weights, milestone tables). Keep the table as a table, never flatten it into a sentence.
- Handle tables that continue across pages.
- OCR only the pages that need it, and flag OCR text as lower-confidence.
- Clean noise: headers/footers, watermark digits, page numbers, Hindi text.

### Stage 4. Structure

- Output: a tree of clauses, each with number, title, text, page, and tables attached.
- Resolve **cross-references** ("as per Schedule F", "subject to clause 5"). Store them as links, because the answer to many questions is in the linked place.
- Mark schedule items as "fills in" clause X.

### Stage 5. Retrieve (pick what to show the model)

- For each clause type (C1 to C6), select candidate sections by keywords and headings (retention, security deposit, mobilisation advance, compensation for delay, price adjustment, 10 CC, guarantee).
- Always include the linked schedule entries.
- Why not paste the whole contract: long documents hurt accuracy and cost. A research thesis on CUAD found retrieval helps long documents but is limited by retriever accuracy, and that single-pass retrieval cannot follow cross-references or confirm a clause is absent. **[UNVERIFIED: master's thesis, not peer reviewed.]**
- Therefore: retrieval, then a second pass that follows cross-references, and an explicit "search for absence" step before returning `NOT_STATED`.

### Stage 6. Extract (LLM call)

- One call per clause type, using the questionnaire questions and the section 9 JSON format.
- Prompt rules (from the questionnaire): quote and section required; `NOT_STATED` if silent; cite the schedule if the schedule fills the value.
- Add to the schema: `source_page`, `value_source` (clause / schedule / amendment), `conflicts_with` (if two places disagree).
- Temperature low, structured output enforced.

### Stage 7. Normalise

- Convert values to common units: days vs working days, % per month vs per day, % of gross bill vs net bill vs tendered value.
- Keep both the original text and the normalised value.
- Record the **base** every time (this was a repeated trap in the questionnaire).

### Stage 8. Verify (see section 3 for the full list)

### Stage 9. Risk flags

- Rules compare normalised values with reference values from the source register (not invented thresholds).
- Every flag shows: the rule, the value found, the reference value, the quote, and "why it matters" in plain words.
- Flags are written from the contractor's side (per the problem statement): high or late-released retention, slow certification and payment, no advance or an advance needing a guarantee, LD with no cap, fixed price over a long duration, large or extendable guarantees, and silent or contradictory clauses.

### Stage 10. Cash-flow impact (Finance Modeller)

Inputs: contract value, planned monthly progress (S-curve), billing cycle, certification and payment lag, and extracted terms. Model:

1. Gross value of work done each month.
2. Deductions: security deposit / retention, advance recovery, taxes if modelled.
3. Payment timing: certification lag plus payment lag, with interest if late.
4. Advances: mobilisation and secured advance in, recovered over later bills.
5. LD: starts after the completion date, up to the cap.
6. Escalation: applied only if the contract allows and only within the allowed period.
7. Contractor's cost outflow from the same S-curve (needs an assumption: cost as % of value).

Outputs: monthly cash position, **peak funding requirement**, total cash locked up in retention and delayed payments, and the money cost of that at an assumed interest rate. Show it as "contract as written" vs "if risky clause were at the reference value".

### Stage 11. Report and review

Described in section 4.

---

## 3. What we check and verify

Verification layers, from cheap to expensive:

| # | Check | How | Catches |
|---|---|---|---|
| V1 | Quote exists | String match (with whitespace/OCR tolerance) of the quote in the source text | Fabricated quotes |
| V2 | Quote location | Match page and section number given by the model | Wrong clause cited |
| V3 | Number in quote | The extracted number must appear in the quote | Values invented or taken from the wrong sentence |
| V4 | Unit and base present | Required fields not empty | Missing "of what" |
| V5 | Schedule check | If the clause says "as per Schedule X" and the answer has no schedule citation, mark incomplete | Schedule overrides |
| V6 | Consistency | Same item stated in two places with different values -> flag conflict | Amendment vs original, clause vs schedule |
| V7 | Plausibility range | Value outside a sane range (e.g. retention 40%) -> flag for human | Unit errors, misreads |
| V8 | Absence check | Before `NOT_STATED`, run a second search across the whole package | False "missed" answers |
| V9 | Second-model check (optional) | Ask a separate call: "does this quote support this value?" | Real quote, wrong meaning |
| V10 | Human review | Low confidence, V6/V7 flags, and all `NOT_STATED` for key fields | Remaining errors |
| V11 | Benchmark scoring | Compare with answer key (correct / missed / incorrect / correct absent) | Overall accuracy for the course report |

Note: V1 to V4 catch fabrication. They do **not** catch "real quote, wrong meaning" (certification period vs payment period). Only V9, V10 and V11 do.

Log every Incorrect and Missed with a cause code: misread table, schedule override, hallucination, wrong unit, OCR error, wrong clause, cross-reference missed.

---

## 4. Final outputs to show

For one uploaded contract package:

1. **Package summary.** Documents found, versions, pages, parse quality score, pages that needed OCR, missing documents (e.g. "Schedule F not provided").
2. **Clause table.** One row per question: value, unit, base, section, page, schedule source, verbatim quote, confidence, status (found / not stated / needs review).
3. **Source viewer.** Click a row, see the PDF page with the quote highlighted.
4. **Risk flag list.** Ranked, each with the rule, the evidence, and a plain explanation. Separate "high-risk term" from "unclear or missing term".
5. **Cash-flow view.** Monthly cash curve, peak funding need, cash locked in retention and delayed payments, effect of LD and escalation. Sliders for delay months and progress.
6. **Review queue.** Items needing human decision, with reasons.
7. **Export.** CSV (matches the answer-key columns), PDF report with quotes and sources.
8. **Evaluation sheet (team only).** Counts per label per clause type, precision, recall, and the error-cause log.
9. **Disclaimer text.** Decision support, not legal advice.

---

## 5. Where things go wrong (civil-specific catalogue)

| Area | What goes wrong | Example | Mitigation |
|---|---|---|---|
| Parsing | Two-column layout mismatches side headings and body | "Mobilization advance" heading beside an unrelated paragraph in GCC 2023 text | Layout-aware parser, check headings against the section tree |
| Parsing | Garbled Hindi / legacy fonts | GCC 2023 margin text | Drop non-English blocks |
| Parsing | Tables read as prose | Escalation weights, milestones | Extract tables separately |
| Parsing | Scanned pages | Image pages in government PDFs | OCR with lower-confidence flag |
| Reading | Several numbers in one clause | 10 / 28 / 45 days in GCC 2023 payment clause | Ask for each period separately; V3 check |
| Reading | Clause says "as per Schedule E" | Performance guarantee % | V5 schedule check |
| Reading | Gross vs net bill vs tendered value | Security deposit base | Required `base` field |
| Reading | Working days vs calendar days | 10 working days | Required `unit` field |
| Reading | Amendments not applied | MoRTH APS circulars (Feb 2024 cut to 3%; newer circulars) | Version field; ask for circulars; V6 |
| Reading | Special conditions override general | Supplementary conditions | Retrieve special conditions first |
| Reading | `NOT_STATED` wrongly returned | Clause exists under unexpected heading | V8 absence check |
| Law | Legal rules change or are contested | LD and proof of loss; Section 74 | Show as context with citation, not as a hard rule |
| Law | Different contract families differ | CPWD vs NHAI vs institute NIT | Record `form_name`; do not mix reference values |
| Finance | Cash model needs inputs not in the contract | S-curve, cost profile | Ask the user, show assumptions |
| Finance | Employer-side delays | Land not handed over; engineer's determinations | Show LD and escalation as scenarios, not predictions |
| Product | Over-trust | Output read as legal advice | Disclaimer, confidence labels |
| Product | Confidential contracts uploaded to an external API | Real tenders under NDA | Public contracts only for now; consent and redaction later |
| Evaluation | Small benchmark | Two contracts | State the limit; avoid claiming general accuracy |

---

## 6. Existing tools and what people struggle with

### 6.1 Existing tools  (all findings from search results; vendor claims are **[UNVERIFIED]**)

| Tool | What it is | Relevance |
|---|---|---|
| Document Crunch | Construction contract review, built on Kira's engine (2020 article); trained on construction clause language | Closest to our idea, but US/commercial and not Indian standard forms |
| Kira (Litera) | Clause extraction with trainable fields; aimed at lawyers and due diligence; enterprise pricing | Shows the "fields + quote" design is standard |
| Ironclad, Icertis, Luminance | General contract lifecycle tools with clause detection and playbook comparison | The "compare with playbook" idea matches our risk flags |
| LlamaParse and similar | Layout-aware PDF and table parsing, with page and coordinate metadata | A parsing option to test; vendor claims need checking on our PDFs |
| Open benchmarks: CUAD, LegalBench, CLAUSE | Datasets for clause extraction and inconsistency detection | Methods and metrics to borrow; none are about Indian civil contracts |

Gap we can fill: the tools found are built around US/UK law and commercial contracts. I found **no tool aimed at Indian public works forms** (CPWD, MoRTH/NHAI) that links extracted clauses to a cash-flow impact. This is an observation from a limited search, not proof that none exists. Check Indian legal-tech tools before claiming novelty in the report.

### 6.2 Research findings on accuracy

- On CUAD, one undergraduate thesis found Claude-3.5-Sonnet reached about 0.77 recall and 0.66 precision with zero-shot prompting, with results varying a lot by clause type **[UNVERIFIED: thesis]**.
- CUAD's own leaderboard metric (precision at 80% recall) shows exhaustive clause finding is hard.
- I found **no independent measurement** of LLM accuracy on tables or on long tender documents, and no hallucination-rate figures. This is a gap that your benchmark can address, and it is something to say plainly in the report.

### 6.3 Problems people report in construction contracts

- Payment terms, retention, delay provisions and pay-if-paid clauses are the usual cash-flow trouble spots; supplementary conditions are often missed. Source: practitioner and vendor guides **[UNVERIFIED: no independent study found]**.
- NHAI context: disputes are mainly about delay, variations, payment and cost escalation, land acquisition, and termination. Certification and delay decisions go first to the Authority/Independent Engineer, whose independence is criticised. NHAI arbitration cases rose from 125 in FY17 to 1,014 in FY18 (Business Standard) **[UNVERIFIED: news report]**.
- Claims in arbitration regularly include interest on delayed payment certificates, price adjustment (steel, cement, fuel, labour) and prolongation costs, which are exactly the terms our tool extracts.
- Case example: an arbitral award on LD was upheld by the Supreme Court in the CCC v STPI matter (section 0.1).

Meaning for design: the tool's value is in **spotting terms that later cause cash or dispute problems**, so prioritise payment timing, retention, advances, LD, escalation and guarantees as you planned.

---

## 7. Questions to settle  (answers change the design)

1. ~~Who is the user?~~ **Settled by the submitted problem statement: the contractor and their project team.** All risk flags and the cash-flow view are written from the contractor's side. Employer and lender views are out of scope.
2. **Which contract families are in the benchmark?** Suggest: CPWD GCC 2023 plus one filled-in institute NIT, plus one MoRTH/NHAI EPC. Confirm.
3. **Do the benchmark contracts include the schedules?** Without Schedule E/F the guarantee percentage, escalation weights and milestones cannot be answered.
4. **Scanned or text PDFs?** Decide whether OCR is in scope.
5. **How deep should the cash model go?** Simple monthly S-curve, or include cost profile and cost of capital?
6. **Reference values for risk flags:** which sources are acceptable (CPWD manual, MoRTH circulars, GFR, CVC guidelines)? Each needs a source-register entry.
7. **Real-time or batch?** One contract at a time with review, or run all benchmark contracts and score?
8. **What is the deliverable for the course:** working demo, report with accuracy numbers, or both?

---

## 8. Sources

Primary (read in this session):
- Supreme Court of India, *Consolidated Construction Consortium Ltd v. Software Technology Parks of India*, CA 5383/2024, 2025 INSC 574 (28 April 2025). Text retrieved from api.sci.gov.in.
- CPWD General Conditions of Contract 2023, copy hosted by IIT Kanpur: https://iitk.ac.in/iwd/file/2026/18-Civil-D2-2026-27/GCC-2023.pdf

Secondary (search results, not fully verified):
- Document Crunch / Kira: https://www.artificiallawyer.com/2020/03/05/built-with-kira-inside-meet-ai-startup-document-crunch/
- Tool roundup: https://www.fast.io/resources/best-ai-contract-review-tools-2026.md
- CUAD / LegalBench thesis and benchmarks: https://arxiv.org/pdf/2308.11462 ; https://repository.tudelft.nl/file/File_e0c6743a-a0db-46b6-8227-557db173ea98?preview=1
- NHAI dispute overview: https://www.epcworld.in/dispute-resolution-mechanisms-in-national-highways-authority-of-india-contracts/
- NHAI arbitration numbers: https://www.pressreader.com/india/business-standard/20190922/281552292575632
- MoRTH additional performance security circular: https://morth.gov.in/sites/default/files/comprehensive_compendium_circular/52-Additional-Performance-001.pdf
- PDF table extraction challenges: https://parsio.io/blog/how-to-extract-tables-from-pdfs/
