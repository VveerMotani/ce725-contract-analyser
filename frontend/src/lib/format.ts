// Formatting helpers. Money follows Indian conventions (lakh = 1e5, crore = 1e7).

const LAKH = 1e5;
const CRORE = 1e7;

/** Indian digit grouping: 4,24,547 / 1,00,00,000. */
export function indianGroup(n: number, decimals = 0): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  const [intPart, frac] = fixed.split(".");
  let out: string;
  if (intPart.length <= 3) out = intPart;
  else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    out = rest + "," + last3;
  }
  return (neg ? "-" : "") + out + (frac ? "." + frac : "");
}

/** "Rs 4.17 crore", "Rs 25.0 lakh", "Rs 48,500"; or full "Rs 4,16,66,667" when full = true. */
export function money(n: number | null | undefined, full = false, opts: { sign?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const sign = opts.sign && n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (full) return `${sign}Rs ${indianGroup(abs)}`;
  if (abs >= CRORE) return `${sign}Rs ${(abs / CRORE).toFixed(abs >= 100 * CRORE ? 0 : abs >= 10 * CRORE ? 1 : 2)} crore`;
  if (abs >= LAKH) return `${sign}Rs ${(abs / LAKH).toFixed(1)} lakh`;
  return `${sign}Rs ${indianGroup(abs)}`;
}

/** Compact axis label: "4.2 cr", "25 L", "48k". */
export function moneyAxis(n: number): string {
  const abs = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (abs >= CRORE) return `${s}${+(abs / CRORE).toFixed(abs >= 10 * CRORE ? 0 : 1)} cr`;
  if (abs >= LAKH) return `${s}${+(abs / LAKH).toFixed(0)} L`;
  if (abs >= 1000) return `${s}${+(abs / 1000).toFixed(0)}k`;
  return `${s}${abs.toFixed(0)}`;
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  const v = x * 100;
  // Drop trailing zeros: 5% not 5.0%, 0.05% kept.
  const s = v.toFixed(Math.abs(v) < 0.1 ? 3 : Math.abs(v) < 1 ? 2 : digits);
  return `${+s}%`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return indianGroup(n, digits);
}

export function shortHash(h: string, n = 10): string {
  return h ? h.slice(0, n) : "";
}

export function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export function tokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
