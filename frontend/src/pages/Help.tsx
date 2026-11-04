// Help: how to use the site, for a first-time visitor. Three steps, the top bar, the colours, uploading, and a few answers.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CircleHelp, FileSearch, FlaskConical, LayoutList, MousePointerClick, Upload } from "lucide-react";
import { PageTitle, Section, buttonCls, cx } from "../components/ui";
import { useLimits } from "../components/LimitNote";
import { STATIC_SITE } from "../staticSite";

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col rounded-lg border border-line bg-surface p-5">
      <span className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft font-serif text-[15px] font-semibold text-accent-ink">{n}</span>
        <span className="text-accent-ink">{icon}</span>
      </span>
      <span className="mt-3 font-serif text-[18px] font-semibold text-ink">{title}</span>
      <span className="mt-1 text-[14px] leading-snug text-ink-2">{children}</span>
    </li>
  );
}

/** One row of the top-bar map: a look-alike of the control, then what it does. */
function BarItem({ look, children }: { look: ReactNode; children: ReactNode }) {
  return (
    <li className="grid gap-x-5 gap-y-1.5 py-3 sm:grid-cols-[220px_1fr] sm:items-center">
      <span>{look}</span>
      <span className="text-[14.5px] text-ink-2">{children}</span>
    </li>
  );
}

const pill = "inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-[13.5px] text-ink-2";
const tab = "inline-block border-b-2 pb-1 text-[14.5px]";

function Dot({ cls }: { cls: string }) {
  return <span className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-full", cls)} aria-hidden />;
}

function Legend({ mark, label, children }: { mark: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-1 flex w-14 shrink-0 justify-center">{mark}</span>
      <span className="text-[14.5px] text-ink-2"><b className="font-medium text-ink">{label}</b> — {children}</span>
    </li>
  );
}

const FAQ: [string, ReactNode][] = [
  ["What does “—” mean?", "The contract does not give that figure, so nothing is filled in. Missing terms are often a risk in themselves."],
  ["What are “answers to confirm”?", "Answers where the automatic check found a doubt, for example a number that is not in the quoted sentence. Open “All 52 questions” and look at the page to confirm them."],
  ["Where do the cash figures come from?", "Only from the contract’s terms and figures you type. The tool never makes up a number: if the contract does not give something the cash model needs (its value, the days to pay a bill) or it is your own figure (your cost, your overdraft rate), the Cash section asks for it, and no cash figure is shown until you enter it. Your own figures are kept in your browser for every contract."],
  ["Can I rely on it for a bid?", "Use it to find and understand the terms quickly. It is decision support, not legal advice: check the terms that matter in the contract itself."],
];

export default function Help() {
  const { limits: l } = useLimits();
  const perDay = l && l.daily_limit > 0 ? l.daily_limit : null;
  return (
    <div>
      <PageTitle title="How to use this site"
        intro="The tool reads a construction contract and pulls out the six terms that decide your cash: when you are paid, what is held back, advances, delay penalties, price rise protection and bank guarantees." />

      <ol className="grid gap-4 sm:grid-cols-3">
        <Step n={1} icon={<Upload className="h-5 w-5" aria-hidden />} title="Open a contract">
          Pick one of the four test contracts on the home page, or upload your own PDF.
        </Step>
        <Step n={2} icon={<LayoutList className="h-5 w-5" aria-hidden />} title="Read the summary">
          Six money terms, red and green flags, and what the terms do to your cash month by month.
        </Step>
        <Step n={3} icon={<MousePointerClick className="h-5 w-5" aria-hidden />} title="Check the proof">
          Click a term for the detail. Every page number opens the contract page with the sentence highlighted.
        </Step>
      </ol>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link to="/" className={buttonCls("primary")}>See the test contracts <ArrowRight className="h-4 w-4" /></Link>
        {!STATIC_SITE && <Link to="/new" className={buttonCls("secondary")}>Upload a contract</Link>}
      </div>

      <Section className="mt-12" title="The top bar">
        <ul className="divide-y divide-line border-b border-line">
          <BarItem look={<span className="inline-block w-[200px] truncate rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[14px] text-ink">Open a contract… ▾</span>}>
            Switch between contracts: the four test contracts and any you upload.
          </BarItem>
          <BarItem look={<span className="flex gap-4"><span className={cx(tab, "border-accent font-medium text-ink")}>Summary</span><span className={cx(tab, "border-transparent text-ink-2")}>All 52 questions</span></span>}>
            Appear once a contract is open. <b className="font-medium text-ink">Summary</b> is the one-page report.{" "}
            <b className="font-medium text-ink">All 52 questions</b> lists every question the tool asks of the contract, with the answer, the
            exact sentence and the page.
          </BarItem>
          <BarItem look={<span className={pill}><CircleHelp className="h-3.5 w-3.5" aria-hidden />Help</span>}>This page.</BarItem>
          <BarItem look={<span className={pill}><FlaskConical className="h-3.5 w-3.5" aria-hidden />How we tested it</span>}>
            Our course project work: how accurate the tool is against a hand-built answer key. You don’t need it to use the tool.
          </BarItem>
        </ul>
      </Section>

      <Section className="mt-12" title="Reading the summary">
        <ul className="divide-y divide-line border-b border-line">
          <Legend mark={<Dot cls="bg-bad" />} label="Serious">a term that can cost you real money. Read it before you bid.</Legend>
          <Legend mark={<Dot cls="bg-warn" />} label="Watch">worth a second look, or the contract is unclear.</Legend>
          <Legend mark={<Dot cls="bg-good" />} label="Fine">a normal, fair term (a green flag).</Legend>
          <Legend mark={<Dot cls="border border-muted bg-transparent" />} label="Not checked">the contract did not give enough to check this.</Legend>
          <Legend mark={<span className="rounded border border-line-strong px-1.5 text-[12.5px] text-accent-ink tnum">p. 13</span>} label="Page link">
            opens the contract page with the quoted sentence highlighted.
          </Legend>
          <Legend mark={<span className="text-[14px] text-ink underline decoration-muted decoration-dotted underline-offset-[3px]">retention</span>} label="Dotted word">
            hover or tap it for a plain-English meaning.
          </Legend>
        </ul>
      </Section>

      {!STATIC_SITE && (
        <Section className="mt-12" title="Uploading your own contract">
          <ul className="flex flex-col gap-2.5 text-[14.5px] text-ink-2">
            <li className="flex gap-3"><FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
              PDF files only: the notice inviting tenders, the conditions of contract, schedules and any corrigenda. Public documents only, as the pages are sent to an AI service to be read.</li>
            {perDay && <li className="flex gap-3"><Dot cls="mt-1.5 bg-accent" />
              {perDay} readings a day for the whole site, because each one uses paid AI credit{l?.remaining != null && <> ({l.remaining} left today)</>}.</li>}
            <li className="flex gap-3"><Dot cls="mt-1.5 bg-accent" />A reading takes about 5–15 minutes. You can keep the page open and watch it progress.</li>
            {l && l.max_pages > 0 && <li className="flex gap-3"><Dot cls="mt-1.5 bg-accent" />Up to {l.max_pages} pages per contract.</li>}
            {l?.hosted && <li className="flex gap-3"><Dot cls="mt-1.5 bg-accent" />Results stay until the server restarts. To keep one, use “Download the report (PDF)” at the bottom of its page.</li>}
            {l?.hosted && <li className="flex gap-3"><Dot cls="mt-1.5 bg-accent" />The site runs on a free server that sleeps when nobody uses it, so the first visit can take about a minute.</li>}
          </ul>
        </Section>
      )}

      <Section className="mt-12" title="Questions">
        <dl className="divide-y divide-line border-b border-line">
          {FAQ.map(([q, a]) => (
            <div key={q} className="py-3.5">
              <dt className="text-[15px] font-medium text-ink">{q}</dt>
              <dd className="mt-1 text-[14.5px] text-ink-2">{a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-[14px] text-muted">More on how it works and its limits: <Link className="text-accent-ink hover:underline" to="/about">About this tool</Link>.</p>
      </Section>
    </div>
  );
}
