// Project overview: what was tested in four figures, the method as a four-step diagram, links to the tabs.
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useApp, useAsync } from "../../context";
import { labelCounts } from "../../types";
import { isRight } from "../../lib/plain";
import { ErrorNote, Figure, Spinner } from "../../components/ui";
import { Head, isClaude, load } from "./shared";

function Step({ n, title, figure, note }: { n: number; title: string; figure: string; note: string }) {
  return (
    <li className="relative flex min-w-0 flex-1 flex-col rounded-lg border border-line bg-surface p-3.5">
      <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Step {n}</span>
      <span className="mt-1 text-[14.5px] font-medium leading-snug text-ink">{title}</span>
      <span className="mt-2 font-serif text-[22px] font-semibold leading-none text-ink tnum">{figure}</span>
      <span className="mt-1 text-[12.5px] leading-snug text-muted">{note}</span>
    </li>
  );
}

function Arrow() {
  return (
    <li aria-hidden className="flex shrink-0 items-center justify-center text-line-strong sm:px-0.5">
      <ArrowRight className="h-4 w-4 rotate-90 sm:rotate-0" />
    </li>
  );
}

export default function Overview() {
  const { runs } = useApp();
  const ev = useAsync(() => load.evaluation(), []);
  const checks = useAsync(() => load.overrides().catch(() => null), []);
  if (ev.loading) return <Spinner label="Loading the scores…" />;
  if (ev.error || !ev.data) return <ErrorNote error={ev.error} title="No scores yet" />;
  const s = ev.data;
  const c = labelCounts(s.counts);
  const total = s.tests.length;
  const right = c.Correct + c["Correct absent"];
  const contracts = Object.keys(s.by_contract).sort();
  const wrong = s.tests.filter((t) => !isRight(t.label)).length;
  const claudeRuns = (runs ?? []).filter((r) => isClaude(r) && r.stage === "done").length;
  const perContract = contracts.length ? Math.round(total / contracts.length) : 0;
  const p = checks.data?.progress;
  // hallucinations = wrongly present + numbers the verifier could not find; the latter were checked by hand (Errors tab)
  const flagged = s.hallucinations - c["Wrongly present"];

  const tabs: [string, string, string][] = [
    ["/project/accuracy", "Accuracy", `${right}/${total} fully right, per contract and term`],
    ["/project/errors", "Where the AI went wrong", `${wrong} tests not fully right, with both pages`],
    ["/project/compare", "Compare contracts", `${contracts.length} contracts side by side`],
    ["/project/fair", "As written vs fair", "Cash model on the contract and on reference terms"],
    ["/project/consistency", "Consistency", "Repeat readings of the same contract"],
    ["/project/checks", "Manual check", p ? `${p.checked} of ${p.total} checked by a person` : "People confirm the judge’s labels"],
  ];

  return (
    <div>
      <Head title="What we tested" note="Four public Indian works contracts, read by Claude without the answer key, graded against the team’s hand-built key." />
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Figure label="Contracts" value={contracts.length} note="public tenders" />
        <Figure label="Questions" value={total} note={`${perContract} per contract`} />
        <Figure label="Fully right" value={`${right}/${total}`} note={`${total ? ((right / total) * 100).toFixed(1) : 0}%`} />
        <Figure label="Invented values" value={c["Wrongly present"]} note={flagged > 0 ? `${flagged} verifier flags, all checked` : "answers not in the contract"} />
      </div>

      <section className="mt-10 border-t border-line pt-6">
        <h3 className="font-serif text-[19px] font-semibold text-ink">Method</h3>
        <ol className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2" aria-label="Four steps">
          <Step n={1} title="Answer key by hand" figure={String(total)} note="answers, each with page and quote" />
          <Arrow />
          <Step n={2} title="Claude reads blind" figure={String(claudeRuns || contracts.length)} note="readings; the key is never shown" />
          <Arrow />
          <Step n={3} title="Code checks quotes" figure={`${Math.round(s.quote_verification_rate * 1000) / 10}%`} note="quotes found on the cited page" />
          <Arrow />
          <Step n={4} title="Judge grades" figure={String(total)} note="labels; people check a sample" />
        </ol>
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <h3 className="font-serif text-[19px] font-semibold text-ink">In this section</h3>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {tabs.map(([to, label, note]) => (
            <li key={to}>
              <Link to={to} className="group flex items-baseline justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-ink group-hover:text-accent-ink">{label}</span>
                  <span className="block text-[13px] text-muted">{note}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted group-hover:text-accent-ink" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
