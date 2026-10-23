// Cash flow diagram (engineering-economics style): time axis in months, up arrows for money received,
// down arrows for money paid out, arrow length proportional to rupees. Drawn from the cash model result.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CashInputs, CashResult } from "../types";
import { money, moneyAxis } from "../lib/format";
import { Disclosure, cx } from "./ui";

type Mode = "gross" | "net";

interface Col {
  month: number;
  cashIn: number;
  cashOut: number;
  net: number;
  pos: number;
  /** received before any delay penalty (bills paid + advance + retention returned) */
  receipts: number;
  advance: number;
  released: number;
  penalty: number;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Engine rule: an amount at fractional month t is split linearly between floor(t) and floor(t)+1. */
function place(map: Map<number, number>, t: number, amount: number) {
  const k = Math.floor(t + 1e-9);
  const f = t - k;
  if (f < 1e-9) map.set(k, (map.get(k) ?? 0) + amount);
  else {
    map.set(k, (map.get(k) ?? 0) + (1 - f) * amount);
    map.set(k + 1, (map.get(k + 1) ?? 0) + f * amount);
  }
}

function columns(w: CashResult, inp: CashInputs, delay: number): { cols: Col[]; tc: number; split: boolean } {
  const months = [...w.months].sort((a, b) => a.month - b.month);
  const V = inp.contract_value;
  const first = months[0]?.month ?? 0;
  const tc = inp.duration_months + delay / 30;
  const adv = new Map<number, number>();
  for (const a of inp.advance_instalments) {
    const m = Math.max(first, a.month);
    adv.set(m, (adv.get(m) ?? 0) + a.share_of_value * V);
  }
  // The delay penalty is deducted from what is due at completion. Show it as its own arrow only when the
  // result really contains it (total cash in = V − penalty, the engine's conservation check).
  const pen = new Map<number, number>();
  const sumIn = months.reduce((s, m) => s + m.cash_in, 0);
  const split = w.ld_amount > 0 && V > 0 && Math.abs(sumIn - (V - w.ld_amount)) < 0.005 * V;
  if (split) place(pen, tc, w.ld_amount);
  let prevHeld = 0;
  const cols = months.map((m) => {
    const released = Math.max(0, prevHeld + m.retention - m.retention_held);
    prevHeld = m.retention_held;
    const penalty = pen.get(m.month) ?? 0;
    return {
      month: m.month, cashIn: m.cash_in, cashOut: m.cash_out, net: m.cash_in - m.cash_out, pos: m.cum_in - m.cum_out,
      receipts: m.cash_in + penalty, advance: adv.get(m.month) ?? 0, released: released > 1 ? released : 0, penalty,
    };
  });
  return { cols, tc, split };
}

/** Round scale value for the legend bar. */
function niceUnit(x: number): number {
  if (x <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= x) ?? 10 * mag;
}

const rs = (n: number) => money(Math.abs(n));
const rsAxis = (n: number) => `Rs ${moneyAxis(Math.abs(n))}`;

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx("rounded px-2.5 py-0.5 text-[12.5px] transition", value === o.value ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface Lbl { x: number; tipY: number; text: string; side: "top" | "bottom"; color: string; strong?: boolean; marker?: boolean }

const H = 300;
const PT = 34;
const PB = 58;
const PL = 10;
const PR = 30;
const MIN_STEP = 15;
const PAY = "var(--bad)";

export function CashArrowDiagram({ w, inputs, delay, peak, peakMonth, dim }: {
  w: CashResult; inputs: CashInputs; delay: number; peak: number; peakMonth: number; dim?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const [mode, setMode] = useState<Mode>("gross");
  const [boxRef, boxW] = useWidth<HTMLDivElement>();
  const { cols, tc } = useMemo(() => columns(w, inputs, delay), [w, inputs, delay]);
  const T = inputs.duration_months;

  const defaultSel = useMemo(() => {
    if (peak > 0 && cols.some((c) => c.month === peakMonth)) return peakMonth;
    let best = cols[0]?.month ?? 0, bv = -1;
    for (const c of cols) { const v = Math.max(c.receipts, c.cashOut); if (v > bv) { bv = v; best = c.month; } }
    return best;
  }, [cols, peak, peakMonth]);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setSel((s) => (s != null && cols.some((c) => c.month === s) ? s : null)); }, [cols]);
  const selMonth = sel ?? defaultSel;

  const n = cols.length;
  const m0 = cols[0]?.month ?? 0;
  const avail = Math.max(0, boxW - PL - PR);
  const step = n ? Math.max(MIN_STEP, Math.min(90, avail / n)) : MIN_STEP;
  const svgW = Math.max(boxW, PL + PR + n * step);
  const x = (t: number) => PL + (t - m0 + 0.5) * step;

  // vertical scale shared by up and down arrows
  const up = (c: Col) => (mode === "gross" ? Math.max(0, c.receipts) : Math.max(0, c.net));
  const down = (c: Col) => (mode === "gross" ? c.cashOut : Math.max(0, -c.net));
  /** gross view: money taken back (delay penalty, or a bill that is negative because the advance is recovered) */
  const ded = (c: Col) => c.penalty + Math.max(0, -c.receipts);
  const upMax = Math.max(0, ...cols.map(up));
  const downMax = Math.max(0, ...cols.map((c) => Math.max(down(c), mode === "gross" ? ded(c) : 0)));
  const plotH = H - PT - PB;
  const k = upMax + downMax > 0 ? plotH / (upMax + downMax) : 0;
  const y0 = PT + upMax * k;
  const sw = Math.max(1.5, Math.min(3.5, step * 0.22));
  const head = Math.max(5, Math.min(8, step * 0.45));

  // notable arrows get a label
  const labels: Lbl[] = [];
  const tipUp = (v: number) => y0 - v * k;
  const tipDown = (v: number) => y0 + v * k;
  const largest = (f: (c: Col) => number) => cols.reduce<Col | null>((b, c) => (f(c) > (b ? f(b) : 0) ? c : b), null);
  /** an amount split over two neighbouring months is labelled once, at the larger part, with the total */
  const groups = (f: (c: Col) => number) => {
    const out: { c: Col; total: number }[] = [];
    let cur: { c: Col; total: number } | null = null;
    cols.forEach((c, i) => {
      const v = f(c);
      if (v <= 0) { cur = null; return; }
      if (cur && cols[i - 1] && f(cols[i - 1]) > 0) { cur.total += v; if (v > f(cur.c)) cur.c = c; }
      else { cur = { c, total: v }; out.push(cur); }
    });
    return out;
  };
  const tipOf = (c: Col, kind: "up" | "down" | "pen") => {
    if (kind === "pen") return mode === "gross" ? tipDown(ded(c)) : c.net >= 0 ? tipUp(c.net) : tipDown(-c.net);
    return kind === "up" ? tipUp(up(c)) : tipDown(down(c));
  };
  for (const g of groups((c) => c.penalty)) {
    const side = mode === "gross" || g.c.net < 0 ? "bottom" : "top";
    labels.push({ x: x(g.c.month) + (mode === "gross" && g.c.cashOut > 0 ? sw * 2.2 : 0), tipY: tipOf(g.c, "pen"), text: `delay penalty ${rs(g.total)}`, side, color: PAY, strong: true });
  }
  for (const g of groups((c) => Math.max(0, -c.receipts))) {
    const side = mode === "gross" || g.c.net < 0 ? "bottom" : "top";
    const what = inputs.advance_instalments.length ? "advance repaid" : "deducted";
    labels.push({ x: x(g.c.month) + (mode === "gross" && g.c.cashOut > 0 ? sw * 2.2 : 0), tipY: tipOf(g.c, "pen"), text: `${what} ${rs(g.total)}`, side, color: PAY, strong: true });
  }
  if (mode === "gross" && w.ld_amount > 0 && !cols.some((c) => c.penalty > 0)) {
    const c = cols.find((q) => q.month === Math.round(tc));
    if (c) labels.push({ x: x(c.month), tipY: y0, text: `delay penalty ${rs(w.ld_amount)}`, side: "bottom", color: PAY, strong: true });
  }
  for (const c of cols) if (c.advance > 0) {
    const side = mode === "gross" || c.net >= 0 ? "top" : "bottom";
    labels.push({ x: x(c.month), tipY: side === "top" ? tipUp(up(c)) : tipDown(down(c)), text: `advance ${rs(c.advance)}`, side, color: "var(--accent-ink)", strong: true });
  }
  for (const g of groups((c) => c.released)) {
    const side = mode === "gross" || g.c.net >= 0 ? "top" : "bottom";
    labels.push({ x: x(g.c.month), tipY: side === "top" ? tipUp(up(g.c)) : tipDown(down(g.c)), text: `retention back ${rs(g.total)}`, side, color: "var(--accent-ink)", strong: true });
  }
  labels.push({ x: x(T), tipY: y0, text: "completion", side: "bottom", color: "var(--ink-2)", marker: true });
  if (delay > 0 && tc > T) labels.push({ x: x(tc), tipY: y0, text: `+${delay} d late`, side: "bottom", color: PAY, marker: true });
  if (peak > 0 && cols.some((c) => c.month === peakMonth)) labels.push({ x: x(peakMonth), tipY: y0, text: `peak funding ${rs(peak)}`, side: "bottom", color: "var(--ink)", strong: true });
  const bigUp = largest(up);
  if (bigUp && !labels.some((l) => l.side === "top" && Math.abs(l.x - x(bigUp.month)) < 1)) labels.push({ x: x(bigUp.month), tipY: tipUp(up(bigUp)), text: rsAxis(up(bigUp)), side: "top", color: "var(--muted)" });
  const bigDown = largest(down);
  if (bigDown && down(bigDown) > 0 && !labels.some((l) => l.side === "bottom" && Math.abs(l.x - x(bigDown.month)) < 1)) labels.push({ x: x(bigDown.month), tipY: tipDown(down(bigDown)), text: rsAxis(-down(bigDown)), side: "bottom", color: "var(--muted)" });

  // place labels in two rows above and two rows below the plot, skipping any that would overlap
  const rowsY = { top: [12, 25], bottom: [PT + plotH + 14, PT + plotH + 27] };
  const taken: Record<string, [number, number][]> = { "top0": [], "top1": [], "bottom0": [], "bottom1": [] };
  const placed: (Lbl & { lx: number; ly: number })[] = [];
  for (const l of labels) {
    const wd = l.text.length * 5.6 + 8;
    const cx0 = Math.min(Math.max(l.x, wd / 2 + 2), svgW - wd / 2 - 2);
    for (let r = 0; r < 2; r++) {
      const key = `${l.side}${r}`;
      const a = cx0 - wd / 2, b = cx0 + wd / 2;
      if (taken[key].some(([p, q]) => a < q + 4 && b > p - 4)) continue;
      taken[key].push([a, b]);
      placed.push({ ...l, lx: cx0, ly: rowsY[l.side][r] });
      break;
    }
  }

  // month ticks: every month marked, labelled every few months
  const every = [1, 2, 3, 4, 6, 12, 24].find((e) => e * step >= 24) ?? 24;
  const lastM = cols[n - 1]?.month ?? 0;
  const tickLabels = cols.filter((c) => c.month % every === 0 || c.month === lastM).map((c) => c.month)
    .filter((m, i, arr) => !(m === lastM && i > 0 && (m - arr[i - 1]) * step < 18 && m % every !== 0));

  const unit = niceUnit((upMax + downMax) / 8);
  const unitPx = unit * k;
  const selCol = cols.find((c) => c.month === selMonth);
  const sign = (v: number) => (v > 0.5 ? "+" : v < -0.5 ? "−" : "");
  const mk = (id: string) => `url(#${uid}-${id})`;

  const arrow = (key: string, ax: number, val: number, dir: 1 | -1, color: string, marker: string, opacity = 1) => {
    const len = val * k;
    if (len < 0.6) return null;
    const hasHead = len > head + 2;
    const y1 = y0;
    const y2 = y0 - dir * (hasHead ? len - head : len);
    return <line key={key} x1={ax} x2={ax} y1={y1} y2={y2} stroke={color} strokeOpacity={opacity} strokeWidth={sw} markerEnd={hasHead ? mk(marker) : undefined} />;
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Seg value={mode} onChange={setMode} label="Arrows" options={[{ value: "gross", label: "Gross (in and out)" }, { value: "net", label: "Net (one arrow per month)" }]} />
      </div>

      <div className="mt-2 min-h-[20px] text-[12.5px] text-ink-2 tnum" aria-live="polite">
        {selCol && (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="font-medium text-ink">Month {selCol.month}</span>
            <span>in {money(selCol.cashIn)}</span>
            <span>out {money(selCol.cashOut)}</span>
            <span>net {sign(selCol.net)}{money(Math.abs(selCol.net))}</span>
            <span className="text-muted">position {sign(selCol.pos)}{money(Math.abs(selCol.pos))}</span>
            {selCol.advance > 0 && <span className="text-accent-ink">advance {money(selCol.advance)}</span>}
            {selCol.released > 0 && <span className="text-accent-ink">retention back {money(selCol.released)}</span>}
            {selCol.penalty > 0 && <span className="text-bad">penalty −{money(selCol.penalty)}</span>}
          </span>
        )}
      </div>

      <div ref={boxRef} className={cx("scroll-thin mt-1 w-full overflow-x-auto overflow-y-hidden", dim && "opacity-60")}>
        {boxW > 0 && n > 0 && (
          <svg width={svgW} height={H} viewBox={`0 0 ${svgW} ${H}`} role="img" className="block select-none"
            aria-label={`Cash flow diagram, months ${m0} to ${lastM}: up arrows money received, down arrows money paid out`}
            onMouseLeave={() => setSel(null)}>
            <defs>
              {([["in", "var(--accent)", 1], ["out", PAY, 0.62], ["pen", PAY, 1], ["axis", "var(--ink-2)", 1]] as const).map(([id, c, o]) => (
                <marker key={id} id={`${uid}-${id}`} viewBox="0 0 10 10" refX={0} refY={5} markerUnits="userSpaceOnUse"
                  markerWidth={id === "axis" ? 7 : head} markerHeight={id === "axis" ? 7 : head * 0.95} orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill={c} fillOpacity={o} />
                </marker>
              ))}
            </defs>

            {selCol && <rect x={x(selCol.month) - step / 2} y={PT - 4} width={step} height={plotH + 8} fill="var(--accent-soft)" />}

            {/* completion and delay markers */}
            <line x1={x(T)} x2={x(T)} y1={PT - 6} y2={PT + plotH + 4} stroke="var(--ink-2)" strokeDasharray="3 3" strokeWidth={1} />
            {delay > 0 && tc > T && (
              <>
                <line x1={x(tc)} x2={x(tc)} y1={PT - 6} y2={PT + plotH + 4} stroke={PAY} strokeDasharray="3 3" strokeWidth={1} />
              </>
            )}

            {/* time axis */}
            <line x1={PL} x2={svgW - PR + 12} y1={y0} y2={y0} stroke="var(--ink-2)" strokeWidth={1.25} markerEnd={mk("axis")} />
            {cols.map((c) => <line key={c.month} x1={x(c.month)} x2={x(c.month)} y1={y0 - 2} y2={y0 + 2} stroke="var(--ink-2)" strokeWidth={1} />)}

            {/* arrows */}
            {cols.map((c) => mode === "gross" ? (
              <g key={c.month}>
                {arrow(`i${c.month}`, x(c.month), Math.max(0, c.receipts), 1, "var(--accent)", "in")}
                {arrow(`o${c.month}`, x(c.month), down(c), -1, PAY, "out", 0.62)}
                {arrow(`p${c.month}`, x(c.month) + (c.cashOut > 0 ? sw * 2.2 : 0), ded(c), -1, PAY, "pen")}
              </g>
            ) : (
              <g key={c.month}>
                {c.net >= 0 ? arrow(`n${c.month}`, x(c.month), c.net, 1, "var(--accent)", "in") : arrow(`n${c.month}`, x(c.month), -c.net, -1, PAY, "out", 0.62)}
              </g>
            ))}

            {peak > 0 && cols.some((c) => c.month === peakMonth) && (
              <path d={`M${x(peakMonth)},${y0 - 4.5} l4.5,4.5 l-4.5,4.5 l-4.5,-4.5 z`} fill="var(--ink)" stroke="var(--page)" strokeWidth={1} />
            )}

            {/* labels with dotted leaders */}
            {placed.map((l, i) => {
              const ly = l.side === "top" ? l.ly + 3 : l.ly - 10;
              const ty = l.side === "top" ? Math.min(l.tipY - 3, y0) : Math.max(l.tipY + 3, y0);
              return (
                <g key={i}>
                  {!l.marker && Math.abs(ty - ly) > 4 && <line x1={l.x} x2={l.x} y1={ly} y2={ty} stroke="var(--line-strong)" strokeDasharray="1.5 2" />}
                  <text x={l.lx} y={l.ly} textAnchor="middle" fontSize={10.5} fontWeight={l.strong ? 600 : 400} fill={l.color}
                    paintOrder="stroke" stroke="var(--page)" strokeWidth={3} strokeLinejoin="round">{l.text}</text>
                </g>
              );
            })}

            {/* month labels */}
            {tickLabels.map((m) => <text key={m} x={x(m)} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{m}</text>)}
            <text x={svgW - 2} y={H - 6} textAnchor="end" fontSize={10.5} fill="var(--muted)">month</text>

            {/* hover / tap targets */}
            {cols.map((c) => (
              <rect key={`h${c.month}`} x={x(c.month) - step / 2} y={0} width={step} height={H} fill="transparent"
                onMouseEnter={() => setSel(c.month)} onClick={() => setSel(c.month)} style={{ cursor: "pointer" }} />
            ))}
          </svg>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><svg width="10" height="16" aria-hidden><line x1="5" x2="5" y1="16" y2="5" stroke="var(--accent)" strokeWidth="2" /><path d="M1,6 L5,0 L9,6 z" fill="var(--accent)" /></svg>{mode === "gross" ? "Received" : "Net in"}</span>
        <span className="inline-flex items-center gap-1.5"><svg width="10" height="16" aria-hidden><line x1="5" x2="5" y1="0" y2="11" stroke={PAY} strokeOpacity="0.62" strokeWidth="2" /><path d="M1,10 L5,16 L9,10 z" fill={PAY} fillOpacity="0.62" /></svg>{mode === "gross" ? "Paid out" : "Net out"}</span>
        {mode === "gross" && cols.some((c) => ded(c) > 0) && (
          <span className="inline-flex items-center gap-1.5"><svg width="10" height="16" aria-hidden><line x1="5" x2="5" y1="0" y2="11" stroke={PAY} strokeWidth="2" /><path d="M1,10 L5,16 L9,10 z" fill={PAY} /></svg>{cols.some((c) => c.penalty > 0) ? "Delay penalty" : "Taken back"}</span>
        )}
        {k > 0 && unitPx > 2 && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            arrow length ∝ Rs
            <svg width="8" height={unitPx + 2} aria-hidden className="ml-1"><line x1="4" x2="4" y1="1" y2={unitPx + 1} stroke="var(--ink-2)" strokeWidth="2" /><line x1="0" x2="8" y1="1" y2="1" stroke="var(--ink-2)" /><line x1="0" x2="8" y1={unitPx + 1} y2={unitPx + 1} stroke="var(--ink-2)" /></svg>
            = {rsAxis(unit)}
          </span>
        )}
      </div>

      <Disclosure summary="Show numbers" className="mt-3">
        <div className="scroll-thin max-h-[380px] overflow-auto border-y border-line">
          <table className="w-full min-w-[420px] text-[13px] tnum">
            <thead className="sticky top-0 bg-page">
              <tr className="border-b border-line text-right text-muted">
                <th className="py-1.5 pr-3 text-left font-medium">Month</th>
                <th className="py-1.5 pr-3 font-medium">In</th>
                <th className="py-1.5 pr-3 font-medium">Out</th>
                <th className="py-1.5 pr-3 font-medium">Net</th>
                <th className="py-1.5 pr-1 font-medium">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {cols.map((c) => (
                <tr key={c.month} onClick={() => setSel(c.month)}
                  className={cx("cursor-pointer border-b border-line text-right last:border-0", c.month === selMonth && "bg-accent-soft", peak > 0 && c.month === peakMonth && "font-medium text-ink")}>
                  <td className="py-1 pr-3 text-left">{c.month}</td>
                  <td className="py-1 pr-3">{money(c.cashIn)}</td>
                  <td className="py-1 pr-3">{money(c.cashOut)}</td>
                  <td className={cx("py-1 pr-3", c.net < -0.5 && "text-bad")}>{money(c.net)}</td>
                  <td className={cx("py-1 pr-1", c.pos < -0.5 && "text-bad")}>{money(c.pos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </div>
  );
}
