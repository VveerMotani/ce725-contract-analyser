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
The sidebar and header show a **MOCK** badge with the reason.

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

| Route | Screen |
|---|---|
| `/new` | S1 New analysis: benchmark or upload with tags, project inputs, confidentiality notice |
| `/packages/:id`, `/runs/:id/package` | S2 Package check |
| `/runs/:id/progress` | S3 Run progress (polls every 2 s) |
| `/runs/:id/overview` | Overview dashboard (default for a finished run) |
| `/runs/:id/clauses` | S4 Clause table; rows open S5, the source viewer drawer |
| `/runs/:id/review` | S6 Review queue with audit trail |
| `/runs/:id/flags` | S7 Risk flags |
| `/runs/:id/cash` | S8 Cash flow: confirm parameters, then charts and sliders |
| `/evaluation` | S9 Evaluation (team only) |
| `/runs/:id/export`, `/about` | S10 Export and About |

## Code map

- `src/types.ts`: TypeScript mirror of `backend/analyser/models.py`.
- `src/api.ts`: REST client, mock switch, page-image URLs.
- `src/context.tsx`: app state (theme, money format, source viewer) and the current run (meta polling, answers, review counts).
- `src/lib/`: Indian money formatting (`Rs 4.17 crore`, `Rs 25.0 lakh`, full `Rs 4,16,66,667`), key figures for the overview, progress curves.
- `src/components/`: layout, the source viewer drawer and UI primitives (chips, KPI tiles, rings, donut, quotes).
