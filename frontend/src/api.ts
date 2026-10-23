// REST client for the FastAPI backend (prefix /api, see backend/INTERFACES.md).
// Mock mode: when VITE_MOCK=1, when the URL has ?mock=1, or when the backend does not
// answer GET /api/benchmarks at start-up, every call is served by src/mock/server.ts.
import type {
  AnswerEnvelope, Benchmark, CashParams, CashflowResponse, CashInputs, Package, ReviewPatch, RiskFlag, RunMeta,
  ScoreSummary, UserInputs, EvaluationSummary,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let mode: "unknown" | "live" | "mock" = "unknown";
let modeReason = "";
let detecting: Promise<void> | null = null;

function forcedMock(): boolean {
  if (import.meta.env.VITE_MOCK === "1" || import.meta.env.VITE_MOCK === "true") return true;
  try { return new URLSearchParams(window.location.search).get("mock") === "1"; } catch { return false; }
}

async function detect(): Promise<void> {
  if (forcedMock()) { mode = "mock"; modeReason = "VITE_MOCK=1"; return; }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch("/api/benchmarks", { signal: ctl.signal });
    const ct = r.headers.get("content-type") || "";
    if (r.ok && ct.includes("json")) { mode = "live"; return; }
    mode = "mock";
    modeReason = `backend answered ${r.status}`;
  } catch {
    mode = "mock";
    modeReason = "backend unreachable";
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureMode(): Promise<"live" | "mock"> {
  if (mode === "unknown") { detecting ??= detect(); await detecting; }
  return mode as "live" | "mock";
}
export const isMock = () => mode === "mock";
export const mockReason = () => modeReason;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  await ensureMode();
  if (mode === "mock") {
    const { mockRequest, MockHttpError } = await import("./mock/server");
    try {
      // Deep-copy so screens never mutate the mock store by accident.
      const res = await mockRequest(method, path, body);
      return (body instanceof FormData ? res : JSON.parse(JSON.stringify(res))) as T;
    } catch (e) {
      if (e instanceof MockHttpError) throw new ApiError(e.status, e.message);
      throw e;
    }
  }
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const r = await fetch(`/api${path}`, init);
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j); } catch { /* not json */ }
    throw new ApiError(r.status, msg);
  }
  return (await r.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  benchmarks: () => request<Benchmark[]>("GET", "/benchmarks"),
  createPackage: (files: File[], tags: string[], contractId: string, title: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files[]", f));
    tags.forEach((t) => fd.append("tags[]", t));
    fd.append("contract_id", contractId);
    fd.append("title", title);
    return request<Package>("POST", "/packages", fd);
  },
  package: (id: string) => request<Package>("GET", `/packages/${enc(id)}`),
  startRun: (packageId: string, userInputs: UserInputs) => request<RunMeta>("POST", "/runs", { package_id: packageId, user_inputs: userInputs }),
  runs: () => request<RunMeta[]>("GET", "/runs"),
  run: (id: string) => request<RunMeta>("GET", `/runs/${enc(id)}`),
  answers: (id: string) => request<AnswerEnvelope[]>("GET", `/runs/${enc(id)}/answers`),
  review: (id: string, qid: string, patch: ReviewPatch) => request<AnswerEnvelope>("PATCH", `/runs/${enc(id)}/review/${enc(qid)}`, patch),
  params: (id: string) => request<CashParams>("GET", `/runs/${enc(id)}/params`),
  saveParams: (id: string, p: CashParams) => request<CashParams>("PUT", `/runs/${enc(id)}/params`, p),
  cashflow: (id: string, overrides?: Partial<CashInputs>) => request<CashflowResponse>("POST", `/runs/${enc(id)}/cashflow`, { overrides: overrides ?? {} }),
  flags: (id: string) => request<RiskFlag[]>("GET", `/runs/${enc(id)}/flags`),
  score: (id: string) => request<ScoreSummary>("GET", `/runs/${enc(id)}/score`),
  evaluation: () => request<EvaluationSummary>("GET", "/evaluation"),
};

export const exportCsvUrl = (runId: string) => `/api/runs/${enc(runId)}/export.csv`;
export const reportPdfUrl = (runId: string) => `/api/runs/${enc(runId)}/report.pdf`;

/** URL of a rendered PDF page. In mock mode returns an SVG placeholder showing the quote. */
export function pageImageUrl(packageId: string, docId: string, page: number, highlight?: string): string {
  if (mode === "mock") return mockPageSvg(docId, page, highlight);
  const q = highlight ? `?highlight=${enc(highlight.slice(0, 400))}` : "";
  return `/api/packages/${enc(packageId)}/page/${enc(docId || "d1")}/${page}.png${q}`;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(s: string, n: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > n) { lines.push(cur.trim()); cur = w; } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

function mockPageSvg(docId: string, page: number, highlight?: string): string {
  const filler = Array.from({ length: 34 }, (_, i) => `<rect x="60" y="${110 + i * 24}" width="${360 + ((i * 53) % 110)}" height="8" rx="2" fill="#d9d8d2"/>`).join("");
  const hl = highlight ? wrap(highlight, 62).slice(0, 6) : [];
  const hlSvg = hl.length
    ? `<rect x="52" y="402" width="496" height="${hl.length * 22 + 16}" fill="#fab219" fill-opacity="0.35" stroke="#eda100" stroke-width="2"/>` +
      `<rect x="56" y="405" width="488" height="${hl.length * 22 + 10}" fill="#fffdf6"/>` +
      hl.map((l, i) => `<text x="64" y="${426 + i * 22}" font-family="Georgia, serif" font-size="14" fill="#111">${esc(l)}</text>`).join("")
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="848" viewBox="0 0 600 848"><rect width="600" height="848" fill="#fff"/>` +
    `<text x="60" y="70" font-family="system-ui, sans-serif" font-size="13" fill="#888">MOCK page image · ${esc(docId)} · page ${page}</text>${filler}${hlSvg}` +
    `<text x="300" y="820" text-anchor="middle" font-family="system-ui" font-size="12" fill="#999">${page}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
