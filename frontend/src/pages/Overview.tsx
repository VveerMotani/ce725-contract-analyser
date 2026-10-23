// Overview: one-screen dashboard for a finished run.
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, CalendarClock, ClipboardCheck, FileSearch, IndianRupee, ShieldAlert, ShieldCheck, Target, Wrench } from "lucide-react";
import { api } from "../api";
import { useApp, useAsync, useRun } from "../context";
import { CLAUSE_SHORT, type ClauseId, type RiskFlag, type Severity, effective, labelCounts } from "../types";
import { contractFacts, keyFigures, sortFlags, worstFlagByClause, type Fact } from "../lib/keyFigures";
import { money, moneyAxis } from "../lib/format";
import { RunGate } from "../components/RunGate";
import { ReplayBanner } from "../components/Replay";
import { Card, Chip, Donut, Dot, Legend, PageHeader, PageLink, ProgressRing, SEVERITY_META, SeverityChip, StatusChip, TONE_SOFT, TONE_SOLID, type Tone, cx } from "../components/ui";
import { LABEL_COLORS } from "./Evaluation";

const SEVS: Severity[] = ["High", "Medium", "Low", "Needs review"];

function flagTone(f?: RiskFlag): Tone {
  if (!f) return "good";
  if (f.severity === "High") return "bad";
  if (f.severity === "Medium") return "warn";
  if (f.severity === "Needs review") return "violet";
  return "good";
}

function Inner() {
  const { runId, answers, meta, pending, verified, openAnswer } = useRun();
  const { fullMoney } = useApp();
  const nav = useNavigate();
  const flags = useAsync(() => api.flags(runId), [runId]);
  const params = useAsync(() => api.params(runId), [runId]);
  const cash = useAsync(() => api.cashflow(runId), [runId]);
  const score = useAsync(() => api.score(runId).catch(() => null), [runId]);

  const envs = answers!;
  const kf = keyFigures(envs, params.data);
  const worst = worstFlagByClause(flags.data ?? []);
  const sevCount = (s: Severity) => (flags.data ?? []).filter((f) => f.severity === s).length;
  const total = envs.length;
  const cr = cash.data?.as_written;
  const cf = contractFacts(envs, params.data, (n) => money(n, fullMoney));
  const facts: { label: string; icon: ReactNode; fact: Fact }[] = [
    { label: "Contract value", icon: <IndianRupee className="h-3.5 w-3.5" />, fact: cf.value },
    { label: "Duration", icon: <CalendarClock className="h-3.5 w-3.5" />, fact: cf.duration },
    { label: "Defects liability", icon: <Wrench className="h-3.5 w-3.5" />, fact: cf.dlp },
  ];
  const top = sortFlags((flags.data ?? []).filter((f) => f.category === "risk")).slice(0, 3);

  const labelData = score.data ? Object.entries(labelCounts(score.data.counts)).map(([name, value]) => ({ name, value, color: LABEL_COLORS[name] ?? "var(--neutral)" })) : [];
  const correct = score.data ? (score.data.counts["Correct"] ?? 0) + (score.data.counts["Correct absent"] ?? 0) : 0;
  const scoreTotal = labelData.reduce((a, b) => a + b.value, 0);

  return (
    <div className="flex flex-col gap-4">
      {meta?.replay && <ReplayBanner />}
      {/* Row 1: scorecard + review + accuracy */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr]">
        <Card className="md:col-span-2 xl:col-span-1" title="Contract risk scorecard" icon={<ShieldAlert className="h-4 w-4 text-muted" />} actions={<Link to={`/runs/${runId}/flags`} className="text-xs font-medium text-accent-ink hover:underline">All flags</Link>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SEVS.map((s) => {
              const n = sevCount(s);
              const t = SEVERITY_META[s].tone;
              return (
                <button key={s} onClick={() => nav(`/runs/${runId}/flags`)} className={cx("flex flex-col items-start rounded-lg p-2.5 text-left transition hover:brightness-95", n ? TONE_SOFT[t] : "bg-surface-2")}>
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2"><span className={cx("h-2 w-2 rounded-full", TONE_SOLID[t])} />{s}</span>
                  <span className={cx("mt-1 text-[28px] font-semibold leading-none tnum", n ? "text-ink" : "text-muted")}>{flags.loading ? "…" : n}</span>
                </button>
              );
            })}
          </div>
          {top.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {top.map((f) => (
                <li key={f.flag_id + f.title} className="flex items-center gap-2 text-[13px]">
                  <SeverityChip severity={f.severity} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-ink">{f.title}</span>
                  {f.rupee_impact ? <span className="text-xs font-medium text-ink-2 tnum">{money(f.rupee_impact, fullMoney)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Review status" icon={<ClipboardCheck className="h-4 w-4 text-muted" />} actions={<Link to={`/runs/${runId}/review`} className="text-xs font-medium text-accent-ink hover:underline">Open queue</Link>}>
          <div className="flex items-center gap-4">
            <ProgressRing value={verified} total={total} label="verified" tone={pending ? "warn" : "good"} />
            <div className="flex flex-col gap-1.5 text-[13px]">
              <div className="text-ink"><b className="tnum">{verified}</b> of {total} answers verified</div>
              {pending ? <Chip tone="warn">{pending} waiting for you</Chip> : <Chip tone="good" icon={<ShieldCheck className="h-3 w-3" />}>Verified by user</Chip>}
              <div className="text-xs text-muted">Auto-verified, accepted or edited count as verified.</div>
            </div>
          </div>
        </Card>

        {score.data && scoreTotal > 0 ? (
          <Card title="Accuracy vs golden tests" icon={<Target className="h-4 w-4 text-muted" />} actions={<Link to="/evaluation" className="text-xs font-medium text-accent-ink hover:underline">Evaluation</Link>}>
            <div className="flex items-center gap-4">
              <Donut data={labelData} size={112} center={<><div className="text-lg font-semibold text-ink tnum">{Math.round((correct / scoreTotal) * 100)}%</div><div className="text-[10.5px] text-muted">correct</div></>} />
              <Legend items={labelData.filter((d) => d.value).map((d) => ({ name: d.name, color: d.color, value: d.value }))} />
            </div>
          </Card>
        ) : (
          <Card title="Run" icon={<Target className="h-4 w-4 text-muted" />}>
            <div className="flex flex-col gap-1.5 text-[13px] text-ink-2">
              <div>Model <b className="text-ink">{meta?.model}</b></div>
              <div>{meta?.llm_calls} AI calls · {meta?.cache_hits} cache hits</div>
              <div className="text-xs text-muted">Not a benchmark: no golden answers to score against.</div>
            </div>
          </Card>
        )}
      </div>

      {/* Row 2: C0 facts strip */}
      <div className="grid gap-2 rounded-xl border border-line bg-surface p-2 sm:grid-cols-3">
        {facts.map(({ label, icon, fact }) => {
          const e = fact.proof;
          const a = e ? effective(e) : null;
          return (
            <div key={label} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">{icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <span className="truncate">{label}</span>
                  {fact.source === "user" ? <Chip size="xs" tone="accent" title="Entered by you; the contract does not give it">your input</Chip>
                    : fact.source === "none" ? <Chip size="xs" title="Not found in the package">not found</Chip>
                    : a && a.status !== "FOUND" ? <StatusChip status={a.status} size="xs" /> : null}
                </div>
                <div className="truncate text-[15px] font-semibold text-ink" title={a?.answer_value}>{fact.text}</div>
              </div>
              {e && a?.pdf_page ? <PageLink page={a.pdf_page} onClick={() => openAnswer(e)} /> : null}
            </div>
          );
        })}
      </div>

      {/* Row 3: clause tiles */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(["C1", "C2", "C3", "C4", "C5", "C6"] as ClauseId[]).map((c) => {
          const k = kf[c];
          const wf = worst[c];
          const tone = flagTone(wf);
          const pa = k.proof ? effective(k.proof) : null;
          return (
            <div key={c} className="group relative flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-muted">{c}</span>
                <span className="text-[13px] font-semibold text-ink">{CLAUSE_SHORT[c]}</span>
                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted" title={wf ? `${wf.severity}: ${wf.title}` : "No risk flag"}>
                  {wf ? wf.severity : "No flag"}<Dot tone={tone} />
                </span>
              </div>
              <button onClick={() => nav(`/runs/${runId}/clauses?clause=${c}`)} className="mt-2 text-left">
                <div className="break-words text-[26px] font-semibold leading-tight tracking-tight text-ink">{k.headline}</div>
                <div className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-2" title={k.sub}>{k.sub || " "}</div>
              </button>
              <div className="mt-3 flex items-center gap-2">
                {k.status ? <StatusChip status={k.status} size="xs" /> : <Chip size="xs">not found</Chip>}
                {wf && <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2" title={wf.title}>{wf.title}</span>}
                <span className="ml-auto" />
                {k.proof && pa?.pdf_page ? (
                  <button onClick={() => openAnswer(k.proof!)} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent-ink hover:underline">
                    <FileSearch className="h-3 w-3" /> proof p.{pa.pdf_page}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Row 4: cash sparkline */}
      <Card title="Cash position" icon={<IndianRupee className="h-4 w-4 text-muted" />}
        actions={<Link to={`/runs/${runId}/cash`} className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline">Cash flow <ArrowRight className="h-3 w-3" /></Link>}>
        {cash.error ? <div className="text-[13px] text-muted">Cash model not available yet: confirm parameters on the Cash flow page.</div> : !cr ? <div className="h-[120px] animate-pulse rounded-lg bg-surface-2" /> : (
          <div className="grid items-center gap-4 md:grid-cols-[240px_1fr]">
            <div className="flex flex-col gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Peak funding needed</div>
                <div className="text-[28px] font-semibold leading-tight text-ink">{money(cr.peak_funding, fullMoney)}</div>
                <div className="text-xs text-ink-2">in month {cr.peak_month} · contract as written</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip size="xs">interest {money(cr.overdraft_interest, fullMoney)}</Chip>
                <Chip size="xs">retention held {money(cr.retention_locked_max, fullMoney)}</Chip>
              </div>
            </div>
            <div className="h-[130px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cr.months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gapFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--s2)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--s2)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickFormatter={(m) => `M${m}`} minTickGap={20} />
                  <YAxis hide />
                  <Tooltip formatter={(v: number) => [money(v, fullMoney), "funding gap"]} labelFormatter={(m) => `Month ${m}`} />
                  <Area type="monotone" dataKey="gap" stroke="var(--s2)" strokeWidth={2} fill="url(#gapFill)" isAnimationActive={false} />
                  <ReferenceDot x={cr.peak_month} y={cr.peak_funding} r={5} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2}
                    label={{ value: moneyAxis(cr.peak_funding), position: "top", fill: "var(--ink-2)", fontSize: 11 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function Overview() {
  return (
    <>
      <PageHeader title="Overview" subtitle="The key terms, risks and cash impact at a glance. Click any figure for its proof." />
      <RunGate><Inner /></RunGate>
    </>
  );
}
