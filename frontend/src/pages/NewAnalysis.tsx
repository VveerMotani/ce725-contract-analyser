// S1 New analysis: pick a benchmark or upload tagged PDFs, enter project inputs, start a run.
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { CheckCircle2, FileUp, Library, Lock, Play, ScanSearch, Trash2, Upload } from "lucide-react";
import { api } from "../api";
import { useApp, useAsync } from "../context";
import type { DocTag, UserInputs } from "../types";
import { money } from "../lib/format";
import { evenCurve, sCurve } from "../lib/curves";
import { Button, Card, Chip, ErrorBox, Field, PageHeader, Segmented, Spinner, cx, inputCls } from "../components/ui";

const TAGS: { value: DocTag; label: string; hint: string }[] = [
  { value: "notice", label: "Notice / RFP", hint: "NIT, RFP, bid data sheet, portal printout" },
  { value: "gcc", label: "General conditions", hint: "CPWD GCC, EPC agreement body" },
  { value: "schedules", label: "Schedules / contract data", hint: "Schedules A–F, Contract Data, Annexures" },
  { value: "special", label: "Special conditions", hint: "Supplementary or particular conditions" },
  { value: "amendment", label: "Amendment", hint: "Corrigenda, correction slips" },
  { value: "boq", label: "BOQ / programme", hint: "Priced quantities, milestones, S-curve" },
  { value: "other", label: "Other", hint: "" },
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

function PctInput({ value, onChange, step = 0.25 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="relative">
      <input type="number" step={step} className={cx(inputCls, "pr-7 tnum")} value={+(value * 100).toFixed(4)}
        onChange={(e) => onChange((parseFloat(e.target.value) || 0) / 100)} />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
    </div>
  );
}

const UNIT_MULT = { rs: 1, lakh: 1e5, crore: 1e7 } as const;

export default function NewAnalysis() {
  const nav = useNavigate();
  const { draft, setDraft, fullMoney, bumpRuns } = useApp();
  const bms = useAsync(() => api.benchmarks(), []);
  const [files, setFiles] = useState<{ file: File; tag: DocTag }[]>([]);
  const [unit, setUnit] = useState<keyof typeof UNIT_MULT>("crore");
  const [busy, setBusy] = useState<"" | "check" | "start">("");
  const [error, setError] = useState<unknown>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const inp = draft.inputs;
  const setInp = (patch: Partial<UserInputs>) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, ...patch } }));
  const valueNum = draft.valueText ? parseFloat(draft.valueText) * UNIT_MULT[unit] : null;

  const curve = useMemo(() => {
    const T = inp.duration_months || 24;
    const p = inp.progress_curve === "even" ? evenCurve(T) : sCurve(T);
    let c = 0;
    return p.map((v, i) => ({ m: i + 1, share: v, cum: (c += v) }));
  }, [inp.duration_months, inp.progress_curve]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const pdfs = Array.from(list).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    setFiles((cur) => [...cur, ...pdfs.map((f) => ({ file: f, tag: guessTag(f.name) }))]);
    setDraft((d) => ({ ...d, packageId: null }));
  };

  const userInputs = (): UserInputs => {
    const T = inp.duration_months;
    return {
      ...inp,
      contract_value: valueNum && valueNum > 0 ? valueNum : null,
      progress: T ? (inp.progress_curve === "even" ? evenCurve(T) : sCurve(T)) : null,
    };
  };

  const uploadPackage = async (): Promise<string> => {
    if (draft.packageId) return draft.packageId;
    if (!files.length) throw new Error("Add at least one PDF first.");
    const cid = draft.contractId.trim() || "CONTRACT-1";
    const pkg = await api.createPackage(files.map((f) => f.file), files.map((f) => f.tag), cid, draft.title.trim() || cid);
    setDraft((d) => ({ ...d, packageId: pkg.package_id }));
    return pkg.package_id;
  };

  const packageIdForStart = async (): Promise<string> => {
    if (draft.source === "upload") return uploadPackage();
    const b = bms.data?.find((x) => x.contract_id === draft.benchmark);
    if (!b) throw new Error("Pick a benchmark contract.");
    return b.package_id;
  };

  const check = async () => {
    setBusy("check"); setError(null);
    try {
      const pid = await packageIdForStart();
      setDraft((d) => ({ ...d, inputs: userInputs() }));
      nav(`/packages/${pid}`);
    } catch (e) { setError(e); } finally { setBusy(""); }
  };

  const start = async () => {
    setBusy("start"); setError(null);
    try {
      const pid = await packageIdForStart();
      const run = await api.startRun(pid, userInputs());
      bumpRuns();
      nav(`/runs/${run.run_id}/progress`);
    } catch (e) { setError(e); } finally { setBusy(""); }
  };

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="New analysis" subtitle="Read a tender or contract package, find its financial terms with proof, flag contractor risks and model cash impact." />

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-warn/50 bg-warn-soft p-3.5 text-warn-ink">
        <Lock className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="text-[13px]">
          <div className="font-semibold">Confidentiality: upload only public documents.</div>
          The text and page images of your PDFs are sent to the Anthropic API (Claude) for reading. Do not upload confidential bids, pricing or
          private contracts. Calculations run locally in plain code.
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        {/* Step 1 documents */}
        <Card title={<><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-white">1</span> Documents</>}
          actions={<Segmented value={draft.source} onChange={(v) => setDraft((d) => ({ ...d, source: v }))}
            options={[{ value: "benchmark", label: <span className="inline-flex items-center gap-1"><Library className="h-3 w-3" />Benchmark</span> }, { value: "upload", label: <span className="inline-flex items-center gap-1"><Upload className="h-3 w-3" />Upload</span> }]} />}>
          {draft.source === "benchmark" ? (
            bms.loading ? <Spinner /> : bms.error ? <ErrorBox error={bms.error} /> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {bms.data!.map((b) => {
                  const on = draft.benchmark === b.contract_id;
                  return (
                    <button key={b.contract_id} onClick={() => setDraft((d) => ({ ...d, benchmark: b.contract_id }))}
                      className={cx("flex flex-col gap-1 rounded-lg border p-3 text-left transition", on ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-surface-2")}>
                      <div className="flex items-center gap-2">
                        <Chip tone={on ? "accent" : "neutral"} size="xs">{b.contract_id}</Chip>
                        {b.has_run && <Chip tone="good" size="xs" icon={<CheckCircle2 className="h-3 w-3" />}>has run</Chip>}
                      </div>
                      <div className="text-[13px] font-medium text-ink">{b.title}</div>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                <Field label="Contract id"><input className={inputCls} placeholder="e.g. PWD-2026-17" value={draft.contractId} onChange={(e) => setDraft((d) => ({ ...d, contractId: e.target.value, packageId: null }))} /></Field>
                <Field label="Title"><input className={inputCls} placeholder="e.g. Road widening, Package 3" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value, packageId: null }))} /></Field>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                onClick={() => fileRef.current?.click()}
                className={cx("flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-5 text-center text-[13px]", dragOver ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-surface-2")}>
                <FileUp className="h-6 w-6 text-muted" />
                <span className="font-medium text-ink">Drop PDFs here or click to choose</span>
                <span className="text-xs text-muted">Tag each file so precedence is right (schedules beat general text, amendments beat both).</span>
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </div>
              {files.length > 0 && (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={f.file.name}>{f.file.name}</span>
                      <span className="text-[11px] text-muted tnum">{(f.file.size / 1e6).toFixed(1)} MB</span>
                      <select className={cx(inputCls, "w-[170px] py-1")} value={f.tag} title={TAGS.find((t) => t.value === f.tag)?.hint}
                        onChange={(e) => { const tag = e.target.value as DocTag; setFiles((cur) => cur.map((x, k) => (k === i ? { ...x, tag } : x))); setDraft((d) => ({ ...d, packageId: null })); }}>
                        {TAGS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <button className="rounded p-1 text-muted hover:text-bad" aria-label="Remove file" onClick={() => { setFiles((cur) => cur.filter((_, k) => k !== i)); setDraft((d) => ({ ...d, packageId: null })); }}><Trash2 className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
              {draft.packageId && <Chip tone="good" icon={<CheckCircle2 className="h-3 w-3" />}>Package uploaded: {draft.packageId}</Chip>}
            </div>
          )}
        </Card>

        {/* Step 2 inputs */}
        <Card title={<><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-white">2</span> Project inputs</>}
          subtitle="The contract does not contain these; the cash model needs them.">
          <div className="grid grid-cols-2 gap-3">
            <Field className="col-span-2" label="Contract value (or accepted bid)" hint={valueNum ? <span className="font-medium text-ink-2">= {money(valueNum, fullMoney)} {fullMoney ? "" : `· ${money(valueNum, true)}`}</span> : "Leave blank to use the value in the contract, if any"}>
              <div className="flex gap-2">
                <input type="number" min={0} step="any" className={cx(inputCls, "tnum")} placeholder="e.g. 250" value={draft.valueText} onChange={(e) => setDraft((d) => ({ ...d, valueText: e.target.value }))} />
                <Segmented size="md" value={unit} onChange={setUnit} options={[{ value: "rs", label: "Rs" }, { value: "lakh", label: "lakh" }, { value: "crore", label: "crore" }]} />
              </div>
            </Field>
            <Field label="Duration (months)" hint="Blank = from the contract">
              <input type="number" min={1} className={cx(inputCls, "tnum")} value={inp.duration_months ?? ""} placeholder="e.g. 24"
                onChange={(e) => setInp({ duration_months: e.target.value ? Math.max(1, parseInt(e.target.value)) : null })} />
            </Field>
            <Field label="Progress curve">
              <div className="flex flex-col gap-1.5">
                <Segmented size="md" value={inp.progress_curve} onChange={(v) => setInp({ progress_curve: v })} options={[{ value: "s_curve", label: "S-curve" }, { value: "even", label: "Even" }]} />
                <div className="h-9 w-full" aria-label="Cumulative progress preview">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={curve} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                      <Area type="monotone" dataKey="cum" stroke="var(--s1)" fill="var(--accent-soft)" strokeWidth={1.5} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Field>
            <Field label="Cost as share of billed value" hint="Contractor's cash out per Rs billed"><PctInput value={inp.cost_share} onChange={(v) => setInp({ cost_share: v })} step={1} /></Field>
            <Field label="Expected delay (days)" hint="For the delay-damages scenario">
              <input type="number" min={0} className={cx(inputCls, "tnum")} value={inp.delay_days} onChange={(e) => setInp({ delay_days: Math.max(0, parseInt(e.target.value) || 0) })} />
            </Field>
            <Field label="Overdraft interest rate (p.a.)"><PctInput value={inp.overdraft_rate_pa} onChange={(v) => setInp({ overdraft_rate_pa: v })} /></Field>
            <Field label="RBI Bank Rate (p.a.)" hint='For "Bank Rate + 3%" terms'><PctInput value={inp.bank_rate_pa} onChange={(v) => setInp({ bank_rate_pa: v })} /></Field>
            <Field label="Bank guarantee commission (p.a.)"><PctInput value={inp.bg_commission_pa} onChange={(v) => setInp({ bg_commission_pa: v })} step={0.1} /></Field>
            <div className="col-span-2">
              <div className="mb-1 text-xs font-medium text-ink-2">Index rise scenario (per year)</div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {Object.entries(inp.index_rise_pa).map(([k, v]) => (
                  <Field key={k} label={<span className="capitalize">{k}</span>}>
                    <PctInput value={v} onChange={(nv) => setInp({ index_rise_pa: { ...inp.index_rise_pa, [k]: nv } })} step={0.5} />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {error ? <div className="mt-4"><ErrorBox error={error} title="Could not start" /></div> : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted">You can change project inputs later on the Cash flow page.</span>
        <Button icon={<ScanSearch className="h-4 w-4" />} onClick={check} disabled={!!busy || (draft.source === "upload" && !files.length && !draft.packageId)}>
          {busy === "check" ? "Checking…" : "Check package first"}
        </Button>
        <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={start} disabled={!!busy || (draft.source === "upload" && !files.length && !draft.packageId)}>
          {busy === "start" ? "Starting…" : "Start analysis"}
        </Button>
      </div>
    </div>
  );
}
