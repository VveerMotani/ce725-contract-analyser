// Manual check: the team re-grades a sample of the judge's labels. "Agree" stores an override equal to the
// judge's label ("confirmed by <name>"), "Change label…" stores a different label with a reason. Both go to
// manual_overrides.json through POST /project/overrides and re-score the run. Read-only copies show the list only.
import { useMemo, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { api } from "../../api";
import { useApp, useAsync } from "../../context";
import { effective, LABELS, type AnswerEnvelope, type GoldenTest, type JudgeNote, type Label, type ManualOverride, type OverridesState, type RunMeta, type TestScore } from "../../types";
import { LABEL_COLOR, topic } from "../../lib/plain";
import { STATIC_SITE } from "../../staticSite";
import { Button, ErrorNote, Spinner, cx, inputCls } from "../../components/ui";
import {
  Head, LABEL_SHORT, PageBtn, Pills, answerText, forget, isClaude, keyTarget, load, reasonOf, selectCls, toolTarget, upper,
} from "./shared";

const PAGE = 20;
const NAME_KEY = "ta-checker-name";

function lsGet(k: string) { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

interface Data {
  tests: TestScore[];
  runOf: Record<string, RunMeta>;
  golden: Record<string, GoldenTest>;
  notes: Record<string, JudgeNote>;
  answers: Record<string, AnswerEnvelope[]>;
  checks: OverridesState;
}

function Progress({ p }: { p: OverridesState["progress"] }) {
  const share = p.total ? p.checked / p.total : 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-serif text-[30px] font-semibold leading-none text-ink tnum">{p.checked}<span className="text-[18px] text-muted"> / {p.total}</span></span>
        <span className="text-[14px] text-ink-2">checked by a person</span>
        <span className="text-[14px] text-muted">·</span>
        <span className="text-[14px] text-ink-2">agreement with judge <span className="font-semibold text-ink tnum">{p.agreement == null ? "—" : `${Math.round(p.agreement * 100)}%`}</span>
          {p.compared > 0 && <span className="text-muted"> ({p.agree} of {p.compared})</span>}</span>
      </div>
      <div className="mt-2 h-2 max-w-[520px] overflow-hidden rounded-full bg-line" role="img" aria-label={`${p.checked} of ${p.total} checked`}>
        <span className="block h-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function ChangeForm({ judge, onSave, onCancel, busy }: { judge: string; onSave: (l: Label, reason: string) => void; onCancel: () => void; busy: boolean }) {
  const [label, setLabel] = useState<Label>((LABELS.find((l) => l !== judge) ?? "Partial") as Label);
  const [reason, setReason] = useState("");
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3 sm:flex-row sm:items-end">
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">Label
        <select className={selectCls} value={label} onChange={(e) => setLabel(e.target.value as Label)}>
          {LABELS.map((l) => <option key={l} value={l}>{LABEL_SHORT[l]}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12.5px] text-muted">Reason
        <input className={cx(inputCls, "py-1 text-[14px]")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the judge’s label is wrong" />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy || !reason.trim()} onClick={() => onSave(label, reason.trim())}>Save</Button>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function TestRow({ t, d, writable, name, onChanged }: { t: TestScore; d: Data; writable: boolean; name: string; onChanged: (s: OverridesState) => void }) {
  const { openSource } = useApp();
  const [mode, setMode] = useState<"idle" | "change">("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const g = d.golden[t.test_id];
  const n = d.notes[t.test_id];
  const meta = d.runOf[t.contract_id];
  const env = d.answers[t.contract_id]?.find((e) => e.answer.question_id === t.question_id);
  const judge = (n?.verdict || t.label) as Label;
  const mine: ManualOverride | undefined = d.checks.overrides.find((o) => o.test_id === t.test_id && (!o.run_id || o.run_id === meta?.run_id));
  const why = n?.reason || reasonOf(t);

  const run = async (fn: () => Promise<OverridesState>) => {
    setBusy(true); setErr(null);
    try { onChanged(await fn()); setMode("idle"); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const save = (label: Label, reason: string) => run(() => api.addOverride({ test_id: t.test_id, label, reason, by: name, run_id: meta?.run_id }));
  const undo = () => run(() => api.removeOverride(t.test_id, mine?.run_id));

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[15px] font-medium text-ink">{topic(t.question_id)}</span>
        <span className="flex items-center gap-2 text-[12.5px] text-muted">
          <span className="tnum">{t.test_id}</span>{t.core && <span className="rounded border border-line-strong px-1 text-[11px]">core</span>}
        </span>
      </div>
      {g?.question && <div className="text-[13px] text-muted">{g.question}</div>}
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[14px] sm:grid-cols-[100px_1fr]">
        <dt className="text-muted">Answer key</dt>
        <dd className="break-words text-ink">{answerText(t.expected_status, t.expected_answer)}</dd>
        <dt className="text-muted">Tool</dt>
        <dd className="break-words text-ink">{answerText(t.tool_status, t.tool_answer)}</dd>
        <dt className="text-muted">Judge</dt>
        <dd className="text-ink-2"><span className="font-medium" style={{ color: LABEL_COLOR[judge] }}>{LABEL_SHORT[judge] ?? judge}</span>{why ? ` · ${upper(why)}` : ""}</dd>
        {mine && (
          <>
            <dt className="text-muted">Person</dt>
            <dd className="text-ink-2">
              {mine.label === judge
                ? <><Check className="mr-1 inline h-4 w-4 text-good" aria-hidden />Agrees{mine.by ? ` · ${mine.by}` : ""}</>
                : <><span className="font-medium" style={{ color: LABEL_COLOR[mine.label] }}>{LABEL_SHORT[mine.label]}</span>{mine.by ? ` · ${mine.by}` : ""}: {mine.reason}</>}
            </dd>
          </>
        )}
      </dl>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {g && <PageBtn who="Key’s page" page={g.pdf_page} onClick={() => openSource(keyTarget(g))} />}
        {env && meta && <PageBtn who="Tool’s page" page={effective(env).pdf_page} onClick={() => openSource(toolTarget(meta, env, `${t.test_id} · tool’s answer`))} />}
        {writable && (
          <span className="ml-auto flex flex-wrap gap-2">
            {mine ? (
              <Button variant="quiet" disabled={busy} onClick={undo} icon={<Undo2 className="h-4 w-4" />}>Undo check</Button>
            ) : (
              <>
                <Button disabled={busy || !name} title={name ? undefined : "Enter your name first"} icon={<Check className="h-4 w-4" />}
                  onClick={() => save(judge, `confirmed by ${name}`)}>Agree</Button>
                <Button variant="quiet" disabled={busy || !name} onClick={() => setMode(mode === "change" ? "idle" : "change")}>Change label…</Button>
              </>
            )}
          </span>
        )}
      </div>
      {mode === "change" && writable && <ChangeForm judge={judge} busy={busy} onSave={save} onCancel={() => setMode("idle")} />}
      {err != null && <div className="mt-2"><ErrorNote error={err} title="Not saved" /></div>}
    </li>
  );
}

export default function ManualCheck() {
  const { runs, mode } = useApp();
  const [ver, setVer] = useState(0);
  const data = useAsync<Data>(async () => {
    if (!runs) return new Promise<Data>(() => {});   // wait for the runs list
    const [ev, checks] = await Promise.all([load.evaluation(), load.overrides()]);
    const runOf: Record<string, RunMeta> = {};
    for (const [cid, rid] of Object.entries(ev.runs_used ?? {})) {
      const m = runs?.find((r) => r.run_id === rid);
      if (m && isClaude(m)) runOf[cid] = m;
    }
    const cids = Object.keys(runOf).sort();
    const [golden, notes, answers] = await Promise.all([
      load.goldenAll(cids), load.judgeNotes().catch(() => [] as JudgeNote[]), load.answersOf(cids.map((c) => runOf[c].run_id)),
    ]);
    return {
      tests: ev.tests.filter((t) => runOf[t.contract_id]), runOf, checks,
      golden: Object.fromEntries(golden.map((g) => [g.test_id, g])),
      notes: Object.fromEntries(notes.filter((n) => cids.some((c) => runOf[c].run_id === n.run_id)).map((n) => [n.test_id, n])),
      answers: Object.fromEntries(cids.map((c) => [c, answers[runOf[c].run_id] ?? []])),
    };
  }, [runs, ver]);
  const [scope, setScope] = useState<"core" | "judged" | "all">("core");
  const [state, setState] = useState<"any" | "open" | "done">("any");
  const [contract, setContract] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [name, setName] = useState(() => lsGet(NAME_KEY));

  const d = data.data;
  const list = useMemo(() => {
    if (!d) return [];
    const done = (t: TestScore) => d.checks.overrides.some((o) => o.test_id === t.test_id);
    return d.tests
      .filter((t) => scope === "all" || (scope === "core" ? t.core : !!d.notes[t.test_id]))
      .filter((t) => !contract || t.contract_id === contract)
      .filter((t) => state === "any" || (state === "done" ? done(t) : !done(t)))
      .sort((a, b) => a.test_id.localeCompare(b.test_id, undefined, { numeric: true }));
  }, [d, scope, contract, state]);

  if (data.loading && !d) return <Spinner label="Loading the graded tests…" />;
  if (data.error || !d) return <ErrorNote error={data.error} title="Could not load the graded tests" />;
  const writable = !STATIC_SITE && mode === "live" && !d.checks.read_only;
  const cids = Object.keys(d.runOf).sort();
  const changed = (s: OverridesState) => {
    forget("evaluation", "overrides");
    setVer((v) => v + 1);
    void s;
  };

  return (
    <div>
      <Head title="Manual check" note="A person re-grades a sample of the judge’s labels: open both pages, then agree or change the label. Every check is stored in manual_overrides.json and applied last when the run is scored." />
      <Progress p={d.checks.progress} />

      {writable ? (
        <label className="mt-6 flex max-w-[360px] flex-col gap-1 text-[12.5px] text-muted">Checker name
          <input className={cx(inputCls, "py-1.5 text-[14px]")} value={name} placeholder="Your name"
            onChange={(e) => { setName(e.target.value); lsSet(NAME_KEY, e.target.value.trim()); }} />
        </label>
      ) : (
        <p className="mt-6 text-[13px] text-muted">Read-only copy: checks are recorded on the team’s own copy of the tool.</p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        <Pills label="Tests" value={scope} onChange={(v) => { setScope(v); setShown(PAGE); }}
          options={[{ value: "core", label: "Core only" }, { value: "judged", label: "Judge-graded" }, { value: "all", label: "All" }]} />
        <Pills label="Checked" value={state} onChange={(v) => { setState(v); setShown(PAGE); }}
          options={[{ value: "any", label: "Any" }, { value: "open", label: "Not checked" }, { value: "done", label: "Checked" }]} />
        <select aria-label="Contract" className={selectCls} value={contract} onChange={(e) => { setContract(e.target.value); setShown(PAGE); }}>
          <option value="">All contracts</option>
          {cids.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="mt-5 text-[13px] text-muted">{list.length} test{list.length === 1 ? "" : "s"}{data.loading ? " · updating…" : ""}</div>
      <ul className="divide-y divide-line border-y border-line">
        {list.slice(0, shown).map((t) => <TestRow key={t.test_id} t={t} d={d} writable={writable} name={name.trim()} onChanged={changed} />)}
      </ul>
      {list.length > shown && (
        <div className="mt-4"><Button onClick={() => setShown((s) => s + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</Button></div>
      )}
    </div>
  );
}
