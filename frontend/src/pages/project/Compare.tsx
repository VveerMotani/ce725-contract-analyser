// Compare contracts: the four test contracts as columns, the six money terms and a few key facts as rows.
// Each term cell: the card's dot (worst flag on the clause, green if a rule passed, grey if not found)
// and its key number. Click a cell to open that contract's term page.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useApp, useAsync } from "../../context";
import { effective, type Answer, type AnswerEnvelope, type CashParams, type CashResult, type ClauseId, type RiskFlag, type RuleCheck, type RunMeta } from "../../types";
import { money, pct } from "../../lib/format";
import { TERM_SHORT } from "../../lib/plain";
import { cardTone, scorecard, type Scorecard } from "../../lib/scorecard";
import { TERM_ORDER, TERM_SLUG } from "../../lib/termDetail";
import { days, firstPct, rate, usable, type Tone } from "../../lib/terms";
import { ErrorNote, Spinner, StatusDot, cx } from "../../components/ui";
import { Head, cached, latestByContract, load, shortTitle } from "./shared";

interface Col {
  meta: RunMeta;
  title: string;
  answers: AnswerEnvelope[];
  params?: CashParams;
  cash?: CashResult;
  sc: Scorecard;
}

interface Cell { tone: Tone; big: string; small?: string }

const MAIN_Q: Record<Exclude<ClauseId, "C0">, string> = { C1: "1.3", C2: "2.2", C3: "3.1", C4: "4.2", C5: "5.1", C6: "6.2" };

function notHere(a: Answer | null): string {
  if (!a || a.status === "NOT_STATED") return "Not stated";
  if (a.status === "POINTS_ELSEWHERE") return "Elsewhere";
  return "Switched off";
}

const isNo = (a: Answer | null) => !!a && (a.status === "NOT_APPLICABLE" || (a.status === "FOUND" && /^\s*no\b/i.test(a.answer_value)));

/** The key number of each term, from the effective answers and usable cash parameters only. */
function termCell(c: Exclude<ClauseId, "C0">, col: Col): Cell {
  const ans = (q: string) => { const e = col.answers.find((x) => x.answer.question_id === q); return e ? effective(e) : null; };
  const p = col.params, inp = p?.inputs;
  const ok = (f: string) => !!inp && usable(p, f) !== null;
  const tone = cardTone(c, col.sc, ans(MAIN_Q[c]));
  switch (c) {
    case "C1": {
      const a = ans("1.3"), li = ans("1.4");
      let d: number | null = null;
      if (a?.status === "FOUND") d = ok("pay_lag_days") && inp!.pay_lag_days > 0 ? Math.round(inp!.pay_lag_days) : parseInt(days(a.answer_value)) || null;
      const late = li?.status === "FOUND" ? (/\bno interest\b|not payable|\bnil\b/i.test(li.answer_value) ? "no late interest" : `late interest ${rate(li.answer_value).replace(/ a year$/, "") || "yes"}`)
        : li?.status === "NOT_STATED" ? "late interest not stated" : li?.status === "POINTS_ELSEWHERE" ? "late interest elsewhere" : undefined;
      return { tone, big: d ? `${d} days` : a?.status === "FOUND" ? "See text" : notHere(a), small: late };
    }
    case "C2": {
      const a = ans("2.2"), cap = ans("2.3");
      if (isNo(ans("2.1"))) return { tone, big: "None" };
      const r = a?.status === "FOUND" ? (ok("retention_rate") && inp!.retention_rate > 0 ? pct(inp!.retention_rate) : firstPct(a.answer_value)) : "";
      const cp = cap?.status === "FOUND" ? (ok("retention_cap") && inp!.retention_cap != null ? pct(inp!.retention_cap) : firstPct(cap.answer_value)) : "";
      return { tone, big: r ? `${r} per bill` : notHere(a), small: cp ? `cap ${cp}` : col.cash && r && col.cash.retention_locked_max > 0 ? `up to ${money(col.cash.retention_locked_max)} held` : undefined };
    }
    case "C3": {
      if (isNo(ans("3.1"))) return { tone, big: "None" };
      const inst = ok("advance_instalments") ? inp!.advance_instalments : [];
      const tot = inst.reduce((x, i) => x + i.share_of_value, 0);
      const a2 = ans("3.2"), intr = ans("3.3");
      const amt = tot ? pct(tot) : a2?.status === "FOUND" ? firstPct(a2.answer_value) : "";
      const small = intr?.status === "FOUND" ? (/interest[- ]free|no interest|without interest/i.test(intr.answer_value) ? "interest-free" : `interest ${rate(intr.answer_value).replace(/ a year$/, "") || "charged"}`) : undefined;
      return { tone, big: amt ? `${amt} of value` : ans("3.1")?.status === "FOUND" ? "See text" : notHere(ans("3.1")), small };
    }
    case "C4": {
      if (isNo(ans("4.1"))) return { tone, big: "None" };
      const a = ans("4.2");
      const r = a?.status === "FOUND" && ok("ld_rate_per_day") && inp!.ld_rate_per_day > 0 ? inp!.ld_rate_per_day : null;
      // same rule as the term card: a clean monthly rate (e.g. 1% a month) is shown per month
      const perMonth = r != null && Math.abs(r * 1e5 - Math.round(r * 1e5)) > 1e-6 && Math.abs(r * 3e5 - Math.round(r * 3e5)) < 1e-6;
      const big = r ? (perMonth ? `${pct(r * 30)} / month` : `${pct(r)} / day`) : a?.status === "FOUND" ? (firstPct(a.answer_value) || "See text") : notHere(a);
      const small = r && ok("ld_cap") ? (inp!.ld_cap == null ? "no upper limit" : `cap ${pct(inp!.ld_cap)}`) : undefined;
      return { tone, big, small };
    }
    case "C5": {
      const a = ans("5.1");
      if (!a || (a.status !== "FOUND" && a.status !== "NOT_APPLICABLE")) return { tone, big: notHere(a) };
      const textApplies = /\b(10CC|10CA|PVC|price variation|price adjustment|escalation)\s+(clause\s+)?(is\s+)?(selected|applicable|applies)\b/i.test(a.answer_value);
      const textFixed = !textApplies && /fixed price|no (general )?(index|price|escalation)|not applicable|does not apply/i.test(a.answer_value);
      const applies = a.status === "NOT_APPLICABLE" ? false : ok("pv_applies") ? inp!.pv_applies : !textFixed;
      return { tone, big: applies ? "Indexed" : "Fixed", small: applies ? (ok("pv_factor") && inp!.pv_factor > 0 && inp!.pv_factor < 1 ? `on ${pct(inp!.pv_factor)} of value` : undefined) : "price rise is yours" };
    }
    case "C6": {
      const a = ans("6.2");
      let ps = a?.status === "FOUND" && ok("perf_security_pct") && inp!.perf_security_pct > 0 ? inp!.perf_security_pct : null;
      if (ps == null && a?.status === "FOUND") { const m = a.answer_value.match(/performance (security|guarantee)[^;]*?(\d+(\.\d+)?)\s?%/i); ps = m ? +m[2] / 100 : null; }
      const extra = ans("6.8");
      const small = extra?.status === "FOUND" && !/^\s*no\b/i.test(extra.answer_value) ? "extra for low bids" : undefined;
      return { tone, big: ps ? `${pct(ps)} performance` : a?.status === "FOUND" ? "See text" : notHere(a), small };
    }
  }
}

function contractFacts(col: Col): { value: string; duration: string; dlp: string } {
  const ans = (q: string) => { const e = col.answers.find((x) => x.answer.question_id === q); return e ? effective(e) : null; };
  const p = col.params, inp = p?.inputs;
  let value = "—";
  if (inp && usable(p, "contract_value") && inp.contract_value > 0) value = money(inp.contract_value);
  else { const v = ans("0.3"); const m = v?.status === "FOUND" ? v.answer_value.match(/Rs\.?\s?[\d,.]+\s*(lakhs?|lacs?|crores?)?/i) : null; if (m) value = m[0]; }
  const d = ans("0.4");
  const dm = d?.status === "FOUND" ? d.answer_value.match(/\b\d+(\.\d+)?\s*(days?|months?|years?|weeks?)\b/i) : null;
  const duration = dm ? dm[0] : inp && usable(p, "duration_months") ? `${inp.duration_months} months` : "—";
  const dl = ans("0.5");
  const none = dl?.status === "FOUND" && /^\s*no\b|not stated/i.test(dl.answer_value);
  const lm = dl?.status === "FOUND" && !none ? dl.answer_value.match(/\b\d+(\.\d+)?\s*(days?|months?|years?)\b/i) : null;
  return { value, duration, dlp: none ? "None stated" : lm ? lm[0] : "—" };
}

async function loadCol(meta: RunMeta, title: string): Promise<Col> {
  const rid = meta.run_id;
  const [answers, params, flags, checks, cash] = await Promise.all([
    load.answers(rid),
    cached(`params/${rid}`, () => api.params(rid)).catch(() => undefined),
    cached(`flags/${rid}`, () => api.flags(rid)).catch(() => [] as RiskFlag[]),
    cached(`checks/${rid}`, () => api.checks(rid)).catch(() => undefined as RuleCheck[] | undefined),
    cached(`cash/${rid}`, () => api.cashflow(rid)).catch(() => undefined),
  ]);
  return { meta, title, answers, params, cash: cash?.as_written, sc: scorecard(checks, flags) };
}

function TermCellView({ cell, onClick, label }: { cell: Cell; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="group flex w-full min-w-0 flex-col items-start rounded px-2 py-2 text-left hover:bg-accent-soft focus:outline-none focus-visible:bg-accent-soft">
      <span className="flex items-center gap-2">
        <StatusDot tone={cell.tone} />
        <span className="font-serif text-[16.5px] font-semibold leading-tight text-ink tnum group-hover:text-accent-ink">{cell.big}</span>
      </span>
      {cell.small && <span className="mt-0.5 pl-[18px] text-[12px] leading-tight text-muted">{cell.small}</span>}
    </button>
  );
}

function MiniTally({ sc }: { sc: Scorecard }) {
  const t = sc.tally;
  const items: [string, number, string][] = [["serious", t.serious, "bg-bad"], ["watch", t.watch, "bg-warn"]];
  if (sc.hasChecks) items.push(["fine", t.fine, "bg-good"], ["not checked", t.notChecked, "border border-muted"]);
  return (
    <ul className="flex flex-col gap-0.5 text-[12.5px] text-ink-2">
      {items.map(([l, n, dot]) => (
        <li key={l} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className={cx("inline-block h-2 w-2 rounded-full", dot)} aria-hidden /><span className="font-medium text-ink tnum">{n}</span> {l}
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <tr className={cx("border-b border-line", className)}>
      <th scope="row" className="sticky left-0 z-10 bg-page py-1 pr-3 text-left align-middle text-[13.5px] font-medium text-ink-2">{label}</th>
      {children}
    </tr>
  );
}

export default function Compare() {
  const { runs, benchmarks } = useApp();
  const nav = useNavigate();
  const cids = (benchmarks ?? []).map((b) => b.contract_id);
  const cols = useAsync(async () => {
    const latest = latestByContract(runs, cids);
    const list = cids.filter((c) => latest[c]);
    return Promise.all(list.map((c) => loadCol(latest[c], shortTitle(benchmarks?.find((b) => b.contract_id === c)?.title ?? c))));
  }, [runs, benchmarks]);

  if (!runs || !benchmarks || cols.loading) return <Spinner label="Loading the four contracts…" />;
  if (cols.error || !cols.data) return <ErrorNote error={cols.error} title="Could not load the contracts" />;
  const list = cols.data;
  if (!list.length) return <><Head title="Compare contracts" /><p className="text-[14.5px] text-muted">No contracts read yet.</p></>;
  const facts = list.map(contractFacts);

  return (
    <div>
      <Head title="Compare contracts" note="The same six money terms in each contract. Dot: worst flag on the term; green when a rule checked it and passed; grey when not found. Click a cell for the term page." />
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="border-b border-line-strong align-bottom">
              <th className="sticky left-0 z-10 w-[130px] bg-page" />
              {list.map((c, i) => (
                <th key={c.meta.run_id} scope="col" className="px-2 pb-3 text-left font-normal">
                  <span className="block text-[12px] text-muted">{c.meta.contract_id}</span>
                  <span className="block text-[14.5px] font-semibold leading-snug text-ink">{c.title}</span>
                  <span className="mt-1 block text-[12.5px] text-ink-2 tnum">{facts[i].value} · {facts[i].duration}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TERM_ORDER.map((t) => (
              <Row key={t} label={TERM_SHORT[t]}>
                {list.map((c) => (
                  <td key={c.meta.run_id} className="px-0.5 align-top">
                    <TermCellView cell={termCell(t, c)} label={`${c.title}: ${TERM_SHORT[t]}`}
                      onClick={() => nav(`/runs/${c.meta.run_id}/terms/${TERM_SLUG[t]}`)} />
                  </td>
                ))}
              </Row>
            ))}
            <Row label="Defects period">
              {list.map((c, i) => <td key={c.meta.run_id} className="px-2.5 py-2 text-[14px] text-ink tnum">{facts[i].dlp}</td>)}
            </Row>
            <Row label="Peak funding">
              {list.map((c) => (
                <td key={c.meta.run_id} className="px-2.5 py-2 text-[14px] text-ink tnum">
                  {c.cash ? <>{money(c.cash.peak_funding)}{c.cash.peak_funding > 0 && <span className="text-[12px] text-muted"> · month {c.cash.peak_month}</span>}</> : "—"}
                </td>
              ))}
            </Row>
            <Row label="Cost of terms">
              {list.map((c) => <td key={c.meta.run_id} className="px-2.5 py-2 text-[14px] text-ink tnum">{c.cash ? money(c.cash.total_cost_of_terms) : "—"}</td>)}
            </Row>
            <Row label="Flags" className="border-b-0">
              {list.map((c) => (
                <td key={c.meta.run_id} className="px-2.5 py-2.5 align-top">
                  <MiniTally sc={c.sc} />
                </td>
              ))}
            </Row>
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[12.5px] text-muted">Cash figures use the illustrative project inputs of each run (cost share, overdraft rate, no delay). Scenarios, not predictions.</p>
    </div>
  );
}
