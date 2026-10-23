// S6 Review queue: accept / edit / reject items a person must confirm, with an audit trail.
import { useMemo, useState } from "react";
import { ArrowRight, Check, Lock, Pencil, RotateCcw, ShieldCheck, X } from "lucide-react";
import { api } from "../api";
import { useRun } from "../context";
import { CLAUSE_SHORT, type Answer, type AnswerEnvelope, type ReviewPatch, type Status, effective } from "../types";
import { fmtDate } from "../lib/format";
import { keyNumber } from "../lib/keyFigures";
import { RunGate } from "../components/RunGate";
import { Button, Card, Chip, Collapsible, ErrorBox, Field, PageHeader, PageLink, ProgressRing, Quote, REVIEW_META, ReviewChip, StatusChip, cx, inputCls } from "../components/ui";

const STATUSES: Status[] = ["FOUND", "NOT_STATED", "NOT_APPLICABLE", "POINTS_ELSEWHERE"];
type EditFields = Pick<Answer, "status" | "answer_value" | "unit" | "base" | "section_ref" | "pdf_page" | "verbatim_quote">;
const EDIT_KEYS: (keyof EditFields)[] = ["status", "answer_value", "unit", "base", "section_ref", "pdf_page", "verbatim_quote"];

function EditForm({ env, onSave, onCancel, busy }: { env: AnswerEnvelope; onSave: (changed: Partial<Answer>, note: string) => void; onCancel: () => void; busy: boolean }) {
  const a = effective(env);
  const [f, setF] = useState<EditFields>({ status: a.status, answer_value: a.answer_value, unit: a.unit, base: a.base, section_ref: a.section_ref, pdf_page: a.pdf_page, verbatim_quote: a.verbatim_quote });
  const [note, setNote] = useState("");
  const changed = EDIT_KEYS.filter((k) => f[k] !== env.answer[k]);
  const save = () => {
    const out: Partial<Answer> = {};
    changed.forEach((k) => { (out as Record<string, unknown>)[k] = f[k]; });
    onSave(out, note);
  };
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-accent/40 bg-accent-soft/30 p-3 md:grid-cols-4">
      <Field label="Status">
        <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Answer value" className="col-span-2 md:col-span-3"><input className={inputCls} value={f.answer_value} onChange={(e) => setF({ ...f, answer_value: e.target.value })} /></Field>
      <Field label="Unit"><input className={inputCls} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="% of gross bill" /></Field>
      <Field label="Base"><input className={inputCls} value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })} placeholder="contract price" /></Field>
      <Field label="Section"><input className={inputCls} value={f.section_ref} onChange={(e) => setF({ ...f, section_ref: e.target.value })} /></Field>
      <Field label="PDF page"><input type="number" min={0} className={inputCls} value={f.pdf_page} onChange={(e) => setF({ ...f, pdf_page: parseInt(e.target.value) || 0 })} /></Field>
      <Field label="Verbatim quote" className="col-span-2 md:col-span-4" hint="Copy exactly from the page; the verifier re-checks it.">
        <textarea rows={2} className={cx(inputCls, "font-serif")} value={f.verbatim_quote} onChange={(e) => setF({ ...f, verbatim_quote: e.target.value })} />
      </Field>
      <Field label="Note (why you changed it)" className="col-span-2 md:col-span-3"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="col-span-2 flex items-end justify-end gap-2 md:col-span-1">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy || changed.length === 0} title={changed.length ? `${changed.length} field(s) changed` : "Change a field first"}>Save edit</Button>
      </div>
    </div>
  );
}

function AuditDiff({ env }: { env: AnswerEnvelope }) {
  const ai = env.answer;
  const user = env.review.user_answer;
  return (
    <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr]">
      <div className="rounded-lg border border-line p-2.5">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">AI answer</div>
        <div className="flex items-center gap-2"><StatusChip status={ai.status} size="xs" /><span className="text-xs text-muted">p.{ai.pdf_page || "–"}</span></div>
        <div className={cx("mt-1 text-[13px]", user && user.answer_value !== ai.answer_value ? "text-bad-ink line-through decoration-1" : "text-ink")}>{ai.answer_value || "–"}</div>
      </div>
      <ArrowRight className="hidden h-4 w-4 self-center text-muted md:block" />
      <div className="rounded-lg border border-accent/40 bg-accent-soft/30 p-2.5">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent-ink">Your answer</div>
        {user ? (
          <>
            <div className="flex items-center gap-2"><StatusChip status={user.status} size="xs" /><span className="text-xs text-muted">p.{user.pdf_page || "–"}</span></div>
            <div className="mt-1 text-[13px] font-medium text-ink">{user.answer_value || "–"}</div>
          </>
        ) : <div className="text-[13px] text-ink-2">{env.review.decision === "accepted" ? "Accepted as is" : env.review.decision === "rejected" ? "Rejected: excluded from flags and cash model" : "–"}</div>}
      </div>
    </div>
  );
}

function ItemCard({ env, frozen, onPatch, openAnswer }: { env: AnswerEnvelope; frozen: boolean; onPatch: (p: ReviewPatch) => Promise<void>; openAnswer: (e: AnswerEnvelope) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const a = env.answer;
  const decided = env.review.decision !== "pending" && env.review.decision !== "not_needed";
  const run = async (p: ReviewPatch) => {
    setBusy(true); setErr(null);
    try { await onPatch(p); setEditing(false); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const key = a.status === "FOUND" ? keyNumber(a.answer_value) : "";
  return (
    <div className={cx("rounded-xl border bg-surface p-4", env.review.decision === "pending" ? "border-warn/40" : "border-line")}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="font-mono text-xs text-muted">{a.question_id}</span>
        <Chip size="xs">{a.clause_id} · {CLAUSE_SHORT[a.clause_id]}</Chip>
        <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">{env.question}</span>
        <ReviewChip decision={env.review.decision} size="xs" />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {env.review.reasons.map((r) => <Chip key={r} tone="warn" size="xs">{r}</Chip>)}
      </div>

      {decided ? (
        <div className="mt-3">
          <AuditDiff env={env} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            {env.review.note && <span className="italic">“{env.review.note}”</span>}
            {env.review.decided_at && <span>· {fmtDate(env.review.decided_at)}</span>}
            {!frozen && <Button size="sm" variant="ghost" className="ml-auto" icon={<RotateCcw className="h-3 w-3" />} disabled={busy} onClick={() => run({ decision: "pending" })}>Undo</Button>}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1.3fr]">
            <div>
              <div className="flex items-center gap-2"><StatusChip status={a.status} size="xs" /><span className="text-[11px] font-semibold uppercase tracking-wide text-muted">AI answer</span></div>
              {key && <div className="mt-1 text-[18px] font-semibold text-ink">{key}</div>}
              <div className="mt-0.5 line-clamp-3 text-[13px] text-ink-2" title={a.answer_value}>{a.answer_value || "–"}</div>
              {a.points_to && <div className="mt-1 text-xs text-warn-ink">→ {a.points_to}</div>}
            </div>
            <div className="flex flex-col gap-1.5">
              {a.verbatim_quote ? <Quote text={a.verbatim_quote} page={a.pdf_page} section={a.section_ref} onOpen={() => openAnswer(env)} /> : (
                <div className="flex items-center gap-2 text-xs text-muted">No quote. <PageLink page={a.pdf_page} onClick={() => openAnswer(env)} /></div>
              )}
              {a.conflicts.length > 0 && <div className="text-xs text-warn-ink">{a.conflicts.length} other value(s): {a.conflicts.map((c) => `${c.value} (p.${c.pdf_page})`).join("; ")}</div>}
            </div>
          </div>
          {editing ? (
            <EditForm env={env} busy={busy} onCancel={() => setEditing(false)} onSave={(changed, note) => run({ decision: "edited", user_answer: changed, note })} />
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {frozen ? (
                <Chip icon={<Lock className="h-3 w-3" />}>Frozen demo run: review is read-only</Chip>
              ) : (
                <>
                  <Button variant="good" size="sm" icon={<Check className="h-3.5 w-3.5" />} disabled={busy} onClick={() => run({ decision: "accepted" })}>Accept</Button>
                  <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
                  <Button variant="danger" size="sm" icon={<X className="h-3.5 w-3.5" />} disabled={busy} onClick={() => run({ decision: "rejected" })}>Reject</Button>
                </>
              )}
              <button className="ml-auto text-xs font-medium text-accent-ink hover:underline" onClick={() => openAnswer(env)}>Open source</button>
            </div>
          )}
        </>
      )}
      {err ? <div className="mt-2"><ErrorBox error={err} title="Could not save" /></div> : null}
    </div>
  );
}

function Inner() {
  const { answers, runId, replaceEnvelope, openAnswer, meta, pending, verified } = useRun();
  const frozen = !!meta?.frozen;
  const [reason, setReason] = useState<string>("all");
  const queue = answers!.filter((e) => e.review.decision === "pending");
  const decided = answers!.filter((e) => ["accepted", "edited", "rejected"].includes(e.review.decision));
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    queue.forEach((e) => e.review.reasons.forEach((r) => { const k = r.split(":")[0]; m.set(k, (m.get(k) ?? 0) + 1); }));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [queue]);
  const shown = reason === "all" ? queue : queue.filter((e) => e.review.reasons.some((r) => r.startsWith(reason)));
  const patch = async (qid: string, p: ReviewPatch) => replaceEnvelope(await api.review(runId, qid, p));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Card bodyClass="flex items-center gap-4 p-4">
          <ProgressRing value={verified} total={answers!.length} label="verified" tone={pending ? "warn" : "good"} />
          <div className="flex flex-col gap-1 text-[13px]">
            <div><b className="tnum">{pending}</b> waiting</div>
            <div className="flex gap-1.5">
              {(["accepted", "edited", "rejected"] as const).map((d) => {
                const n = answers!.filter((e) => e.review.decision === d).length;
                return <Chip key={d} size="xs" tone={REVIEW_META[d].tone}>{n} {d}</Chip>;
              })}
            </div>
          </div>
        </Card>
        {pending === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-good/40 bg-good-soft p-4 text-good-ink">
            <ShieldCheck className="h-8 w-8 shrink-0" />
            <div>
              <div className="text-[15px] font-semibold">Verified by user</div>
              <div className="text-[13px]">Every item that needed a person has been accepted, edited or rejected. Flags and cash use your decisions.</div>
            </div>
          </div>
        ) : (
          <Card title="Why items are here" subtitle="Every not-stated, points-elsewhere, conflict, visual-only, low-confidence or failed-check answer needs a person.">
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setReason("all")}><Chip tone={reason === "all" ? "accent" : "neutral"}>All {queue.length}</Chip></button>
              {reasons.map(([r, n]) => <button key={r} onClick={() => setReason(r)}><Chip tone={reason === r ? "accent" : "warn"}>{r} · {n}</Chip></button>)}
            </div>
          </Card>
        )}
      </div>

      {shown.map((e) => <ItemCard key={e.answer.question_id} env={e} frozen={frozen} openAnswer={openAnswer} onPatch={(p) => patch(e.answer.question_id, p)} />)}

      {decided.length > 0 && (
        <Collapsible summary={<span>Decided items · audit trail <span className="text-xs font-normal text-muted">({decided.length})</span></span>} defaultOpen={pending === 0}>
          <div className="flex flex-col gap-3">
            {decided.map((e) => <ItemCard key={e.answer.question_id} env={e} frozen={frozen} openAnswer={openAnswer} onPatch={(p) => patch(e.answer.question_id, p)} />)}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

export default function ReviewQueue() {
  return (
    <>
      <PageHeader title="Review queue" subtitle="Confirm what the AI could not prove on its own. Your decisions are kept next to the AI answer." />
      <RunGate><Inner /></RunGate>
    </>
  );
}
