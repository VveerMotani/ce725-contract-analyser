// Home: what the tool does in one paragraph, the four test contracts, and a way to read a new one.
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "../api";
import { useApp, useAsync } from "../context";
import type { Benchmark, RunMeta } from "../types";
import { money } from "../lib/format";
import { sourceShort } from "../lib/plain";
import { scorecard } from "../lib/scorecard";
import { Tally } from "../components/Tally";
import { issuerOf, usable } from "../lib/terms";
import { InfoTip, Spinner, buttonCls } from "../components/ui";
import { SAVED_ONLY_NOTE, STATIC_SITE } from "../staticSite";

/** The run to open for a contract: finished runs first, AI-read before replay, newest first. */
export function bestRun(runs: RunMeta[] | undefined, contractId: string): RunMeta | undefined {
  const mine = (runs ?? []).filter((r) => r.contract_id === contractId);
  const score = (r: RunMeta) => (r.stage === "done" ? 2 : r.stage === "error" ? 0 : 1) * 10 + (r.replay ? 0 : 1);
  return mine.sort((a, b) => score(b) - score(a) || (b.finished_at || b.started_at).localeCompare(a.finished_at || a.started_at))[0];
}

function ContractCard({ b, run }: { b: Benchmark; run: RunMeta | undefined }) {
  const nav = useNavigate();
  const done = run?.stage === "done";
  const info = useAsync(async () => {
    if (!run || !done) return null;
    const [flags, params, checks] = await Promise.all([
      api.flags(run.run_id).catch(() => []), api.params(run.run_id).catch(() => undefined), api.checks(run.run_id).catch(() => undefined),
    ]);
    return { flags, params, sc: scorecard(checks, flags) };
  }, [run?.run_id, done]);
  const p = info.data?.params;
  const vSrc = usable(p, "contract_value");
  const value = p && vSrc && p.inputs.contract_value > 0 ? `${money(p.inputs.contract_value)}${vSrc === "user" ? " (assumed)" : ""}` : "";
  const status = !run ? "Not read yet"
    : run.stage === "error" ? "Reading stopped"
    : !done ? `Reading · ${Math.round(run.progress * 100)}%`
    : null;
  const go = () => nav(run ? `/runs/${run.run_id}` : STATIC_SITE ? "/" : `/new?benchmark=${b.contract_id}`);

  return (
    <li className="flex flex-col rounded-lg border border-line bg-surface p-5 transition hover:border-line-strong">
      <button onClick={go} className="text-left">
        <span className="block font-serif text-[19px] font-semibold leading-snug text-ink hover:underline">{b.title}</span>
      </button>
      <span className="mt-1 text-[14px] text-ink-2">{issuerOf(b.contract_id)}</span>
      {value && <span className="mt-1 text-[14px] text-ink-2">Value {value}</span>}
      {status ? <span className="mt-3 text-[14px] text-ink">{status}</span>
        : info.data ? <Tally t={info.data.sc.tally} hasChecks={info.data.sc.hasChecks} className="mt-3" />
        : <span className="mt-3 text-[14px] text-muted">…</span>}
      <span className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-[13.5px]">
        {run && <span className="text-muted">{sourceShort(run)}</span>}
        {!STATIC_SITE && <Link className="text-accent-ink hover:underline" to={`/new?benchmark=${b.contract_id}`}>{run ? "Read again" : "Read it"}</Link>}
      </span>
    </li>
  );
}

export default function Home() {
  const { benchmarks, runs } = useApp();
  const others = (runs ?? []).filter((r) => !benchmarks?.some((b) => b.contract_id === r.contract_id));
  return (
    <div>
      <header className="pb-10">
        <h1 className="max-w-[22ch] font-serif text-[32px] font-semibold leading-tight text-ink sm:text-[40px]">Contract money terms, with proof</h1>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[15px] text-ink-2">
          Six terms, each linked to its page
          <InfoTip label="What the tool does">
            Upload a construction contract. The tool finds the six money terms (when you get paid, how much is held back, advances,
            penalties for delay, price rise protection, bank guarantees), shows the exact sentence and page for each, flags risky terms,
            and shows what they do to your cash.
          </InfoTip>
        </p>
        <ul className="mt-4 flex flex-wrap gap-2 text-[13px] text-ink-2">
          {["Payment", "Retention", "Advance", "Delay penalty", "Price adjustment", "Guarantees"].map((t) => (
            <li key={t} className="rounded border border-line-strong px-2 py-0.5">{t}</li>
          ))}
        </ul>
        {STATIC_SITE
          ? <p className="mt-6 text-[14px] text-muted">{SAVED_ONLY_NOTE}</p>
          : <div className="mt-6"><Link to="/new" className={buttonCls("primary")}>Upload a contract <ArrowRight className="h-4 w-4" /></Link></div>}
      </header>

      <section className="border-t border-line pt-8">
        <h2 className="font-serif text-[22px] font-semibold text-ink">Test contracts</h2>
        {!benchmarks ? <Spinner /> : (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {benchmarks.map((b) => <ContractCard key={b.contract_id} b={b} run={bestRun(runs, b.contract_id)} />)}
          </ul>
        )}
      </section>

      {others.length > 0 && (
        <section className="mt-10 border-t border-line pt-8">
          <h2 className="font-serif text-[20px] font-semibold text-ink">Other contracts</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {others.map((r) => (
              <li key={r.run_id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3 text-[15px]">
                <Link className="text-ink hover:underline" to={`/runs/${r.run_id}`}>{r.contract_id}</Link>
                <span className="text-[13.5px] text-muted">{r.stage === "done" ? sourceShort(r) : r.stage === "error" ? "stopped" : "being read"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
