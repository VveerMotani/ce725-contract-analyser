// Page frame: a slim top bar (name, contract switcher, three links), one reading column, a quiet footer.
import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { exportCsvUrl, mockReason, reportPdfUrl } from "../api";
import { RunProvider, lsLastRun, rememberRun, useApp, useOptionalRun } from "../context";
import type { RunMeta } from "../types";
import { fmtDay } from "../lib/format";
import { STATIC_SAVED, STATIC_SITE } from "../staticSite";
import { sourceShort } from "../lib/plain";
import { cx } from "./ui";
import { SourcePanel } from "./SourcePanel";

function runLabel(r: RunMeta, all: RunMeta[], titleOf: (c: string) => string): string {
  const same = all.filter((x) => x.contract_id === r.contract_id && sourceShort(x) === sourceShort(r));
  const when = same.length > 1 ? `, ${fmtDay(r.finished_at || r.started_at)}` : "";
  const state = r.stage === "done" ? "" : r.stage === "error" ? " (stopped)" : " (reading…)";
  return `${titleOf(r.contract_id)} — ${sourceShort(r)}${when}${state}`;
}

function Switcher({ current }: { current: string | null }) {
  const { runs, benchmarks } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const titleOf = (c: string) => benchmarks?.find((b) => b.contract_id === c)?.title ?? c;
  const list = runs ?? [];
  const sorted = [...list].sort((a, b) => a.contract_id.localeCompare(b.contract_id) || (b.finished_at || b.started_at).localeCompare(a.finished_at || a.started_at));
  const onChange = (id: string) => {
    if (!id) return;
    const sub = loc.pathname.match(/^\/runs\/[^/]+\/(answers|technical)/)?.[1];
    nav(`/runs/${id}${sub ? `/${sub}` : ""}`);
  };
  return (
    <select aria-label="Choose a contract" value={current ?? ""} onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-0 truncate rounded-md border border-line-strong bg-surface py-1.5 pl-2.5 pr-8 text-[14px] text-ink outline-none focus:border-accent sm:w-[300px]">
      <option value="">{!runs ? "Loading…" : list.length ? "Choose a contract…" : "No contracts read yet"}</option>
      {sorted.map((r) => <option key={r.run_id} value={r.run_id}>{runLabel(r, list, titleOf)}</option>)}
    </select>
  );
}

function TopLink({ to, children, disabled, end }: { to: string; children: string; disabled?: boolean; end?: boolean }) {
  if (disabled) return <span className="cursor-not-allowed text-[14.5px] text-muted opacity-60">{children}</span>;
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx(
      "whitespace-nowrap border-b-2 pb-0.5 text-[14.5px] transition",
      isActive ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
    )}>{children}</NavLink>
  );
}

function TopBar() {
  const run = useOptionalRun();
  const { runs, dark, toggleDark } = useApp();
  const last = lsLastRun();
  const fallback = runs?.find((r) => r.run_id === last)?.run_id ?? runs?.find((r) => r.stage === "done")?.run_id ?? null;
  const rid = run?.runId ?? fallback;
  return (
    <header className="border-b border-line bg-page">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Home">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-accent font-serif text-[15px] font-semibold text-white dark:text-[#10223d]">₹</span>
          <span className="font-serif text-[17px] font-semibold text-ink">Contract Money Terms</span>
        </Link>
        <nav className="order-3 flex w-full items-center gap-5 sm:order-none sm:w-auto" aria-label="Main">
          <TopLink to={rid ? `/runs/${rid}` : "/"} disabled={!rid} end>Report</TopLink>
          <TopLink to={rid ? `/runs/${rid}/answers` : "/"} disabled={!rid}>All answers</TopLink>
          <TopLink to="/accuracy">Accuracy</TopLink>
        </nav>
        <div className="order-2 ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:order-none sm:flex-none">
          <div className="hidden min-w-0 sm:block"><Switcher current={run?.runId ?? null} /></div>
          <button onClick={toggleDark} className="rounded p-1.5 text-muted hover:text-ink" aria-label={dark ? "Use light theme" : "Use dark theme"} title={dark ? "Light theme" : "Dark theme"}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
        <div className="order-4 w-full sm:hidden"><Switcher current={run?.runId ?? null} /></div>
      </div>
    </header>
  );
}

function Footer() {
  const run = useOptionalRun();
  const { mode } = useApp();
  const mock = mode === "mock";
  const linkCls = "text-accent-ink hover:underline";
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-[920px] flex-col gap-3 px-4 py-8 text-[13.5px] text-muted sm:px-6">
        {run && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Link className={linkCls} to={`/runs/${run.runId}/technical`}>Technical details</Link>
            {!mock && <a className={linkCls} href={reportPdfUrl(run.runId)} target="_blank" rel="noreferrer">Download the report (PDF)</a>}
            {!mock && <a className={linkCls} href={exportCsvUrl(run.runId)} download>Answers as a spreadsheet (CSV)</a>}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          <Link className={linkCls} to="/about">About this tool and its limits</Link>
          <span>Decision support, not legal advice.</span>
        </div>
        {STATIC_SITE && <div>Static copy · results saved on {fmtDay(STATIC_SAVED)}</div>}
        {mock && <div>Showing made-up sample data{/unreachable|answered/.test(mockReason()) ? " because the server is not answering" : ""}. Start the server to see real results.</div>}
      </div>
    </footer>
  );
}

export function Shell() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <TopBar />
      <main className="mx-auto w-full max-w-[920px] flex-1 px-4 pt-8 sm:px-6 sm:pt-10">
        <Outlet />
      </main>
      <Footer />
      <SourcePanel />
    </div>
  );
}

export function RunShell() {
  const { runId = "" } = useParams();
  useEffect(() => { if (runId) rememberRun(runId); }, [runId]);
  return (
    <RunProvider runId={runId}>
      <Shell />
    </RunProvider>
  );
}
