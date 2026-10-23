// Short plain definitions for contract words, shown by <Term> on hover or tap.
// Indian public-works usage (CPWD, MoRTH/NHAI, state PWDs). Each definition stays under 25 words.

export interface GlossEntry {
  /** headword shown in bold at the top of the tooltip */
  head: string;
  def: string;
}

export const GLOSSARY = {
  retention: { head: "Retention / security deposit", def: "Share of each running bill, often 5%, held back by the employer as security. Returned after the defects liability period ends." },
  dlp: { head: "Defects liability period (DLP)", def: "Period after completion, often 1 to 2 years, when you repair defects at your own cost. Retention and guarantees are held till it ends." },
  ra_bill: { head: "Running account bill / IPC", def: "Interim bill for work done so far, usually monthly. Certified by the engineer and paid less deductions; also called interim payment certificate." },
  stage: { head: "Stage payment", def: "Payment released when a set stage of the work is complete, instead of monthly for measured quantities." },
  certification: { head: "Certification", def: "The engineer's check and approval of a bill's quantities and amount. Payment time usually runs from certification, not from submission." },
  emd: { head: "Earnest money deposit (EMD) / bid security", def: "Deposit sent with the bid, usually 1 to 2% of the estimate. Forfeited if you withdraw; returned once the performance guarantee is given." },
  perf: { head: "Performance guarantee / performance security", def: "Bank guarantee, often 3 to 5% of contract value, given after award. Cashed if you fail to perform; returned after the defects period." },
  aps: { head: "Additional performance security", def: "Extra security asked for when your bid is well below the estimate, to cover the risk of an unworkably low price." },
  bg: { head: "Bank guarantee (BG)", def: "Your bank's promise to pay the employer on demand, up to a fixed sum. The bank charges a yearly commission and blocks your credit limit." },
  mob_advance: { head: "Mobilisation advance", def: "Advance, often up to 10% of contract value, paid at the start to set up the site. Recovered from later bills against a bank guarantee." },
  secured_advance: { head: "Secured advance", def: "Advance against materials brought to site for the permanent works, typically up to 75% of their value, recovered as they are used." },
  ld: { head: "Liquidated damages / compensation for delay", def: "Fixed sum deducted for each day or week you finish late, usually capped at 5 to 10% of contract value. No proof of loss needed." },
  eot: { head: "Extension of time (EOT)", def: "Extra time granted for delays that are not your fault, such as late site handover or drawings. No delay penalty for that period." },
  pv: { head: "Price variation / price adjustment / escalation", def: "Clause that raises or lowers payments as cost indices move after the base date, so you do not carry all of inflation." },
  index: { head: "Index (WPI, CPI)", def: "Published price index: Wholesale Price Index for materials and fuel, Consumer Price Index for labour. The formula compares current and base-date values." },
  base_date: { head: "Base date", def: "Reference date for price variation, usually 28 days before the bid due date. Index values on this date are the starting point." },
  milestone: { head: "Milestone", def: "Intermediate target: a share of the work to be done by a set date. Missing it can attract its own delay penalty." },
  bank_rate: { head: "Bank Rate", def: "Rate at which the RBI lends to banks. Contracts often set interest on late payment or advances at Bank Rate plus a margin." },
  contract_value: { head: "Tendered value / contract price", def: "Your accepted bid amount. Securities, advances and penalty caps are usually worked out as percentages of it." },
  completion_cert: { head: "Completion certificate", def: "Engineer's certificate that the work is complete. Starts the defects liability period and usually releases part of the retention." },
  encashment: { head: "Encashment", def: "The employer invoking a bank guarantee and taking the money from your bank, usually on demand without proving any loss." },
  fdr: { head: "FDR (fixed deposit receipt)", def: "Bank fixed deposit pledged to the employer as security instead of a bank guarantee. Your money stays locked till it is released." },
  contract_data: { head: "Schedule F / Contract Data", def: "Project-specific sheet that fills in the general conditions: percentages, periods, rates and which optional clauses apply." },
  gcc: { head: "GCC (General Conditions of Contract)", def: "Standard clauses an employer uses for every contract, such as CPWD or MoRTH conditions. Project details sit in special conditions or contract data." },
  nit: { head: "NIT (Notice Inviting Tender)", def: "The tender notice: work, estimated cost, EMD, time allowed, eligibility and bid dates. Usually the first document of the package." },
  peak_funding: { head: "Peak funding", def: "The most of your own money tied up in the work at any one time, before payments catch up. Sets your overdraft need." },
  financing_cost: { head: "Financing cost", def: "Interest on your own money or overdraft used to carry the work until bills are paid and held-back money is returned." },
  cash_flow_diagram: { head: "Cash flow diagram", def: "Arrows month by month: up for money received, down for money spent. Shows when the work runs on your own money." },
} satisfies Record<string, GlossEntry>;

export type GlossKey = keyof typeof GLOSSARY;

/** Glossary word for each money term's name (Payment has none). */
export const TERM_GLOSS: Partial<Record<string, GlossKey>> = {
  C2: "retention", C3: "mob_advance", C4: "ld", C5: "pv", C6: "perf",
};
