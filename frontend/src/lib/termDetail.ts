// Helpers for the term detail pages: slugs, questions per term, and careful text parsing.
// Parsers only read numbers that are written in the answer text; they never fill gaps.
import type { Answer, ClauseId } from "../types";

export const TERM_SLUG: Record<Exclude<ClauseId, "C0">, string> = {
  C1: "payment", C2: "retention", C3: "advance", C4: "delay", C5: "price", C6: "guarantees",
};
export const SLUG_TERM: Record<string, Exclude<ClauseId, "C0">> = Object.fromEntries(
  Object.entries(TERM_SLUG).map(([k, v]) => [v, k as Exclude<ClauseId, "C0">]),
) as Record<string, Exclude<ClauseId, "C0">>;
export const TERM_ORDER: Exclude<ClauseId, "C0">[] = ["C1", "C2", "C3", "C4", "C5", "C6"];

/** Split an answer into its "; "-separated parts. */
export function segments(text: string): string[] {
  return (text || "").split(/;\s+|\.\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
}

/** First "N days / N working days / N months" in a text, as days (months × 30). */
export function daysIn(text: string): { days: number; label: string } | null {
  const m = (text || "").match(/\b(\d+(?:\.\d+)?)\s*(?:\(\w+\)\s*)?(working |business |calendar )?(days?|months?|weeks?|years?)\b/i);
  if (!m) return null;
  const n = +m[1];
  const unit = m[3].toLowerCase();
  const days = /day/.test(unit) ? n : /week/.test(unit) ? n * 7 : /month/.test(unit) ? n * 30 : n * 365;
  return { days, label: `${n} ${(m[2] ?? "").toLowerCase()}${unit.replace(/s?$/, n === 1 ? "" : "s")}` };
}

/** First segment of an answer matching `re` (status FOUND only). */
export function seg(a: Answer | null, re: RegExp): string | null {
  if (!a || a.status !== "FOUND") return null;
  return segments(a.answer_value).find((s) => re.test(s)) ?? null;
}

/** "Rs 14,501", "Rs 3.50 lakh", "Rs 1.2 crore" -> rupees. */
export function rupeesIn(text: string): number | null {
  const m = (text || "").match(/Rs\.?\s?([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?)?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const u = (m[2] ?? "").toLowerCase();
  return n * (u.startsWith("cr") ? 1e7 : u.startsWith("la") ? 1e5 : 1);
}

export function pctNum(text: string, near?: RegExp): number | null {
  const t = near ? (text.match(new RegExp(`${near.source}[^;]*?(\\d+(?:\\.\\d+)?)\\s?%`, "i"))?.[1] ?? null) : (text.match(/(\d+(?:\.\d+)?)\s?%/)?.[1] ?? null);
  return t == null ? null : +t / 100;
}

/** All weight tables in a 5.3 answer: "Earthwork: L20 C5 S0 B0 F10 M50 A15; Bituminous work: L20 …". */
const CODE: Record<string, string> = { L: "Labour", C: "Cement", S: "Steel", B: "Bitumen", F: "Fuel", M: "Materials", A: "Plant", P: "Plant" };
export function weightTables(text: string): { name: string; w: [string, number][] }[] {
  const out: { name: string; w: [string, number][] }[] = [];
  for (const m of (text || "").matchAll(/(?:([A-Za-z&/ ,-]{3,60}):\s*)?((?:\b[LCSBFMAP]\d+(?:\.\d+)?\s*){3,})/g)) {
    const w = [...m[2].matchAll(/\b([LCSBFMAP])(\d+(?:\.\d+)?)/g)].map(([, k, v]) => [CODE[k], +v] as [string, number]).filter(([, v]) => v > 0);
    if (w.length >= 2) out.push({ name: (m[1] ?? "").trim() || `Table ${out.length + 1}`, w });
  }
  if (out.length) return out;
  const named = [...(text || "").matchAll(/\b(labour|cement|steel|bitumen|fuel|other materials|materials|plant)\b\s*:?\s*(nil|\d+(?:\.\d+)?)\s?%?/gi)];
  if (named.length >= 2) {
    const map = new Map<string, number>();
    named.forEach(([, k, v]) => {
      const key = /material/i.test(k) ? "Materials" : k[0].toUpperCase() + k.slice(1).toLowerCase();
      if (!map.has(key)) map.set(key, v.toLowerCase() === "nil" ? 0 : +v);
    });
    const w = [...map.entries()].filter(([, v]) => v > 0);
    if (w.length >= 2) out.push({ name: "Index weights", w });
  }
  return out;
}

/** Milestones from 4.4 / 0.6 text: "I 145th day, II 320th day" or "25%/50%/75%/100% … at 10/20/30/40 days". */
export function milestones(text: string): { name: string; day: number; share?: string }[] {
  if (!text) return [];
  const slash = text.match(/((?:\d+%\/)+\d+%)[^;]*?((?:\d+\/)+\d+)\s*days/i);
  if (slash) {
    const sh = slash[1].split("/"), ds = slash[2].split("/").map(Number);
    if (sh.length === ds.length) return ds.map((d, i) => ({ name: `Milestone ${i + 1}`, day: d, share: sh[i] }));
  }
  const ord = [...text.matchAll(/\b(\d+)(?:st|nd|rd|th)\s+day/gi)].map((m) => +m[1]);
  const uniq = [...new Set(ord)];
  if (uniq.length >= 2) return uniq.map((d, i) => ({ name: i === uniq.length - 1 && /complet/i.test(text) ? "Completion" : `Milestone ${i + 1}`, day: d }));
  return [];
}

/** How long a guarantee stays valid, read from one segment: anchor (completion or end of defects period) plus an offset. */
export function validity(text: string): { anchor: "completion" | "dlp"; offsetMonths: number; label: string } | null {
  if (!text) return null;
  const anchor = /defect|DLP|maintenance period/i.test(text) ? "dlp" : /complet/i.test(text) ? "completion" : null;
  if (!anchor) return null;
  const off = text.match(/(\d+(?:\.\d+)?)\s*(days?|months?|years?)\s*(?:after|beyond|from)|plus\s*(?:minimum\s*)?(\d+(?:\.\d+)?)\s*(days?|months?|years?)/i);
  let m = 0, label = anchor === "dlp" ? "end of defects period" : "completion";
  if (off) {
    const n = +(off[1] ?? off[3]);
    const u = (off[2] ?? off[4]).toLowerCase();
    m = /day/.test(u) ? n / 30 : /year/.test(u) ? n * 12 : n;
    label = `${n} ${u} after ${label}`;
  }
  return { anchor, offsetMonths: m, label };
}
