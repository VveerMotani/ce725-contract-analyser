import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ensureMode } from "./api";
import type { AnswerEnvelope, RunMeta, UserInputs } from "./types";

// ---------------------------------------------------------------------------
// Generic async hook
// ---------------------------------------------------------------------------

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    fn().then(
      (d) => { if (my === seq.current) { setData(d); setLoading(false); } },
      (e) => { if (my === seq.current) { setError(e); setLoading(false); } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------------------
// App-wide state: backend mode, theme, money format, source viewer, S1 draft
// ---------------------------------------------------------------------------

export interface SourceTarget {
  packageId: string;
  docId: string;
  page: number;
  quote: string;
  env?: AnswerEnvelope;
  title?: string;
}

export interface Draft {
  source: "benchmark" | "upload";
  benchmark: string;
  packageId: string | null;
  contractId: string;
  title: string;
  inputs: UserInputs;
  valueText: string;
}

export const DEFAULT_INPUTS: UserInputs = {
  contract_value: null,
  duration_months: null,
  progress_curve: "s_curve",
  progress: null,
  cost_share: 0.85,
  overdraft_rate_pa: 0.105,
  bank_rate_pa: 0.0625,
  bg_commission_pa: 0.015,
  delay_days: 60,
  index_rise_pa: { cement: 0.05, steel: 0.08, fuel: 0.07, labour: 0.06, bitumen: 0.06 },
  supplier_credit_days: 0,
};

interface AppCtx {
  mode: "live" | "mock" | "unknown";
  dark: boolean;
  toggleDark: () => void;
  fullMoney: boolean;
  setFullMoney: (b: boolean) => void;
  source: SourceTarget | null;
  openSource: (t: SourceTarget) => void;
  closeSource: () => void;
  draft: Draft;
  setDraft: (d: Draft | ((d: Draft) => Draft)) => void;
  runsVersion: number;
  bumpRuns: () => void;
}

const Ctx = createContext<AppCtx | null>(null);

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"live" | "mock" | "unknown">("unknown");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [fullMoney, setFullMoneyS] = useState(() => lsGet("ta-money-full") === "1");
  const [source, setSource] = useState<SourceTarget | null>(null);
  const [runsVersion, setRunsVersion] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    source: "benchmark", benchmark: "BM1", packageId: null, contractId: "", title: "", inputs: DEFAULT_INPUTS, valueText: "",
  });

  useEffect(() => { ensureMode().then(setMode); }, []);

  const toggleDark = useCallback(() => {
    const n = !document.documentElement.classList.contains("dark");
    lsSet("ta-theme", n ? "dark" : "light");
    setDark(n);
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  // Follow the OS theme until the user picks one.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => { if (!lsGet("ta-theme")) setDark(e.matches); };
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const setFullMoney = useCallback((b: boolean) => { setFullMoneyS(b); lsSet("ta-money-full", b ? "1" : "0"); }, []);

  const value = useMemo<AppCtx>(() => ({
    mode, dark, toggleDark, fullMoney, setFullMoney, source,
    openSource: setSource, closeSource: () => setSource(null),
    draft, setDraft, runsVersion, bumpRuns: () => setRunsVersion((v) => v + 1),
  }), [mode, dark, toggleDark, fullMoney, setFullMoney, source, draft, runsVersion]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppProvider missing");
  return c;
}

// ---------------------------------------------------------------------------
// Current run: meta (polled every 2 s until done), answers, review count
// ---------------------------------------------------------------------------

interface RunCtx {
  runId: string;
  meta: RunMeta | undefined;
  metaError: unknown;
  answers: AnswerEnvelope[] | undefined;
  answersError: unknown;
  done: boolean;
  pending: number;
  verified: number;
  reloadAnswers: () => void;
  replaceEnvelope: (e: AnswerEnvelope) => void;
  openAnswer: (e: AnswerEnvelope) => void;
  openPage: (page: number, quote?: string, docId?: string, title?: string) => void;
}

const RCtx = createContext<RunCtx | null>(null);

export function RunProvider({ runId, children }: { runId: string; children: ReactNode }) {
  const { openSource, bumpRuns } = useApp();
  const [meta, setMeta] = useState<RunMeta>();
  const [metaError, setMetaError] = useState<unknown>(null);
  const [answers, setAnswers] = useState<AnswerEnvelope[]>();
  const [answersError, setAnswersError] = useState<unknown>(null);
  const done = meta?.stage === "done";

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setMeta(undefined);
    setAnswers(undefined);
    setMetaError(null);
    const tick = async () => {
      try {
        const m = await api.run(runId);
        if (stop) return;
        setMeta(m);
        setMetaError(null);
        if (m.stage !== "done" && m.stage !== "error") timer = setTimeout(tick, 2000);
        else bumpRuns();
      } catch (e) {
        if (stop) return;
        setMetaError(e);
        timer = setTimeout(tick, 4000);
      }
    };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const reloadAnswers = useCallback(() => {
    setAnswersError(null);
    api.answers(runId).then(setAnswers, setAnswersError);
  }, [runId]);

  useEffect(() => { if (done) reloadAnswers(); }, [done, reloadAnswers]);

  const replaceEnvelope = useCallback((e: AnswerEnvelope) => {
    setAnswers((a) => a?.map((x) => (x.answer.question_id === e.answer.question_id ? e : x)));
  }, []);

  const pkg = meta?.package_id ?? "";
  const openAnswer = useCallback((e: AnswerEnvelope) => {
    const a = e.review.decision === "edited" && e.review.user_answer ? e.review.user_answer : e.answer;
    openSource({ packageId: pkg, docId: e.doc_id || e.verification?.found_doc_id || "d1", page: a.pdf_page, quote: a.verbatim_quote, env: e });
  }, [pkg, openSource]);
  const openPage = useCallback((page: number, quote = "", docId = "d1", title?: string) => {
    openSource({ packageId: pkg, docId, page, quote, title });
  }, [pkg, openSource]);

  const pending = answers?.filter((a) => a.review.decision === "pending").length ?? 0;
  const verified = answers ? answers.length - pending : 0;

  const value = useMemo<RunCtx>(() => ({
    runId, meta, metaError, answers, answersError, done, pending, verified, reloadAnswers, replaceEnvelope, openAnswer, openPage,
  }), [runId, meta, metaError, answers, answersError, done, pending, verified, reloadAnswers, replaceEnvelope, openAnswer, openPage]);

  return <RCtx.Provider value={value}>{children}</RCtx.Provider>;
}

export function useRun(): RunCtx {
  const c = useContext(RCtx);
  if (!c) throw new Error("RunProvider missing");
  return c;
}

export function useOptionalRun(): RunCtx | null {
  return useContext(RCtx);
}
