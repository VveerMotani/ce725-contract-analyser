// All answers: the 52 questions grouped by term, each with its answer, page and a single status word.
// "Needs a check" shows only answers a person should confirm, with accept / correct / reject.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useRun } from "../context";
import { CLAUSE_IDS, effective, type Answer, type AnswerEnvelope, type ReviewPatch, type Status } from "../types";
import { DECISION_WORD, STATUS_WORD, TERM_NAME, reasonsPlain } from "../lib/plain";
import { elsewhereTarget } from "../lib/terms";
import { RunReady } from "../components/RunReady";
import { Button, Choice, ErrorNote, Field, InfoTip, PageTitle, ProofMark, SeeLink, cx, inputCls } from "../components/ui";

const ORDER = [...CLAUSE_IDS.slice(1), CLAUSE_IDS[0]];
const STATUSES: Status[] = ["FOUND", "NOT_STATED", "POINTS_ELSEWHERE", "NOT_APPLICABLE"];

function answerText(a: Answer): string {
  if (a.status === "FOUND") return a.answer_value || "–";
  if (a.status === "POINTS_ELSEWHERE") { const t = elsewhereTarget(a); return t ? `In ${t}.` : a.answer_value || "In another document."; }
  if (a.status === "NOT_STATED") return "Nothing on this in the document.";
  return a.answer_value || "Does not apply to this contract.";
}

type EditFields = Pick<Answer, "status" | "answer_value" | "pdf_page" | "section_ref" | "verbatim_quote">;
const EDIT_KEYS: (keyof EditFields)[] = ["status", "answer_value", "pdf_page", "section_ref", "verbatim_quote"];

function EditForm({ env, onSave, onCancel, busy }: { env: AnswerEnvelope; onSave: (changed: Partial<Answer>, note: string) => void; onCancel: () => void; busy: boolean }) {
  const a = effective(env);
  const [f, setF] = useState<EditFields>({ status: a.status, answer_value: a.answer_value, pdf_page: a.pdf_page, section_ref: a.section_ref, verbatim_quote: a.verbatim_quote });
  const [note, setNote] = useState("");
  const changed = EDIT_KEYS.filter((k) => f[k] !== env.answer[k]);
  const save = () => {
    const out: Partial<Answer> = {};
    changed.forEach((k) => { (out as Record<string, unknown>)[k] = f[k]; });
    onSave(out, note);
  };
  return (
    <div className="mt-3 grid gap-3 border-l-2 border-accent pl-4 sm:grid-cols-[1fr_120px]">
      <Field label="Correct answer" className="sm:col-span-2">
        <textarea rows={2} className={inputCls} value={f.answer_value} onChange={(e) => setF({ ...f, answer_value: e.target.value })} />
      </Field>
      <Field label="Is it in the document?">
        <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORD[s]}</option>)}
        </select>
      </Field>
      <Field label="Page"><input type="number" min={0} className={inputCls} value={f.pdf_page} onChange={(e) => setF({ ...f, pdf_page: parseInt(e.target.value) || 0 })} /></Field>
      <Field label="Exact sentence from the contract" className="sm:col-span-2">
        <textarea rows={2} className={cx(inputCls, "font-serif")} value={f.verbatim_quote} onChange={(e) => setF({ ...f, verbatim_quote: e.target.value })} />
      </Field>
      <Field label="Clause number"><input className={inputCls} value={f.section_ref} onChange={(e) => setF({ ...f, section_ref: e.target.value })} /></Field>
      <Field label="Why you changed it" className="sm:col-span-1"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button variant="primary" onClick={save} disabled={busy || changed.length === 0}>Save correction</Button>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

function Row({ env, frozen, showReview, onDecided }: { env: AnswerEnvelope; frozen: boolean; showReview: boolean; onDecided: (qid: string) => void }) {
  const { runId, replaceEnvelope, openAnswer } = useRun();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const a = effective(env);
  const d = env.review.decision;
  const decided = d === "accepted" || d === "edited" || d === "rejected";
  const patch = async (p: ReviewPatch) => {
    setBusy(true); setErr(null);
    try { onDecided(a.question_id); replaceEnvelope(await api.review(runId, a.question_id, p)); setEditing(false); } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <li className="py-3.5">
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="text-[13.5px] text-muted">{env.question}</div>
          <p className={cx("mt-0.5 text-[15px] leading-relaxed", d === "rejected" ? "text-muted line-through" : a.status === "FOUND" ? "text-ink" : "text-ink-2")}>{answerText(a)}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[13.5px] text-ink-2">{STATUS_WORD[a.status]} <ProofMark env={env} /></span>
          {a.pdf_page > 0 && <SeeLink label="See" page={a.pdf_page} onClick={() => openAnswer(env)} />}
        </div>
      </div>

      {(showReview || decided) && (d === "pending" || decided) && (
        <div className="mt-2">
          {d === "pending" && (
            <ul className="flex flex-col gap-0.5 text-[13.5px] text-ink-2">
              {reasonsPlain(env.review.reasons).map((r) => <li key={r}>• {r}</li>)}
            </ul>
          )}
          {decided && (
            <div className="flex flex-wrap items-center gap-x-3 text-[13.5px] text-muted">
              <span>{DECISION_WORD[d]}{env.review.note ? ` — “${env.review.note}”` : ""}.</span>
              {!frozen && <Button variant="quiet" disabled={busy} onClick={() => patch({ decision: "pending" })}>Undo</Button>}
            </div>
          )}
          {d === "pending" && !frozen && !editing && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => patch({ decision: "accepted" })}>Right</Button>
              <Button disabled={busy} onClick={() => setEditing(true)}>Correct it</Button>
              <Button disabled={busy} onClick={() => patch({ decision: "rejected" })}>Wrong, leave out</Button>
            </div>
          )}
          {editing && <EditForm env={env} busy={busy} onCancel={() => setEditing(false)} onSave={(changed, note) => patch({ decision: "edited", user_answer: changed, note })} />}
          {err ? <div className="mt-2"><ErrorNote error={err} title="Could not save" /></div> : null}
        </div>
      )}
    </li>
  );
}

function Inner() {
  const { answers, meta, pending } = useRun();
  const [sp, setSp] = useSearchParams();
  const filter = sp.get("filter") === "check" ? "check" : "all";
  const setFilter = (f: "all" | "check") => { const n = new URLSearchParams(sp); if (f === "all") n.delete("filter"); else n.set("filter", f); setSp(n, { replace: true }); };
  const frozen = !!meta?.frozen;
  const envs = answers!;
  // Answers decided while this list is open stay visible, so a decision can be undone.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const onDecided = (q: string) => setTouched((t) => new Set(t).add(q));
  const shown = filter === "check" ? envs.filter((e) => e.review.decision === "pending" || touched.has(e.answer.question_id)) : envs;

  return (
    <div>
      <PageTitle title="All answers" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Choice label="Which answers" value={filter} onChange={setFilter}
          options={[{ value: "all", label: `All ${envs.length}` }, { value: "check", label: `To confirm (${pending})` }]} />
        {filter === "check" && (
          <InfoTip label="About confirming answers">
            The tool could not fully prove these answers. Open the page, then mark each one. Flags and cash figures use your decision.
          </InfoTip>
        )}
        {filter === "check" && frozen && <span className="text-[13px] text-muted">Read-only demo</span>}
      </div>
      {filter === "check" && shown.length === 0 && <p className="mt-8 text-[15px] text-ink-2">Nothing left to confirm.</p>}

      {ORDER.map((c) => {
        const items = shown.filter((e) => effective(e).clause_id === c);
        if (!items.length) return null;
        return (
          <section key={c} className="mt-9">
            <h2 className="font-serif text-[20px] font-semibold text-ink">{TERM_NAME[c]}</h2>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {items.map((e) => <Row key={e.answer.question_id} env={e} frozen={frozen} showReview={filter === "check"} onDecided={onDecided} />)}
            </ul>
          </section>
        );
      })}

      <p className="mt-8 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
        <span><span className="text-good">✓</span> quote found on the page</span>
        <span><span className="text-warn">⚠</span> to confirm</span>
        <span><span className="text-accent-ink">✓</span> checked by a person</span>
      </p>
    </div>
  );
}

export default function AllAnswers() {
  return <RunReady><Inner /></RunReady>;
}
