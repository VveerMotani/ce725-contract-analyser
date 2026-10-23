// Flag tally: ● 2 serious ● 3 watch ● 10 fine ○ 4 not checked
import type { Scorecard } from "../lib/scorecard";
import { cx } from "./ui";

export function Tally({ t, onClick, className, hasChecks = true }: { t: Scorecard["tally"]; onClick?: () => void; className?: string; hasChecks?: boolean }) {
  const items: [string, number, string, boolean][] = [
    ["serious", t.serious, "bg-bad", true],
    ["watch", t.watch, "bg-warn", true],
    ["fine", t.fine, "bg-good", hasChecks],
    ["not checked", t.notChecked, "border border-muted bg-transparent", hasChecks],
  ];
  const body = items.filter(([, , , show]) => show).map(([label, n, dot]) => (
    <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cx("inline-block h-2.5 w-2.5 rounded-full", dot)} aria-hidden />
      <span className="font-medium text-ink tnum">{n}</span> {label}
    </span>
  ));
  const cls = cx("flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-ink-2", className);
  return onClick
    ? <button type="button" onClick={onClick} className={cx(cls, "text-left hover:opacity-80")} aria-label="Go to red and green flags">{body}</button>
    : <div className={cls}>{body}</div>;
}
