// MOCK backend: answers the same REST paths as the FastAPI app (backend/INTERFACES.md, M5 table)
// from in-memory fixtures. Used when VITE_MOCK=1 or the backend is unreachable.
import type {
  AnswerEnvelope, CashParams, CashflowResponse, Package, PageInfo, ReviewPatch, RiskFlag, RunMeta, UserInputs, DocTag,
} from "../types";
import { BENCHMARKS, BENCH_TITLES, buildAnswers, buildFlags, buildPackage, buildParams, buildScore, h01 } from "./data";
import { referenceView, runCash, sCurve, evenCurve } from "./cashEngine";

interface RunRec {
  meta: RunMeta;
  dataContract: string; // which golden contract the mock content comes from
  startedMs: number | null; // null = finished fixture
  answers?: AnswerEnvelope[];
  params?: CashParams;
  flags?: RiskFlag[];
  userInputs?: Partial<UserInputs>;
}

const STAGES: [string, string][] = [
  ["ingest", "Hashing files and reading page text"],
  ["retrieve", "Finding candidate pages for C0–C6"],
  ["extract", "Extracting answers (one call per clause type)"],
  ["crossref", "Following 'as per Schedule / Contract Data' pointers"],
  ["absence", "Second search before accepting NOT_STATED"],
  ["visual", "Reading flagged pages as images"],
  ["verify", "Checking quotes, pages and numbers"],
  ["flags", "Applying risk rules R1–R18"],
];
const STAGE_SECONDS = 2.2;

const packages = new Map<string, Package>();
const runs = new Map<string, RunRec>();

function finishedMeta(c: string, i: number): RunMeta {
  return {
    run_id: `run-${c}-mock`,
    package_id: c,
    contract_id: c,
    model: "claude-opus-5-5",
    prompt_version: "v1",
    schema_version: "v1",
    effort: "high",
    started_at: `2026-10-23T${String(8 + i).padStart(2, "0")}:10:00`,
    finished_at: `2026-10-23T${String(8 + i).padStart(2, "0")}:24:00`,
    stage: "done",
    progress: 1,
    log: STAGES.map(([s, l]) => `[${s}] ${l} … done`).concat(["[done] 52 answers, verification complete (MOCK)"]),
    error: "",
    llm_calls: 14 + i * 3,
    cache_hits: 9 + i,
    input_tokens: 412000 - i * 61000,
    output_tokens: 38000 - i * 4000,
    // BM1 stays editable in mock mode so the review queue can be tried; others behave like frozen demo runs.
    frozen: c !== "BM1",
  };
}

["BM1", "BM2", "BM3", "BM4"].forEach((c, i) => {
  runs.set(`run-${c}-mock`, { meta: finishedMeta(c, i), dataContract: c, startedMs: null });
});

function getPackage(id: string): Package {
  if (packages.has(id)) return packages.get(id)!;
  if (BENCH_TITLES[id]) {
    const p = buildPackage(id);
    packages.set(id, p);
    return p;
  }
  throw new MockHttpError(404, `package ${id} not found`);
}

export class MockHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function liveMeta(r: RunRec): RunMeta {
  if (r.startedMs === null) return r.meta;
  const el = (Date.now() - r.startedMs) / 1000;
  const idx = Math.floor(el / STAGE_SECONDS);
  const m = { ...r.meta };
  if (idx >= STAGES.length) {
    m.stage = "done";
    m.progress = 1;
    m.finished_at = m.finished_at || new Date().toISOString();
    m.log = STAGES.map(([s, l]) => `[${s}] ${l} … done`).concat(["[done] 52 answers ready (MOCK)"]);
    m.llm_calls = 17; m.cache_hits = 4; m.input_tokens = 356000; m.output_tokens = 31000;
    r.meta = m;
    r.startedMs = null;
    return m;
  }
  m.stage = STAGES[idx][0];
  m.progress = Math.min(0.99, el / (STAGE_SECONDS * STAGES.length));
  m.log = STAGES.slice(0, idx).map(([s, l]) => `[${s}] ${l} … done`).concat([`[${STAGES[idx][0]}] ${STAGES[idx][1]} …`]);
  if (idx >= 2) m.log.push(`[${STAGES[idx][0]}] clause C${Math.min(6, Math.floor((el % STAGE_SECONDS) * 3))} …`);
  m.llm_calls = Math.max(0, Math.floor((el - STAGE_SECONDS * 2) / 0.8));
  m.cache_hits = Math.floor(m.llm_calls / 4);
  m.input_tokens = m.llm_calls * 21000;
  m.output_tokens = m.llm_calls * 1800;
  return m;
}

function run(id: string): RunRec {
  const r = runs.get(id);
  if (!r) throw new MockHttpError(404, `run ${id} not found`);
  liveMeta(r);
  return r;
}

function answersOf(r: RunRec): AnswerEnvelope[] {
  if (!r.answers) r.answers = buildAnswers(r.dataContract, r.meta.contract_id);
  return r.answers;
}

function paramsOf(r: RunRec): CashParams {
  if (!r.params) {
    const p = buildParams(r.dataContract);
    const u = r.userInputs;
    if (u) {
      if (u.contract_value) p.inputs.contract_value = u.contract_value;
      if (u.duration_months) p.inputs.duration_months = u.duration_months;
      if (u.cost_share != null) p.inputs.cost_share = u.cost_share;
      if (u.overdraft_rate_pa != null) p.inputs.overdraft_rate_pa = u.overdraft_rate_pa;
      if (u.bank_rate_pa != null) p.inputs.bank_rate_pa = u.bank_rate_pa;
      if (u.bg_commission_pa != null) p.inputs.bg_commission_pa = u.bg_commission_pa;
      if (u.delay_days != null) p.inputs.delay_days = u.delay_days;
      if (u.index_rise_pa) p.inputs.index_rise_pa = u.index_rise_pa;
      const T = p.inputs.duration_months;
      p.inputs.progress = u.progress && u.progress.length === T ? u.progress : u.progress_curve === "even" ? evenCurve(T) : sCurve(T);
    }
    r.params = p;
  }
  return r.params;
}

function makeUploadPackage(form: FormData): Package {
  const files = form.getAll("files[]") as File[];
  const tags = form.getAll("tags[]") as string[];
  const contractId = String(form.get("contract_id") || "UPLOAD");
  const title = String(form.get("title") || contractId);
  const pid = `pkg-${Date.now().toString(36)}`;
  const pages: PageInfo[] = [];
  const docs = files.map((f, i) => {
    const docId = `d${i + 1}`;
    const n = 12 + Math.floor(h01(f.name) * 80);
    for (let p = 1; p <= n; p++) {
      const h = h01(f.name + p);
      const scan = h < 0.05;
      const choice = h > 0.96;
      pages.push({
        doc_id: docId, page: p, text: scan ? "" : "MOCK page text …", char_count: scan ? 12 : Math.floor(900 + h * 3000), image_count: scan ? 1 : 0,
        low_text: scan, garbled: false, choice_fields: choice ? ["Yes/No"] : [], strike_hits: [], formula_image: false,
        needs_visual: scan || choice, visual_reasons: [scan ? "Almost no text layer (scan or image page)" : "", choice ? "Choice field 'Yes/No'" : ""].filter(Boolean),
      });
    }
    return {
      doc_id: docId, filename: f.name, path: `runs/_uploads/${pid}/${f.name}`, tag: (tags[i] || "other") as DocTag,
      sha256: Array.from({ length: 64 }, (_, k) => "0123456789abcdef"[Math.floor(h01(f.name + k) * 16)]).join(""), page_count: n,
    };
  });
  const missing = docs.some((d) => d.tag === "gcc") ? [] : [{ label: "General Conditions of Contract (referenced, not uploaded)", doc_id: "d1", page: 3, quote: "General Conditions of Contract … shall apply" }];
  const pkg: Package = { package_id: pid, contract_id: contractId, title, files: docs, pages, missing_references: missing, created_at: new Date().toISOString() };
  packages.set(pid, pkg);
  return pkg;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Route a request to the mock backend. `path` excludes the /api prefix. */
export async function mockRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  await delay(120 + Math.random() * 120);
  const clean = path.split("?")[0];
  const seg = clean.split("/").filter(Boolean);

  if (method === "GET" && clean === "/benchmarks") return BENCHMARKS;
  if (method === "GET" && clean === "/evaluation") {
    return { ...buildScore(), runs_used: { BM1: "run-BM1-mock", BM2: "run-BM2-mock", BM3: "run-BM3-mock", BM4: "run-BM4-mock" }, missing_benchmarks: [] };
  }
  if (seg[0] === "packages") {
    if (method === "POST" && seg.length === 1) {
      const { pages: _p, ...rest } = makeUploadPackage(body as FormData);
      return { ...rest, pages: [] };
    }
    if (method === "GET" && seg.length === 2) {
      const p = getPackage(seg[1]);
      return { ...p, pages: p.pages.map((pg) => ({ ...pg, text: pg.text.slice(0, 300) })) };
    }
  }
  if (seg[0] === "runs") {
    if (seg.length === 1 && method === "GET") return [...runs.values()].map(liveMeta).sort((a, b) => (b.started_at > a.started_at ? 1 : -1));
    if (seg.length === 1 && method === "POST") {
      const b = body as { package_id: string; user_inputs: Partial<UserInputs> };
      const pkg = getPackage(b.package_id);
      const id = `run-${pkg.contract_id}-${Date.now().toString(36)}`;
      const meta: RunMeta = {
        run_id: id, package_id: pkg.package_id, contract_id: pkg.contract_id, model: "claude-opus-5-5", prompt_version: "v1",
        schema_version: "v1", effort: "high", started_at: new Date().toISOString(), finished_at: "", stage: "queued", progress: 0,
        log: ["[queued] run created (MOCK)"], error: "", llm_calls: 0, cache_hits: 0, input_tokens: 0, output_tokens: 0, frozen: false,
      };
      const dataContract = BENCH_TITLES[pkg.contract_id] ? pkg.contract_id : "BM1";
      runs.set(id, { meta, dataContract, startedMs: Date.now(), userInputs: b.user_inputs });
      return meta;
    }
    const r = run(seg[1]);
    const sub = seg[2];
    if (!sub && method === "GET") return liveMeta(r);
    if (r.meta.stage !== "done" && sub) throw new MockHttpError(409, "run not finished");
    if (sub === "answers" && method === "GET") return answersOf(r);
    if (sub === "review" && method === "PATCH") {
      const env = answersOf(r).find((e) => e.answer.question_id === seg[3]);
      if (!env) throw new MockHttpError(404, "question not found");
      if (r.meta.frozen) throw new MockHttpError(403, "Frozen demo run: review is read-only");
      const p = body as ReviewPatch;
      env.review = {
        ...env.review,
        decision: p.decision,
        user_answer: p.decision === "edited" ? { ...env.answer, ...(p.user_answer ?? {}) } : null,
        note: p.note ?? "",
        decided_at: p.decision === "pending" ? "" : new Date().toISOString(),
      };
      return env;
    }
    if (sub === "params" && method === "GET") return paramsOf(r);
    if (sub === "params" && method === "PUT") {
      if (r.meta.frozen) throw new MockHttpError(403, "Frozen demo run: parameters are read-only");
      r.params = body as CashParams;
      return r.params;
    }
    if (sub === "cashflow" && method === "POST") {
      const inputs = { ...paramsOf(r).inputs, ...((body as { overrides?: object })?.overrides ?? {}) };
      const res: CashflowResponse = { as_written: runCash(inputs), reference: runCash(referenceView(inputs)) };
      return res;
    }
    if (sub === "flags" && method === "GET") {
      if (!r.flags) r.flags = buildFlags(r.dataContract);
      return r.flags;
    }
    if (sub === "score" && method === "GET") {
      if (!BENCH_TITLES[r.meta.contract_id]) throw new MockHttpError(404, "not a benchmark");
      const s = buildScore();
      const tests = s.tests.filter((t) => t.contract_id === r.meta.contract_id);
      return { ...s, run_id: r.meta.run_id, tests, counts: s.by_contract[r.meta.contract_id] };
    }
  }
  throw new MockHttpError(404, `mock: no handler for ${method} ${path}`);
}
