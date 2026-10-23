# Tender and Contract Analyser: Website Build Plan (v1)

CE725 | Team 2 | Topic 12 | drafted 23 Oct 2026 | presentation 31 Oct 2026

This plan turns `Tender_Analyser_Build_Spec_v1.md` (the spec) into a working website. Where the shared planning chat and the spec disagree, **the spec wins**: 4 statuses (`FOUND`, `NOT_STATED`, `NOT_APPLICABLE`, `POINTS_ELSEWHERE`), 52 questions per contract, 4 benchmark contracts, scoring against `golden_tests_v1.json`.

---

## 1. Decisions (recommended defaults, change before Day 1 ends)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Website stack | **Python FastAPI backend + React (Vite, TypeScript) frontend** | PDF work (PyMuPDF, pdfplumber) and the cash engine are Python. A real frontend gives the source viewer with highlighted quotes and a proper review queue, which Streamlit does badly. All needed Python packages are already installed. |
| D2 | How the tool calls Claude | **One adapter with two backends.** Default: the local `claude -p` command (Claude Code headless mode, runs on your Claude subscription). Optional: an Anthropic API key. | A Claude Pro/Max subscription does **not** include API access; the API is billed separately. `claude -p` works on any machine where Claude Code is logged in, which is enough for the demo and the scoring runs. The API route is faster and works from any machine, if the team wants to pay for it. |
| D3 | Model | One Claude model for text and page images, recorded in every run | The spec asks to log model name, date and settings (§10.5). |
| D4 | Storage | Files on disk, one folder per run (`runs/<run_id>/`), no database | The spec puts accounts and databases out of scope. |
| D5 | Parser | PyMuPDF text per page + visual pass on flagged pages (spec §12 Q1) | Already installed; gives page numbers, images, and drawing objects for strike-through detection (trap T1). |
| D6 | Hindi or scanned pages | Read visually, mark `confidence: low`, always put in the review queue (spec §12 Q6) | Keeps the tool honest without dropping content. |
| D7 | Cash model depth | Monthly S-curve with cost share, lags, retention, advance, damages, escalation, guarantee cost (spec §8). Supplier credit as an optional input. | Matches §8 and the §8.4 hand benchmark. |

---

## 2. Architecture

```
Browser (React)
  Upload & tag docs → Package check → Run progress → Clause table + Source viewer
  → Review queue → Risk flags → Cash flow → Evaluation (team only) → Export
        │  REST (JSON), background jobs with progress polling
FastAPI backend
  ingest/     F1 intake + hashing, F2 page text, F3 visual-pass triggers, page render
  structure/  F4 document map + precedence, F5 clause-type retrieval
  llm/        adapter: claude CLI | Anthropic API; prompt files versioned in prompts/v1/
  extract/    F6 extraction (1 call per clause type), F7 cross-refs, F8 absence check
  verify/     F9 conflicts, F10 normaliser, F11 verifier (V1–V9), schema validation
  params/     maps verified answers → cash-model parameters (Interface B)
  risk/       F12 rules R1–R18 from a table (rules_v1.yaml, each with its source)
  cashflow/   F13 deterministic engine (no LLM)
  evaluate/   F15 scoring vs golden_tests_v1.json, metrics, error log
  report/     F14 CSV (answer-key columns) + PDF report
runs/<run_id>/  pages.json, retrieval.json, raw_llm/*.json, answers.json,
                verification.json, review.json, flags.json, cashflow.json, score.json
```

**Key rule:** the LLM reads text and images and returns quotes and values. All arithmetic (normalising units, flags, cash flow, scoring) is plain Python.

### Interfaces (freeze on Day 1)

- **Interface A:** `extraction_schema_v1.json`. Already frozen.
- **Interface B: cash parameters.** Each parameter carries `value`, `unit`, `source_question_id`, `confirmed_by_user`.

| Parameter | Meaning | From question / user |
|---|---|---|
| `contract_value` | V (Rs) | C0 or user |
| `duration_months` | T | C0 or user |
| `progress_curve` | p[m], sums to 1 | user (default: even or S-curve) |
| `cost_share` | c | user |
| `cert_lag_days`, `pay_lag_days` | certification and payment lag | C1 |
| `late_interest_rate` | i_late (0 if "no interest") | C1 |
| `min_bill_value` | minimum interim bill | C1 |
| `retention_rate`, `retention_cap` | r, Rmax (share of V) | C2 |
| `retention_release` | rule: on completion / after DLP / staged | C2 |
| `advance_pct`, `advance_instalments` | A and timing | C3 |
| `advance_recovery_rate`, `advance_recovery_deadline` | ρ, deadline as share of T | C3 |
| `advance_interest_rate` | i_a | C3 |
| `ld_rate_per_day`, `ld_cap` | ℓ, Lmax (share of V) | C4 |
| `pv_applies`, `pv_factor`, `pv_weights` | price variation switch, factor, weights | C5 |
| `perf_security_pct`, `bg_validity_months` | guarantee amount and life | C6 |
| `bg_commission`, `overdraft_rate`, `bank_rate` | g, i_od, b | user |
| `delay_days`, `index_scenario` | D, index path | user |

The mapping step asks the LLM to **transcribe** numbers from verified answers into these fields (no calculation). Code then checks each number appears in its source answer or quote, and the user confirms it on the review screen before the cash model runs.

---

## 3. Website screens

| # | Screen | Shows | Spec |
|---|---|---|---|
| S1 | New analysis | Upload PDFs, tag each (NIT, GCC, schedules, special conditions, amendments, BOQ), enter project inputs, confidentiality notice | §2, F1 |
| S2 | Package check | Files, hashes, pages, text-per-page, pages needing a visual pass, documents referenced but missing | F1, F2, F3 |
| S3 | Run progress | Stage-by-stage progress, model, prompt version, cache hits | §10.5 |
| S4 | Clause table | 52 rows grouped by C0–C6: status, value, unit, base, section, page, confidence, verification badges | F6, F11 |
| S5 | Source viewer | Click a row: rendered PDF page with the quote highlighted, plus conflicts and the reference path | F4, F7, F9 |
| S6 | Review queue | Every `NOT_STATED`, `POINTS_ELSEWHERE`, conflict, visual-only, low-confidence or failed-verification item; accept / edit / reject with an audit trail (AI value against user value) | F14 |
| S7 | Risk flags | R1–R18 ranked; each with rule, value, reference value and its source, quote, plain-words reason; "high-risk term" separated from "unclear or missing" | F12 |
| S8 | Cash flow | Cash in vs out, cumulative gap, peak funding and month, retention locked, interest and guarantee cost, damages for chosen delay, escalation exposure; sliders (delay, payment lag, advance on/off); "as written" vs "at reference value" | F13 |
| S9 | Evaluation (team only) | Scores vs golden tests per contract and clause type, precision, recall, core pass rate, quote verification rate, hallucination count, trap hits, error log with cause codes, run-to-run comparison | F15 |
| S10 | Export and about | CSV in answer-key columns, PDF report, disclaimer ("decision support, not legal advice"), assumptions and limitations | F14 |

---

## 4. Build phases (8 days)

Each phase ends with a **re-score of all four contracts**, so we always know whether a change helped. Prompts are tuned only on `Reference_CPWD_GCC_2023.pdf` (and other dev documents from the Source Register if downloaded), never on BM1–BM4.

| Phase | Dates | Build | Done when |
|---|---|---|---|
| P0 Foundations | 23–24 Oct | git repo, folder layout, FastAPI skeleton; **F1/F2** ingest of all 5 PDFs; **F15** scoring harness (sanity test: golden answers scored against themselves = 100%); **F13** cash engine + unit test for the §8.4 benchmark | §8.4 table reproduced exactly; all PDFs give per-page text; harness runs |
| P1 First extraction | 24–25 Oct | LLM adapter (CLI + API), prompts v1 from spec §9, **F6** extraction, **F11** verifier V1–V4, schema validation, result caching | BM1 (NHAI) six main numbers correct; 100% of quotes pass or are discarded; first scores for all 4 recorded |
| P2 References and absence | 25–26 Oct | **F5** retrieval with term lists, **F7** cross-reference follower, **F8** absence check, **F9** conflicts, **F10** normaliser | Traps T4, T5, T6, T8, T9, T10, T11, T12 handled; re-score |
| P3 Visual pass and precedence | 26–27 Oct | **F3** strike-through detection (PyMuPDF drawings + choice regex) and page-image reading, formula images, scans; **F4** document map and precedence | BM2-3.1 (IIT Bombay "Yes/~~No~~") and BM2-5.1 correct; re-score |
| P4 Website | 27–28 Oct | React app: S1–S10; **F12** risk rules; Interface B mapping + confirmation; cash view | Full flow works end to end on BM1 in the browser |
| P5 Freeze and measure | 29 Oct | **F14** review queue and exports; 3 runs at temperature 0 for stability; final run frozen | Stability ≥ 95% same status (spec §10.4); final scores saved |
| P6 Docs and demo | 30 Oct | User manual, validation report numbers, error log write-up, AI usage log check, demo script, every member rehearses | Demo runs offline from cached results if the network or usage limit fails |

Fallback if behind schedule: drop F3's automatic strike-through detection (send all choice-field pages to the visual pass instead), then drop the PDF report (keep CSV), then drop the escalation scenario from the cash view. Never drop F11, F13's benchmark test or F15.

---

## 5. Ownership (each teammate must be able to explain their module in the viva)

| Module | Features | Owner validates by |
|---|---|---|
| M1 Ingest and extraction | F1–F8, prompts | Error log with cause codes for every miss in their clause types |
| M2 Verification and scoring | F9–F11, F15, review queue logic | Planted-fake-quote test; scoring sanity test; final metrics table |
| M3 Risk rules | F12, `rules_v1.yaml` | Boundary-value table (exactly 30 days, exactly 5%, exactly 10%) |
| M4 Cash flow | F13, Interface B | §8.4 hand benchmark in Excel and in Python, matched exactly |
| M5 Website and report | S1–S10, exports | Usability test with 2–3 peers or a practitioner (bonus credit) |

---

## 6. Risks to the build

| Risk | Mitigation |
|---|---|
| `claude -p` is slow or hits the subscription usage limit during scoring runs | Cache every LLM response by (file hash, page set, prompt version, model); score from cache; run full scoring overnight; API key as backup |
| Long PDFs exceed what one call should see | Retrieval (F5) sends only candidate pages per clause type plus their pointer targets |
| Prompt tuned on test contracts by accident | Dev/test split enforced in code: test PDFs refused in "dev mode" |
| Demo fails live | Demo mode loads a frozen run from `runs/` |
| Golden key itself has errors | Spec §10.1: a person still checks the six main numbers against PDF pages; report the limit |

---

## 7. Not building (from the spec and the chat)

Clause types beyond C0–C6; financial statement analysis (Topic 8); employer or lender views; legal advice; user accounts, databases, deployment; confidential contracts; LLM arithmetic. These go in "future work".
