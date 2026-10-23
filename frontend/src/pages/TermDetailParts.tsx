// Building blocks for the term detail pages: a day/month ruler, key-point tiles, the question rows.
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useRun } from "../context";
import { effective, type AnswerEnvelope } from "../types";
import { STATUS_WORD, topic } from "../lib/plain";
import { cx } from "../components/ui";

export interface RulerRow {
  label: string;
  start?: number;
  end: number;
  value: string;
  env?: AnswerEnvelope | null;
  tone?: "accent" | "good" | "bad" | "muted";
  note?: string;
}

const BAR: Record<NonNullable<RulerRow["tone"]>, string> = {
  accent: "var(--accent)", good: "var(--good)", bad: "var(--bad)", muted: "var(--fair)",
};

/** Horizontal bars on one shared scale (days or months), each row with its value and page link. */
export function Ruler({ rows, max, marks = [], unit }: { rows: RulerRow[]; max: number; marks?: { at: number; label: string }[]; unit: string }) {
  const { openAnswer } = useRun();
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div>
      <ul className="flex flex-col">
        {rows.map((r, i) => {
          const a = r.env ? effective(r.env) : null;
          return (
            <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-line py-2.5 sm:grid-cols-[170px_1fr_170px]">
              <span className="text-[14px] text-ink">{r.label}{r.note && <span className="block text-[12px] text-muted">{r.note}</span>}</span>
              <span className="relative order-3 col-span-2 h-3 sm:order-none sm:col-span-1">
                <span className="absolute inset-y-[5px] left-0 right-0 rounded bg-surface-2" />
                {marks.map((m) => <span key={m.label} className="absolute inset-y-0 w-px bg-line-strong" style={{ left: x(m.at) }} />)}
                <span className="absolute inset-y-[3px] rounded" style={{ left: x(r.start ?? 0), width: `calc(${x(r.end)} - ${x(r.start ?? 0)})`, background: BAR[r.tone ?? "accent"], opacity: r.start != null ? 0.85 : 0.35 }} />
                <span className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-surface" style={{ left: x(r.end), background: BAR[r.tone ?? "accent"] }} />
              </span>
              <span className="text-right text-[13.5px] text-ink tnum">
                {r.value}
                {r.env && a && a.pdf_page > 0 && <button className="ml-2 text-[12.5px] text-accent-ink hover:underline" onClick={() => openAnswer(r.env!, r.label)}>p. {a.pdf_page}</button>}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="relative mt-1 hidden h-5 text-[11.5px] text-muted sm:ml-[182px] sm:mr-[182px] sm:block">
        <span className="absolute left-0">0 {marks.some((m) => m.at / max > 0.82) ? unit : ""}</span>
        {marks.map((m) => <span key={m.label} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(m.at) }}>{m.label}</span>)}
        {!marks.some((m) => m.at / max > 0.82) && <span className="absolute right-0">{Math.round(max)} {unit}</span>}
      </div>
    </div>
  );
}

export interface KeyPoint { label: string; value: ReactNode; env?: AnswerEnvelope | null; tone?: "bad" | "good" }

/** Small tiles: short label, short value, the full answer one click away. */
export function KeyPoints({ items }: { items: KeyPoint[] }) {
  return (
    <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {items.map((k) => <KeyTile key={k.label} k={k} />)}
    </ul>
  );
}

function KeyTile({ k }: { k: KeyPoint }) {
  const { openAnswer } = useRun();
  const [open, setOpen] = useState(false);
  const a = k.env ? effective(k.env) : null;
  return (
    <li className="border-b border-line py-2.5">
      <div className="text-[12.5px] text-muted">{k.label}</div>
      <div className="flex items-start justify-between gap-3">
        <span className={cx("text-[15px]", k.tone === "bad" ? "text-bad" : k.tone === "good" ? "text-good" : "text-ink")}>{k.value}</span>
        <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[12.5px]">
          {a && a.answer_value && <button className="text-muted hover:text-ink" aria-expanded={open} aria-label="Show the full answer" onClick={() => setOpen((o) => !o)}><ChevronRight className={cx("h-4 w-4 transition-transform", open && "rotate-90")} /></button>}
          {k.env && a && a.pdf_page > 0 && <button className="text-accent-ink hover:underline" onClick={() => openAnswer(k.env!, k.label)}>p. {a.pdf_page}</button>}
        </span>
      </div>
      {open && a && <p className="mt-1 text-[13.5px] text-ink-2">{a.answer_value}</p>}
    </li>
  );
}

/** Every question of a clause: topic, answer, status, confidence, page; conflicts expand inline. */
export function QuestionRows({ envs }: { envs: AnswerEnvelope[] }) {
  const { openAnswer } = useRun();
  return (
    <ul className="divide-y divide-line border-y border-line">
      {envs.map((e) => {
        const a = effective(e);
        return (
          <li key={a.question_id} className="grid grid-cols-[1fr_auto] gap-x-4 py-3">
            <div className="min-w-0">
              <div className="text-[12.5px] text-muted" title={e.question}>{topic(a.question_id)}</div>
              <p className={cx("mt-0.5 text-[14.5px] leading-relaxed", a.status === "FOUND" ? "text-ink" : "text-ink-2")}>{a.answer_value || "—"}</p>
              {a.conflicts.length > 0 && (
                <details className="mt-1">
                  <summary className="inline-flex cursor-pointer rounded border border-warn/50 px-1.5 text-[12px] text-ink-2">{a.conflicts.length + 1} values</summary>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-ink-2">
                    {a.conflicts.map((c, i) => (
                      <li key={i}>{c.value} <span className="text-muted">· {c.section_ref}, p. {c.pdf_page}{c.governs === true ? " · applies" : c.governs === false ? " · overridden" : ""}</span></li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div className="flex flex-col items-end gap-0.5 text-right text-[12.5px]">
              <span className="whitespace-nowrap text-ink-2">{STATUS_WORD[a.status]}</span>
              <span className="whitespace-nowrap text-muted">{a.confidence} confidence</span>
              {a.pdf_page > 0 && <button className="text-accent-ink hover:underline" onClick={() => openAnswer(e)}>p. {a.pdf_page}</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="mb-3 flex items-center gap-2 font-serif text-[19px] font-semibold text-ink">{title}{aside}</h2>
      {children}
    </section>
  );
}

export function NoData({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-[14px] text-muted">{children}</p>;
}
