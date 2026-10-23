// S9 Evaluation (team only): scores against golden_tests_v1.json. Charts first, table below.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Bug, Crosshair, FlaskConical, Quote as QuoteIcon, Search, Star, Target } from "lucide-react";
import { api } from "../api";
import { useAsync } from "../context";
import { CLAUSE_IDS, CLAUSE_SHORT, LABELS, labelCounts, type Label, type TestScore } from "../types";
import { ReplayBanner } from "../components/Replay";
import { Card, CheckIcon, Chip, Donut, ErrorBox, KpiTile, Legend, PageHeader, Spinner, type Tone, cx, inputCls } from "../components/ui";

export const LABEL_COLORS: Record<string, string> = {
  Correct: "var(--good)",
  "Correct absent": "var(--s3)",
  Partial: "var(--warn)",
  Incorrect: "var(--bad)",
  Missed: "var(--serious)",
  "Wrongly present": "var(--violet)",
};
const LABEL_TONE: Record<Label, Tone> = {
  Correct: "good", "Correct absent": "good", Partial: "warn", Incorrect: "bad", Missed: "serious", "Wrongly present": "violet",
};
const CONTRACTS = ["BM1", "BM2", "BM3", "BM4"];

function pctS(x: number) { return `${Math.round(x * 100)}%`; }

function heatColor(f: number | null): string {
  if (f === null) return "var(--surface-2)";
  const steps = ["var(--seq-0)", "var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)", "var(--seq-6)"];
  return steps[Math.min(steps.length - 1, Math.floor(f * (steps.length - 1) + 0.5))];
}

function Heatmap({ tests }: { tests: TestScore[] }) {
  const cell = (c: string, k: string) => {
    const t = tests.filter((x) => x.contract_id === c && x.clause_id === k);
    if (!t.length) return { f: null as number | null, n: 0, ok: 0 };
    const ok = t.filter((x) => x.label === "Correct" || x.label === "Correct absent").length;
    return { f: ok / t.length, n: t.length, ok };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[12px]">
        <thead>
          <tr><th />{CLAUSE_IDS.map((k) => <th key={k} className="px-1 text-center font-semibold text-muted" title={CLAUSE_SHORT[k]}>{k}<div className="text-[10px] font-normal">{CLAUSE_SHORT[k]}</div></th>)}</tr>
        </thead>
        <tbody>
          {CONTRACTS.map((c) => (
            <tr key={c}>
              <th className="pr-2 text-left font-semibold text-ink-2">{c}</th>
              {CLAUSE_IDS.map((k) => {
                const { f, n, ok } = cell(c, k);
                const dark = f !== null && f >= 0.55;
                return (
                  <td key={k} title={`${c} ${k}: ${ok}/${n} correct`} className="h-11 min-w-[58px] rounded-md text-center font-semibold tnum"
                    style={{ background: heatColor(f), color: dark ? "var(--heat-hi-ink)" : "var(--ink)" }}>
                    {f === null ? "–" : pctS(f)}
                    <div className="text-[10px] font-normal opacity-75">{ok}/{n}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        0%<span className="flex h-2 w-40 overflow-hidden rounded">{[0, 1, 2, 3, 4, 5, 6].map((i) => <span key={i} className="flex-1" style={{ background: `var(--seq-${i})` }} />)}</span>100% correct (incl. correct absent)
      </div>
    </div>
  );
}

function stackData(by: Record<string, Record<string, number>>, keys: string[], nameOf: (k: string) => string = (k) => k) {
  return keys.filter((k) => by[k]).map((k) => ({ name: nameOf(k), ...labelCounts(by[k]) }));
}

function StackedBars({ data }: { data: Record<string, string | number>[] }) {
  return (
    <div className="h-[230px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={96} />
          <Tooltip cursor={{ fill: "var(--accent-soft)" }} />
          <RLegend verticalAlign="top" height={28} iconType="square" wrapperStyle={{ fontSize: 11.5 }} />
          {LABELS.map((l, i) => (
            <Bar key={l} dataKey={l} stackId="a" fill={LABEL_COLORS[l]} stroke="var(--surface)" strokeWidth={1.5} isAnimationActive={false}
              radius={i === LABELS.length - 1 ? [0, 3, 3, 0] : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Evaluation() {
  const ev = useAsync(() => api.evaluation(), []);
  const [label, setLabel] = useState<Label | "all">("all");
  const [contract, setContract] = useState("all");
  const [clause, setClause] = useState("all");
  const [coreOnly, setCoreOnly] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [q, setQ] = useState("");

  const s = ev.data;
  const rows = useMemo(() => {
    if (!s) return [];
    const n = q.trim().toLowerCase();
    return s.tests.filter((t) =>
      (label === "all" || t.label === label) && (contract === "all" || t.contract_id === contract) && (clause === "all" || t.clause_id === clause) &&
      (!coreOnly || t.core) && (!errorsOnly || !["Correct", "Correct absent"].includes(t.label)) &&
      (!n || `${t.test_id} ${t.expected_answer} ${t.tool_answer} ${t.cause_code}`.toLowerCase().includes(n)));
  }, [s, label, contract, clause, coreOnly, errorsOnly, q]);

  if (ev.loading) return <Spinner label="Loading evaluation…" />;
  if (ev.error) return <><PageHeader title="Evaluation" /><ErrorBox error={ev.error} title="No evaluation yet" /></>;
  const total = s!.tests.length;
  const counts = labelCounts(s!.counts);
  const donut = LABELS.map((l) => ({ name: l, value: counts[l], color: LABEL_COLORS[l] }));
  const correct = counts["Correct"] + counts["Correct absent"];
  const causes = Object.entries(s!.tests.reduce<Record<string, number>>((a, t) => { if (t.cause_code) a[t.cause_code] = (a[t.cause_code] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Evaluation" icon={<FlaskConical className="h-5 w-5 text-accent" />}
        subtitle={<>Tool answers scored against the {total} golden tests (spec §10).</>} />

      {s!.replay && (
        <ReplayBanner>
          These scores use answer-key replay runs for: <b>{(s!.replay_contracts ?? Object.keys(s!.runs_used ?? {})).join(", ")}</b> — they test the pipeline, not the AI.
          Run the AI on each benchmark for real accuracy numbers.
        </ReplayBanner>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">Runs used:</span>
        {Object.entries(s!.runs_used ?? {}).map(([c, r]) => <Link key={c} to={`/runs/${r}/overview`}><Chip tone="accent" size="xs">{c} · {r}</Chip></Link>)}
        {(s!.missing_benchmarks ?? []).map((c) => <Chip key={c} tone="warn" size="xs" icon={<AlertTriangle className="h-3 w-3" />}>{c}: no run yet</Chip>)}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile label="Precision" icon={<Crosshair className="h-3.5 w-3.5" />} value={pctS(s!.precision)} sub="correct / answers given" tone="accent" />
        <KpiTile label="Recall" icon={<Target className="h-3.5 w-3.5" />} value={pctS(s!.recall)} sub="correct / answers in key" tone="accent" />
        <KpiTile label="Core pass rate" icon={<Star className="h-3.5 w-3.5" />} value={pctS(s!.core_pass_rate)} sub={`${s!.tests.filter((t) => t.core).length} core tests`} tone={s!.core_pass_rate >= 0.9 ? "good" : "warn"} />
        <KpiTile label="Quote verification" icon={<QuoteIcon className="h-3.5 w-3.5" />} value={pctS(s!.quote_verification_rate)} sub="target 100%" tone={s!.quote_verification_rate >= 0.999 ? "good" : "warn"} />
        <KpiTile label="Hallucinations" icon={<Bug className="h-3.5 w-3.5" />} value={s!.hallucinations} sub="wrongly present + invented" tone={s!.hallucinations ? "bad" : "good"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.8fr)_1.2fr_1.2fr]">
        <Card title="All labels">
          <div className="flex items-center gap-4">
            <Donut data={donut} size={128} stroke={18} center={<><div className="text-lg font-semibold text-ink tnum">{pctS(correct / Math.max(1, total))}</div><div className="text-[10.5px] text-muted">correct</div></>} />
            <Legend items={donut.map((d) => ({ name: d.name, color: d.color, value: d.value }))} />
          </div>
        </Card>
        <Card title="By contract"><StackedBars data={stackData(s!.by_contract, CONTRACTS)} /></Card>
        <Card title="By clause type"><StackedBars data={stackData(s!.by_clause, CLAUSE_IDS, (k) => `${k} ${CLAUSE_SHORT[k as keyof typeof CLAUSE_SHORT]}`)} /></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Where it works: contract × clause" subtitle="Share of tests labelled Correct or Correct absent"><Heatmap tests={s!.tests} /></Card>
        <Card title="Error causes" subtitle="Cause codes (spec §10.6)">
          {causes.length === 0 ? <div className="text-[13px] text-muted">No errors logged.</div> : (
            <ul className="flex flex-col gap-1.5">
              {causes.map(([c, n]) => (
                <li key={c} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-[190px] truncate font-mono text-[11.5px] text-ink-2" title={c}>{c}</span>
                  <span className="h-2 rounded-full bg-bad" style={{ width: `${(n / causes[0][1]) * 60}%`, minWidth: 6 }} />
                  <span className="font-semibold tnum text-ink">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Per-test results" subtitle="Expected answer next to the tool's answer"
        actions={<span className="text-xs text-muted tnum">{rows.length} of {total}</span>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className={cx(inputCls, "w-auto")} value={label} onChange={(e) => setLabel(e.target.value as Label | "all")} aria-label="Label">
            <option value="all">All labels</option>{LABELS.map((l) => <option key={l}>{l}</option>)}
          </select>
          <select className={cx(inputCls, "w-auto")} value={contract} onChange={(e) => setContract(e.target.value)} aria-label="Contract">
            <option value="all">All contracts</option>{CONTRACTS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className={cx(inputCls, "w-auto")} value={clause} onChange={(e) => setClause(e.target.value)} aria-label="Clause">
            <option value="all">All clauses</option>{CLAUSE_IDS.map((c) => <option key={c} value={c}>{c} {CLAUSE_SHORT[c]}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-2"><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> Core only</label>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-2"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label>
          <div className="relative ml-auto min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className={cx(inputCls, "pl-8")} placeholder="Search tests…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="scroll-thin max-h-[640px] overflow-auto">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-2">Test</th><th className="py-1.5 pr-2">Label</th><th className="py-1.5 pr-2">Expected</th><th className="py-1.5 pr-2">Tool</th>
                <th className="py-1.5 pr-2">Cause</th><th className="py-1.5">Quote</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.test_id} className="border-b border-line align-top last:border-0">
                  <td className="py-1.5 pr-2 font-mono text-[11.5px] text-ink-2">
                    <span className="flex items-center gap-1">{t.core && <Star className="h-3 w-3 fill-warn text-warn" aria-label="core test" />}{t.test_id}</span>
                  </td>
                  <td className="py-1.5 pr-2"><Chip size="xs" tone={LABEL_TONE[t.label]}>{t.label}</Chip>{t.needs_human_check && <div className="mt-0.5 text-[10.5px] text-violet-ink">human check</div>}</td>
                  <td className="max-w-[320px] py-1.5 pr-2">
                    <Chip size="xs">{t.expected_status}</Chip>
                    <div className="mt-0.5 line-clamp-3 text-ink" title={t.expected_answer}>{t.expected_answer || "–"}</div>
                  </td>
                  <td className="max-w-[320px] py-1.5 pr-2">
                    <Chip size="xs" tone={t.tool_status === t.expected_status ? "good" : "bad"}>{t.tool_status}</Chip>
                    <div className={cx("mt-0.5 line-clamp-3", t.label === "Correct" || t.label === "Correct absent" ? "text-ink" : "text-bad-ink")} title={t.tool_answer}>{t.tool_answer || "–"}</div>
                    {t.reason && <div className="mt-0.5 text-[11px] text-muted">{t.reason}</div>}
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-[11px] text-ink-2">{t.cause_code || ""}</td>
                  <td className="py-1.5"><CheckIcon passed={t.quote_verified} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">No tests match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
