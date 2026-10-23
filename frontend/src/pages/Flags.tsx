// Red flags / green flags scorecard, with a collapsed line for rules not checked and items to confirm.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useRun } from "../context";
import { effective, type RiskFlag } from "../types";
import { money } from "../lib/format";
import { flagWhy, topic } from "../lib/plain";
import { notCheckedWhy, type Row, type Scorecard } from "../lib/scorecard";
import { StatusDot, cx } from "../components/ui";

function firstSentences(t: string, n: number): string {
  return t.split(/(?<=[.!?])\s+(?=[A-Z“‘'"(])/).slice(0, n).join(" ");
}

function Expand({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-2.5 py-2.5">{summary}<ChevronRight className="disclosure-caret h-4 w-4 shrink-0 text-muted transition-transform" aria-hidden /></summary>
      <div className="pb-3 pl-5 text-[14px] text-ink-2">{children}</div>
    </details>
  );
}

function FlagDetail({ f }: { f: RiskFlag }) {
  const { answers, openPage } = useRun();
  const env = answers?.find((e) => e.answer.question_id === f.question_ids[0]);
  return (
    <div className="mt-1 first:mt-0">
      <p>{firstSentences(flagWhy(f), 3)}</p>
      {f.quote && <blockquote className="mt-2 border-l-2 border-line-strong pl-3 font-serif text-[14px] text-ink-2">“{f.quote}”</blockquote>}
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[12.5px] text-muted">
        {f.pdf_page > 0 && <button className="text-accent-ink hover:underline" onClick={() => openPage(f.pdf_page, f.quote, env?.doc_id || "d1", f.title, "Red flags")}>p. {f.pdf_page}</button>}
        <span>rule {f.flag_id}</span>
      </div>
    </div>
  );
}

function TopicLinks({ qids }: { qids: string[] }) {
  const { answers, openAnswer } = useRun();
  return (
    <>
      {qids.map((q, i) => {
        const env = answers?.find((e) => e.answer.question_id === q);
        const pg = env ? effective(env).pdf_page : 0;
        return (
          <span key={q}>
            {i > 0 ? ", " : ""}
            {env ? <button className="text-accent-ink hover:underline" onClick={() => openAnswer(env, "To confirm")}>{topic(q).toLowerCase()}{pg ? ` p. ${pg}` : ""}</button> : topic(q).toLowerCase()}
          </span>
        );
      })}
    </>
  );
}

function ConfirmRow({ r }: { r: Row }) {
  let body: ReactNode;
  if (r.id === "R16") body = <TopicLinks qids={r.question_ids} />;
  else if (r.id === "R17") {
    body = r.flags.map((f, i) => {
      const m = f.explanation.match(/cited at ([^)]+)\)/) ?? f.explanation.match(/depend on (.+?), which is not/);
      return <div key={i}>{(m ? m[1] : f.section_ref).replace(/\s+in$/, "")}: <TopicLinks qids={f.question_ids} /></div>;
    });
  } else if (r.id === "R18") body = r.flags.map((f) => f.value_found).join("; ") || r.check?.reason;
  else body = r.flags.length ? firstSentences(flagWhy(r.flags[0]), 1) : r.check?.reason;
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-2.5 py-1.5">
      <span className="mt-[7px] inline-block h-2 w-2 rounded-full bg-none" aria-hidden />
      <div><span className="text-ink">{r.label}</span><div className="text-[13px] text-muted">{body}</div></div>
    </li>
  );
}

export function FlagBoard({ sc }: { sc: Scorecard }) {
  return (
    <div>
      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <h3 className="font-serif text-[18px] font-semibold text-ink">Red flags <span className="font-sans text-[14px] font-normal text-muted">{sc.red.length}</span></h3>
          {sc.red.length === 0 ? <p className="mt-2 text-[14px] text-muted">None</p> : (
            <ul className="mt-1 divide-y divide-line border-y border-line">
              {sc.red.map((r) => (
                <li key={r.id}>
                  <Expand summary={
                    <>
                      <StatusDot tone={r.tone} title={r.severity === "High" ? "Serious" : "Watch"} />
                      <span className="min-w-0 flex-1 text-[14.5px] text-ink">{r.label}</span>
                      {r.rupee != null && r.rupee > 0 && <span className="shrink-0 rounded border border-line-strong px-1.5 text-[12px] text-ink-2 tnum">{money(r.rupee)}</span>}
                    </>
                  }>
                    {r.flags.length ? r.flags.map((f, i) => <FlagDetail key={i} f={f} />) : <p>{r.check?.reason}</p>}
                  </Expand>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-serif text-[18px] font-semibold text-ink">Green flags <span className="font-sans text-[14px] font-normal text-muted">{sc.green.length}</span></h3>
          {!sc.hasChecks ? <p className="mt-2 text-[14px] text-muted">Not available</p> : sc.green.length === 0 ? <p className="mt-2 text-[14px] text-muted">None</p> : (
            <ul className="mt-1 divide-y divide-line border-y border-line">
              {sc.green.map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 py-2.5 text-[14.5px] text-ink" title={r.check?.reason}>
                  <span className="w-2.5 text-center text-good" aria-hidden>✓</span>{r.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {(sc.notChecked.length > 0 || sc.confirm.length > 0) && (
        <details className="group mt-4">
          <summary className="inline-flex cursor-pointer items-center gap-1 text-[13.5px] text-muted hover:text-ink">
            <ChevronRight className="disclosure-caret h-4 w-4 transition-transform" aria-hidden />
            {[sc.notChecked.length ? `${sc.notChecked.length} not checked` : "", sc.confirm.length ? `${sc.confirm.length} to confirm` : ""].filter(Boolean).join(" · ")}
          </summary>
          <ul className={cx("mt-2 text-[14px]")}>
            {sc.notChecked.map((r) => (
              <li key={r.id} className="grid grid-cols-[auto_1fr] gap-x-2.5 py-1.5">
                <span className="mt-[7px] inline-block h-2 w-2 rounded-full border border-muted" aria-hidden />
                <div><span className="text-ink">{r.label}</span> <span className="text-[13px] text-muted">· not checked, {notCheckedWhy(r)}</span></div>
              </li>
            ))}
            {sc.confirm.map((r) => <ConfirmRow key={r.id} r={r} />)}
          </ul>
        </details>
      )}
    </div>
  );
}
