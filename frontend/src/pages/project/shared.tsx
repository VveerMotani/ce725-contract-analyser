// Shared pieces of the Project area: cached loads, run selection, plain cause names, page buttons.
import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { api } from "../../api";
import type { SourceTarget } from "../../context";
import { effective, type AnswerEnvelope, type GoldenTest, type Label, type RunMeta, type Status, type TestScore } from "../../types";
import { STATUS_WORD, runSource, topic } from "../../lib/plain";
import { cx } from "../../components/ui";

// ---------------------------------------------------------------------------
// Cached loads (the tabs share them; a person's check clears the scores)
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<unknown>>();

export function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export function forget(...keys: string[]) {
  keys.forEach((k) => cache.delete(k));
}

export const load = {
  evaluation: () => cached("evaluation", () => api.evaluation()),
  judgeNotes: () => cached("judge-notes", () => api.judgeNotes()),
  overrides: () => cached("overrides", () => api.overrides()),
  golden: (cid: string) => cached(`golden/${cid}`, () => api.golden(cid)),
  goldenAll: (cids: string[]) => Promise.all(cids.map((c) => load.golden(c).catch(() => [] as GoldenTest[]))).then((x) => x.flat()),
  answers: (rid: string) => cached(`answers/${rid}`, () => api.answers(rid)),
  answersOf: (rids: string[]) =>
    Promise.all(rids.map((r) => load.answers(r).catch(() => [] as AnswerEnvelope[]))).then((xs) => Object.fromEntries(rids.map((r, i) => [r, xs[i]])) as Record<string, AnswerEnvelope[]>),
};

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const isClaude = (m: RunMeta) => runSource(m) === "claude";

/** Latest finished run per contract; a Claude-read run beats a replay (same rule as the backend). */
export function latestByContract(runs: RunMeta[] | undefined, contracts: string[]): Record<string, RunMeta> {
  const out: Record<string, RunMeta> = {};
  for (const c of contracts) {
    const done = (runs ?? []).filter((r) => r.contract_id === c && r.stage === "done");
    done.sort((a, b) => Number(isClaude(b)) - Number(isClaude(a)) || (b.started_at + b.run_id).localeCompare(a.started_at + a.run_id));
    if (done[0]) out[c] = done[0];
  }
  return out;
}

export function shortTitle(title: string): string {
  return title.replace(/\b(Tender|Agreement|NIT)\b/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** The judge's cause codes in plain words. */
export const CAUSE_WORD: Record<string, string> = {
  ONE_OF_MANY_NUMBERS: "Left out one of several numbers",
  CONVENTION_DIFFERENCE: "Status convention differs",
  TEXT_LAYER_MISSED_STRIKE: "Missed a struck-through word",
  IMAGE_NOT_READ: "Formula image not read",
  SCAN_NOT_READ: "Scanned page not read",
  RETRIEVAL_MISSED: "Did not find the clause",
  CONFLICT_MISSED: "Missed a conflicting clause",
  REFERENCE_NOT_FOLLOWED: "Did not follow a reference",
  SCHEDULE_NOT_USED: "Schedule not used",
  RATE_CAP_MIXED: "Rate and cap mixed up",
  WRONG_BASE_OR_UNIT: "Wrong base or unit",
  INVENTED_VALUE: "Value not in the contract",
  INVENTED_QUOTE: "Quote not in the contract",
  WRONG_CLAUSE: "Read the wrong clause",
  TERM_NOT_RECOGNISED: "Term not recognised",
  NEGATIVE_MISREAD: "Misread a “not”",
};

export function causeWord(code: string): string {
  return code ? CAUSE_WORD[code] ?? code.toLowerCase().replace(/_/g, " ") : "No cause given";
}

export const LABEL_SHORT: Record<Label, string> = {
  Correct: "Correct",
  "Correct absent": "Correct (absent)",
  Partial: "Partly right",
  Incorrect: "Wrong",
  Missed: "Missed",
  "Wrongly present": "Wrongly present",
};

export function statusWord(s: string): string {
  return STATUS_WORD[s as Status] ?? s;
}

/** "value | unit | base" with the status word in front when it is not "Found". */
export function answerText(status: string, text: string): string {
  const [v, ...rest] = (text || "").split(" | ");
  const extra = rest.filter(Boolean);
  const body = v ? v + (extra.length ? ` (${extra.join("; ")})` : "") : "";
  if (!status || status === "FOUND") return body || "—";
  return body ? `${statusWord(status)}. ${body}` : statusWord(status);
}

export function upper(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/** The judge's reason from a test's reason text when there is no judge note. */
export function reasonOf(t: TestScore): string {
  return t.reason.replace(/^LLM-judged:\s*\(subagent judge\)\s*/, "").replace(/\s*\[code said[^]*$/, "").trim();
}

// ---------------------------------------------------------------------------
// Source panel targets
// ---------------------------------------------------------------------------

export function keyTarget(g: GoldenTest): SourceTarget {
  return {
    packageId: g.contract_id, docId: "d1", page: g.pdf_page, quote: g.verbatim_quote,
    title: `${topic(g.question_id)}: answer key`, subtitle: `${g.test_id} · answer key`,
  };
}

export function toolTarget(meta: RunMeta, env: AnswerEnvelope, subtitle?: string): SourceTarget {
  const a = effective(env);
  return {
    packageId: meta.package_id, docId: env.doc_id || env.verification?.found_doc_id || "d1",
    page: a.pdf_page, quote: a.verbatim_quote, env, subtitle: subtitle ?? "Tool’s answer",
  };
}

/** Small "Tool p. 25" / "Key p. 25" button; disabled look when there is no page. */
export function PageBtn({ who, page, onClick }: { who: string; page: number | undefined; onClick: () => void }) {
  if (!page || page <= 0) {
    return <span className="inline-flex items-center gap-1 text-[12.5px] text-muted"><FileText className="h-3.5 w-3.5" aria-hidden />{who}: no page</span>;
  }
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-line-strong bg-surface px-2 py-0.5 text-[12.5px] text-accent-ink hover:border-accent">
      <FileText className="h-3.5 w-3.5" aria-hidden />{who} <span className="tnum">p. {page}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout bits
// ---------------------------------------------------------------------------

export function Head({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h2 className="font-serif text-[23px] font-semibold leading-tight text-ink sm:text-[26px]">{title}</h2>
      {note && <p className="mt-1.5 max-w-[70ch] text-[13.5px] text-muted">{note}</p>}
      {children}
    </header>
  );
}

export function Sub({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mt-10 border-t border-line pt-6", className)}>
      <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-serif text-[19px] font-semibold text-ink">
        <span>{title}</span>{aside && <span className="font-sans text-[13px] font-normal text-muted">{aside}</span>}
      </h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Small segmented filter (wraps on a phone). */
export function Pills<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx("rounded-full border px-2.5 py-0.5 text-[13px] transition",
            value === o.value ? "border-ink bg-ink text-page" : "border-line-strong text-ink-2 hover:border-ink hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const selectCls = "rounded-md border border-line-strong bg-surface py-1 pl-2 pr-7 text-[13.5px] text-ink outline-none focus:border-accent";
