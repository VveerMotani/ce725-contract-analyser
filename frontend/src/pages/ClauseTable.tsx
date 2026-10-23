// S4 Clause table: 52 answers grouped by C0–C6 with status, key value, proof and verification.
import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Eye, GitCompareArrows, Image as ImageIcon, Search, X } from "lucide-react";
import { useRun } from "../context";
import { CLAUSE_IDS, CLAUSE_NAMES, type AnswerEnvelope, type ClauseId, type Status, effective } from "../types";
import { keyNumber } from "../lib/keyFigures";
import { RunGate } from "../components/RunGate";
import { Chip, ConfidenceBars, PageHeader, PageLink, ReviewChip, STATUS_META, Segmented, StatusChip, Tip, VerifyIcons, cx, inputCls } from "../components/ui";

const STATUSES: Status[] = ["FOUND", "NOT_STATED", "NOT_APPLICABLE", "POINTS_ELSEWHERE"];

function Inner() {
  const { answers, openAnswer } = useRun();
  const [sp, setSp] = useSearchParams();
  const clause = (sp.get("clause") as ClauseId | null) ?? "all";
  const [statuses, setStatuses] = useState<Set<Status>>(new Set());
  const [review, setReview] = useState<"all" | "pending">(sp.get("review") === "pending" ? "pending" : "all");
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return answers!.filter((e) => {
      const a = effective(e);
      if (clause !== "all" && a.clause_id !== clause) return false;
      if (statuses.size && !statuses.has(a.status)) return false;
      if (review === "pending" && e.review.decision !== "pending") return false;
      if (needle) {
        const hay = `${a.question_id} ${e.question} ${a.answer_value} ${a.section_ref} ${a.verbatim_quote} ${a.unit} ${a.base}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [answers, clause, statuses, review, q]);

  const groups = CLAUSE_IDS.map((c) => ({ c, items: rows.filter((e) => effective(e).clause_id === c) })).filter((g) => g.items.length);
  const counts = (items: AnswerEnvelope[]) => STATUSES.map((s) => [s, items.filter((e) => effective(e).status === s).length] as const).filter(([, n]) => n);

  const setClause = (c: string) => { const n = new URLSearchParams(sp); if (c === "all") n.delete("clause"); else n.set("clause", c); setSp(n, { replace: true }); };
  const toggleStatus = (s: Status) => setStatuses((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2">
        <select className={cx(inputCls, "w-auto")} value={clause} onChange={(e) => setClause(e.target.value)} aria-label="Clause type">
          <option value="all">All clause types</option>
          {CLAUSE_IDS.map((c) => <option key={c} value={c}>{c} · {CLAUSE_NAMES[c]}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => toggleStatus(s)} className={cx("rounded-full ring-offset-1 transition", statuses.has(s) ? "ring-2 ring-accent" : statuses.size ? "opacity-50 hover:opacity-100" : "")}>
              <StatusChip status={s} />
            </button>
          ))}
        </div>
        <Segmented value={review} onChange={setReview} options={[{ value: "all", label: "All" }, { value: "pending", label: <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />Needs review</span> }]} />
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[300px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={cx(inputCls, "pl-8")} placeholder="Search answers, quotes, clauses…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted" onClick={() => setQ("")} aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </div>
        <span className="text-xs text-muted tnum">{rows.length} of {answers!.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="w-[46px] py-2 pl-3 pr-2 font-semibold">Q</th>
              <th className="py-2 pr-3 font-semibold">Question</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold">Key value</th>
              <th className="py-2 pr-3 font-semibold">Section</th>
              <th className="py-2 pr-3 font-semibold">Page</th>
              <th className="py-2 pr-3 font-semibold">Conf.</th>
              <th className="py-2 pr-3 font-semibold">Checks</th>
              <th className="py-2 pr-3 font-semibold">Review</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ c, items }) => {
              const isCollapsed = collapsed.has(c);
              return (
                <Fragment key={c}>
                  <tr className="border-b border-line bg-surface-2">
                    <td colSpan={9} className="px-3 py-1.5">
                      <button className="flex w-full items-center gap-2 text-left" onClick={() => setCollapsed((cur) => { const n = new Set(cur); if (n.has(c)) n.delete(c); else n.add(c); return n; })}>
                        {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
                        <span className="text-[12px] font-semibold text-muted">{c}</span>
                        <span className="text-[13px] font-semibold text-ink">{CLAUSE_NAMES[c]}</span>
                        <span className="ml-2 flex gap-1">
                          {counts(items).map(([s, n]) => <Chip key={s} size="xs" tone={STATUS_META[s].tone}>{n} {STATUS_META[s].label.toLowerCase()}</Chip>)}
                        </span>
                        {items.some((e) => e.review.decision === "pending") && <Chip size="xs" tone="warn" className="ml-auto" icon={<Eye className="h-3 w-3" />}>{items.filter((e) => e.review.decision === "pending").length} to review</Chip>}
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed && items.map((e) => {
                    const a = effective(e);
                    const key = a.status === "FOUND" ? keyNumber(a.answer_value) : "";
                    return (
                      <tr key={a.question_id} onClick={() => openAnswer(e)} className="cursor-pointer border-b border-line align-top last:border-0 hover:bg-accent-soft/40">
                        <td className="py-2 pl-3 pr-2 font-mono text-xs text-muted">{a.question_id}</td>
                        <td className="max-w-[190px] py-2 pr-3 text-ink-2"><span className="line-clamp-2">{e.question}</span></td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-col items-start gap-1">
                            <StatusChip status={a.status} size="xs" />
                            <span className="flex gap-1">
                              {a.conflicts.length > 0 && <Tip tip={`${a.conflicts.length} conflicting value(s)`}><GitCompareArrows className="h-3.5 w-3.5 text-warn" /></Tip>}
                              {a.visual_check !== "none" && <Tip tip={`Visual pass ${a.visual_check}`}><ImageIcon className="h-3.5 w-3.5 text-violet" /></Tip>}
                            </span>
                          </div>
                        </td>
                        <td className="max-w-[360px] py-2 pr-3">
                          {key && <div className="text-[15px] font-semibold leading-tight text-ink">{key}</div>}
                          <div className={cx("line-clamp-2", key ? "text-xs text-ink-2" : "text-[13px] text-ink")} title={a.answer_value}>
                            {a.answer_value || <span className="text-muted">–</span>}
                          </div>
                          {a.points_to && <div className="mt-0.5 truncate text-[11.5px] text-warn-ink">→ {a.points_to}</div>}
                          {(a.unit || a.base) && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {a.unit && <Chip size="xs" tone="accent" className="max-w-[220px] truncate" title={`unit: ${a.unit}`}>{a.unit}</Chip>}
                              {a.base && <span className="truncate text-[11px] text-muted" title={a.base}>base: {a.base}</span>}
                            </div>
                          )}
                        </td>
                        <td className="max-w-[130px] py-2 pr-3 text-xs text-ink-2"><span className="line-clamp-2">{a.section_ref || "–"}</span></td>
                        <td className="py-2 pr-3" onClick={(ev) => ev.stopPropagation()}><PageLink page={a.pdf_page} onClick={() => openAnswer(e)} /></td>
                        <td className="py-2 pr-3"><ConfidenceBars level={a.confidence} /></td>
                        <td className="py-2 pr-3"><VerifyIcons env={e} /></td>
                        <td className="py-2 pr-3"><ReviewChip decision={e.review.decision} size="xs" /></td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {groups.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-muted">No answers match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ClauseTable() {
  return (
    <>
      <PageHeader title="Clause table" subtitle="Every answer with its proof. Click a row to see the page and quote." />
      <RunGate><Inner /></RunGate>
    </>
  );
}
