# Static copy of the website (Cloudflare Pages)

A fully static, read-only copy of the site: no Python server, free hosting on Cloudflare Pages.
It shows only the four frozen Claude-read runs in `runs/frozen/BM*_agent-*` (the same selection as
`deploy/build_hf_space.py`; answer-key replays are left out).

## Rebuild

From the project root (needs the backend's Python packages, Node 20+ and `frontend/node_modules`):

```bash
python deploy/build_static_site.py             # about 2 minutes; writes deploy/static-site/ (gitignored)
python deploy/build_static_site.py --no-pages  # JSON only, no page images (quick check)
python deploy/build_static_site.py --skip-npm  # keep the built website, redo the data
```

What it does:

1. Builds the website with `VITE_STATIC=1` (`npm run build -- --outDir deploy/static-site`), so
   `frontend/dist`, which the backend serves, is not touched. `VITE_STATIC_SAVED` (today's date)
   goes into the footer: "Static copy · results saved on <date>".
2. Starts the real FastAPI app in-process (`fastapi.testclient.TestClient`) with
   `ANALYSER_READ_ONLY=1` and a temporary `RUNS_DIR` holding only the four frozen runs, and saves
   every response the site can ask for, unchanged:

   | Server | Static file |
   |---|---|
   | `GET /api/benchmarks`, `/runs`, `/evaluation` | `/static-api/benchmarks.json`, `runs.json`, `evaluation.json` |
   | `GET /api/runs/<id>` and `/answers`, `/params`, `/flags`, `/checks`, `/score` | `/static-api/runs/<id>.json`, `/static-api/runs/<id>/answers.json`, ... |
   | `GET /api/packages/<pkg>` | `/static-api/packages/<pkg>.json` |
   | `GET /api/runs/<id>/reference-changes` | `/static-api/runs/<id>/reference-changes.json` |
   | Project area: `GET /api/golden/<cid>`, `/project/judge-notes`, `/project/overrides` | `/static-api/golden/<cid>.json`, `/static-api/project/judge-notes.json`, `overrides.json` (saved with `read_only: true`, so Manual check shows no buttons) |
   | `GET /api/runs/<id>/export.csv`, `report.pdf` | `/static-api/runs/<id>/export.csv`, `report.pdf` |
   | `POST /api/runs/<id>/cashflow` (grid below) | `/static-api/runs/<id>/cashflow/<key>.json` |
   | `GET /api/packages/<pkg>/page/<doc>/<n>.png` | `/static-pages/<pkg>/<doc>/<n>.png` (every page of the four PDFs) |
   | same with `?highlight=<quote>` | `/static-pages/<pkg>/<doc>/<n>-<hash>.png`, listed in `/static-api/pages.json` |

3. Renders the page images with the real `render_page_png` (zoom 2.0, as the server), then stores
   them as 128-colour palette PNGs (same pixel size, about half the bytes). A highlighted variant is
   made for every quote the site can highlight: each answer's `verbatim_quote` (and a person's
   correction), each red flag's quote, the quotes of documents referred to but missing, and every
   answer-key quote (`golden_tests_v1.json`, for the Project area's "Key's page" buttons).
   Conflict quotes are never highlighted by the site (it shows those pages plain), so they get the
   plain page. If a quote is not found on its page the highlighted image would equal the plain one,
   so none is written and the site uses the plain page.
4. Writes `_headers` (download names for the CSV and PDF, caching) and prints the file count and size.

## The grid and the keys

Defined once in `frontend/src/staticGrid.json`, read by both the builder and `frontend/src/staticSite.ts`:

| Slider | Request | Grid | Files per run |
|---|---|---|---|
| none (report, term pages) | `overrides: {}` | | `base` |
| Report → Cash → Delay | `{delay_days: d}` | 0 to 360 days, step 15 (the slider snaps to it and says "steps of 15 days") | `delay-0` ... `delay-360` (25) |
| Price adjustment → If prices rise | `{index_rise_pa: {labour, cement, steel, fuel, bitumen, materials: p/100}}` | 0 to 15 %, step 0.5 (the same step as the live site) | `rise-0` ... `rise-15`, e.g. `rise-7.5` (31) |

The delay slider on the Delay penalty page and the arrow diagram need no extra files (the first is
computed in the browser, the second uses the Report's cash result). Other overrides are not
precomputed; the site never sends them.

Highlight key: FNV-1a 32-bit hash (8 hex characters) of the UTF-8 bytes of the quote, cut to 400
characters as the site cuts it.

## Deploy

```bash
npx wrangler pages deploy deploy/static-site --project-name <name>
```

(Or drag the folder into the Cloudflare dashboard: Workers & Pages → Create → Pages → Upload assets.)

There is no `404.html`, so Pages serves `index.html` for every unknown path: client routes such as
`/runs/<id>`, `/runs/<id>/terms/<term>`, `/runs/<id>/answers`, `/project/...`, `/about` work on reload and
as shared links. No `_redirects` is needed. The site checks the content type of every saved file it
fetches, so a missing file (served as `index.html`) shows the usual "not available" message.

To try it locally, serve the folder with any static server that falls back to `index.html`
(for example `npx serve -s deploy/static-site`).

## Limits

- Cloudflare Pages: at most 20,000 files and 25 MiB per file. This build: about 940 files and
  80 MB (page images about 71 MB; largest file the 0.75 MB JavaScript bundle). The builder stops
  if either limit is passed.
- Read-only: no uploads, no new analysis, no review decisions or parameter edits ("Saved results
  only — run the tool locally to analyse a contract."). The four runs are frozen, so those buttons
  are hidden anyway.
- The delay slider moves in 15-day steps (live site: 5) and stops at 360 days (live: 365).
- Rebuild after changing a frozen run, the risk rules, the cash model or the website.
