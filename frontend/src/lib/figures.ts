// Figures the cash model needs that the contract does not give. The site never makes them up:
// the server lists them as `missing`, the visitor types them, and they go with every cash request
// as overrides. Your own figures (cost, overdraft rate, ...) are kept for all contracts in this
// browser; contract figures (value, days to pay, ...) are kept per contract.
import { useSyncExternalStore } from "react";
import type { CashInputs, CashParams, ReleaseStep } from "../types";
import { evenCurve, sCurve } from "./curves";

export type FigureKind = "crore" | "months" | "days" | "pct" | "curve" | "release";

export interface FigureDef {
  label: string;
  kind: FigureKind;
  /** "own": the contractor's own figure (same for every contract); "contract": this contract only. */
  group: "own" | "contract";
  help: string;
  example: string;
}

export const FIGURES: Record<string, FigureDef> = {
  contract_value: { label: "Contract value", kind: "crore", group: "contract", help: "The tender value or your bid.", example: "25" },
  duration_months: { label: "Time to complete", kind: "months", group: "contract", help: "The stipulated completion period.", example: "18" },
  pay_lag_days: { label: "Days from bill to payment", kind: "days", group: "contract", help: "The contract does not say. Use what this employer usually takes.", example: "30" },
  dlp_months: { label: "Defects liability period", kind: "months", group: "contract", help: "How long after completion you stay liable for defects.", example: "12" },
  retention_release: { label: "Retention returned, months after completion", kind: "release", group: "contract", help: "When the money held back comes back to you.", example: "12" },
  perf_security_validity_months_after_completion: { label: "Performance guarantee kept after completion", kind: "months", group: "contract", help: "Months the guarantee must stay valid after completion.", example: "12" },
  pv_factor: { label: "Share of the bill adjusted for price rise", kind: "pct", group: "contract", help: "The fixed factor in the price-adjustment formula.", example: "85" },
  progress: { label: "Shape of the work over time", kind: "curve", group: "contract", help: "How the work is spread over the months.", example: "" },
  cost_share: { label: "Your cost as % of the contract value", kind: "pct", group: "own", help: "What you spend for every Rs 100 you bill.", example: "85" },
  overdraft_rate_pa: { label: "Your overdraft interest rate (a year)", kind: "pct", group: "own", help: "What your bank charges on the money you borrow.", example: "10.5" },
  supplier_credit_days: { label: "Credit from your suppliers", kind: "days", group: "own", help: "Days your suppliers give you to pay. 0 if none.", example: "0" },
  bg_commission_pa: { label: "Bank guarantee commission (a year)", kind: "pct", group: "own", help: "What your bank charges for a guarantee.", example: "1.5" },
  bank_rate_pa: { label: "RBI Bank Rate today", kind: "pct", group: "own", help: "The contract pays interest as “Bank Rate + x%”.", example: "5.75" },
};

/** What the visitor typed: numbers as typed (crore, %, days, months) or "even" / "s_curve".
 *  `<key>.example` = "1" marks a value filled by "Use example figures" rather than typed. */
export type Typed = Record<string, string>;

const EX = ".example";

/** Example values for "Use example figures": a typical small Indian works contractor. Always shown
 *  as examples, never as contract terms or the visitor's own figures. */
export const EXAMPLES: Record<string, string> = {
  contract_value: "25", duration_months: "12", pay_lag_days: "30", dlp_months: "12", retention_release: "12",
  perf_security_validity_months_after_completion: "12", pv_factor: "85", progress: "s_curve",
  cost_share: "85", overdraft_rate_pa: "10.5", supplier_credit_days: "0", bg_commission_pa: "1.5", bank_rate_pa: "6",
};

export const isExample = (typed: Typed, k: string) => typed[k + EX] === "1";

/** Fill every empty field in `keys` with its example value, marked as an example. */
export function withExamples(typed: Typed, keys: string[]): Typed {
  const out = { ...typed };
  for (const k of keys) if (!(out[k] ?? "").trim() && EXAMPLES[k]) { out[k] = EXAMPLES[k]; out[k + EX] = "1"; }
  return out;
}

/** A field the visitor changes is no longer an example. */
export function edit(typed: Typed, k: string, v: string): Typed {
  const out = { ...typed, [k]: v };
  delete out[k + EX];
  return out;
}

/** Missing figures currently filled with example values. */
export function examplesUsed(runId: string, params: CashParams | undefined): string[] {
  const typed = typedFor(runId);
  return (params?.missing ?? []).filter((k) => isExample(typed, k) && typed[k]);
}

const OWN_KEY = "cmt.myFigures";
const runKey = (runId: string) => `cmt.figures.${runId}`;

function read(key: string): Typed {
  try { return JSON.parse(localStorage.getItem(key) || "{}") as Typed; } catch { return {}; }
}
function write(key: string, v: Typed) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode: kept for this page only */ }
}

// A tiny store so every page (summary, term pages, cash chart) sees the same figures at once.
let version = 0;
const memory: Record<string, Typed> = {};
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

function load(key: string): Typed { return memory[key] ?? (memory[key] = read(key)); }

export function typedFor(runId: string): Typed {
  return { ...load(OWN_KEY), ...load(runKey(runId)) };
}

export function saveTyped(runId: string, typed: Typed) {
  const own = { ...load(OWN_KEY) }, mine = { ...load(runKey(runId)) };
  for (const [k, v] of Object.entries(typed)) {
    if (k.endsWith(EX)) continue;
    const target = FIGURES[k]?.group === "own" ? own : mine;
    if (v.trim() === "") delete target[k]; else target[k] = v.trim();
    if (typed[k + EX] === "1" && v.trim()) target[k + EX] = "1"; else delete target[k + EX];
  }
  memory[OWN_KEY] = own; memory[runKey(runId)] = mine;
  write(OWN_KEY, own); write(runKey(runId), mine);
  version++;
  listeners.forEach((f) => f());
}

/** A typed value as a cash-model input, or undefined when it is not a usable number. */
export function toInput(key: string, raw: string | undefined, months: number): unknown {
  if (raw == null || raw === "") return undefined;
  const def = FIGURES[key];
  if (!def) return undefined;
  if (def.kind === "curve") {
    if (months <= 0) return undefined;
    return raw === "s_curve" ? sCurve(months) : raw === "even" ? evenCurve(months) : undefined;
  }
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  switch (def.kind) {
    case "crore": return n > 0 ? n * 1e7 : undefined;
    case "pct": return n / 100;
    case "months": return key === "duration_months" ? (n >= 1 ? Math.round(n) : undefined) : n;
    case "days": return n;
    case "release": return [{ share: 1, months_after_completion: n }] as ReleaseStep[];
  }
}

/** The overrides to send with every cash request: typed figures for the fields the server says are missing. */
export function overridesFor(runId: string, params: CashParams | undefined): Partial<CashInputs> {
  const missing = params?.missing ?? [];
  if (!params || !missing.length) return {};
  const typed = typedFor(runId);
  const out: Record<string, unknown> = {};
  const months = (toInput("duration_months", typed.duration_months, 0) as number | undefined) ?? params.inputs.duration_months;
  for (const k of missing) {
    const v = toInput(k, typed[k], months);
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<CashInputs>;
}

/** Figures still missing after what the visitor typed. Empty = the cash model can run. */
export function stillMissing(runId: string, params: CashParams | undefined): string[] {
  if (!params) return [];
  const o = overridesFor(runId, params) as Record<string, unknown>;
  return (params.missing ?? []).filter((k) => o[k] === undefined);
}

/** Re-render when any typed figure changes; returns a number that changes with them. */
export function useFiguresVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Params as the pages should show them: typed figures in place, marked as the user's. */
export function withFigures(params: CashParams | undefined, overrides: Partial<CashInputs>): CashParams | undefined {
  const keys = Object.keys(overrides);
  if (!params || !keys.length) return params;
  return {
    ...params,
    inputs: { ...params.inputs, ...overrides },
    provenance: [...params.provenance.filter((p) => !keys.includes(p.field)),
      ...keys.map((field) => ({ field, source: "user" as const, question_id: "", quote: "", confirmed: true }))],
  };
}
