// Read a contract: (1) which contract, (2) a few facts about the project, with sensible defaults. Advanced inputs are collapsed.
import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FileUp, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context";
import type { DocTag, UserInputs } from "../types";
import { money } from "../lib/format";
import { evenCurve, sCurve } from "../lib/curves";
import { Button, Choice, Disclosure, ErrorNote, Field, PageTitle, cx, inputCls } from "../components/ui";

const TAGS: { value: DocTag; label: string }[] = [
  { value: "notice", label: "Tender notice or RFP" },
  { value: "gcc", label: "General conditions" },
  { value: "schedules", label: "Schedules or contract data" },
  { value: "special", label: "Special conditions" },
  { value: "amendment", label: "Corrigendum or amendment" },
  { value: "boq", label: "Bill of quantities or programme" },
  { value: "other", label: "Something else" },
];

function guessTag(name: string): DocTag {
  const n = name.toLowerCase();
  if (/corrig|amend|addend/.test(n)) return "amendment";
  if (/gcc|general.?cond|agreement/.test(n)) return "gcc";
  if (/sched|annex|contract.?data/.test(n)) return "schedules";
  if (/special|scc|supplement/.test(n)) return "special";
  if (/boq|quantit|programme/.test(n)) return "boq";
  if (/nit|notice|rfp|tender/.test(n)) return "notice";
  return "other";
}

function PctInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="relative block">
      <input type="number" step="any" aria-label={label} className={cx(inputCls, "pr-8 tnum")} value={+(value * 100).toFixed(4)}
        onChange={(e) => onChange((parseFloat(e.target.value) || 0) / 100)} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">%</span>
    </span>
  );
}

export default function NewAnalysis() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { draft, setDraft, benchmarks, refreshRuns } = useApp();
  const bmId = sp.get("benchmark");
  const bm = bmId ? benchmarks?.find((b) => b.contract_id === bmId) : undefined;
  const [files, setFiles] = useState<{ file: File; tag: DocTag }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const inp = draft.inputs;
  const setInp = (patch: Partial<UserInputs>) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, ...patch } }));
  const valueNum = draft.valueText ? parseFloat(draft.valueText) * 1e7 : null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const pdfs = Array.from(list).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    setFiles((cur) => [...cur, ...pdfs.map((f) => ({ file: f, tag: guessTag(f.name) }))]);
  };

  const start = async () => {
    setBusy(true); setError(null);
    try {
      let pid: string;
      if (bmId) {
        if (!bm) throw new Error("That test contract was not found.");
        pid = bm.package_id;
      } else {
        if (!files.length) throw new Error("Add at least one PDF first.");
        const name = draft.title.trim() || "New contract";
        const cid = draft.contractId.trim() || name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32).toUpperCase() || "CONTRACT-1";
        const pkg = await api.createPackage(files.map((f) => f.file), files.map((f) => f.tag), cid, name);
        pid = pkg.package_id;
      }
      const T = inp.duration_months;
      const ui: UserInputs = {
        ...inp,
        contract_value: valueNum && valueNum > 0 ? valueNum : null,
        progress: T ? (inp.progress_curve === "even" ? evenCurve(T) : sCurve(T)) : null,
      };
      const run = await api.startRun(pid, ui);
      refreshRuns();
      nav(`/runs/${run.run_id}`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const canStart = !busy && (bmId ? !!bm : files.length > 0);

  return (
    <div className="max-w-[680px]">
      <PageTitle title={bm ? `Read “${bm.title}”` : "Read a new contract"} />

      <section className="border-t border-line pt-6">
        <h2 className="font-serif text-[20px] font-semibold text-ink">1. The contract</h2>
        {bmId ? (
          <p className="mt-2 text-[15px] text-ink-2">{bm ? bm.title : bmId} · test contract. <Link className="text-accent-ink hover:underline" to="/new">Upload another</Link></p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Name of the contract" hint="For example: Road widening, Package 3">
              <input className={inputCls} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </Field>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
              className={cx("flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-7 text-center text-[14.5px]", dragOver ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent")}>
              <FileUp className="h-6 w-6 text-muted" aria-hidden />
              <span className="font-medium text-ink">Drop the PDF files here, or click to choose</span>
              <span className="text-[13px] text-muted">Notice, conditions, schedules, corrigenda</span>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {files.length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {files.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-[14.5px] text-ink" title={f.file.name}>{f.file.name}</span>
                    <select aria-label="What is this file?" className={cx(inputCls, "w-auto py-1 text-[14px]")} value={f.tag}
                      onChange={(e) => { const tag = e.target.value as DocTag; setFiles((cur) => cur.map((x, k) => (k === i ? { ...x, tag } : x))); }}>
                      {TAGS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button className="rounded p-1 text-muted hover:text-ink" aria-label={`Remove ${f.file.name}`} onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}><X className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[13px] text-muted">Public documents only: pages are sent to Claude (Anthropic).</p>
          </div>
        )}
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-serif text-[20px] font-semibold text-ink">2. About the project</h2>
        <p className="mt-1 text-[13.5px] text-muted">For the cash figures · defaults suit most public works</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Contract value" hint={valueNum ? `= ${money(valueNum)}` : "Leave blank to use the value in the contract."}>
            <span className="relative block">
              <input type="number" min={0} step="any" className={cx(inputCls, "pr-16 tnum")} placeholder="e.g. 25" value={draft.valueText}
                onChange={(e) => setDraft((d) => ({ ...d, valueText: e.target.value }))} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">Rs crore</span>
            </span>
          </Field>
          <Field label="How long will the work take?" hint="Leave blank to use the time in the contract.">
            <span className="relative block">
              <input type="number" min={1} className={cx(inputCls, "pr-16 tnum")} placeholder="e.g. 18" value={inp.duration_months ?? ""}
                onChange={(e) => setInp({ duration_months: e.target.value ? Math.max(1, parseInt(e.target.value)) : null })} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">months</span>
            </span>
          </Field>
          <Field label="Your cost as % of contract value" hint="What you spend for every Rs 100 you bill.">
            <PctInput label="Your cost as % of contract value" value={inp.cost_share} onChange={(v) => setInp({ cost_share: v })} />
          </Field>
          <Field label="Delay to plan for" hint="Also adjustable on the report">
            <span className="relative block">
              <input type="number" min={0} className={cx(inputCls, "pr-14 tnum")} value={inp.delay_days} onChange={(e) => setInp({ delay_days: Math.max(0, parseInt(e.target.value) || 0) })} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">days</span>
            </span>
          </Field>
        </div>

        <Disclosure className="mt-6" summary="More settings">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your overdraft interest rate (a year)"><PctInput label="Overdraft interest rate" value={inp.overdraft_rate_pa} onChange={(v) => setInp({ overdraft_rate_pa: v })} /></Field>
            <Field label="RBI Bank Rate" hint="For terms like “Bank Rate + 3%”."><PctInput label="RBI Bank Rate" value={inp.bank_rate_pa} onChange={(v) => setInp({ bank_rate_pa: v })} /></Field>
            <Field label="Bank guarantee commission (a year)"><PctInput label="Bank guarantee commission" value={inp.bg_commission_pa} onChange={(v) => setInp({ bg_commission_pa: v })} /></Field>
            <Field label="Credit from your suppliers">
              <span className="relative block">
                <input type="number" min={0} className={cx(inputCls, "pr-14 tnum")} value={inp.supplier_credit_days} onChange={(e) => setInp({ supplier_credit_days: Math.max(0, parseInt(e.target.value) || 0) })} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">days</span>
              </span>
            </Field>
            <Field label="Shape of the work over time" className="sm:col-span-2">
              <Choice label="Shape of the work over time" value={inp.progress_curve} onChange={(v) => setInp({ progress_curve: v })}
                options={[{ value: "s_curve", label: "Slow start, busy middle (S-curve)" }, { value: "even", label: "Even every month" }]} />
            </Field>
            <div className="sm:col-span-2">
              <div className="text-[14px] font-medium text-ink">Expected price rise a year</div>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {Object.entries(inp.index_rise_pa).map(([k, v]) => (
                  <Field key={k} label={<span className="text-[13.5px] font-normal capitalize text-ink-2">{k}</span>}>
                    <PctInput label={`Price rise for ${k}`} value={v} onChange={(nv) => setInp({ index_rise_pa: { ...inp.index_rise_pa, [k]: nv } })} />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        </Disclosure>
      </section>

      {error ? <div className="mt-6"><ErrorNote error={error} title="Could not start" /></div> : null}
      <div className="mt-8 border-t border-line pt-6">
        <Button variant="primary" onClick={start} disabled={!canStart}>{busy ? "Starting…" : "Start reading the contract"}</Button>
      </div>
    </div>
  );
}
