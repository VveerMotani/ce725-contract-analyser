// "Key facts" on the report: key dates, money locked up, number tiles, what you must do to get paid,
// documents not in the package. Built from effective answers, usable cash parameters and the cash result only.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Info } from "lucide-react";
import { api } from "../api";
import { useAsync, useRun } from "../context";
import { effective, type AnswerEnvelope, type CashParams, type CashResult, type RiskFlag, type RuleCheck } from "../types";
import { money, moneyAxis } from "../lib/format";
import { answerLookup, keyDates, missingDocs, moneyLocked, numberTiles, payConditions, type Chip, type KeyDate } from "../lib/keyfacts";
import { cx } from "../components/ui";
import { Term } from "../components/Term";
import type { GlossKey } from "../lib/glossary";

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** (i) with a short note. Fixed-positioned and clamped to the viewport so it never widens the page. */
function Tip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(280, window.innerWidth - 32);
    setPos({ left: Math.max(16, Math.min(r.left, window.innerWidth - 16 - w)), top: r.bottom + 6 });
  };
  return (
    <span className="relative inline-flex align-middle">
      <button ref={btn} type="button" aria-label={label} aria-expanded={!!pos} onClick={toggle} onBlur={() => setPos(null)}
        className="rounded-full p-0.5 text-muted hover:text-ink">
        <Info className="h-3.5 w-3.5" />
      </button>
      {pos && (
        <span role="tooltip" style={{ left: pos.left, top: pos.top }}
          className="fixed z-40 w-[280px] max-w-[calc(100vw-32px)] rounded-md border border-line bg-surface p-3 font-sans text-[13px] font-normal leading-snug text-ink-2 shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}

function Head({ children, tip }: { children: ReactNode; tip?: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1 text-[13px] font-medium text-muted">
      {children}{tip && <Tip>{tip}</Tip>}
    </h3>
  );
}

function PageLink({ env, label }: { env?: AnswerEnvelope | null; label: string }) {
  const { openAnswer } = useRun();
  if (!env) return null;
  const a = effective(env);
  if (!a.pdf_page) return null;
  return <button className="shrink-0 text-[12px] text-accent-ink hover:underline" onClick={() => openAnswer(env, label)}>p. {a.pdf_page}</button>;
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

// ---------------------------------------------------------------------------
// Key dates timeline
// ---------------------------------------------------------------------------

interface Ev { t: number; label: string; value: string; kind: KeyDate["kind"]; env: AnswerEnvelope | null }

function KeyDatesTimeline({ dates, completion }: { dates: KeyDate[]; completion: number | null }) {
  const { openAnswer } = useRun();
  const [boxRef, boxW] = useWidth<HTMLDivElement>();
  const evs = useMemo(() => {
    const out: Ev[] = [];
    for (const d of dates) {
      const same = out.find((e) => Math.abs(e.t - d.t) < 0.02);
      if (same) { same.label = `${same.label}, ${d.label.charAt(0).toLowerCase()}${d.label.slice(1)}`; same.env ??= d.env; continue; }
      out.push({ t: d.t, label: d.label, value: d.value, kind: d.kind, env: d.env });
    }
    return out;
  }, [dates]);

  const W = Math.max(boxW, 600);
  const PADL = 14, PADR = 14;
  const end = Math.max(...evs.map((e) => e.t), completion ?? 0, 1);
  const c = completion ?? end;
  // after completion the dates can run for years: give the build period 55% of the width when that happens
  const broken = completion != null && end - c > 1.2 * c;
  const inner = W - PADL - PADR;
  // when broken, dates after completion are spaced evenly (not to scale); their labels carry the time
  const after = evs.filter((e) => e.t > c + 1e-6).map((e) => e.t);
  const x = (t: number) => {
    if (!broken) return PADL + (t / end) * inner;
    if (t <= c) return PADL + (t / c) * inner * 0.55;
    const i = after.indexOf(t);
    return PADL + inner * 0.55 + ((i + 1) / after.length) * inner * 0.45;
  };
  const AY = 70;
  const nameY = [50, 33, 16];
  const valY = [92, 106, 120];
  const lanes: [number, number][][] = [[], [], []];
  const placed = evs.map((e) => {
    const wd = Math.max(e.label.length * 6, e.value.length * 5.6) + 10;
    const px = x(e.t);
    const anchor: "start" | "middle" | "end" = px - wd / 2 < 2 ? "start" : px + wd / 2 > W - 2 ? "end" : "middle";
    const a = anchor === "start" ? px - 4 : anchor === "end" ? px - wd + 4 : px - wd / 2;
    let lane = 0;
    while (lane < 2 && lanes[lane].some(([p, q]) => a < q && a + wd > p)) lane++;
    lanes[lane].push([a, a + wd]);
    return { ...e, px, anchor, lane };
  });
  const colour = (k: KeyDate["kind"]) => (k === "late" ? "var(--bad)" : k === "start" || k === "completion" ? "var(--ink)" : "var(--accent)");

  const narrow = boxW > 0 && boxW < 520;
  return (
    <div ref={boxRef} className="scroll-thin w-full overflow-x-auto overflow-y-hidden">
      {narrow && (
        <ol className="relative ml-1.5 border-l-2 border-line-strong py-1" aria-label="Key dates">
          {evs.map((e, i) => {
            const col = colour(e.kind);
            const done = completion != null && e.t <= completion + 1e-6;
            const click = e.env ? () => openAnswer(e.env!, e.label) : undefined;
            return (
              <li key={i} className="relative flex items-baseline justify-between gap-3 py-1.5 pl-5 text-[13.5px]"
                style={done ? { borderLeft: "2px solid var(--accent)", marginLeft: -2 } : undefined}>
                <span className="absolute top-[11px] h-3 w-3 rounded-full" style={{ left: done ? -7 : -7.5, background: e.kind === "milestone" ? "var(--surface)" : col, border: `2px solid ${col}` }} />
                {click ? <button onClick={click} className={cx("text-left hover:underline", e.kind === "late" ? "text-bad" : "text-ink", e.kind === "completion" && "font-semibold")}>{e.label}</button>
                  : <span className={cx(e.kind === "late" ? "text-bad" : "text-ink", e.kind === "completion" && "font-semibold")}>{e.label}</span>}
                <span className="shrink-0 text-[12.5px] text-muted tnum">{e.value}</span>
              </li>
            );
          })}
        </ol>
      )}
      {boxW > 0 && !narrow && (
        <svg width={W} height={130} viewBox={`0 0 ${W} 130`} role="img" className="block"
          aria-label={`Key dates: ${evs.map((e) => `${e.label} ${e.value}`).join("; ")}`}>
          {completion != null ? (
            <>
              <line x1={x(0)} x2={x(c)} y1={AY} y2={AY} stroke="var(--accent)" strokeWidth={3} />
              <line x1={x(c)} x2={x(end)} y1={AY} y2={AY} stroke="var(--line-strong)" strokeWidth={1.5} />
              {broken && (
                <g stroke="var(--muted)" strokeWidth={1.2}>
                  <line x1={x(c) + 14} x2={x(c) + 20} y1={AY + 5} y2={AY - 5} />
                  <line x1={x(c) + 19} x2={x(c) + 25} y1={AY + 5} y2={AY - 5} />
                </g>
              )}
            </>
          ) : <line x1={x(0)} x2={x(end)} y1={AY} y2={AY} stroke="var(--line-strong)" strokeWidth={1.5} />}
          {placed.map((e, i) => {
            const col = colour(e.kind);
            const click = e.env ? () => openAnswer(e.env!, e.label) : undefined;
            return (
              <g key={i} onClick={click} style={click ? { cursor: "pointer" } : undefined}>
                {e.lane > 0 && <line x1={e.px} x2={e.px} y1={nameY[e.lane] + 4} y2={AY - 7} stroke="var(--line-strong)" strokeDasharray="1.5 2" />}
                {e.lane > 0 && <line x1={e.px} x2={e.px} y1={AY + 7} y2={valY[e.lane] - 10} stroke="var(--line-strong)" strokeDasharray="1.5 2" />}
                <circle cx={e.px} cy={AY} r={e.kind === "milestone" ? 4.5 : 5.5}
                  fill={e.kind === "milestone" ? "var(--surface)" : col} stroke={col} strokeWidth={e.kind === "milestone" ? 2 : 1} />
                <text x={e.px} y={nameY[e.lane]} textAnchor={e.anchor} fontSize={11.5} fontWeight={e.kind === "completion" ? 600 : 500}
                  fill={e.kind === "late" ? "var(--bad)" : "var(--ink)"}>{e.label}</text>
                <text x={e.px} y={valY[e.lane]} textAnchor={e.anchor} fontSize={11} fill="var(--muted)" className="tnum">{e.value}</text>
                <rect x={e.px - 10} y={AY - 10} width={20} height={20} fill="transparent" />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money locked up
// ---------------------------------------------------------------------------

const LOCK = [
  { key: "retention", label: "Retention held", colour: "var(--accent)", opacity: 0.55 },
  { key: "perf", label: "Performance guarantee", colour: "var(--odd)", opacity: 0.35 },
  { key: "advance", label: "Advance guarantee", colour: "var(--fair)", opacity: 0.45 },
] as const;
const LOCK_TERM: Record<string, [GlossKey, string]> = { retention: ["retention", "Retention"], perf: ["perf", "Performance guarantee"] };
/** glossary words for the number tiles (retention is already explained in the chart legend) */
const TILE_TERM: Record<string, GlossKey> = { emd: "emd", ld: "ld", fin: "financing_cost", bg: "bg" };

function LockedChart({ locked }: { locked: NonNullable<ReturnType<typeof moneyLocked>> }) {
  const series = LOCK.filter((s) => s.key === "retention" || (s.key === "perf" ? locked.hasPerf : locked.hasAdvance));
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="text-[12.5px] text-muted">Peak locked up</div>
          <div className="mt-1 font-serif text-[24px] font-semibold leading-none text-ink tnum">{locked.peak > 0 ? money(locked.peak) : "—"}</div>
          {locked.peak > 0 && <div className="mt-1 text-[12.5px] text-muted">month {locked.peakMonth}</div>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: s.colour, opacity: s.opacity + 0.25 }} />
              {LOCK_TERM[s.key] ? <span><Term k={LOCK_TERM[s.key][0]}>{LOCK_TERM[s.key][1]}</Term>{s.label.slice(LOCK_TERM[s.key][1].length)}</span> : s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 h-[170px] sm:h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={locked.rows} margin={{ top: 6, right: 8, left: 0, bottom: 2 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} minTickGap={18} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={moneyAxis} width={52} />
            <Tooltip labelFormatter={(m) => `Month ${m}`}
              formatter={(v: number, n: string) => [money(v), LOCK.find((s) => s.key === n)?.label ?? n]} />
            {series.map((s) => (
              <Area key={s.key} type="stepAfter" dataKey={s.key} stackId="1" stroke={s.colour} strokeWidth={1.25}
                fill={s.colour} fillOpacity={s.opacity} isAnimationActive={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

function ChipRow({ chips, empty }: { chips: Chip[]; empty: string }) {
  const { openAnswer, openPage } = useRun();
  if (!chips.length) return <div className="mt-2 text-[13px] text-muted">{empty}</div>;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const click = c.env ? () => openAnswer(c.env!, c.label) : c.page ? () => openPage(c.page!.page, c.page!.quote, c.page!.doc, c.label) : undefined;
        const cls = "inline-flex max-w-full items-center truncate rounded border border-line-strong bg-surface px-2 py-0.5 text-[12.5px] text-ink-2";
        return click
          ? <button key={c.label} title={c.title} onClick={click} className={cx(cls, "hover:border-accent hover:text-ink")}>{c.label}</button>
          : <span key={c.label} title={c.title} className={cls}>{c.label}</span>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function KeyFacts({ answers, params, cash, flags, checks }: {
  answers: AnswerEnvelope[]; params: CashParams | undefined; cash: CashResult | undefined; flags: RiskFlag[]; checks: RuleCheck[] | undefined;
}) {
  const { meta } = useRun();
  const pkg = useAsync(() => (meta ? api.package(meta.package_id).catch(() => undefined) : Promise.resolve(undefined)), [meta?.package_id]);
  const ans = useMemo(() => answerLookup(answers), [answers]);
  const dates = useMemo(() => keyDates(ans, params), [ans, params]);
  const locked = useMemo(() => (cash ? moneyLocked(cash, params, dates) : null), [cash, params, dates]);
  const tiles = useMemo(() => numberTiles(ans, params, cash), [ans, params, cash]);
  const pay = useMemo(() => payConditions(ans, flags, params), [ans, flags, params]);
  const docs = useMemo(() => missingDocs(flags, checks, pkg.data ?? undefined), [flags, checks, pkg.data]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Head tip={<>Months of 30 days from the start. Tap a date to see the clause.{dates.list.some((d) => d.kind === "late") ? " The late finish uses the saved delay." : ""}</>}>Key dates</Head>
        <div className="mt-2">
          {dates.list.length > 1 ? <KeyDatesTimeline dates={dates.list} completion={dates.completion} /> : <div className="text-[13px] text-muted">—</div>}
        </div>
      </div>

      <div>
        <Head tip={<>Cash held back from bills plus the face value of the bank guarantees you keep open, month by month.
          {locked?.hasAdvance ? " The advance guarantee is 110% of the advance still owed." : ""}
          {locked?.perfToCompletion ? " The performance guarantee's validity is not stated; it is shown up to completion." : ""}
          {" "}From the cash model with the saved delay.</>}>Money locked up</Head>
        <div className="mt-2">
          {locked ? <LockedChart locked={locked} /> : <div className="text-[13px] text-muted">—</div>}
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.key} className="flex min-w-0 flex-col rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center gap-0.5 text-[12.5px] text-muted">
              <span className="truncate">{TILE_TERM[t.key] ? <Term k={TILE_TERM[t.key]}>{t.label}</Term> : t.label}</span><Tip label={`About ${t.label}`}>{t.info}</Tip>
            </div>
            <div className={cx("mt-1 font-serif font-semibold leading-tight text-ink tnum", t.value.length > 14 ? "text-[17px]" : "text-[22px]")}>{t.value}</div>
            <div className="mt-auto flex items-end justify-between gap-2 pt-1">
              <span className="min-w-0 text-[12px] leading-snug text-muted">{t.note}</span>
              <PageLink env={t.env} label={t.label} />
            </div>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="min-w-0">
          <Head tip="Conditions in the payment, deduction and final-bill clauses. Tap one to see the clause.">What you must do to get paid</Head>
          <ChipRow chips={pay} empty="No extra conditions found" />
        </div>
        <div className="min-w-0">
          <Head tip="Documents the contract refers to that were not in the files read. Their terms could not be checked.">Documents not in the package</Head>
          <ChipRow chips={docs.chips} empty={docs.checked ? "None" : "—"} />
        </div>
      </div>
    </div>
  );
}
