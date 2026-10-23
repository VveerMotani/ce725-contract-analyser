# Validation run, 23 Oct 2026: Claude reads the four benchmark contracts

## How the run was done

- **Reader.** No API key was available, so four Claude Code subagents (Claude Opus 5.5), one per contract, played the extraction model. Each got only what the API pipeline would send: the page text with page markers and struck-through words marked `~~like this~~`, images of the visual pages, the 52 questions, the v1 system prompt and the output format (`backend/scripts/prepare_agent_workspaces.py`). They were told not to open any other file; the answer key was never in their folder.
- **Difference from the API design.** The subagents searched the text with tools (grep, read) instead of getting one long prompt per clause type. Report this as a method difference.
- **Pipeline.** Their `answers.json` files went through the real tool: schema check, verifier, cash parameters, cash flow, risk flags, scoring (`backend/scripts/import_agent_answers.py`). Runs: `BM1_agent-20261023-231019`, `BM2_agent-20261023-231019`, `BM3_agent-20261023-231019`, `BM4_agent-20261023-231020` (also frozen in `runs/frozen/`).
- **Grading.** The code's deterministic comparison is a first pass only. Four more subagents, one per contract, then graded every test strictly by spec §10.2 (`backend/scripts/agent_judge.py`). They saw the answer key, the tool's answer and quote, the code's label and the contract text. The judge's label is the final label; the code's label is kept in each test's reason.
- **People still have to confirm:** the key issues listed below, and a sample of the judge's labels.

## Headline (graded against the answer key as it stands)

| Contract | Correct | Correct absent | Partial | Incorrect | Missed | Wrongly present | Fully right |
|---|---|---|---|---|---|---|---|
| BM1 NHAI Makhu EPC | 44 | 5 | 3 | 0 | 0 | 0 | **49 / 52** |
| BM2 IIT Bombay tender | 33 | 4 | 13 | 2 | 0 | 0 | **37 / 52** |
| BM3 MP Agro tender | 45 | 4 | 2 | 1 | 0 | 0 | **49 / 52** |
| BM4 MoEF NIT | 40 | 1 | 7 | 3 | 1 | 0 | **41 / 52** |
| **All** | **162** | **14** | **25** | **6** | **1** | **0** | **176 / 208 (84.6%)** |

- **Precision 83.9%, recall 84.4%.** Core-test pass rate 84.6% (33 of 39). Quote verification rate 99.5%.
- **Hallucinations: 0.** The tool never gave a value where the key says there is none. The verifier flagged 4 numbers it could not find in the text layer, and all 4 are real:
  - BM1 0.85 is in a formula image.
  - BM3 3.50% is in Hindi legacy-font text.
  - BM3 Rs 30,000 and Rs 18,000 are written in words.
  - BM2 Rs 2.12 crore is a rounding of Rs 2,12,27,336.
- **Most errors are Partial (25).** The tool was right but left out one part of a multi-part answer, often putting it in its notes instead of the answer field.
- **5 of 6 Incorrect are status disagreements where the content agrees with the key.** For example, the tool says NOT_APPLICABLE and the key says FOUND for the same "switched off" fact. The key's `accept_also_status` did not allow the second status.
- Full files: `summary_judged.txt`, `scores_judged.xlsx`, `error_log_judged.csv`, `judge_notes.csv`. The deterministic-only score is in `summary.txt`: 85.1%, with 143 tests flagged for a human check.

## Error causes (judge's cause codes)

| Cause | Count | What it means |
|---|---|---|
| ONE_OF_MANY_NUMBERS | 17 | A number or part of a multi-part answer is missing |
| CONVENTION_DIFFERENCE | 10 | Status or field convention differs from the key's (content mostly agrees) |
| TEXT_LAYER_MISSED_STRIKE | 2 | BM2-1.3 / 1.4, see key issues: here the **key** missed the strike-through |
| IMAGE_NOT_READ | 1 | BM1-5.2: the maintenance formula image was not supplied or read |
| RETRIEVAL_MISSED | 1 | BM1-4.8: early-completion bonus and Authority's damages not found |
| CONFLICT_MISSED | 1 | BM2-4.6: Clause 22 not cited |

## Where the answer key looks wrong (a person must check before changing the key)

| Test | Finding | Evidence |
|---|---|---|
| BM2-1.3 | The 10th/15th working-day payment sentence is struck through, so the contract gives no interim payment period. The tool is right; the key is not. | p25, page image and text strike marks |
| BM2-1.4 | The interim 5%/45-day interest and the 10% advance-interest paragraph are struck through; only the 5% on a delayed final bill (Clause 9) stands. This matches the tool. | p25, p26 |
| BM2-4.8 | Clause 19K does not apply below Rs 5 crore (this tender is Rs 2.12 crore), so the tool was right to leave it out. | p48 |
| BM3-2.7 | The key's answer is right, but the quote and page are missing. | GCC 23, p52 |
| BM1-1.5 | The key's note is inaccurate (taxes are a deduction in Schedule O), but the answer itself is fine. | p236 |

Confirmed **not** key errors: BM3-4.8 (amounts written in words on p61) and BM3-5.1 (Rs 1.89 crore is a fair rounding of Rs 188.65 lakh).

If the three BM2 items are confirmed and added to `backend/analyser/evaluate/manual_overrides.json`, BM2 rises to about 40 / 52.

## Where the scoring code was wrong (fix list for the scorer)

The judges found 17 tests where the deterministic label was wrong, in both directions:

- **Too harsh:**
  - a clause number counted as a missing value (BM1-1.7);
  - a different, correct number read as a contradiction (BM1-5.3 weights vs 85%, BM2-5.3 85% vs 35%, BM4-6.6 7 vs 10 days);
  - a scanned-page quote treated as invented (BM3-1.6).
- **Too lenient:** a missing part not noticed (BM1-6.2, BM2-4.6, BM2-5.2, BM2-5.5, BM2-6.5, BM3-6.2, BM4-1.5).

Report this as a limit of rule-based scoring. It is also why the final labels come from the judge, with the code as a cross-check.

## What the tool found in each contract (contractor's view)

| Contract | Main risks raised | Cash result (illustrative inputs) |
|---|---|---|
| BM1 (Rs 100 crore assumed, price blank in draft) | Advance recovered by month 16 of 24 (67% of work); interest-bearing advance at Bank Rate + 3%; low-bid additional security; termination when damages exceed 10%; 6% deducted against a 5% cap; Schedules A–D and H missing | No funding gap (the 10% advance covers it); Rs 5 crore locked in retention; terms cost about Rs 95 lakh |
| BM2 (Rs 2.12 crore, 9 months) | Rs 30 lakh minimum bill (above one month's billing); security deposit held 12 months after completion; advance at 10% interest | Peak funding Rs 25.9 lakh in month 8 |
| BM3 (Rs 1.89 crore, 12 months) | **No interest on late payment** (High); payment period not stated; termination penalty 20% of unexecuted work; deposit held to end of defects period; no advance | Peak funding Rs 13.4 lakh in month 1 |
| BM4 (Rs 7.25 lakh, 40 days) | Most money terms are only in CPWD GCC 2023, which is not in the package (15 answers depend on it); 1.25% withheld per missed milestone; no advance | Peak funding Rs 3.1 lakh |

Cash figures use the illustrative project inputs in `import_agent_answers.py` (contract value and duration from the documents; cost share 85%; overdraft 10%; no delay). They are scenarios, not predictions.

## Limits to state in the report

- **One run per contract.** No stability measurement yet; spec §10.4 asks for 3 runs.
- **AI grades AI.** The judges are the same model family as the reader. A person should re-grade a sample (for example all 39 core tests) and record agreement.
- **Untested path.** The reader worked agentically (search tools), not through the API prompt design; the API path is still untested live.
- **Scenario inputs.** BM1's contract price is blank, so its cash numbers use the spec's illustrative Rs 100 crore.
