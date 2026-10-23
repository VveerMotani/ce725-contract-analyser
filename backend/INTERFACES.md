# Module interfaces (frozen)

All data types live in `analyser/models.py`. Paths and settings live in `analyser/config.py`.
Each module owns one folder under `backend/analyser/` and exposes only the functions below.
Change a signature only after every module owner agrees.

Run everything from `backend/`: `python -m pytest`, `uvicorn analyser.api.app:app --reload --port 8000`.

## M1 Ingest and structure (`analyser/ingest`, `analyser/structure`)

```python
# analyser/ingest/__init__.py
def build_package(files: list[tuple[str, str]], contract_id: str, title: str = "",
                  package_id: str | None = None) -> Package
    # files = [(absolute_pdf_path, DocTag)]. Hashes files, parses every page (F2),
    # sets visual triggers (F3), detects referenced-but-missing documents (F1).
    # Writes runs/packages/<package_id>/package.json and pages.json. Returns Package with pages filled.
def load_package(package_id: str) -> Package          # reads it back, pages filled
def benchmark_package(contract_id: str) -> Package    # builds or loads BM1..BM4 from config.BENCHMARKS (cached by package_id = contract_id)
def render_page_png(pdf_path: str, page: int, zoom: float = 2.0,
                    highlight: str | None = None) -> bytes
    # PNG of the page; if highlight is given, draws boxes around the best fuzzy match of that text.

# analyser/structure/__init__.py
def build_document_map(package: Package) -> list[SectionEntry]          # F4
def retrieve(package: Package, clause_id: str,
             doc_map: list[SectionEntry] | None = None) -> RetrievalResult   # F5
def find_pages(package: Package, terms: list[str]) -> list[tuple[str, int]]   # used by F7/F8
def resolve_pointer(package: Package, pointer_text: str,
                    doc_map: list[SectionEntry]) -> list[tuple[str, int]]  # pages that a "as per Schedule F" points to
TERM_LISTS: dict[str, list[str]]   # C0..C6 search terms from spec §4
```

## M1 LLM and extraction (`analyser/llm`, `analyser/extract`, `analyser/params`, `prompts/v1/`)

```python
# analyser/llm/__init__.py
class LLMClient:
    def __init__(self, model: str = config.MODEL, effort: str = config.EFFORT): ...
    def call_json(self, system: str, user_text: str, images: list[bytes] = [],
                  schema: dict | None = None, call_tag: str = "") -> tuple[object, str]
        # Returns (parsed JSON, cache_key). Cached on disk in cache/llm/<key>.json keyed by
        # (model, effort, prompt text, image hashes, schema). Records usage in the cache file.
    stats: dict   # calls, cache_hits, input_tokens, output_tokens

# analyser/extract/__init__.py
QUESTIONS: dict[str, list[dict]]   # clause_id -> [{"question_id": "2.2", "question": "...", "fields": "..."}] parsed from the questionnaire
def extract_package(package: Package, llm: LLMClient,
                    on_progress: Callable[[str, float, str], None] | None = None) -> list[AnswerEnvelope]
    # F6 one call per clause type, F3 page images where needed, F7 cross-reference pass,
    # F8 absence pass. Returns 52 envelopes (verification not yet filled).

# analyser/params/__init__.py
def map_to_cash_params(envelopes: list[AnswerEnvelope], user_inputs: dict,
                       llm: LLMClient | None) -> CashParams
    # LLM transcribes numbers from verified answers into CashInputs fields (no arithmetic);
    # code checks each number appears in the source answer; falls back to defaults with provenance "default".
```

## M2 Verification and scoring (`analyser/verify`, `analyser/evaluate`)

```python
# analyser/verify/__init__.py
def verify_answers(envelopes: list[AnswerEnvelope], package: Package,
                   llm: LLMClient | None = None) -> list[AnswerEnvelope]
    # F11 V1-V8 (+V9 when llm given), F10 normaliser, F9 conflicts. Fills .verification, .doc_id,
    # and .review.reasons/decision ("pending" when a person must look, spec F14).
def quote_in_text(quote: str, text: str) -> tuple[bool, float]   # whitespace/hyphen tolerant match

# analyser/evaluate/__init__.py
def load_golden() -> list[dict]
def score_run(envelopes_by_contract: dict[str, list[AnswerEnvelope]], run_id: str) -> ScoreSummary
def write_error_log(summary: ScoreSummary, path: Path) -> None     # CSV, spec §10.6 columns
```

## M3 Risk rules (`analyser/risk`, `analyser/risk/rules_v1.yaml`)

```python
def flag_risks(envelopes: list[AnswerEnvelope], package: Package,
               cash: CashInputs | None = None, cash_result: CashResult | None = None) -> list[RiskFlag]
def load_rules() -> list[dict]
```

## M4 Cash flow (`analyser/cashflow`)

```python
def run_cashflow(inputs: CashInputs, sensitivities: bool = True) -> CashResult
def reference_view(inputs: CashInputs) -> CashInputs   # same project, risky terms set to reference values (spec §8.2 step 11)
```

## M5 API and website (`analyser/api`, `analyser/report`, `frontend/`)

REST API, all JSON unless noted, prefix `/api`:

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/benchmarks` | | `[{contract_id, title, package_id, has_run}]` |
| POST | `/packages` | multipart: `files[]`, `tags[]`, `contract_id`, `title` | `Package` (pages omitted) |
| GET | `/packages/{package_id}` | | `Package` with `pages` (text truncated to 300 chars) |
| GET | `/packages/{package_id}/page/{doc_id}/{page}.png` | `?highlight=<quote>` | PNG |
| POST | `/runs` | `{package_id, user_inputs: {...}}` | `RunMeta` (starts background job) |
| GET | `/runs` | | `[RunMeta]` |
| GET | `/runs/{run_id}` | | `RunMeta` |
| GET | `/runs/{run_id}/answers` | | `[AnswerEnvelope]` |
| PATCH | `/runs/{run_id}/review/{question_id}` | `{decision, user_answer?, note?}` | `AnswerEnvelope` |
| GET | `/runs/{run_id}/params` | | `CashParams` |
| PUT | `/runs/{run_id}/params` | `CashParams` (user-confirmed) | `CashParams` |
| POST | `/runs/{run_id}/cashflow` | `{overrides?: {...}}` | `{as_written: CashResult, reference: CashResult}` |
| GET | `/runs/{run_id}/flags` | | `[RiskFlag]` |
| GET | `/runs/{run_id}/score` | | `ScoreSummary` or 404 if not a benchmark |
| GET | `/evaluation` | | latest `ScoreSummary` across all four benchmarks |
| GET | `/runs/{run_id}/export.csv` | | CSV in answer-key columns |
| GET | `/runs/{run_id}/report.pdf` | | PDF report |

Run folder `runs/<run_id>/`: `meta.json`, `answers.json` (list of AnswerEnvelope), `params.json`, `flags.json`, `cashflow.json`, `score.json`.
