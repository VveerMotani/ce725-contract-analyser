// The Project area: how the student team tested the tool (answer key, scores, errors, checks).
// Kept apart from the contractor pages; for the team, the professor and the viva.
import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cx } from "../../components/ui";

export const PROJECT_TABS: { to: string; label: string; end?: boolean }[] = [
  { to: "/project", label: "Overview", end: true },
  { to: "/project/accuracy", label: "Accuracy" },
  { to: "/project/errors", label: "Where the AI went wrong" },
  { to: "/project/compare", label: "Compare contracts" },
  { to: "/project/fair", label: "As written vs fair" },
  { to: "/project/consistency", label: "Consistency" },
  { to: "/project/checks", label: "Manual check" },
];

export default function ProjectShell() {
  const bar = useRef<HTMLUListElement>(null);
  const { pathname } = useLocation();
  // On a phone the tabs scroll sideways: keep the open one in view.
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>("a[aria-current='page']");
    const ul = bar.current;
    if (el && ul) ul.scrollLeft = Math.max(0, el.offsetLeft - ul.offsetLeft - (ul.clientWidth - el.offsetWidth) / 2);
  }, [pathname]);
  return (
    <div>
      <header className="pb-5 pt-1">
        <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">CE725 · Team 2 · Topic 12</div>
        <h1 className="mt-1 font-serif text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">Project</h1>
        <p className="mt-1 text-[13.5px] text-muted">How the team tested the tool. Not part of the contractor report.</p>
      </header>
      <nav aria-label="Project" className="-mx-4 mb-8 border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul ref={bar} className="flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PROJECT_TABS.map((t) => (
            <li key={t.to} className="shrink-0">
              <NavLink to={t.to} end={t.end} className={({ isActive }) => cx(
                "block whitespace-nowrap border-b-2 pb-2 text-[14px] transition",
                isActive ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
              )}>{t.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
