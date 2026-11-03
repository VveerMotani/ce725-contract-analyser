// Page frame: a slim top bar (name, contract picker, Help, How we tested it), a strip with the open contract's
// two views (Summary · All 52 questions), one reading column, a quiet footer.
import { useEffect, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { CircleHelp, FlaskConical, Moon, Sun } from "lucide-react";
import { exportCsvUrl, mockReason, reportPdfUrl } from "../api";
import { RunProvider, rememberRun, useApp, useOptionalRun } from "../context";
import type { RunMeta } from "../types";
import { fmtDay } from "../lib/format";
import { STATIC_SAVED, STATIC_SITE } from "../staticSite";
import { runSource } from "../lib/plain";
import { cx } from "./ui";
import { SourcePanel } from "./SourcePanel";

/** Contract name only; the answer-key test runs (team copies) and repeat readings get a short tag. */
function runLabel(r: RunMeta, all: RunMeta[], titleOf: (c: string) => string): string {
  const replay = runSource(r) === "replay";
  const same = all.filter((x) => x.contract_id === r.contract_id && (runSource(x) === "replay") === replay);
  const when = same.length > 1 ? `, ${fmtDay(r.finished_at || r.started_at)}` : "";
  const state = r.stage === "done" ? "" : r.stage === "error" ? " (stopped)" : " (reading…)";
  return `${titleOf(r.contract_id)}${replay ? " — answer-key test" : ""}${when}${state}`;
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
      <option value="">{!runs ? "Loading…" : list.length ? "Open a contract…" : "No contracts read yet"}</option>
      {sorted.map((r) => <option key={r.run_id} value={r.run_id}>{runLabel(r, list, titleOf)}</option>)}
    </select>
  );
}

function TabLink({ to, children, end, title }: { to: string; children: string; end?: boolean; title: string }) {
  return (
    <NavLink to={to} end={end} title={title} className={({ isActive }) => cx(
      "-mb-px whitespace-nowrap border-b-2 py-2.5 text-[14.5px] transition",
      isActive ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
    )}>{children}</NavLink>
  );
}

/** Round link in the top bar (Help, How we tested it). The label hides on a phone when `short` is set. */
function PillLink({ to, icon, children, title, short }: { to: string; icon: ReactNode; children: string; title: string; short?: boolean }) {
  return (
    <NavLink to={to} title={title} aria-label={children} className={({ isActive }) => cx(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13.5px] transition",
      isActive ? "border-accent bg-accent-soft font-medium text-ink" : "border-line-strong text-ink-2 hover:border-accent hover:text-ink",
    )}>
      {icon}<span className={short ? "hidden sm:inline" : undefined}>{children}</span>
    </NavLink>
  );
}

/** The open contract's two views, in a strip under the top bar so they read as part of that contract. */
function ContractTabs({ runId }: { runId: string }) {
  return (
    <div className="border-t border-line">
      <nav aria-label="This contract" className="mx-auto flex max-w-[1120px] items-center gap-5 px-4 sm:px-6">
        <span className="hidden text-[12.5px] uppercase tracking-[0.06em] text-muted sm:inline">This contract</span>
        <TabLink to={`/runs/${runId}`} end title="One-page summary: the six money terms, flags and cash">Summary</TabLink>
        <TabLink to={`/runs/${runId}/answers`} title="Every question the tool asks of the contract, with its answer and page">All 52 questions</TabLink>
      </nav>
    </div>
  );
}

function TopBar() {
  const run = useOptionalRun();
  const { dark, toggleDark } = useApp();
  return (
    <header className="border-b border-line bg-page">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Home">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-accent font-serif text-[15px] font-semibold text-white dark:text-[#10223d]">₹</span>
          <span className="font-serif text-[17px] font-semibold text-ink">Contract Money Terms</span>
        </Link>
        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
          <div className="hidden min-w-0 sm:block"><Switcher current={run?.runId ?? null} /></div>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
          <PillLink to="/help" icon={<CircleHelp className="h-3.5 w-3.5" aria-hidden />} title="How to use this site">Help</PillLink>
          <PillLink to="/project" short icon={<FlaskConical className="h-3.5 w-3.5" aria-hidden />}
            title="Course project: how the team tested the tool's accuracy. Not needed to use the tool.">How we tested it</PillLink>
          <button onClick={toggleDark} className="rounded p-1.5 text-muted hover:text-ink" aria-label={dark ? "Use light theme" : "Use dark theme"} title={dark ? "Light theme" : "Dark theme"}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
        <div className="w-full sm:hidden"><Switcher current={run?.runId ?? null} /></div>
      </div>
      {run && <ContractTabs runId={run.runId} />}
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
          <Link className={linkCls} to="/help">How to use this site</Link>
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
