// Static, read-only copy of the site (build flag VITE_STATIC=1, built by deploy/build_static_site.py).
// Every GET is a saved JSON file under /static-api/, cash-flow what-ifs are precomputed on the grid in
// staticGrid.json, and page images are saved PNGs under /static-pages/. The key scheme is described in
// staticGrid.json, which the Python builder reads too.
import grid from "./staticGrid.json";

export const STATIC_SITE = import.meta.env.VITE_STATIC === "1" || import.meta.env.VITE_STATIC === "true";
/** Date the saved copy was made (set by the builder), for the footer. */
export const STATIC_SAVED = import.meta.env.VITE_STATIC_SAVED ?? "";
export const DELAY_GRID = grid.delay_days;
export const RISE_GRID = grid.rise_pct;
export const SAVED_ONLY_NOTE = "Saved results only — run the tool locally to analyse a contract.";

function snap(v: number, g: { min: number; max: number; step: number }): number {
  const s = Math.round((Math.min(g.max, Math.max(g.min, v)) - g.min) / g.step) * g.step + g.min;
  return Math.round(s * 1000) / 1000;
}

export const snapDelay = (d: number) => snap(d, DELAY_GRID);
export const snapRise = (pct: number) => snap(pct, RISE_GRID);

/** File key of a cash-flow request, or null when these overrides were not precomputed. */
export function cashflowKey(overrides: Record<string, unknown> | undefined): string | null {
  const o = overrides ?? {};
  const keys = Object.keys(o);
  if (keys.length === 0) return "base";
  if (keys.length !== 1) return null;
  if (keys[0] === "delay_days" && typeof o.delay_days === "number") return `delay-${snapDelay(o.delay_days)}`;
  if (keys[0] === "index_rise_pa" && o.index_rise_pa && typeof o.index_rise_pa === "object") {
    const r = o.index_rise_pa as Record<string, number>;
    const vals = RISE_GRID.indices.map((k) => r[k]);
    if (Object.keys(r).length !== vals.length || vals.some((v) => typeof v !== "number" || v !== vals[0])) return null;
    return `rise-${snapRise(vals[0] * 100)}`;
  }
  return null;
}

/** FNV-1a 32-bit hash of the UTF-8 bytes, as 8 lowercase hex characters (same as the Python builder). */
export function textKey(s: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

let pageIndex: Record<string, string[]> = {};

/** Load the list of highlighted page images that exist (called once at start-up). */
export async function loadPageIndex(): Promise<void> {
  try {
    const r = await fetch("/static-api/pages.json");
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) pageIndex = await r.json();
  } catch { /* plain pages still work */ }
}

export function staticPageUrl(packageId: string, docId: string, page: number, highlight?: string): string {
  const base = `/static-pages/${encodeURIComponent(packageId)}/${encodeURIComponent(docId)}/${page}`;
  if (highlight) {
    const k = textKey(highlight.slice(0, grid.highlight_max_chars));
    if (pageIndex[`${packageId}/${docId}/${page}`]?.includes(k)) return `${base}-${k}.png`;
  }
  return `${base}.png`;
}

/** Saved file for a GET path, e.g. /runs/X/answers -> /static-api/runs/X/answers.json. */
export function staticGetUrl(path: string): string {
  return `/static-api${path.split("?")[0]}.json`;
}
