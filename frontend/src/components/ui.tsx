// Small, quiet UI primitives. No coloured cards, no badges: hierarchy comes from type and space.
import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, Info, Loader2, X } from "lucide-react";
import type { AnswerEnvelope } from "../types";
import type { Tone } from "../lib/terms";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const DOT: Record<Tone, string> = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", none: "bg-none" };
const DOT_LABEL: Record<Tone, string> = { good: "Looks fair", warn: "Worth a close look", bad: "Serious", none: "Not found in this document" };

export function StatusDot({ tone, className, title }: { tone: Tone; className?: string; title?: string }) {
  return <span role="img" aria-label={title ?? DOT_LABEL[tone]} title={title ?? DOT_LABEL[tone]} className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-full", DOT[tone], className)} />;
}

export function Section({ title, aside, children, id, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={cx("scroll-mt-6 border-t border-line pt-7 sm:pt-8", className)}>
      <h2 className="flex items-center gap-2 font-serif text-[21px] font-semibold leading-tight text-ink sm:text-[23px]">{title}{aside}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PageTitle({ title, intro, children }: { title: ReactNode; intro?: ReactNode; children?: ReactNode }) {
  return (
    <header className="pb-6 pt-2">
      <h1 className="font-serif text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">{title}</h1>
      {intro && <p className="mt-2 max-w-[64ch] text-[15px] text-ink-2">{intro}</p>}
      {children}
    </header>
  );
}

/** A quiet "Show …" disclosure built on <details>. */
export function Disclosure({ summary, children, defaultOpen, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return (
    <details className={cx("group", className)} open={defaultOpen}>
      <summary className="inline-flex items-center gap-1.5 py-1 text-[14px] font-medium text-accent-ink hover:underline">
        <ChevronRight className="disclosure-caret h-4 w-4 transition-transform" aria-hidden />
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function buttonCls(variant: "primary" | "secondary" | "quiet" = "secondary"): string {
  const v = {
    primary: "bg-accent text-white border-transparent hover:opacity-90 dark:text-[#10223d]",
    secondary: "bg-surface text-ink border-line-strong hover:bg-surface-2",
    quiet: "bg-transparent text-accent-ink border-transparent hover:underline px-1",
  }[variant];
  return cx("inline-flex items-center justify-center gap-1.5 rounded-md border px-3.5 py-1.5 text-[14px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50", v);
}

export function Button({ children, onClick, variant = "secondary", disabled, type = "button", className, title, icon }: {
  children?: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "quiet"; disabled?: boolean;
  type?: "button" | "submit"; className?: string; title?: string; icon?: ReactNode;
}) {
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={cx(buttonCls(variant), className)}>
      {icon}{children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-[14px] text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function ErrorNote({ error, title = "Something went wrong" }: { error: unknown; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="border-l-2 border-bad py-1 pl-3 text-[14px]">
      <div className="font-medium text-ink">{title}</div>
      <div className="break-words text-muted">{msg}</div>
    </div>
  );
}

/** "See in contract (p. 50)" */
export function SeeLink({ page, onClick, label = "See in contract" }: { page?: number; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="whitespace-nowrap text-[13.5px] text-accent-ink hover:underline">
      {label}{page ? <span className="tnum"> (p. {page})</span> : null}
    </button>
  );
}

/** Small verification mark for an answer: check when the proof holds, warning when a check raised a doubt. */
export function ProofMark({ env }: { env: AnswerEnvelope }) {
  const d = env.review.decision;
  if (d === "accepted" || d === "edited") return <span title="Checked by a person" className="inline-flex text-accent-ink"><Check className="h-4 w-4" aria-label="Checked by a person" /></span>;
  if (d === "rejected") return <span title="Rejected by a person" className="inline-flex text-muted"><X className="h-4 w-4" aria-label="Rejected by a person" /></span>;
  const v = env.verification?.verdict;
  if (v === "fail") return <span title="The proof did not hold up" className="inline-flex text-bad"><AlertTriangle className="h-4 w-4" aria-label="The proof did not hold up" /></span>;
  if (v === "warn" || d === "pending") return <span title="Needs a check" className="inline-flex text-warn"><AlertTriangle className="h-4 w-4" aria-label="Needs a check" /></span>;
  if (v === "pass") return <span title="Quote found on the page" className="inline-flex text-good"><Check className="h-4 w-4" aria-label="Quote found on the page" /></span>;
  return <span className="inline-block h-4 w-4" />;
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="text-[14px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

/** Two or three choices shown as plain text buttons. */
export function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong p-0.5">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx("rounded px-3 py-1 text-[14px] transition", value === o.value ? "bg-ink text-page" : "text-ink-2 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small (i) that opens a short note on click. Keeps long sentences off the page. */
export function InfoTip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}
        className="rounded-full p-0.5 text-muted hover:text-ink">
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <span role="tooltip" className="absolute left-0 top-7 z-30 w-[280px] max-w-[calc(100vw-48px)] rounded-md border border-line bg-surface p-3 font-sans text-[13px] font-normal leading-snug text-ink-2 shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}

/** Big number with a small label above: the factsheet unit. */
export function Figure({ label, value, note, className }: { label: ReactNode; value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-1 font-serif text-[24px] font-semibold leading-none text-ink tnum sm:text-[28px]">{value}</div>
      {note && <div className="mt-1 text-[12.5px] text-muted">{note}</div>}
    </div>
  );
}
