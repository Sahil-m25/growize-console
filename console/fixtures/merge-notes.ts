/* HOW THE MERGE WORKS — merge-glue.js 155–229: panel("merge.notes") and its "try them" chips
   (mTry/mStep/mArrow), as DATA. It is prototype documentation about the demo people, so it travels
   with the demo book (Dataset.MERGENOTES, filled by ./book/index.ts) and is rendered by the generic
   drawer in src/components/shell/drawers/merge.tsx — no demo name is ever bundled into the client. */

import type { PersonKey } from "@/domain";
import type { NoteBlock, NoteRun, NoteStep } from "@/lib/data/types";

const r = (t: string): NoteRun => ({ t });
const b = (t: string): NoteRun => ({ t, b: true });
const h = (t: string): NoteBlock => ({ kind: "h", t });
const p = (...runs: NoteRun[]): NoteBlock => ({ kind: "p", runs });
const ul = (...items: (string | NoteRun[])[]): NoteBlock => ({
  kind: "ul",
  items: items.map((i) => (typeof i === "string" ? [r(i)] : i)),
});
const s = (k: string, page: string, t: string, side?: "im"): NoteStep => ({ k: k as PersonKey, page, t, ...(side ? { side } : {}) });
const steps = (...st: NoteStep[]): NoteBlock => ({ kind: "steps", steps: st });
const row = (...cells: (string | NoteRun[])[]): NoteRun[][] => cells.map((c) => (typeof c === "string" ? [r(c)] : c));

export const MERGENOTES: NoteBlock[] = [
  h("The idea"),
  p(
    r("One console, one sign-in, one Zoho org. This console is the base: its rail, top bar, drawer, colours and buttons. The Investment Management portal is now its "),
    b("Investors"),
    r(" side — the same screens and rules, redrawn in this console's design. Your seat decides which pages you get; nobody gets a page their seat did not already hold in one of the two apps."),
  ),
  h("Where every Investment Management page went"),
  {
    kind: "table",
    head: ["Investment Management", "Here", "How"],
    rows: [
      row("Dashboard", "Today", "One rail entry, only what is waiting on you. Finance also gets one line of links to the pages that own each figure."),
      row("Transactions", "Payments", "Leads seats read payments on their leads; Finance records and matches. Anyone holding both sees only the full ledger."),
      row("Documents", "Documents", "The lead side reads the register and tells the investor; the Investors side sends and verifies. Anyone holding both sees only the Investors page."),
      row("Activity log", "Activity", "A person with both halves switches between Leads and Investors at the top."),
      row("Team", "Teams", "One page: the member list, then \"Investors side seats\" as a section."),
      row("System", "System", "Same."),
      row("Insights", "Numbers", "One Numbers entry: lead numbers and Investors numbers are its two halves."),
      row("Investors · Farms · Tickets · Updates", "Investors band in the rail", [
        r("\"Updates\" became "),
        b("Investor updates"),
        r(", so it is never confused with the bell. Every heading matches its rail name."),
      ]),
    ],
  },
  h("Who sees what"),
  p(
    r("IR Associates and the IR Manager: the lead pages only, as before. Finance, Compliance, the Auditor and Account Management: the Investors pages only. "),
    b("Sahil is the super user"),
    r(" (D68): every page and every action of both sides, including PAN, Aadhaar and bank reveals, so one account can test every feature. He gets a Lead side / Investors side switch on Today, Activity, Numbers and System."),
  ),
  h("Who does the work"),
  p(
    r("Finance (Harsha Bhat) is the primary doer of money and paperwork: recording receipts, sending and verifying documents. Compliance (Fahad Rizvi) passes KYC; Account Management (Divya Kamath) owns care. Their queues stay theirs. On Sahil's Today they appear as \"Finance's queue · primary: Harsha Bhat\" and \"Account Management's queue\"; every panel he opens names the primary doer, and whatever he does is recorded as his. The wall between them — PAN, Aadhaar and bank details stay Finance's — is enforced on the server, not by the rail."),
  ),
  h("Workflows across the old wall — try them"),
  p(b("1 · Money."), r(" The IR reports it; Finance records it; a second Finance person matches it; the lead's rung moves.")),
  steps(
    s("rohit", "today", "Rohit: Today"),
    s("harsha", "today", "Harsha: Today — record"),
    s("meena", "pay", "Meena: Payments — match"),
    s("rohit", "leads", "Rohit: the lead"),
  ),
  p(b("2 · Paper."), r(" Finance sends; the IR tells the investor and says it came back signed; Compliance verifies.")),
  steps(
    s("harsha", "docs", "Harsha: Documents — send"),
    s("rohit", "docs", "Rohit: Documents — tell"),
    s("fahad", "docs", "Fahad: Documents — verify"),
  ),
  p(b("3 · After the money: care."), r(" The head of Account Management assigns a KAM; the KAM logs contact and works tickets.")),
  steps(
    s("divya", "inv", "Divya: Investors — assign"),
    s("imran", "today", "Imran: Today"),
    s("imran", "tkt", "Imran: Tickets"),
  ),
  p(
    b("4 · Test everything from one account."),
    r(" Sign in as Sahil: Leads to work a lead and its paperwork, Today (Investors) for Finance's and Account Management's queues, then Documents, Payments, Tickets, Farms and Investor updates."),
  ),
  steps(
    s("sahil", "leads", "Sahil: Leads"),
    s("sahil", "today", "Sahil: Finance's queue", "im"),
    s("sahil", "docs", "Sahil: Documents"),
  ),
  p(b("5 · Running it."), r(" One person administers both sides.")),
  steps(
    s("sahil", "people", "Sahil: Teams — Investors", "im"),
    s("sahil", "activity", "Sahil: Activity — Investors", "im"),
  ),
  h("Buttons"),
  ul(
    "Green is the one next step on a row. Outlined buttons and chips are everything else.",
    "A write your seat may not make is refused where you press it, and says whose it is.",
    "Detail and every multi-field write open in the drawer beside the page, never a new page.",
    "Revealing PAN, Aadhaar or a bank account asks for a reason and is logged.",
  ),
  h("What the Jev audit changed"),
  ul(
    "Each fact has one home: unowned leads only on Leads, breaches only on Today (Updates links to them), holds and figures only on their own pages.",
    "Leads is the book (by name, with last contact); Today is where you act.",
    "One label per action: \"Open the record\" on both sides; \"Assign owner\" for leads and \"Assign manager\" for investors.",
    "Full audit, scores and the open questions: pm/merge-audit/REPORT.md.",
  ),
  h("Not merged yet in this concept"),
  ul(
    "The two sides still read their own sample data, so a claim raised on the lead side does not yet appear on Finance's Today. In the build it is one write read by both sides.",
    "Two sample dates: the lead side reads 28 Aug, the Investors side 2 Sep.",
    "The Investors pages keep their own wording; a Jev pass on the six shared pages comes next.",
  ),
  h("The case against merging"),
  ul(
    [b("One deploy for two risk levels."), r(" Every lead-side fix also ships the money screens.")],
    [b("One wall instead of two."), r(" Separate apps mean a lead seat never loads the money screens at all.")],
    [b("Different release rhythms."), r(" The lead side needs to ship fast now; the money side needs gated releases.")],
    [b("Rework now."), r(" The Investment Management plan (56 stories, 180 Jev cases) must be remapped and re-scored.")],
    [b("A long rail"), r(" for Digital Infrastructure: 17 destinations and two-sided pages.")],
    [b("Audit."), r(" Separation of duties is easier to show with two apps.")],
    "One repo does not need one app: two apps can share this design and its components.",
  ),
];
