// About: what the tool does, how, its assumptions and limits. Plain text, one column.
import { PageTitle } from "../components/ui";

const ASSUMPTIONS = [
  "The cash figures are monthly: work follows your planned shape (S-curve or even), bills are monthly, and waiting times are rounded to whole months.",
  "Your cost share, overdraft rate, Bank Rate, guarantee commission, expected delay and price rises are your figures, not contract terms. Anything marked “assumed” is a default you should check.",
  "The fair reference values behind the warnings come from the Manual for Procurement of Works 2022, Department of Expenditure orders of November 2020, CPWD GCC 2023 and the test contracts. They are starting points, not law.",
  "Price variation uses the contract’s own factor and weights when it applies; for a fixed-price contract the figure shows what a price rise could cost you.",
  "Scanned or Hindi pages are read as images, marked as less certain and always sent for a human check.",
];
const LIMITS = [
  "Built for Indian public-works contracts and six money terms (plus basic contract facts).",
  "Terms that sit in documents you did not upload (for example general conditions incorporated by reference) are reported as being in another document, not filled in.",
  "AI reading can be wrong. Every answer needs an exact sentence that the code finds on the stated page; anything doubtful is set aside or sent for a human check.",
  "No legal advice, no employer or lender view, no user accounts.",
];

export default function About() {
  return (
    <div className="max-w-[720px]">
      <PageTitle title="About this tool" intro="CE 725 course project, Team 2: an AI reader for the money terms in construction contracts." />

      <section className="border-t border-line pt-6 text-[15px] leading-relaxed text-ink-2">
        <p><b className="font-medium text-ink">Decision support, not legal advice.</b> The tool shows what a contract says, with proof. A qualified person must check the terms that matter before a bid decision.</p>
        <h2 className="mt-8 font-serif text-[20px] font-semibold text-ink">How it works</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
          <li><b className="font-medium text-ink">Claude reads.</b> It reads the page text, and page images where the text is not enough, and answers 52 fixed questions. Each answer comes with the exact sentence, clause and page. It never does arithmetic.</li>
          <li><b className="font-medium text-ink">Code checks.</b> Every quoted sentence is looked up on its page, and the numbers in the answer must appear in it. Anything that does not hold up goes to a person.</li>
          <li><b className="font-medium text-ink">Code calculates.</b> The warnings come from fixed rules, and the cash figures from plain arithmetic, so every number can be reproduced.</li>
        </ol>
        <h2 className="mt-8 font-serif text-[20px] font-semibold text-ink">Confidentiality</h2>
        <p className="mt-3">Use only public documents. The text and page images of uploaded PDFs are sent to the Anthropic API to be read. Results are saved as files on the machine that runs the server; there are no accounts or shared databases.</p>
        <h2 className="mt-8 font-serif text-[20px] font-semibold text-ink">Assumptions</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">{ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}</ul>
        <h2 className="mt-8 font-serif text-[20px] font-semibold text-ink">Limits</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">{LIMITS.map((a) => <li key={a}>{a}</li>)}</ul>
      </section>
    </div>
  );
}
