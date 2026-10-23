import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Activity, BookOpen, ClipboardCheck, Download, FileStack, FlaskConical, LayoutDashboard, ListChecks, Lock,
  Menu, Moon, PlusCircle, ShieldAlert, Sun, Table2, Wallet, X,
} from "lucide-react";
import { api, mockReason } from "../api";
import { RunProvider, useApp, useOptionalRun } from "../context";
import type { RunMeta } from "../types";
import { fmtDate } from "../lib/format";
import { Chip, Segmented, cx } from "./ui";
import { SourceDrawer } from "./SourceDrawer";
import { ReplayChip } from "./Replay";

const LAST_RUN_KEY = "ta-last-run";

export function rememberRun(id: string) {
  try { localStorage.setItem(LAST_RUN_KEY, id); } catch { /* ignore */ }
}
export function lastRun(): string | null {
  try { return localStorage.getItem(LAST_RUN_KEY); } catch { return null; }
}

function NavItem({ to, icon, children, badge, disabled }: { to: string; icon: ReactNode; children: ReactNode; badge?: ReactNode; disabled?: boolean }) {
  if (disabled) {
    return <span className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted opacity-60">{icon}{children}</span>;
  }
  return (
    <NavLink to={to} className={({ isActive }) => cx(
      "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition",
      isActive ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
    )}>
      {icon}<span className="flex-1">{children}</span>{badge}
    </NavLink>
  );
}

function RunPicker({ current }: { current: string | null }) {
  const { runsVersion } = useApp();
  const nav = useNavigate();
  const [runs, setRuns] = useState<RunMeta[]>([]);
  useEffect(() => { api.runs().then(setRuns).catch(() => setRuns([])); }, [runsVersion, current]);
  return (
    <div className="px-3">
      <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wider text-muted">Current run</label>
      <select
        value={current ?? ""}
        onChange={(e) => { if (e.target.value) nav(`/runs/${e.target.value}/overview`); }}
        className="w-full truncate rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
      >
        <option value="">{runs.length ? "Select a run…" : "No runs yet"}</option>
        {runs.map((r) => (
          <option key={r.run_id} value={r.run_id}>
            {r.contract_id}{r.replay ? " · Answer-key replay (not AI output)" : ""} · {r.stage === "done" ? fmtDate(r.finished_at || r.started_at) : r.stage}{r.frozen ? " · demo" : ""}
          </option>
        ))}
      </select>
      {runs.find((r) => r.run_id === current)?.replay && <div className="mt-1.5"><ReplayChip /></div>}
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const run = useOptionalRun();
  const { mode } = useApp();
  const runId = run?.runId ?? lastRun();
  const base = runId ? `/runs/${runId}` : "";
  const notReady = !runId;
  const pending = run?.pending ?? 0;
  return (
    <nav className="flex h-full flex-col gap-4 py-4" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onNavigate?.(); }}>
      <Link to="/" className="flex items-center gap-2 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white"><FileStack className="h-4 w-4" /></span>
        <span className="leading-tight">
          <span className="block text-[13.5px] font-semibold text-ink">Contract Analyser</span>
          <span className="block text-[11px] text-muted">Tender & cash-risk review</span>
        </span>
      </Link>
      <div className="px-3">
        <NavLink to="/new" className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110">
          <PlusCircle className="h-4 w-4" /> New analysis
        </NavLink>
      </div>
      <RunPicker current={run?.runId ?? null} />
      <div className="flex flex-col gap-0.5 px-2">
        <div className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Results</div>
        <NavItem to={`${base}/overview`} disabled={notReady} icon={<LayoutDashboard className="h-4 w-4" />}>Overview</NavItem>
        <NavItem to={`${base}/clauses`} disabled={notReady} icon={<Table2 className="h-4 w-4" />}>Clause table</NavItem>
        <NavItem to={`${base}/review`} disabled={notReady} icon={<ClipboardCheck className="h-4 w-4" />}
          badge={run?.answers ? (pending > 0 ? <Chip tone="warn" size="xs">{pending}</Chip> : <Chip tone="good" size="xs">✓</Chip>) : undefined}>Review queue</NavItem>
        <NavItem to={`${base}/flags`} disabled={notReady} icon={<ShieldAlert className="h-4 w-4" />}>Risk flags</NavItem>
        <NavItem to={`${base}/cash`} disabled={notReady} icon={<Wallet className="h-4 w-4" />}>Cash flow</NavItem>
        <NavItem to={`${base}/export`} disabled={notReady} icon={<Download className="h-4 w-4" />}>Export</NavItem>
        <div className="mt-3 px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Run details</div>
        <NavItem to={`${base}/package`} disabled={notReady} icon={<ListChecks className="h-4 w-4" />}>Package check</NavItem>
        <NavItem to={`${base}/progress`} disabled={notReady} icon={<Activity className="h-4 w-4" />}>Run progress</NavItem>
        <div className="mt-3 px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Team only</div>
        <NavItem to="/evaluation" icon={<FlaskConical className="h-4 w-4" />}>Evaluation</NavItem>
        <NavItem to="/about" icon={<BookOpen className="h-4 w-4" />}>About & limits</NavItem>
      </div>
      <div className="mt-auto px-4 text-[11px] text-muted">
        {mode === "mock" ? (
          <div className="rounded-lg border border-warn/40 bg-warn-soft p-2 text-warn-ink">
            <b>Mock data</b> ({mockReason()}). Numbers are illustrative, generated from the golden tests.
          </div>
        ) : mode === "live" ? (
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-good" /> Connected to backend</span>
        ) : null}
        <div className="mt-2">Decision support, not legal advice.</div>
      </div>
    </nav>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const run = useOptionalRun();
  const { dark, toggleDark, fullMoney, setFullMoney, mode } = useApp();
  const meta = run?.meta;
  const loc = useLocation();
  const titleFromPath = loc.pathname.startsWith("/evaluation") ? "Evaluation against golden tests" : loc.pathname.startsWith("/about") ? "About, assumptions and limits" : loc.pathname.startsWith("/new") ? "New analysis" : loc.pathname.startsWith("/packages") ? "Package check" : "";
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (!meta) { setTitle(""); return; }
    let alive = true;
    api.package(meta.package_id).then((p) => { if (alive) setTitle(p.title || p.contract_id); }).catch(() => setTitle(""));
    return () => { alive = false; };
  }, [meta?.package_id]);
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur lg:px-6">
      <button className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <div className="min-w-0 flex-1">
        {meta ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Chip tone="accent" size="xs">{meta.contract_id}</Chip>
            <span className="truncate text-[14px] font-semibold text-ink">{title || meta.package_id}</span>
            {meta.replay && <ReplayChip />}
            {meta.frozen && <Chip size="xs" icon={<Lock className="h-3 w-3" />} title="Read-only demo run: review and parameter edits are disabled">Frozen demo run</Chip>}
            {meta.stage === "error" && <Chip tone="bad" size="xs">run failed</Chip>}
            {meta.stage !== "done" && meta.stage !== "error" && <Chip tone="accent" size="xs">running · {Math.round(meta.progress * 100)}%</Chip>}
          </div>
        ) : (
          <span className="text-[14px] font-semibold text-ink">{titleFromPath}</span>
        )}
      </div>
      {run?.answers && (
        run.pending > 0 ? (
          <Link to={`/runs/${run.runId}/review`} className="shrink-0"><Chip tone="warn" className="hover:brightness-95"><span className="hidden sm:inline">Pending review:</span><span className="sm:hidden">Review</span> {run.pending}</Chip></Link>
        ) : (
          <span className="shrink-0"><Chip tone="good">Verified by user</Chip></span>
        )
      )}
      {mode === "mock" && <span className="hidden sm:inline-flex"><Chip tone="warn" size="xs">MOCK</Chip></span>}
      <span className="hidden sm:inline-flex">
        <Segmented value={fullMoney ? "full" : "short"} onChange={(v) => setFullMoney(v === "full")}
          options={[{ value: "short", label: "Rs cr/lakh" }, { value: "full", label: "Full Rs" }]} />
      </span>
      <button onClick={toggleDark} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Toggle dark mode" title="Toggle dark mode">
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </header>
  );
}

export function Shell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 overflow-y-auto border-r border-line bg-surface lg:block scroll-thin">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-[260px] overflow-y-auto bg-surface shadow-xl">
            <button className="absolute right-2 top-2 rounded p-1 text-muted" onClick={() => setOpen(false)} aria-label="Close navigation"><X className="h-4 w-4" /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <Header onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 lg:px-6">
          <Outlet />
        </main>
      </div>
      <SourceDrawer />
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

