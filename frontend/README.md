# Tender and Contract Analyser: website (M5b)

React 18 + TypeScript + Vite 6, Tailwind CSS 4, React Router 6, Recharts 2, lucide-react. All versions are pinned in `package.json`.

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to http://127.0.0.1:8000 (FastAPI)
```

Start the backend separately from `backend/`: `uvicorn analyser.api.app:app --reload --port 8000`.

## Mock mode (no backend)

```bash
npm run dev:mock     # loads .env.mock (VITE_MOCK=1): every /api call is answered by src/mock/
```

Mock mode also switches on automatically when the backend does not answer `GET /api/benchmarks`
at start-up (unreachable, or a non-JSON / 5xx reply), or when the URL has `?mock=1`.
The footer and the note under each report say the data is made up.

Mock data (all clearly fake, for development only):

- `src/mock/golden.json`: a copy of `../golden_tests_v1.json`; refresh it with `npm run gen-mock`.
- `src/mock/data.ts`: builds the 52 answers per benchmark from the golden tests, with deterministic, made-up
  "tool mistakes" (Partial, Incorrect, Missed, ...), verification checks, review reasons, packages, cash
  parameters, risk flags and the evaluation summary.
- `src/mock/cashEngine.ts`: a small TypeScript version of spec §8.2 so the cash sliders react. The real
  numbers come from the Python engine through `POST /api/runs/{id}/cashflow`.
- `src/mock/server.ts`: routes the same REST paths as `backend/INTERFACES.md` in memory. New runs step
  through the stages in about 20 s. BM1 is editable; BM2 to BM4 behave as frozen demo runs (403 on
  review and parameter edits). State resets on page reload.

## Build

```bash
npm run build        # tsc -b && vite build  ->  frontend/dist (served by the backend)
npm run typecheck    # TypeScript only
npm run preview      # serve dist on :4173 (also proxies /api)
```

## Screens

The site is a report you read top to bottom, not a dashboard. A slim top bar holds the name, a contract
switcher and three links (Report · All answers · Accuracy). One reading column, light theme by default
(dark toggle in the top bar), Source Serif 4 for headings and Inter for text.

| Route | Screen |
|---|---|
| `/` | Home: what the tool does in one paragraph, the four test contracts (title, issuer, value, one-line status), "Upload a contract" |
| `/new`, `/new?benchmark=BM1` | Read a contract: (1) the contract (upload PDFs and say what each file is), (2) a few project facts with defaults; more settings are collapsed |
| `/runs/:id` | **Contract report**, a factsheet: title + source tag; four key figures (contract value, duration, defects period, peak funding) and a flag tally (serious / watch / fine / not checked). **Money terms**: six cards (Payment, Retention, Advance, Delay penalty, Price adjustment, Guarantees), each with one big number, a small inline-SVG graphic, a status dot and a page link. **Flags**: red flags and green flags side by side from `GET /runs/{id}/checks` (falls back to `/flags`), rows expand to the explanation, quote and page; a collapsed line lists rules not checked and items to confirm. **Cash**: three figures, one cash-position chart, a delay slider; assumptions and month table behind disclosures. A pill links to the answers to confirm |
| `/runs/:id/terms/:term` (`payment`, `retention`, `advance`, `delay`, `price`, `guarantees`) | Term detail, opened by clicking a money-term card: tabs across the six terms, big number and dot, large graphics (payment timeline and money owed; retention held per month; advance still owed with recoveries and deadline; delay penalty in rupees with its own slider and milestones; index weights per work type, formula and a price-rise scenario; securities in rupees and validity bars), key points, every question of the clause with page links and conflicts, and the clause's flags |
| `/runs/:id/answers` (`?filter=check`) | All 52 answers grouped by term, with a status word, page link and check mark. "Needs a check" shows the review actions (It is right / Correct it / It is wrong) |
| `/runs/:id/technical` | Technical details: model, effort, versions, tokens, progress log, files and hashes, pages read as images, missing documents, risk rules with codes and sources, PDF and CSV downloads |
| `/accuracy` | Overall "176/208" with a stacked bar, then per contract "49/52" with a stacked bar and its mistakes collapsed (tool vs answer key, and why). Precision, recall etc. behind "More measures". Says which runs were read by Claude and which are answer-key replays |
| `/about` | What the tool does, assumptions, limits, confidentiality |

Old addresses (`/runs/:id/overview`, `clauses`, `review`, `flags`, `cash`, `progress`, `package`, `export`, `/evaluation`) redirect to the new screens.

## Wording rules

- Factsheet style: numbers and small graphics first, words as labels. Headings 1–3 words, labels ≤ 6 words; anything longer sits behind an (i) or an expand.
- Card graphics use cash parameters only when their provenance is "extracted" or "user", plus the cash model result; otherwise the card shows "—" or where the term lives.

- No raw enums, check ids or jargon on screen. Statuses read "Found", "Not in document", "In another document",
  "Switched off"; review reasons and verification checks are mapped to plain sentences (`src/lib/plain.ts`).
  Rule codes (R9 ...) appear only as a small muted tag and on the Technical page.
- Money in Indian style: Rs 4.2 crore, Rs 25 lakh (`src/lib/format.ts`).
- The six term sentences (`src/lib/terms.ts`) are built from the effective answers (a person's correction if any, else the AI answer).
  A cash parameter is used only when its provenance is "extracted" or "user"; a default is never shown as a contract fact. When the
  wording is unclear the answer text is shown instead of an invented number.
- Data source note under the report header: "Answers read by Claude (Opus 5.5)" for runs whose model names Claude (including
  "subagent" runs), "Answer-key replay" for replay runs, "Made-up sample answers" in mock mode.

## Code map

- `src/types.ts`: TypeScript mirror of `backend/analyser/models.py` (unchanged).
- `src/api.ts`: REST client, mock switch, page-image URLs (unchanged).
- `src/context.tsx`: app state (theme, source panel, runs and benchmarks lists, new-analysis draft) and the current run (meta polling, answers, review count).
- `src/lib/plain.ts`: plain words for statuses, terms, the 52 question topics, review reasons, checks, flags, accuracy labels and run sources.
- `src/lib/terms.ts`: text helpers (percentages, days, rates, other-document targets) and parameter provenance.
- `src/lib/scorecard.ts`: red / green flags, tally and card dots from `/checks` + `/flags`.
- `src/lib/format.ts`: Indian money, percentages, dates.
- `src/components/`: `Layout` (top bar, footer), `SourcePanel` (page image with the quote highlighted), `RunReady` (progress / error states), `ui` (small primitives).
- `src/lib/termDetail.ts`: term slugs and text parsers for the detail pages (days, rupees, weights, milestones, guarantee validity).
- `src/pages/`: `Home`, `NewAnalysis`, `Report` (+ `TermCards`, `Flags`, `CashEffect`), `TermDetail` (+ `TermPanels`, `TermDetailParts`), `AllAnswers`, `Accuracy`, `Technical`, `About`.
- `src/mock/server.ts` also answers `GET /runs/{id}/checks` (every rule without a mock flag counts as a pass).
