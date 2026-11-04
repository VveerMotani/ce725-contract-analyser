// The figures the cash model needs that the contract does not give: the visitor types them, the
// site never fills them in. Shown in the Cash section instead of any cash figure until complete.
import { useState } from "react";
import type { CashParams } from "../types";
import { FIGURES, saveTyped, stillMissing, typedFor, useFiguresVersion, type Typed } from "../lib/figures";
import { Button, Choice, cx, inputCls } from "./ui";

const UNIT: Record<string, string> = { crore: "Rs crore", months: "months", days: "days", pct: "%", release: "months" };

function Input({ k, value, onChange }: { k: string; value: string; onChange: (v: string) => void }) {
  const def = FIGURES[k];
  if (def.kind === "curve") {
    return (
      <Choice label={def.label} value={value as "s_curve" | "even" | ""} onChange={onChange}
        options={[{ value: "s_curve", label: "Slow start, busy middle" }, { value: "even", label: "Even every month" }]} />
    );
  }
  return (
    <span className="relative block max-w-[240px]">
      <input type="number" min={0} step="any" aria-label={def.label} placeholder={def.example ? `e.g. ${def.example}` : undefined}
        className={cx(inputCls, "py-1.5 pr-20 text-[15px] tnum")} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{UNIT[def.kind]}</span>
    </span>
  );
}

function Group({ title, note, keys, draft, set }: { title: string; note: string; keys: string[]; draft: Typed; set: (k: string, v: string) => void }) {
  if (!keys.length) return null;
  return (
    <div className="mt-5">
      <h3 className="text-[15px] font-medium text-ink">{title}</h3>
      <p className="text-[13px] text-muted">{note}</p>
      <div className="mt-2 divide-y divide-line border-y border-line">
        {keys.map((k) => (
          <label key={k} className="grid gap-x-5 gap-y-1.5 py-3 sm:grid-cols-[1fr_260px] sm:items-center">
            <span>
              <span className="block text-[14.5px] text-ink">{FIGURES[k].label}</span>
              <span className="block text-[13px] text-muted">{FIGURES[k].help}</span>
            </span>
            <Input k={k} value={draft[k] ?? ""} onChange={(v) => set(k, v)} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** The form, for the figures in `params.missing`. */
export function FiguresNeeded({ runId, params, onDone }: { runId: string; params: CashParams; onDone?: () => void }) {
  useFiguresVersion();
  const keys = (params.missing ?? []).filter((k) => FIGURES[k]);
  const [draft, setDraft] = useState<Typed>(() => typedFor(runId));
  const [tried, setTried] = useState(false);
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const left = stillMissing(runId, params);
  const save = () => {
    saveTyped(runId, Object.fromEntries(keys.map((k) => [k, draft[k] ?? ""])));
    setTried(true);
    if (!stillMissing(runId, params).length) onDone?.();
  };
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <p className="text-[15px] text-ink">
        To work out the cash effect, the model needs {keys.length === 1 ? "one figure" : `${keys.length} figures`} that this contract does not give.
        The tool never fills these in by itself.
      </p>
      <Group title="About this contract" note="Kept for this contract in this browser." draft={draft} set={set}
        keys={keys.filter((k) => FIGURES[k].group === "contract")} />
      <Group title="Your own figures" note="Never in a contract. Kept in this browser and used for every contract you open."
        draft={draft} set={set} keys={keys.filter((k) => FIGURES[k].group === "own")} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save}>Work out the cash effect</Button>
        {tried && left.length > 0 && <span className="text-[13.5px] text-bad">Still needed: {left.map((k) => FIGURES[k]?.label ?? k).join(", ")}.</span>}
      </div>
    </div>
  );
}

/** One line under the cash figures: which typed figures they use, with a way to change them. */
export function FiguresUsed({ runId, params, onChange }: { runId: string; params: CashParams; onChange: () => void }) {
  useFiguresVersion();
  const typed = typedFor(runId);
  const keys = (params.missing ?? []).filter((k) => FIGURES[k] && typed[k]);
  if (!keys.length) return null;
  const show = (k: string) => {
    const d = FIGURES[k], v = typed[k];
    if (d.kind === "curve") return v === "s_curve" ? "slow start, busy middle" : "even";
    if (d.kind === "crore") return `Rs ${v} crore`;
    return `${v}${d.kind === "pct" ? "%" : ` ${UNIT[d.kind]}`}`;
  };
  return (
    <p className="mt-4 text-[13.5px] text-ink-2">
      Uses your figures (not in the contract): {keys.map((k) => `${FIGURES[k].label} ${show(k)}`).join(" · ")}.{" "}
      <button className="text-accent-ink hover:underline" onClick={onChange}>Change</button>
    </p>
  );
}
