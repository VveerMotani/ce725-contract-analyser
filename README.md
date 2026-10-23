# Tender and Contract Analyser

CE725 Team 2, Topic 12: AI Contract Analyser for Financial Risk Clauses.

A website that reads Indian public-works contract PDFs and, from the contractor's side:

1. **Finds** six financial terms (payment, retention, advances, delay damages, price escalation, guarantees) plus contract facts, answering 52 fixed questions.
2. **Shows proof** for every answer: verbatim quote, clause number, PDF page, with the page shown and the quote highlighted.
3. **Checks the AI**: every quote is matched against the PDF text; numbers must appear in the quote; anything doubtful goes to a review queue for a person.
4. **Flags risks** with fixed, editable rules (R1–R18) tied to a source.
5. **Models cash impact** (peak funding, interest, guarantee cost, damages, escalation) with plain Python. The AI never does arithmetic.
6. **Scores itself** against a hand-built answer key of 208 questions over four public contracts.

The proof that the tool works (accuracy, where the AI went wrong, contract comparison, as written vs fair terms,
repeat readings, people's spot checks of the judge's labels) lives in a separate **Project** area of the website
(`/project`), not in the contractor pages.

Decision support, not legal advice.

## Quick start

Needs Python 3.11+ and Node 20+.

```bash
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
python backend/run_server.py
```

Open http://127.0.0.1:8000. API docs at http://127.0.0.1:8000/docs.

To run the AI, copy `backend/.env.example` to `backend/.env` and add your Anthropic API key (never commit `.env`). Without a key the site still works on the frozen demo runs in `runs/frozen/`.

Frontend development with hot reload: `cd frontend && npm run dev` (http://localhost:5173, proxies `/api` to the backend). Without a backend: `npm run dev:mock`.

## Commands (run from `backend/`)

| What | Command |
|---|---|
| All tests | `python -m pytest -q` |
| Show prompts and token estimate, no API call | `python -m analyser.extract BM1 --dry-run` |
| Extract one contract from the command line | `python -m analyser.extract BM1` |
| Score runs against the answer key | `python -m analyser.evaluate ../runs/<run_id> [--error-log] [--xlsx] [--judge]` |
| Check the answer key's quotes against the PDFs | `python -m analyser.evaluate.golden_check` |
| Record a person's check of a judge label | website → Project → Manual check (writes `analyser/evaluate/manual_overrides.json`, re-scores the run: code, judge verdicts from `validation/*/`, overrides last) |
| Answer-key replay runs (pipeline test, no AI) | `python -m scripts.make_replay_runs [--freeze]` |
| Freeze a run for the offline demo | `python -m analyser.api.store freeze <run_id>` |
| Rebuild the §8.4 Excel benchmark | `python -m analyser.cashflow.benchmark` |

## How it fits together

```
PDFs → ingest (pages, strike-throughs, scans) → retrieval (candidate pages per clause type)
     → Claude: one call per clause type, cross-reference pass, absence pass, page images for visual pages
     → verifier (quote in PDF? page right? numbers in quote?) → review queue (people decide)
     → cash parameters (AI transcribes, code checks, user confirms) → cash-flow engine → risk rules
     → website + CSV + PDF report;  benchmarks → scoring vs golden_tests_v1.json
```

| Module | Folder | Owner | Notes |
|---|---|---|---|
| M1a Ingest and retrieval | `backend/analyser/ingest`, `structure` | | F1–F5; strike-through detection (trap T1) |
| M1b Claude extraction | `backend/analyser/llm`, `extract`, `params`, `backend/prompts/v1` | | F6–F8; prompts are versioned; every call cached in `backend/cache/llm` |
| M2 Verification and scoring | `backend/analyser/verify`, `evaluate` | | F9–F11, F15; `manual_overrides.json` for human labels |
| M3 Risk rules | `backend/analyser/risk` (`rules_v1.yaml`, `README.md`) | | F12 |
| M4 Cash flow | `backend/analyser/cashflow` (`FORMULAS.md`, `benchmark_8_4.xlsx`) | | F13; reproduces spec §8.4 exactly |
| M5 API, reports, website | `backend/analyser/api`, `report`, `frontend/` | | F14 |

Shared types: `backend/analyser/models.py`. Module contracts: `backend/INTERFACES.md`. Requirements: `Tender_Analyser_Build_Spec_v1.md`. Build plan: `WEBSITE_BUILD_PLAN.md`.

## Rules the team agreed

- Prompts are tuned only on `Dev Documents/` and `Benchmark Contracts/Reference_CPWD_GCC_2023.pdf`, never on BM1–BM4.
- Only public documents go to the API. Real client contracts must not be uploaded.
- Every AI-assisted step goes in the AI usage log the day it happens.
- Change `models.py` or `INTERFACES.md` only with every module owner's agreement.
