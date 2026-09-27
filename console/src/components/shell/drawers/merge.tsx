"use client";

/* HOW THE MERGE WORKS — merge-glue.js 155–229: panel("merge.notes") and its "try them" chips
   (mTry/mStep/mArrow). Opened from the rail foot's link (Rail.tsx). A chip signs in as that person
   and opens that page, on the side it names. */

import type { NavKey, PersonKey } from "@/domain";
import { MT, navFor, P } from "@/lib/selectors";
import { signInAdmits } from "@/lib/data/admission";
import { reducer } from "@/lib/state";
import { useConsole, useSession } from "@/lib/store";
import { Pav } from "@/components/ui";
import { useRouter } from "next/navigation";
import { announceNav, pathOf, type View } from "../routes";
import { registerDrawer } from "./registry";

function MStep({ k, page, side, t }: { k: PersonKey; page: string; side?: "im"; t: string }) {
  const { state, dispatch } = useConsole();
  const { signIn } = useSession();
  const router = useRouter();
  /* mTry(k,page,side) — merge-glue.js:163 */
  const mTry = () => {
    if (!signInAdmits({ PEOPLE: state.PEOPLE, GRANT: state.CAPS, im: state.IM }, k)) return;
    signIn(k);
    if (side) dispatch({ type: "setSide", k: page, s: side });
    const next = reducer(state, { type: "signIn", k });
    if (navFor(next).some((n) => n.k === page)) {
      dispatch({ type: "go", v: page as NavKey });
      announceNav(pathOf(page as View));
      router.push(pathOf(page as View));
    }
  };
  return (
    <a
      className="chip"
      role="button"
      tabIndex={0}
      onClick={mTry}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          mTry();
        }
      }}
      title={`Sign in as ${P(state.PEOPLE, k).n} and open ${MT[page] || page}`}
    >
      <Pav k={k} /> {t}
    </a>
  );
}

const MArrow = () => (
  <span className="sm" aria-hidden="true">
    →
  </span>
);

const pk = (k: string) => k as PersonKey;

function Body() {
  return (
    <div className="mn">
      <h3>The idea</h3>
      <p>
        One console, one sign-in, one Zoho org. This console is the base: its rail, top bar, drawer, colours and
        buttons. The Investment Management portal is now its <b>Investors</b> side — the same screens and rules,
        redrawn in this console&apos;s design. Your seat decides which pages you get; nobody gets a page their seat did
        not already hold in one of the two apps.
      </p>
      <h3>Where every Investment Management page went</h3>
      <table>
        <thead>
          <tr>
            <th>Investment Management</th>
            <th>Here</th>
            <th>How</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Dashboard</td>
            <td>Today</td>
            <td>
              One rail entry, only what is waiting on you. Finance also gets one line of links to the pages that own each
              figure.
            </td>
          </tr>
          <tr>
            <td>Transactions</td>
            <td>Payments</td>
            <td>
              Leads seats read payments on their leads; Finance records and matches. Anyone holding both sees only the
              full ledger.
            </td>
          </tr>
          <tr>
            <td>Documents</td>
            <td>Documents</td>
            <td>
              The lead side reads the register and tells the investor; the Investors side sends and verifies. Anyone
              holding both sees only the Investors page.
            </td>
          </tr>
          <tr>
            <td>Activity log</td>
            <td>Activity</td>
            <td>A person with both halves switches between Leads and Investors at the top.</td>
          </tr>
          <tr>
            <td>Team</td>
            <td>Teams</td>
            <td>One page: the member list, then &quot;Investors side seats&quot; as a section.</td>
          </tr>
          <tr>
            <td>System</td>
            <td>System</td>
            <td>Same.</td>
          </tr>
          <tr>
            <td>Insights</td>
            <td>Numbers</td>
            <td>One Numbers entry: lead numbers and Investors numbers are its two halves.</td>
          </tr>
          <tr>
            <td>Investors · Farms · Tickets · Updates</td>
            <td>Investors band in the rail</td>
            <td>
              &quot;Updates&quot; became <b>Investor updates</b>, so it is never confused with the bell. Every heading
              matches its rail name.
            </td>
          </tr>
        </tbody>
      </table>
      <h3>Who sees what</h3>
      <p>
        IR Associates and the IR Manager: the lead pages only, as before. Finance, Compliance, the Auditor and Account
        Management: the Investors pages only. <b>Sahil is the super user</b> (D68): every page and every action of
        both sides, including PAN, Aadhaar and bank reveals, so one account can test every feature. He gets a Lead
        side / Investors side switch on Today, Activity, Numbers and System.
      </p>
      <h3>Who does the work</h3>
      <p>
        Finance (Harsha Bhat) is the primary doer of money and paperwork: recording receipts, sending and verifying
        documents. Compliance (Fahad Rizvi) passes KYC; Account Management (Divya Kamath) owns care. Their queues stay
        theirs. On Sahil&apos;s Today they appear as &quot;Finance&apos;s queue · primary: Harsha Bhat&quot; and
        &quot;Account Management&apos;s queue&quot;; every panel he opens names the primary doer, and whatever he does is
        recorded as his. The wall between them — PAN, Aadhaar and bank details stay Finance&apos;s — is enforced on
        the server, not by the rail.
      </p>
      <h3>Workflows across the old wall — try them</h3>
      <p>
        <b>1 · Money.</b> The IR reports it; Finance records it; a second Finance person matches it; the lead&apos;s
        rung moves.
      </p>
      <div className="steps">
        <MStep k={pk("rohit")} page="today" t="Rohit: Today" />
        <MArrow />
        <MStep k={pk("harsha")} page="today" t="Harsha: Today — record" />
        <MArrow />
        <MStep k={pk("meena")} page="pay" t="Meena: Payments — match" />
        <MArrow />
        <MStep k={pk("rohit")} page="leads" t="Rohit: the lead" />
      </div>
      <p>
        <b>2 · Paper.</b> Finance sends; the IR tells the investor and says it came back signed; Compliance verifies.
      </p>
      <div className="steps">
        <MStep k={pk("harsha")} page="docs" t="Harsha: Documents — send" />
        <MArrow />
        <MStep k={pk("rohit")} page="docs" t="Rohit: Documents — tell" />
        <MArrow />
        <MStep k={pk("fahad")} page="docs" t="Fahad: Documents — verify" />
      </div>
      <p>
        <b>3 · After the money: care.</b> The head of Account Management assigns a KAM; the KAM logs contact and works
        tickets.
      </p>
      <div className="steps">
        <MStep k={pk("divya")} page="inv" t="Divya: Investors — assign" />
        <MArrow />
        <MStep k={pk("imran")} page="today" t="Imran: Today" />
        <MArrow />
        <MStep k={pk("imran")} page="tkt" t="Imran: Tickets" />
      </div>
      <p>
        <b>4 · Test everything from one account.</b> Sign in as Sahil: Leads to work a lead and its paperwork, Today
        (Investors) for Finance&apos;s and Account Management&apos;s queues, then Documents, Payments, Tickets, Farms
        and Investor updates.
      </p>
      <div className="steps">
        <MStep k={pk("sahil")} page="leads" t="Sahil: Leads" />
        <MArrow />
        <MStep k={pk("sahil")} page="today" side="im" t="Sahil: Finance's queue" />
        <MArrow />
        <MStep k={pk("sahil")} page="docs" t="Sahil: Documents" />
      </div>
      <p>
        <b>5 · Running it.</b> One person administers both sides.
      </p>
      <div className="steps">
        <MStep k={pk("sahil")} page="people" side="im" t="Sahil: Teams — Investors" />
        <MArrow />
        <MStep k={pk("sahil")} page="activity" side="im" t="Sahil: Activity — Investors" />
      </div>
      <h3>Buttons</h3>
      <ul>
        <li>Green is the one next step on a row. Outlined buttons and chips are everything else.</li>
        <li>A write your seat may not make is refused where you press it, and says whose it is.</li>
        <li>Detail and every multi-field write open in the drawer beside the page, never a new page.</li>
        <li>Revealing PAN, Aadhaar or a bank account asks for a reason and is logged.</li>
      </ul>
      <h3>What the Jev audit changed</h3>
      <ul>
        <li>
          Each fact has one home: unowned leads only on Leads, breaches only on Today (Updates links to them), holds
          and figures only on their own pages.
        </li>
        <li>Leads is the book (by name, with last contact); Today is where you act.</li>
        <li>
          One label per action: &quot;Open the record&quot; on both sides; &quot;Assign owner&quot; for leads and
          &quot;Assign manager&quot; for investors.
        </li>
        <li>Full audit, scores and the open questions: pm/merge-audit/REPORT.md.</li>
      </ul>
      <h3>Not merged yet in this concept</h3>
      <ul>
        <li>
          The two sides still read their own sample data, so a claim raised on the lead side does not yet appear on
          Finance&apos;s Today. In the build it is one write read by both sides.
        </li>
        <li>Two sample dates: the lead side reads 28 Aug, the Investors side 2 Sep.</li>
        <li>The Investors pages keep their own wording; a Jev pass on the six shared pages comes next.</li>
      </ul>
      <h3>The case against merging</h3>
      <ul>
        <li>
          <b>One deploy for two risk levels.</b> Every lead-side fix also ships the money screens.
        </li>
        <li>
          <b>One wall instead of two.</b> Separate apps mean a lead seat never loads the money screens at all.
        </li>
        <li>
          <b>Different release rhythms.</b> The lead side needs to ship fast now; the money side needs gated releases.
        </li>
        <li>
          <b>Rework now.</b> The Investment Management plan (56 stories, 180 Jev cases) must be remapped and re-scored.
        </li>
        <li>
          <b>A long rail</b> for Digital Infrastructure: 17 destinations and two-sided pages.
        </li>
        <li>
          <b>Audit.</b> Separation of duties is easier to show with two apps.
        </li>
        <li>One repo does not need one app: two apps can share this design and its components.</li>
      </ul>
    </div>
  );
}

registerDrawer("p:merge.notes", { w: 640, title: () => "How the merge works", Body });
