import { useState, type ReactNode } from "react";
import {
  AlertTriangle, Ban, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, CircleHelp, Eye, FileSearch,
  Hash, Info, Link2, Loader2, MinusCircle, Pencil, Quote as QuoteIcon, ShieldAlert, X, XCircle,
} from "lucide-react";
import type { AnswerEnvelope, ReviewDecision, Severity, Status } from "../types";

export type Tone = "good" | "warn" | "bad" | "serious" | "neutral" | "accent" | "violet";

const TONE_CHIP: Record<Tone, string> = {
  good: "bg-good-soft text-good-ink",
  warn: "bg-warn-soft text-warn-ink",
  bad: "bg-bad-soft text-bad-ink",
  serious: "bg-serious-soft text-serious-ink",
  neutral: "bg-neutral-soft text-neutral-ink",
  accent: "bg-accent-soft text-accent-ink",
  violet: "bg-violet-soft text-violet-ink",
};
export const TONE_SOLID: Record<Tone, string> = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  serious: "bg-serious",
  neutral: "bg-neutral",
  accent: "bg-accent",
  violet: "bg-violet",
};
export const TONE_SOFT: Record<Tone, string> = {
  good: "bg-good-soft",
  warn: "bg-warn-soft",
  bad: "bg-bad-soft",
  serious: "bg-serious-soft",
  neutral: "bg-neutral-soft",
  accent: "bg-accent-soft",
  violet: "bg-violet-soft",
};
export const TONE_TEXT: Record<Tone, string> = {
  good: "text-good-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  serious: "text-serious-ink",
  neutral: "text-neutral-ink",
  accent: "text-accent-ink",
  violet: "text-violet-ink",
};
export const TONE_VAR: Record<Tone, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  serious: "var(--serious)",
  neutral: "var(--neutral)",
  accent: "var(--accent)",
  violet: "var(--violet)",
};

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Basic building blocks
// ---------------------------------------------------------------------------

export function Card({ title, icon, actions, children, className, bodyClass, subtitle }: {
  title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; subtitle?: ReactNode;
}) {
  return (
    <section className={cx("min-w-0 rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink">{icon}{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">{icon}{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Chip({ tone = "neutral", icon, children, title, className, size = "sm" }: {
  tone?: Tone; icon?: ReactNode; children: ReactNode; title?: string; className?: string; size?: "xs" | "sm";
}) {
  return (
    <span title={title} className={cx(
      "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium",
      size === "xs" ? "px-1.5 py-px text-[10.5px]" : "px-2 py-0.5 text-[11.5px]",
      TONE_CHIP[tone], className,
    )}>
      {icon}{children}
    </span>
  );
}

export function Dot({ tone, className, title }: { tone: Tone; className?: string; title?: string }) {
  return <span title={title} className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-full", TONE_SOLID[tone], className)} />;
}

export function Button({ children, onClick, variant = "secondary", disabled, icon, type = "button", className, title, size = "md" }: {
  children?: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger" | "good"; disabled?: boolean;
  icon?: ReactNode; type?: "button" | "submit"; className?: string; title?: string; size?: "sm" | "md";
}) {
  const v = {
    primary: "bg-accent text-white hover:brightness-110 border-transparent",
    secondary: "bg-surface text-ink border-line-strong hover:bg-surface-2",
    ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2",
    danger: "bg-surface text-bad-ink border-line-strong hover:bg-bad-soft",
    good: "bg-good text-white border-transparent hover:brightness-110",
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={cx(
      "inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
      size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-[13px]", v, className,
    )}>
      {icon}{children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ error, title = "Something went wrong" }: { error: unknown; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-soft p-3 text-sm text-bad-ink">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div><div className="font-semibold">{title}</div><div className="break-words opacity-90">{msg}</div></div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-10 text-center">
      <div className="text-muted">{icon ?? <FileSearch className="h-8 w-8" />}</div>
      <div className="font-semibold text-ink">{title}</div>
      {children && <div className="max-w-md text-[13px] text-ink-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip (CSS only)
// ---------------------------------------------------------------------------

export function Tip({ tip, children, side = "top" }: { tip: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" className={cx(
        "pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-[260px] -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] font-normal leading-snug text-ink shadow-lg group-hover:block",
        side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
      )}>{tip}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Domain chips
// ---------------------------------------------------------------------------

export const STATUS_META: Record<Status, { tone: Tone; label: string; icon: ReactNode; hint: string }> = {
  FOUND: { tone: "good", label: "Found", icon: <Check className="h-3 w-3" />, hint: "The document states it" },
  NOT_STATED: { tone: "neutral", label: "Not stated", icon: <CircleDashed className="h-3 w-3" />, hint: "Nothing in the package after a full search" },
  NOT_APPLICABLE: { tone: "accent", label: "Not applicable", icon: <Ban className="h-3 w-3" />, hint: "Clause exists but this contract switches it off" },
  POINTS_ELSEWHERE: { tone: "warn", label: "Points elsewhere", icon: <Link2 className="h-3 w-3" />, hint: "Detail is in another document" },
};

export function StatusChip({ status, size }: { status: Status; size?: "xs" | "sm" }) {
  const m = STATUS_META[status] ?? STATUS_META.NOT_STATED;
  return <Chip tone={m.tone} icon={m.icon} title={m.hint} size={size}>{m.label}</Chip>;
}

export const SEVERITY_META: Record<Severity, { tone: Tone; rank: number; icon: ReactNode }> = {
  High: { tone: "bad", rank: 5, icon: <ShieldAlert className="h-3 w-3" /> },
  Medium: { tone: "warn", rank: 4, icon: <AlertTriangle className="h-3 w-3" /> },
  Low: { tone: "accent", rank: 3, icon: <Info className="h-3 w-3" /> },
  "Needs review": { tone: "violet", rank: 2, icon: <Eye className="h-3 w-3" /> },
  Info: { tone: "neutral", rank: 1, icon: <Info className="h-3 w-3" /> },
};

export function SeverityChip({ severity, size }: { severity: Severity; size?: "xs" | "sm" }) {
  const m = SEVERITY_META[severity] ?? SEVERITY_META.Info;
  return <Chip tone={m.tone} icon={m.icon} size={size}>{severity}</Chip>;
}

export const REVIEW_META: Record<ReviewDecision, { tone: Tone; label: string; icon: ReactNode }> = {
  pending: { tone: "warn", label: "Pending review", icon: <Eye className="h-3 w-3" /> },
  accepted: { tone: "good", label: "Accepted", icon: <CheckCircle2 className="h-3 w-3" /> },
  edited: { tone: "accent", label: "Edited", icon: <Pencil className="h-3 w-3" /> },
  rejected: { tone: "bad", label: "Rejected", icon: <X className="h-3 w-3" /> },
  not_needed: { tone: "neutral", label: "Auto-verified", icon: <Check className="h-3 w-3" /> },
};

export function ReviewChip({ decision, size }: { decision: ReviewDecision; size?: "xs" | "sm" }) {
  const m = REVIEW_META[decision];
  return <Chip tone={m.tone} icon={m.icon} size={size}>{m.label}</Chip>;
}

function VIcon({ ok, label, icon, detail }: { ok: boolean | null | undefined; label: string; icon: ReactNode; detail?: string }) {
  const tone: Tone = ok === true ? "good" : ok === false ? "bad" : "neutral";
  const state = ok === true ? "passed" : ok === false ? "failed" : "not applicable";
  return (
    <Tip tip={<span><b>{label}</b>: {state}{detail ? <><br /><span className="text-muted">{detail}</span></> : null}</span>}>
      <span className={cx("inline-flex h-5 w-5 items-center justify-center rounded-md", TONE_CHIP[tone], ok == null && "opacity-60")} aria-label={`${label} ${state}`}>
        {icon}
      </span>
    </Tip>
  );
}

/** Three small icons: quote verified, page match, numbers in quote. */
export function VerifyIcons({ env }: { env: AnswerEnvelope }) {
  const v = env.verification;
  const v3 = v?.checks.find((c) => c.check === "V3");
  const v2 = v?.checks.find((c) => c.check === "V2");
  const v1 = v?.checks.find((c) => c.check === "V1");
  return (
    <span className="inline-flex items-center gap-1">
      <VIcon ok={v?.quote_found} label="Quote found in text" detail={v1?.detail} icon={<QuoteIcon className="h-3 w-3" />} />
      <VIcon ok={v?.page_matches} label="Quote on stated page" detail={v2?.detail} icon={<FileSearch className="h-3 w-3" />} />
      <VIcon ok={v3?.passed} label="Numbers appear in quote" detail={v3?.detail} icon={<Hash className="h-3 w-3" />} />
    </span>
  );
}

export function VerdictChip({ verdict }: { verdict: "pass" | "warn" | "fail" | undefined }) {
  if (!verdict) return <Chip tone="neutral" icon={<CircleHelp className="h-3 w-3" />}>Unverified</Chip>;
  const m = { pass: { t: "good" as Tone, i: <CheckCircle2 className="h-3 w-3" /> }, warn: { t: "warn" as Tone, i: <AlertTriangle className="h-3 w-3" /> }, fail: { t: "bad" as Tone, i: <XCircle className="h-3 w-3" /> } }[verdict];
  return <Chip tone={m.t} icon={m.i}>{verdict}</Chip>;
}

export function CheckIcon({ passed }: { passed: boolean | null }) {
  if (passed === true) return <CheckCircle2 className="h-4 w-4 text-good" />;
  if (passed === false) return <XCircle className="h-4 w-4 text-bad" />;
  return <MinusCircle className="h-4 w-4 text-neutral" />;
}

export function ConfidenceBars({ level }: { level: "high" | "medium" | "low" }) {
  const n = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const tone = level === "high" ? "bg-good" : level === "medium" ? "bg-warn" : "bg-bad";
  return (
    <Tip tip={`Confidence: ${level}`}>
      <span className="inline-flex items-end gap-[2px]" aria-label={`confidence ${level}`}>
        {[1, 2, 3].map((i) => <span key={i} className={cx("w-[4px] rounded-sm", i <= n ? tone : "bg-line-strong")} style={{ height: 4 + i * 3 }} />)}
      </span>
    </Tip>
  );
}

// ---------------------------------------------------------------------------
// Text that stays short by default
// ---------------------------------------------------------------------------

export function ClampText({ text, className, more = "more" }: { text: string; className?: string; more?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className={cx("text-[13px] text-ink-2", className)}>
      <span className={open ? "" : "line-clamp-1"}>{text}</span>
      {text.length > 80 && (
        <button onClick={() => setOpen(!open)} className="text-xs font-medium text-accent-ink hover:underline">{open ? "less" : more}</button>
      )}
    </div>
  );
}

export function Collapsible({ summary, children, defaultOpen = false, className, right }: {
  summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string; right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cx("rounded-lg border border-line", className)}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-ink hover:bg-surface-2">
        {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        <span className="min-w-0 flex-1">{summary}</span>
        {right}
      </button>
      {open && <div className="border-t border-line px-3 py-3">{children}</div>}
    </div>
  );
}

/** Verbatim quote as a styled blockquote with page badge; collapsed to one line by default. */
export function Quote({ text, page, onOpen, collapsed = true, section }: { text: string; page?: number; onOpen?: () => void; collapsed?: boolean; section?: string }) {
  const [open, setOpen] = useState(!collapsed);
  if (!text) return <div className="text-xs italic text-muted">No quote</div>;
  return (
    <figure className="group relative rounded-r-md border-l-[3px] border-accent bg-surface-2 py-1.5 pl-3 pr-2">
      <blockquote className={cx("font-serif text-[13px] leading-relaxed text-ink", !open && "line-clamp-1")}>“{text}”</blockquote>
      <figcaption className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        {page ? (
          <button onClick={onOpen} disabled={!onOpen} className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-px font-semibold text-accent-ink hover:underline disabled:no-underline">
            <FileSearch className="h-3 w-3" /> p. {page}
          </button>
        ) : null}
        {section && <span className="truncate">{section}</span>}
        {text.length > 70 && <button onClick={() => setOpen(!open)} className="font-medium text-accent-ink hover:underline">{open ? "collapse" : "full quote"}</button>}
      </figcaption>
    </figure>
  );
}

export function PageLink({ page, onClick }: { page: number; onClick?: () => void }) {
  if (!page) return <span className="text-muted">–</span>;
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-px text-[11.5px] font-semibold text-accent-ink hover:underline tnum">
      <FileSearch className="h-3 w-3" />p.{page}
    </button>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles, rings, donut
// ---------------------------------------------------------------------------

export function KpiTile({ label, value, sub, tone, icon, className, onClick }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode; className?: string; onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cx("relative min-w-0 overflow-hidden rounded-xl border border-line bg-surface px-4 py-3 text-left", onClick && "hover:border-accent", className)}>
      {tone && <span className={cx("absolute inset-y-0 left-0 w-1", TONE_SOLID[tone])} />}
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-muted">{icon}{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-2">{sub}</div>}
    </Comp>
  );
}

export function ProgressRing({ value, total, size = 112, stroke = 10, label, tone = "good" }: {
  value: number; total: number; size?: number; stroke?: number; label?: ReactNode; tone?: Tone;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = total ? value / total : 0;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TONE_VAR[tone]} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-lg font-semibold leading-none text-ink tnum">{value}<span className="text-xs font-normal text-muted">/{total}</span></div>
        {label && <div className="mt-1 text-[10.5px] leading-tight text-muted">{label}</div>}
      </div>
    </div>
  );
}

export interface DonutSlice { name: string; value: number; color: string }

export function Donut({ data, size = 120, stroke = 16, center }: { data: DonutSlice[]; size?: number; stroke?: number; center?: ReactNode }) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 2 : 0;
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {data.filter((d) => d.value > 0).map((d) => {
          const len = (d.value / total) * c;
          const el = (
            <circle key={d.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-acc}>
              <title>{`${d.name}: ${d.value}`}</title>
            </circle>
          );
          acc += len;
          return el;
        })}
      </svg>
      {center && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; value?: ReactNode }[] }) {
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          <span className="text-ink-2">{i.name}</span>
          {i.value !== undefined && <span className="ml-auto pl-3 font-semibold text-ink tnum">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "sm" }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cx(
          "rounded-md font-medium transition", size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-[13px]",
          value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
        )}>{o.label}</button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
