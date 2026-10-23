# Tender and Contract Analyser: Feature and Build Spec (v1)

Team 2 | CE725 | Topic 12 (AI Contract Analyser for Financial Risk Clauses) | prepared 22 Oct 2026 by the Data Lead

**What this file is.** A spec the team can hand to their AI (or their developer) to build the tool and to check that it works. It says what the tool must do, what to look for in a tender or contract, what the output must look like, which risks to flag, how to model cash impact, and how to test all of it.

**Companion files** (all in the project folder):

| File | Use |
|---|---|
| `Contract_Analyser_Detailed_Design_v0.1.md` | The pipeline stage by stage. This spec does not repeat it. |
| `Contract_Extraction_Questionnaire_v0.1.md` | The 52 questions per contract. |
| `extraction_schema_v1.json` | The exact output record the AI must return. |
| `golden_tests_v1.json` | 208 verified expected answers to test against (4 contracts x 52 questions). |
| `Contract_Answer_Key_v2_verified.xlsx` | The same answers with quotes and check columns. |
| `Contract_Source_Register.xlsx` | Every source, and where the reference values come from. |
| `Benchmark Contracts\` | The four raw test contracts and the CPWD GCC 2023 reference. |

**Status labels used below.** **[SEEN]** means the team read it in a real document. **[ASSUMPTION]** means a design choice we made. **[UNVERIFIED]** means from a secondary source or memory and must be checked before use.

---

## 0. The goal in plain words

Given a contract package (the tender or contract PDFs for one project), the tool must:

1. **Find** six kinds of financial term: payment, retention, advance, delay damages, price escalation, guarantees. Plus a few facts about the contract (value, duration, defects period, milestones).
2. **Show proof** for each: the exact words, the clause number, the PDF page.
3. **Say honestly** when a term is not there, when it is switched off, or when it lives in another document.
4. **Flag risks** from the contractor's side.
5. **Estimate cash impact**: how the terms change the contractor's cash position, peak funding need, and exposure to delay damages and price rises.

"Working well" means: no number appears without proof; the six main numbers are right on our test contracts; the tool admits what it cannot see; and every mistake it makes is logged with a cause.

**Out of scope for now:** employer or lender views, legal advice, contracts that are not public, and anything other than Indian public-works style documents.

---

## 1. Rules the AI must always follow

1. **No proof, no answer.** Every answer needs a verbatim quote, the clause number and the PDF page. If it cannot give them, the status is `NOT_STATED` or `POINTS_ELSEWHERE`, never a guess.
2. **Use only the document.** Never fill a gap with what is "usual" in Indian contracts. A model that supplies "30 days" or "5%" from memory has invented it.
3. **Four statuses, used exactly:**
   - `FOUND`: the document states it.
   - `NOT_STATED`: nothing is said anywhere in the package after a full search.
   - `NOT_APPLICABLE`: the clause exists but this contract switches it off (for example "No advance payable", or a price adjustment that applies only above a size this contract does not reach). Keep the printed terms in the answer.
   - `POINTS_ELSEWHERE`: the document defers to another document or to a blank schedule (for example the NIT says "General Conditions of Contract 2023 apply" and the detail is only there).
4. **Always give the base and the unit** with every percentage or time: of what (gross bill, net bill, tendered value, contract price, bid price, value of unexecuted work) and per what (day, week, month, working days or calendar days).
5. **Report every number in a clause**, not just one. Retention can be "6% deducted, 5% cap". Payment can be "10 working days for part payment, 28 for the rest, interest after 45".
6. **Follow every pointer to its end.** "As per Contract Data", "as per Schedule F", "see Annexure P" must be followed until a value or a blank is reached.
7. **Schedules and data sheets beat general text** when they fill or override a clause. Special conditions beat general conditions. Later amendments beat earlier text. Report which one governs.
8. **If two places disagree, report both** and say which one the document says governs. Do not silently pick one.
9. **Look at the page when text is not enough.** Strike-throughs, scanned pages, formula images and tables with ticks are invisible or garbled in extracted text (section 5).
10. **Never output a quote that is not in the text.** The code will check, and a failed check discards the answer.

---

## 2. What the tool needs as input

**A. The documents** (user tags each one):

| Tag | Examples |
|---|---|
| Notice or RFP | NIT, RFP, bid data sheet, portal printout |
| General conditions | CPWD GCC 2023, an EPC agreement body |
| Schedules, contract data, annexures | CPWD Schedules A to F, MoRTH Schedules, "Contract Data", Annexure P and R |
| Special or particular conditions | Supplementary conditions, Hindi or regional side documents |
| Amendments | Corrigenda, correction slips, circulars |
| BOQ and programme | Priced quantities, milestone and S-curve tables |

**B. Inputs from the user** (the contract does not contain these, and the cash model needs them):

| Input | Why |
|---|---|
| Contract value (or accepted bid) | Many contracts leave it blank; the NHAI draft did |
| Start date and completion period | Needed for damages and escalation timing |
| Planned monthly progress (S-curve) | Needed for cash flow |
| Cost as a share of value | Contractor's cash out |
| Overdraft interest rate and RBI Bank Rate | Interest on advances and late payments often says "Bank Rate + 3%" |
| Expected delay in days | For the damages scenario |
| Index rise scenario (cement, steel, fuel, labour) | For escalation exposure |

**C. Completeness check (do this first).** Tell the user what is missing: "Schedules A to D and H not in the package", "General Conditions incorporated by reference but not supplied", "no corrigenda uploaded". **[SEEN]** In the NHAI test agreement the schedules that set stage-payment percentages were not in the text; in the MoEF tender the whole CPWD GCC is only referenced.

---

## 3. Features the tool must have

Each feature has a "done when" test. Real examples are from our four test contracts.

| # | Feature | What it must do | Done when |
|---|---|---|---|
| F1 | Package intake and completeness | Hash and version each file. List documents found and documents referenced but missing. | A missing schedule or an incorporated-by-reference document is reported before extraction starts. |
| F2 | Page-level parsing | Extract text per PDF page and keep the page number for every block. Measure text per page. | Every quote can be traced to a page. Pages with almost no text are listed. |
| F3 | Visual pass | Render and read any page that text cannot cover: pages with no text, pages with images, and schedule pages with choice fields such as "Yes/No" or "Applicable/Not Applicable". Send the page image to a vision-capable model. | The tool gets the IIT Bombay schedule right (section 5, trap T1) and reads the formula images in the NHAI agreement. |
| F4 | Document map and precedence | Build a map: clause numbers, titles, schedules, annexures. Record which document fills or overrides which clause. | For each term the tool can say "clause X says A, Schedule Y says B, B governs." |
| F5 | Clause-type retrieval | For each of C1 to C6, gather candidate sections by headings and the term lists in section 4, always including the schedule entries they point to. | Recall of the right section is 100% on the golden tests (no answer lost because the section was not shown to the model). |
| F6 | Structured extraction | One call per clause type. Return one record per question in the schema (section 6). | Output validates against `extraction_schema_v1.json`. |
| F7 | Cross-reference follower | Follow "as per Contract Data / Schedule / Annexure" up to 4 steps. Return the end value and the path. | NHAI-style and MP-style two-step references are resolved (trap T5). |
| F8 | Absence check | Before returning `NOT_STATED`, search the whole package again with the term lists and a second wording. | No clause is reported absent that exists under another heading. |
| F9 | Conflict detector | Compare the same term across clause, schedule, annexure and amendment. | The MP tender's two weight tables (18/13 against 20/20) are flagged (trap T10). |
| F10 | Normaliser | Convert to one unit set and keep the original wording. Store base and unit. | "1% per month" and "0.05% per day" are comparable. |
| F11 | Verifier | Check quote exists, page matches, number appears in the quote, base and unit present. Optional second model check: "does this quote support this value?" | No answer passes with a quote that is not on the stated page. |
| F12 | Risk flags | Apply the rules in section 7. Show rule, value, reference, quote, plain explanation. | Each flag has evidence and a source for its threshold. |
| F13 | Cash-flow impact | Build the monthly model in section 8 from the extracted terms and the user inputs. | Reproduces the hand benchmark in section 8.4 exactly. |
| F14 | Report and review queue | Table of answers, risk list, cash view, and a queue of items a person must confirm. | Every `NOT_STATED`, `POINTS_ELSEWHERE`, conflict and visual-only answer is in the queue. |
| F15 | Evaluation harness | Score the tool against `golden_tests_v1.json` and write the error log. | Section 10 produces the numbers for the validation report. |

---

## 4. What to look for: clause by clause

This section is for people. **Do not paste the "seen in" examples into the AI's prompt** (they come from the test contracts and would contaminate the test). Use the term lists and the field lists.

### C0. Contract facts (header)

| Field | Look for | Where it hides | Watch out |
|---|---|---|---|
| Form and version | "General Conditions of Contract 2023", "Standard EPC Agreement", edition dates | Cover, Schedule E, index | Two editions of the same form differ. Record which. |
| Parties | Employer, Authority, Contractor, Engineer-in-Charge | Cover, first page, parties clause | Contractor can be a blank placeholder in a draft. |
| Contract value | Estimated cost, tendered value, probable amount of contract, Contract Price, bid price | NIT, Schedule E, bid data sheet, form of agreement | "Estimated cost" is not the accepted price. Say which one it is. |
| Completion period | Time allowed, stipulated period, scheduled completion date, number of days or months | Schedule F, contract data, tender form | Can be blank in one place and given in another table. |
| Defects period | Defect liability period, maintenance period, warranty | General conditions, contract data | A product warranty is not a defects liability period. |
| Milestones | Project milestone, mile stone, stage, percentage of work against days | Schedule F or J, contract data | The same milestone can have different days in a schedule and a worked example. |

### C1. Payment terms

| Field | Look for (words) | Where it hides |
|---|---|---|
| Billing basis and frequency | running bill, running account bill, interim payment certificate (IPC), stage payment statement, milestone payment, monthly statement | Payment article, Schedule F ("Clause 7") |
| Minimum value before a bill is payable | "gross work to be done ... since the last such payment ... eligible for interim payment" | Schedule F |
| Submission, certification and payment periods | "within N days", "N working days", "on or before the 7th", "ad hoc payment", "part payment" | Payment article. Often three different periods in one paragraph. |
| Late payment interest | "interest at", "Bank Rate", "simple interest", "no interest shall be payable" | Payment article, a general "No interest payable" clause |
| Deductions | retention, security deposit, advance recovery, taxes, recoveries | Payment article |
| Final bill | final bill, final payment statement, completion certificate, discharge | End of payment article |
| Payment conditions | "no running bill shall be paid until labour licences ... are submitted", pay-when-paid | Schedule F "Clause 7A" or similar |
| Measurement method | computerised measurement book, electronic measurement book | Schedule F "Clause 6" |

**Normalise:** periods in days with a flag for working or calendar days; the interest rate as rate, base (for example Bank Rate) and start day.
**Common mistakes:** returning the certification period as the payment period; returning only "10 working days" when 28 and 45 are in the same paragraph; supplying "30 days" when the document gives none; ignoring a general clause that says no interest is payable.

### C2. Retention and security deposit

| Field | Look for (words) | Where it hides |
|---|---|---|
| Rate and base | retention money, security deposit, guarantee money, "X% of each running bill", "of tendered value" | Payment article, retention clause, Schedule E, contract data |
| Cap | "maximum", "shall not exceed", "up to X% of final contract amount" | Same clause or contract data |
| Link to earnest money or bid security | "earnest money ... converted", "bid security ... substituted by performance security" | Tender form, definitions |
| Release | "refunded within N days of completion certificate", "after the defect liability period", "year wise", "half ... after six months" | Retention clause, general rules |
| Substitution | "may be replaced by bank guarantee / FDR / surety bond" | Same clause |
| Interest on retention | "no interest shall be payable" (general) | General clause |

**Common mistakes:** missing that the deduction rate and the cap differ; mixing performance security and security deposit; stating the rate without the base; missing the release trigger.

### C3. Advances

| Field | Look for (words) | Where it hides |
|---|---|---|
| Is there one? | mobilisation advance, mobilization and construction machinery advance, plant and machinery advance, secured advance, advance payment | A clause plus a Schedule or contract data entry that says yes or no |
| Amount and instalments | "not exceeding X% of tendered value", "two instalments of 5%" | Advance clause |
| Interest | "interest free", "simple interest at X% per annum", "Bank Rate + N%" | Advance clause. A second, higher rate may apply if the advance is recovered by encashing the guarantee. |
| Security | "bank guarantee for 110% of the instalment", "not more than 6 bonds" | Advance clause |
| Recovery | "X% of each bill", "pro rata beyond the first 10% of work", "repaid before 80% of the period" | Advance clause |
| Conditions | "written request within one month", "utilisation certificate", "second instalment after 60 days" | Advance clause |

**Common mistakes:** inventing an advance because a bank-guarantee form mentions one; treating "Yes/No" as undecided when one word is struck through; merging two instalments into one; missing a second guarantee for equipment advances.

### C4. Delay damages (called liquidated damages, compensation for delay, damages or penalty)

| Field | Look for (words) | Where it hides |
|---|---|---|
| Existence and name | liquidated damages, compensation for delay, damages, penalty, amount withheld, retention for slippage | Delay clause, Schedule F, Contract Data, an annexure |
| Rate and base | "per day / week / month", "% of contract price / tendered value / bid price / value of unexecuted work" | May be 2 or 3 references deep |
| Cap | "shall not exceed 10%", "limited to a maximum of" | Same clause |
| Grace period and trigger | "within 30 days of the date", "fails to achieve any milestone", "progress below" | Same clause |
| Milestone mechanism | "amount to be withheld for each missed milestone", slippage scales | Schedule F, annexure |
| Refund | "refunded if made good", "refunded if completed in time" | Same clause |
| Extension of time | grounds, notice periods ("within 15 business days or right is lost") | Extension clause |
| Proof of loss language | "genuine pre-estimate", "without reference to actual loss", "not by way of penalty" | Definitions or a general clause |
| Other damages | lane closure, defects, late security, bid bar | Several articles |
| Termination link | "if damages exceed the cap the Authority may terminate", progress thresholds | Same clause or contract data |
| Early completion bonus | "bonus ... per day ... maximum" | Payment or delay article |

**Common mistakes:** stopping at "as per Contract Data"; missing that the rate is a maximum fixed by an authority named in a schedule; reading "damages ... not by way of penalty or liquidated damages" as "there are no damages"; reporting a per-month rate as per-day.

### C5. Price escalation or price variation

| Field | Look for (words) | Where it hides |
|---|---|---|
| Is it fixed price or not? | price variation, price adjustment, escalation, "rates firm", "no escalation shall be paid", 10C, 10CA, 10CC | A clause plus a schedule entry that switches it on or off |
| Applicability gates | "only if the amount in the NIT is more than Rs ten crore", "stipulated period exceeding 12 months" | Contract data, schedule |
| Formula | "V = ...", weights, a 0.85 factor | Often an image |
| Weights | labour, cement, steel, bitumen, fuel, plant, other materials, by work type | A table that can run across pages and appear twice with different numbers |
| Indices and lag | wholesale price index, labour index, bitumen price at a named refinery, "month three months before" | Definitions under the formula |
| Base date | "last stipulated date of receipt of tenders", "28 days before the bid due date" | Definitions |
| Exclusions and cut-offs | "only for work done during the stipulated period", "stage billed within 30 days" | After the formula |
| Statutory-change clause | "fresh law or statutory rule" | A separate clause (10C) |

**Common mistakes:** listing formulas as active when the clause is switched off; reading a labour percentage on the statutory-change clause as an escalation weight; inventing the algebra when the formula is an image; picking one of two disagreeing weight tables without saying so.

### C6. Guarantees and securities

| Field | Look for (words) | Where it hides |
|---|---|---|
| Bid security | earnest money, EMD, bid security, bid security declaration | NIT, bid data sheet |
| Performance security | performance guarantee, performance security, "X% of tendered amount / bid price" | A clause, Schedule E, contract data |
| Additional security for low bids | additional performance security, "bid below X% of estimate", a staircase or formula | Bid instructions, contract data |
| Timing | "within 15 days", late fee per day | Schedule F |
| Validity and extension | "valid until completion plus N months", "60 days after the defects period", "extended if time is extended" | Clause and contract data |
| Forms and issuers | bank guarantee, e-bank guarantee, surety bond, demand draft, FDR, banker's cheque; "scheduled bank", "commercial bank"; any restriction on a named bank | Clause, footnotes, circulars |
| Encashment and forfeiture | "on default", "on failure to commence", "on demand" | Clause, guarantee form |
| Release | "within N days of completion certificate", interest if returned late | Clause |
| Guarantees for advances | "110% of the instalment" | Advance clause |

**Common mistakes:** one number for performance security when there are layers; missing the validity extension; missing that the percentage lives in a schedule; missing footnotes that change accepted forms.

---

## 5. Traps found in real contracts (build and test for each)

All of these were seen in the four test contracts **[SEEN]**. The answer key already records the right answers.

| ID | Trap | Why a simple tool fails | What the tool must do |
|---|---|---|---|
| T1 | **Strike-through choice fields.** A schedule says "Yes/~~No~~" or "~~Applicable~~/Not Applicable". | Extracted text shows both words. Two text readers (ours and an independent one) both read it as undecided. | Detect choice patterns (`Yes ?/ ?No`, `Applicable ?/ ?Not Applicable`) and send that page as an image to a vision-capable model. Also try detecting lines drawn over words (PDF drawing objects). |
| T2 | **Formulas as images.** The price-adjustment equations are pictures. | The text layer holds only the variable definitions, so the AI invents the algebra. | Detect pages with images near "formula" words and read them visually. Never output a formula that was not seen. |
| T3 | **Scanned pages.** Circulars appended as scans, some in Hindi. | No text at all. | Report them as "not machine-readable", read them visually, mark confidence low, queue for a human. |
| T4 | **Rate and cap that disagree.** "Deduct 6%, total not above 5% of price." | The AI returns one number. | Return both, label rate and cap. |
| T5 | **Two-step references.** Delay clause says "as per Contract Data"; Contract Data says "as per Annexure P". | The AI stops at the first pointer and reports "rate not stated". | Follow pointers to the end (F7). |
| T6 | **Schedule overrides the clause.** The general text has a blank or a different value. | The AI quotes the clause. | Prefer the schedule and say so. |
| T7 | **Inactive clause with printed terms.** Price adjustment is printed in full but switched off by contract size. | The AI reports it as active. | Status `NOT_APPLICABLE`, keep the printed terms, explain the gate. |
| T8 | **Incorporated by reference.** The NIT says the General Conditions apply and does not include them. | The AI says "not stated" or invents typical values. | Status `POINTS_ELSEWHERE` and name the document. If the document is in the package, resolve it. |
| T9 | **Negative statements.** "No interest payable on any payment due." "No mobilisation advance." | The AI supplies a typical rate or advance. | Capture the negative as the answer. |
| T10 | **Conflicting values.** Weights 18/13 in one table and 20/20 in another; Milestone I at day 145 in a schedule and day 180 in a worked example; minimum bill value in the clause and in the schedule. | The AI picks one. | Return both and the governing rule if the document gives one (F9). |
| T11 | **Different words for the same thing.** "Damages", "compensation for delay", "amount withheld", "retention for slippage". "Security deposit" against "retention money". | Keyword search misses it. | Use the term lists in section 4 and the absence check (F8). |
| T12 | **Several numbers in one clause.** 10 working days, 28 working days, interest after 45 days. | The AI returns one. | One field per number, with unit and base. |
| T13 | **Conditional applicability.** Applies only above Rs 10 crore, or only for periods over 12 months. | The AI ignores the gate. | Evaluate the gate against the contract's value and period. If those are blank, say the gate cannot be evaluated. |
| T14 | **Template twins.** Two NHAI agreements share nearly all values. | The AI "finds" a difference that does not exist. | Compare field by field and report only real differences. |
| T15 | **Blank placeholders.** Contractor name and contract price are blank in a draft. | The AI makes one up. | Status `POINTS_ELSEWHERE` or `NOT_STATED` with a note. |
| T16 | **Image printouts at the front.** A portal printout holds dates, EMD and bid validity. | No text. | Visual pass (F3). |
| T17 | **Broken text.** Digits split ("0 .05%"), legacy-font Hindi, side headings beside the wrong paragraph. | Quote checks fail, numbers are misread. | Normalise whitespace for matching, check against the page image for key numbers. |
| T18 | **A word that looks like a negative.** "Damages ... are not by way of penalty or liquidated damages." | The AI concludes there are no damages. | Read the whole sentence. The clause defines the term "Damages". |

---

## 6. Output record the AI must return

One record per question. Full JSON Schema: `extraction_schema_v1.json`.

| Field | Meaning |
|---|---|
| `contract_id`, `clause_id` (C0 to C6), `question_id` (such as `2.2`) | Which question |
| `status` | `FOUND`, `NOT_STATED`, `NOT_APPLICABLE` or `POINTS_ELSEWHERE` |
| `answer_value` | Short, plain answer. Several parts separated by semicolons. Includes every rate, cap, period, base. |
| `unit` | Such as `% of gross bill`, `days`, `% per day of contract price` |
| `base` | What the percentage is of |
| `value_source` | `clause`, `schedule`, `contract_data`, `annexure`, `amendment`, `portal_page`, `other` |
| `section_ref` | Clause number as printed |
| `pdf_page` | PDF page number (position in the file) |
| `verbatim_quote` | At most 40 words, copied exactly, in one run. Empty only for `NOT_STATED`. |
| `conflicts` | List of other values found, each with its clause, page and quote |
| `points_to` | For `POINTS_ELSEWHERE`: the document or clause that holds the detail |
| `visual_check` | `none`, `needed`, or `done` with what the image showed |
| `confidence` | `high`, `medium`, `low` |
| `notes` | Under 60 words: traps met, ambiguity, what could not be read |

**Example** (from the CPWD GCC 2023 reference document, not a test contract):

```json
{
  "contract_id": "REF",
  "clause_id": "C4",
  "question_id": "4.2",
  "status": "FOUND",
  "answer_value": "Maximum 1% per month of delay, computed per day; the authority named in Schedule F decides the rate",
  "unit": "% per month of delay, accepted tendered value",
  "base": "accepted tendered value of work",
  "value_source": "clause",
  "section_ref": "Clause 2",
  "pdf_page": 29,
  "verbatim_quote": "With maximum rate @ 1% (one percent) maximum per month of delay to be computed on per day basis",
  "conflicts": [],
  "points_to": "",
  "visual_check": "none",
  "confidence": "high",
  "notes": "1% is a stated maximum, not a fixed rate. Cap of 10% is in the same clause."
}
```

---

## 7. Risk flags

Flags are written from the **contractor's** side. Every flag shows the rule, the value found, the reference value, the quote, and a plain-words reason. **Thresholds are starting points, not law.** Each reference is tied to a source we read.

| ID | Flag | Raise when | Severity | Reference and status |
|---|---|---|---|---|
| R1 | Retention or security deposit high or uncapped | Cap above 5% of price or no cap; or retention held to the end of the defects period with no stage release | Medium | 2022 Manual for Procurement of Works: security deposit usually 5% of each running bill, can be replaced by a bank guarantee, half released at taking-over **[SEEN]** |
| R2 | Rate above cap | Deduction rate is higher than the stated cap | Info | The tool should explain the effective figure. **[SEEN]** in NHAI test agreement |
| R3 | Performance security high | Above 5%, or an additional security for low bids applies | Medium | Manual: usually 5% **[SEEN]**. Department of Expenditure order of 12 Nov 2020 cut it to 3% **[SEEN, via a circular that quotes it]** |
| R4 | Delay damages uncapped or high | No cap, or cap above 10%; or daily rate above 0.05% of price | High if no cap, otherwise Medium | Manual: total not above 10% **[SEEN]**. CPWD GCC 2023: up to 1% a month, cap 10% **[SEEN]**. NHAI: 0.05% a day, cap 10% **[SEEN]**. Daily-rate line is **[ASSUMPTION]**, calibrate. |
| R5 | No extension-of-time route | Damages apply but no grounds for extension are found | High | Check each contract's extension clause |
| R6 | No interest on late payment | "No interest payable" or silent | High | **[SEEN]** in the MP tender. Silent is "unclear", say which. |
| R7 | Slow or unclear payment | Payment period above 30 days, or not stated | Medium | NHAI 30 days; CPWD 10 and 28 working days **[SEEN]**. 30 days is **[ASSUMPTION]**. |
| R8 | No advance, or a costly one | No mobilisation advance; or advance is interest-bearing; or guarantee above 100% of the advance | Medium | Manual: advance is need-based, interest-free advances discouraged **[SEEN]** |
| R9 | Fast advance recovery | Recovery finishes before the planned work could pay it back | Medium | Compare the recovery rule with the S-curve (F13) |
| R10 | Fixed price on a long contract | No price variation and planned duration above 18 months | High | Manual: price variation not applicable up to 18 months **[SEEN]** |
| R11 | Price variation with holes | No labour coverage; long index lag; cut-off for late billing; applies only above a size the contract does not reach | Medium | Read from the clause (C5) |
| R12 | Progress-linked termination or heavy withholding | Termination below a progress level; large percentages withheld for missed milestones | Medium | **[SEEN]** MP tender, MoEF tender |
| R13 | High minimum bill | Value needed before an interim bill is payable is more than one planned month of billing | Medium | **[SEEN]** IIT Bombay schedule |
| R14 | Guarantee validity tied to extensions | Validity must be extended whenever time is extended | Low | CPWD GCC 2023 **[SEEN]**. Estimate the guarantee cost. |
| R15 | Payment conditions | Bills not paid until labour registrations or other papers are submitted | Low | **[SEEN]** |
| R16 | Conflict in the document | Two places give different values (F9) | Needs review | n/a |
| R17 | Unresolved reference | `POINTS_ELSEWHERE` and the target document is not in the package | Needs review | n/a |
| R18 | Missing document | Schedules or conditions referred to but not supplied | Needs review | n/a |

**Not verified, do not hard-code:** the General Financial Rules limit on performance security plus retention for works (a news summary said 3 to 10% combined) and the MSME payment period (45 days, from commentary). Check the primary text first. Treat "does delay damages need proof of loss" as a contested question: the 2015 and 2025 Supreme Court rulings in the source register point in different directions. Show it as context, never as a rule.

---

## 8. Cash-flow impact module

### 8.1 Inputs

`V` contract value; `T` months; `p[m]` share of work done in month m (adds to 100%); `c` cost as a share of value; billing frequency; certification lag and payment lag (days); part-payment rule if any; retention rate `r`, cap `Rmax`, release rule; advance `A` (amount and instalment dates); advance recovery rate `ρ`; advance interest rate `i_a`; recovery deadline; guarantee commission `g` (% a year, **[ASSUMPTION]** user input); overdraft rate `i_od`; RBI Bank Rate `b`; delay `D` days; damages rate `ℓ` per day and cap `Lmax`; escalation weights `w[j]`, base indices, scenario indices; late-payment interest rate `i_late`.

### 8.2 Monthly steps

1. **Gross work:** `B[m] = V × p[m]`.
2. **Deductions:** retention `Ret[m] = r × B[m]` until the running total reaches `Rmax × V`; advance recovery `Rec[m] = ρ × B[m]` until the advance is repaid; other deductions if the contract lists them.
3. **Net certified:** `Net[m] = B[m] − Ret[m] − Rec[m]`.
4. **Cash in:** `Net[m]` arrives after the certification and payment lags. Advances arrive on their dates. Retention returns on its release date. Late payment earns `i_late` only if the contract says so.
5. **Cash out:** `Out[m] = c × B[m]` (add supplier credit days if the user supplies them).
6. **Position:** `Gap[m] = cumulative Out − cumulative In`. **Peak funding** is the largest positive gap.
7. **Interest cost:** `Σ max(0, Gap[m]) × i_od / 12`. Interest on the advance: `outstanding × i_a / 12`, using the higher rate if the contract says so for encashed guarantees.
8. **Guarantee cost:** `g × guarantee amount × years held`. Guarantee amount follows validity and extension rules.
9. **Delay damages:** `min(ℓ × D, Lmax) × V`, with the grace rule if there is one.
10. **Escalation:** if price variation applies, `Σ over bills of factor × B[m] × Σ w[j] × (I[j,m] − I[j,0]) / I[j,0]` using the contract's own factor (for example 0.85) and lag. If the contract is fixed price, exposure is `cost share of that material × index change`, shown as a scenario.
11. **Show two views:** "contract as written" and "if the risky term were at the reference value" (section 7).

### 8.3 Outputs

Monthly cash curve; peak funding and the month it happens; cash locked in retention and delayed payments; interest and guarantee cost; delay damages for the chosen delay; escalation exposure or recovery for the chosen index path; a sensitivity chart (delay, payment lag, advance on or off).

### 8.4 Hand benchmark the module must reproduce

Use illustrative round numbers (they are not from any contract). **[ASSUMPTION]** Contract value Rs 100 crore, 24 months, even monthly progress, NHAI-style terms (retention 6% capped at 5%, advance 10% in two parts, recovery 15% of each bill, damages 0.05% a day capped at 10%).

| Item | Hand calculation | Result |
|---|---|---|
| Gross work each month | 100 / 24 | Rs 4.1667 crore |
| Retention each month | 6% of 4.1667 | Rs 0.25 crore |
| Month in which retention reaches its 5% cap (Rs 5 crore) | 5 / 0.25 | Month 20 |
| Advance recovery each month | 15% of 4.1667 | Rs 0.625 crore |
| Month in which a Rs 10 crore advance is fully recovered | 10 / 0.625 | Month 16 (inside the 80% limit, which is month 19.2) |
| Net certified in month 1 | 4.1667 − 0.25 − 0.625 | Rs 3.2917 crore |
| Delay damages for 60 days | 60 × 0.05% of 100 | Rs 3 crore |
| Days of delay to reach the cap | 10% / 0.05% | 200 days (Rs 10 crore) |

The team's validation report should compare the tool's output with these hand numbers and list any difference with its cause.

---

## 9. Prompts

**Dev and test split.** Tune prompts on documents that are **not** in the test set: the CPWD GCC 2023 reference, the IIT Hyderabad GCC 2026, the NIT Meghalaya GCC, the CPWD EPC GCC 2024, and the Dr PDKV Akola tenders (all in the Source Register). Keep the four benchmark contracts for testing only. Do not use the NHAI Vijayawada agreement as a dev example, because it is nearly identical to the NHAI test agreement. Do not paste test answers into any prompt.

### 9.1 System prompt (use as is)

```
You are a careful reader of Indian public-works tender and contract documents.
You answer questions about financial terms using ONLY the text and page images supplied.

Rules:
1. Every answer needs a verbatim quote (at most 40 words, copied exactly, one run of text),
   the clause number as printed, and the PDF page number given in the page marker.
2. Never use outside knowledge about what is "usual". If the document does not say it, say so.
3. Status must be one of: FOUND, NOT_STATED, NOT_APPLICABLE, POINTS_ELSEWHERE.
   - NOT_APPLICABLE: the clause exists but the document switches it off for this contract. Keep the printed terms in the answer.
   - POINTS_ELSEWHERE: the document defers to another document or a blank schedule. Name it.
4. Give every number in the clause. Give the unit and what the number is a percentage of.
5. Follow every "as per Schedule / Contract Data / Annexure" pointer to its end before answering.
6. If a schedule or data sheet fills or overrides a clause, use it and say so.
7. If two places give different values, return both in "conflicts" and say which governs, if the document says.
8. Choice fields such as "Yes/No" or "Applicable/Not Applicable" may have one option struck through.
   You cannot see that in text. If a page image is supplied, read it; otherwise set visual_check to "needed".
9. Return JSON only, matching the schema. No commentary.
```

### 9.2 Extraction prompt (one call per clause type)

```
Contract id: {contract_id}
Clause type: {clause_id} {clause_name}
Pages supplied: text of PDF pages {page_list}, each starting with a marker [[PAGE n]].
Page images supplied for: {image_page_list}
Search terms that matter for this clause type: {term_list_from_section_4}

Answer each question below. Return a JSON list with one record per question, using the schema.
Questions:
{question_list_for_this_clause}

Reminders: quote exactly; page number from the marker; base and unit for every percentage and period;
all numbers in the clause; follow references; NOT_STATED only if nothing is said anywhere in the pages supplied.
```

### 9.3 Cross-reference prompt (second pass)

```
These answers contain pointers ("as per ...", "see ...", "Schedule ...", "Contract Data ...", "Annexure ...").
Pages supplied: {pointer_target_pages}.
For each pointer, find the target and return the value found there with its own quote and page.
If the target is blank or missing from the supplied pages, say POINTS_ELSEWHERE and name what is missing.
```

### 9.4 Absence prompt (before any NOT_STATED is accepted)

```
The question below was answered NOT_STATED. Search the whole package text again using these words: {term_list}
and these alternative wordings: {synonyms}. Also check schedules, contract data, annexures, footnotes and portal pages.
Return either the passage you found, or CONFIRMED_ABSENT with the list of sections you searched.
```

### 9.5 Visual prompt (schedule and image pages)

```
This is a page image from a tender schedule. Fields may offer a choice (for example "Yes / No" or
"Applicable / Not Applicable") where one option is struck through or circled, or a blank may be filled by hand.
For each financial item on this page (security deposit, performance guarantee, advance, delay compensation,
price variation, interim payment limit, milestones) report: the label as printed, the value printed,
which option is selected (the one NOT struck through), and anything unreadable.
If a formula is shown, write it out exactly as printed.
```

### 9.6 Verifier prompt (optional second check)

```
Question: {question}
Proposed answer: {answer_value} ({unit}, {base})
Quote: "{verbatim_quote}"
Does the quote, read in full, support exactly this answer? Reply SUPPORTED, PARTIAL (say what is missing)
or NOT_SUPPORTED (say why). Watch for: wrong base, wrong unit, a rate given as a cap, a period that is
certification and not payment, or a negative sentence read as a positive.
```

---

## 10. How to know it works

### 10.1 Test data

`golden_tests_v1.json` holds 208 expected answers (4 contracts x 52 questions), each with the expected status, answer, clause, PDF page and quote, a `core` flag for the crisp numeric ones, and `accept_also` where two statuses are both reasonable. The key was checked four ways (see the answer key's Read Me). **Still to do by a person:** compare the six main numbers with the PDF pages. Report this limit in the validation report.

### 10.2 Scoring rules (per question)

| Label | When |
|---|---|
| **Correct** | Status matches and every number, unit and base in the expected answer is present and right, and the quote is on the stated page |
| **Partial** | Status right, but a number, unit or base is missing. Count as Incorrect in the headline, but report separately |
| **Incorrect** | Wrong status or wrong number; or any invented value; or a quote that is not in the text |
| **Missed** | Expected `FOUND` but tool says `NOT_STATED` |
| **Correct absent** | Both say `NOT_STATED` |
| **Wrongly present** | Expected `NOT_STATED` but tool gives a value (a hallucination) |

Comparison rules: percentages and day counts must match exactly. "1% per month" and "0.033% per day" are the same only if the tool states the conversion. Multi-part answers need every part. Where `accept_also` lists another status, accept it but mark Partial.

### 10.3 Metrics to report

Per contract and per clause type: counts of each label; **precision** (correct answers over answers given) and **recall** (correct answers over answers in the key); core-test pass rate; quote verification rate; hallucination count (Wrongly present plus invented numbers); how often each trap in section 5 was hit.

### 10.4 Suggested targets **[ASSUMPTION]** (set your own, state them, then report honestly)

- Quote verification rate 100% (anything failing is discarded and retried, then queued).
- Zero invented values among the six main numbers per contract (retention, advance, damages rate, damages cap, payment days, performance security).
- Core tests: at least 90% Correct on the long standard-template contract and the real tender from your own institute; lower is acceptable on the trap-heavy tenders if every miss is logged with a cause.
- Visual pass triggered on every page that has a choice field, an image or no text.
- Stability: three runs at temperature 0 give the same status on at least 95% of questions.

### 10.5 Run protocol

1. Fix and record: model name and date, prompt version, schema version, temperature, retrieval settings.
2. Run all four contracts. Then run twice more to measure stability.
3. Score with the rules above. Write every Incorrect, Missed and Wrongly present into the error log.
4. Fix the cause, re-run, and keep the old scores so you can show improvement.
5. Keep the final run untouched for the report.

### 10.6 Error log columns and cause codes

Columns: run id, contract, question, expected, tool output, label, cause code, fix tried, result.
Cause codes: `TEXT_LAYER_MISSED_STRIKE`, `IMAGE_NOT_READ`, `SCAN_NOT_READ`, `REFERENCE_NOT_FOLLOWED`, `SCHEDULE_NOT_USED`, `RATE_CAP_MIXED`, `WRONG_BASE_OR_UNIT`, `ONE_OF_MANY_NUMBERS`, `INVENTED_VALUE`, `INVENTED_QUOTE`, `WRONG_CLAUSE`, `TERM_NOT_RECOGNISED`, `NEGATIVE_MISREAD`, `CONFLICT_MISSED`, `CONVENTION_DIFFERENCE`, `RETRIEVAL_MISSED`.

These feed the course's AI usage log and the reflection report (where the AI was wrong, with examples).

### 10.6a Core tests (examples; the full list is in `golden_tests_v1.json`)

| Test | Question | Expected status | Expected answer | Clause | PDF page |
|---|---|---|---|---|---|
| BM1-0.4 | Completion period and start trigger | FOUND | 730 days from the Appointed Date | Cl. 10.3(i) | 64 |
| BM1-1.3 | Days to pay after certification | FOUND | Payment no later than 30 days from submission of the Stage Payment Statement; if no IPC in 30 days the Authority pays the amount claimed and adjusts later | Cl. 19.9(i)(a) | 107 |
| BM1-1.4 | Interest on delayed payment | FOUND | Bank Rate + 3% per annum on all unpaid sums | Cl. 19.9(ii) | 108 |
| BM1-2.2 | Rate and base | FOUND | 6% of every payment for Works (stage payments under Cl. 19.5) | Cl. 7.5(i) | 50 |
| BM1-2.3 | Cap on total retention | FOUND | 5% of Contract Price | Cl. 7.5(i) | 50 |
| BM1-2.5 | When retention is released | FOUND | Balance refunded within 15 days of the Completion Certificate (after set-off of appropriations) | Cl. 7.5(iii) | 50 |
| BM1-3.2 | Amount and instalments | FOUND | 10% of Contract Price in two instalments of 5% each | Cl. 19.2(i) | 103 |
| BM1-3.3 | Interest-free or interest-bearing | FOUND | Interest-bearing at Bank Rate + 3% per annum | Cl. 19.2(i); 19.2(vii) | 102 |
| BM1-3.4 | Recovery method | FOUND | 15% deducted from each Stage Payment Statement from the first one; fully repaid before 80% of the scheduled construction period | Cl. 19.2(vi) | 104 |
| BM1-3.5 | Security for the advance | FOUND | Irrevocable unconditional e-Bank Guarantee for 110% of each instalment, valid until full repayment | Cl. 19.2(iii) and (iv) | 103 |
| BM1-4.2 | Rate and base | FOUND | 0.05% of Contract Price for each day of delay, reckoned from the date in Schedule J. Payable if the milestone or the Scheduled Completion Date is not achieved within 30 days of that date | Cl. 10.3(ii) | 64 |
| BM1-4.3 | Cap on damages | FOUND | 10% of Contract Price; above that the Contractor is in default and the Authority may terminate | Cl. 10.3(iii) | 65 |
| BM1-5.5 | Base date | FOUND | Last day of the calendar month at least 28 days before the Bid Due Date | Cl. 1.1 (Base Date) | 17 |
| BM1-6.2 | Amount and base | FOUND | Performance Security 3% of Bid Price; Additional Performance Security up to 3% of Bid Price; advance e-BG 110% of each instalment; equipment advance up to 5% of Contract Price | Cl. 7.1(i); 19.2 | 48 |
| BM1-6.5 | Validity and extension | FOUND | Performance Security valid until 60 days after the Defects Liability Period (may be furnished for 2 years and extended 2 months before expiry); Additional Performance Security valid until 28 days after Project Completion Date | Cl. 7.1(i)(B); 7.2 | 48 |
| BM2-1.6 | Minimum bill value or interim payment cap | FOUND | Minimum gross work Rs 30 lakhs (net of advances) before an interim payment is due | Schedule F, clause 7 | 109 |
| BM2-2.2 | Percentage and base | FOUND | 5% of gross amount of each running and final bill (Schedule E: 5% of tendered value) | Clause 1A; Schedule E | 105 |
| BM2-3.1 | Is a mobilisation advance given | FOUND | Yes. Schedule F entry for Clause 10B(ii) reads 'Yes/No' with 'No' struck through, so the mobilisation advance clause applies (up to 10% of tendered value, 10% simple interest) | Clause 10B(ii); Schedule F | 109 |
| BM2-3.2 | Percentage and instalments | FOUND | Up to 10% of tendered value; in two or more instalments decided by the Engineer-in-Charge | Clause 10B(ii) | 28 |
| BM2-3.3 | Interest on advance | FOUND | Simple interest 10% a year from date of payment to date of recovery, on the outstanding balance | Clause 10B(iii) | 28 |
| BM2-4.2 | Rate and base | FOUND | Maximum 1% of accepted Tendered Value per month of delay, computed per day; the actual rate is decided by the authority named in Schedule F (Deputy Director (FEA), IITB) | Clause 2; Schedule F | 17 |
| BM2-4.3 | Cap on damages | FOUND | 10% of accepted Tendered Value of work (or of the sectional part if a separate period applies) | Clause 2 | 17 |
| BM2-5.1 | Fixed price or price variation | FOUND | Price variation clauses are present. Schedule F: clause 10CA (materials) is NOT applicable ('Applicable' struck through). Clause 10CC (general escalation) IS applicable ('Not Applicable' struck through) but only for stipulated ... | Clauses 10C, 10CA, 10CC; Schedule F | 110 |
| BM2-6.2 | Amount or percentage and base | FOUND | Performance guarantee 5% of tendered amount; security deposit 5% of tendered value; earnest money Rs 4,24,547; advance guarantee 110% of the advance | Clause 1 | 15 |
| BM3-1.2 | Days for employer to certify an interim bill | NOT_STATED |  |  |  |
| BM3-1.3 | Days for employer to pay a certified bill | NOT_STATED |  |  |  |
| BM3-1.4 | Interest on delayed payment | FOUND | No interest payable on any payment due or awarded | GCC 23 | 52 |
| BM3-2.2 | Percentage and base | FOUND | 5% of gross amount of each running bill | Contract Data 17 | 64 |
| BM3-3.1 | Mobilisation advance given | NOT_APPLICABLE | No mobilisation and construction machinery advance is payable | Contract Data 19; GCC 32.1 | 64 |
| BM3-4.2 | Rate and base | FOUND | Milestone slippage: amount retained of 2.5%, 5%, 7.5% or 10% of the work remaining unexecuted (by slippage band); final delay: 0.05% of contract price per day | Annexure P | 68 |
| BM3-4.3 | Maximum cap | FOUND | 10% of contract price | Annexure P | 68 |
| BM3-5.1 | Fixed price or price variation clause | FOUND | Fixed price for this tender. Price adjustment applies only if the amount in the NIT is more than Rs 10 crore; this tender is Rs 1.89 crore | Annexure-1 GCC 31; Contract Data 18 | 2 |
| BM3-6.2 | Amount or percentage | FOUND | Earnest money Rs 188,650; performance security 5% of contract amount; additional performance security 5% for PWD road works; low-bid additional security by formula (see 6.8); security deposit 5% of running bills | ITB 22 (Annexure-1); Bid Data Sheet 9, 11 | 2 |
| BM4-1.3 | Days to pay a certified amount | POINTS_ELSEWHERE | Not stated in the NIT (interim payment period). The NIT incorporates CPWD GCC 2023 by reference (Schedule E), so the detail is in that document (see Reference_CPWD_GCC_2023.pdf). | Schedule E | 21 |
| BM4-2.2 | Percentage and base | FOUND | 2.50% of tendered amount | Schedule E | 21 |
| BM4-3.1 | Mobilisation advance given? | NOT_APPLICABLE | No: clause 10B(ii) shall not be applicable | Schedule F, Cl. 10B(ii) | 24 |
| BM4-4.2 | Rate and base | POINTS_ELSEWHERE | Delay compensation rate is not in this file (GCC clause 2). Schedule F fixes milestone withholding at 1.25% of accepted tendered amount per missed milestone | Schedule F, Cl. 2 and 5 | 23 |
| BM4-5.1 | Fixed price or price variation | FOUND | No general index-based escalation: clause 10CC and 10CA are Not Applicable. Clause 10C is marked Applicable with labour component 25% (statutory-change compensation only, per GCC) | Schedule F, Cl. 10C, 10CA, 10CC | 24 |
| BM4-6.2 | Amount or percentage for each | FOUND | EMD Rs 14,501; performance guarantee 5% of tendered amount; security deposit 2.50% of tendered amount | CPWD-6 para 11; Schedule E | 15 |

39 core tests of 208. BM3 and BM4 core tests include 'not stated' and 'points elsewhere' answers on purpose: they check that the tool does not invent values.

---

## 11. Build order for the remaining days

The final presentation is on 31 October, so submission is earlier. A realistic order:

1. **First:** F1, F2, F6, F11 on the NHAI test agreement (text only). Get the six main numbers and the quote check working. Run the scoring harness (F15) from the start.
2. **Next:** F5, F7, F8 so references and absence are handled. Re-score all four contracts.
3. **Then:** F3 (visual pass) and F4 (precedence). This fixes the IIT Bombay schedule and the formula pages. Re-score.
4. **Then:** F12 (flags) and F13 (cash module). Check the hand benchmark in section 8.4.
5. **Last:** F14 (report and review queue), the user manual, and the error log write-up.

Do not wait for the cash module to start scoring. Do not tune prompts on the test contracts.

---

## 12. Decisions the team has to make

1. **Parser:** plain text extraction plus a vision pass for flagged pages, or a layout-aware parsing service? Test on the four contracts either way.
2. **Which model for which job:** a vision-capable model for pages and a cheaper one for text is allowed. Record each choice.
3. **How deep the cash model goes:** monthly S-curve only, or with supplier credit and cost of capital?
4. **Which reference values** the flags may use. Anything not marked [SEEN] needs a source first.
5. **Privacy:** send only public documents to the API. Say so in the user manual.
6. **Hindi pages:** treat them as unreadable and queue for a human, or read them visually and mark low confidence.

---

## Appendix A. Reference values we actually read (use for flags and for sanity checks)

| Source | Value | Status |
|---|---|---|
| Manual for Procurement of Works 2022 (Dept. of Expenditure) | Performance security usually 5%. Security deposit or retention usually 5% of each running bill, replaceable by unconditional bank guarantee. Delay damages total not above 10% of contract price. Price variation not applicable up to 18 months. Mobilisation advance should be need-based and interest-free advances are discouraged. | [SEEN] |
| Dept. of Expenditure OMs of 12 Nov 2020 | Performance security cut from the earlier 5 to 10% to 3%. Bid security declaration instead of bid security. | [SEEN, via a circular that quotes them] |
| CPWD GCC 2023 (copy hosted by IIT Kanpur) | Security deposit 2.5% of tendered amount. Performance guarantee percentage in Schedule E, valid to completion plus at least 6 months. Delay compensation up to 1% a month, cap 10%. Part payment within 10 working days, rest within 28, simple interest 5% a year after 45 days if the bill is in order. Escalation clause 10CC uses a 0.85 factor. | [SEEN] |
| NHAI draft EPC agreement (test contract BM1) | Payment within 30 days; late interest Bank Rate + 3%; retention 6% capped at 5%; advance 10% in two parts at Bank Rate + 3%; recovery 15% of each stage payment; performance security 3%; damages 0.05% a day, cap 10%. | [SEEN] |
| IIT Bombay tender (test contract BM2) | Performance guarantee 5%, security deposit 5%; advance up to 10% at 10% simple interest; delay compensation up to 1% a month, cap 10%. | [SEEN] |
| MP Agro tender (test contract BM3) | Security deposit 5%; performance security 5% (plus 5% for road works); price adjustment only above Rs 10 crore; damages 0.05% a day, cap 10%; no interest on late payment. | [SEEN] |
| MoEF&CC tender (test contract BM4) | Security deposit 2.5%; performance guarantee 5%; clauses 10CA and 10CC not applicable; four milestones with 1.25% withheld for each miss. | [SEEN] |
| General Financial Rules 2017, Rule 171 for works | Performance security plus security deposit 3 to 10% combined | [UNVERIFIED, news summary] |
| MSME Development Act 2006, sections 15 and 16 | Payment within 45 days, interest at three times the RBI bank rate | [UNVERIFIED, commentary; sources disagree on 15 and 45 days] |

## Appendix B. Terms and short forms

NIT notice inviting tender. RFP request for proposal. GCC general conditions of contract. SCC special conditions of contract. EPC engineering, procurement and construction. HAM hybrid annuity model. CPWD Central Public Works Department. MoRTH Ministry of Road Transport and Highways. NHAI National Highways Authority of India. EMD earnest money deposit. PG performance guarantee. PS performance security. SD security deposit. DLP defects liability period. IPC interim payment certificate. BOQ bill of quantities. DSR delhi schedule of rates. WPI wholesale price index. CPI-IW consumer price index for industrial workers. BG bank guarantee. e-BG electronic bank guarantee. FDR fixed deposit receipt. DD demand draft. LD liquidated damages. EOT extension of time. PVC price variation clause. POL petrol, oil and lubricants. ROB road over bridge. Crore = 10 million. Lakh = 100,000.
