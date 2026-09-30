/* M05-S07-W1 / M05-S07-W2 / M05-S08-W1 — Today, Investors side: "Waiting on you" per seat (GET /api/queues/investors).
   Live: the route — { queue: { side: "money" | "am", … } } for the signed-in seat (server/queues/queue).
   Fixture: the same answer projected from the demo book's finQueue / careQueue (mineQueue picks the seat's own).
   PROVISIONAL (W2): the route has no 'send' or 'declined' row — a paper the investor declined, or one not yet sent, has
   no source (M05-S07-NOTE-2) and is not a Remind row (closed Sign requests are skipped) — so the fixture drops both
   rather than keep rows the route cannot serve. A 'send a new one' row kind is the owner's call, not this wiring's. */

import type { AmToday, MoneyQueue } from "@/server/queues/queue";
import type { CareRow, MoneyRow } from "@/server/queues/rules";
import {
  cared, isAM, lastC, may, mineQueue, overdue, pageReadable, quiet, readBook, readOnlySeat, ticketBook, tierOf, who, careQueue,
  type ImQ,
} from "@/lib/im";
import { fail, ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";

/** The money row plus the one word the route does not carry: which IR raised a claim ("from Rohit"). Live: absent. */
export type MoneyRowView = MoneyRow & { readonly from?: string | null };
export type MoneyToday = Omit<MoneyQueue, "rows"> & { readonly rows: readonly MoneyRowView[] };
export type InvestorQueue = MoneyToday | AmToday;

/** the route has two urgencies; the book's third ("ok") is never queued */
const urg = (x: ImQ): "now" | "soon" => (x.urg === "now" ? "now" : "soon");
const NO_PAGE = () => fail(403, "no-book", "This page is not part of your seat.");

function moneyRow({ s, me }: ImBook, x: ImQ): MoneyRowView | null {
  const investor = { id: x.inv.id, name: x.inv.n };
  const base = { key: `${x.kind}:${x.inv.id}`, investor, text: x.t, urg: urg(x), days: null };
  switch (x.kind) {
    case "claim": return { ...base, key: `claim:${x.n.id}`, kind: "claim", action: "Answer it", ref: { claimId: x.n.id }, from: who(s, x.n.ir).n.split(" ")[0] };
    case "hold": return { ...base, kind: "hold", days: x.days, action: "Open the record", ref: {} };
    case "verify": return { ...base, kind: "verify", action: "Verify it", ref: { paper: x.r.d ? x.r.d.id : undefined } };
    case "kyc": return { ...base, kind: "kyc", action: "Check it", ref: { recordId: x.inv.id } };
    case "fema": return { ...base, kind: "fema", action: "Open the record", ref: { recordId: x.inv.id } };
    default: return null;   /* send, declined: see the note above */
  }
}

export function careRowOf({ s, me }: ImBook, x: ImQ): CareRow | null {
  const t = tierOf(x.inv);
  const base = { key: `${x.kind}:${x.inv.id}`, investor: { id: x.inv.id, name: x.inv.n }, tier: (t ? t.k : "C") as CareRow["tier"], text: x.t, urg: urg(x), days: null };
  if (x.kind === "nokam") return { ...base, kind: "nokam", action: may(s, me, "assign") ? "Assign manager" : null };
  if (x.kind === "intro") return { ...base, kind: "intro", action: "Record the introduction" };
  if (x.kind === "due") return { ...base, kind: "due", days: x.days, action: "Log a conversation" };
  return null;
}

export const investorQueue: ReadEndpoint<ImBook, void, InvestorQueue> = {
  path: () => "/api/queues/investors",
  pick: j => (j as { queue: InvestorQueue }).queue,
  fixture(b) {
    const { s, me } = b;
    if (!pageReadable(s, me, "dash")) return NO_PAGE();
    const asOf = 0;   /* the queue is not a cached figure: nothing on the screen reads its time */
    if (isAM(s, me)) {
      const rows = careQueue(s, me).flatMap(x => careRowOf(b, x) ?? []);
      const book = readBook(s, me).filter(cared);
      const mine = ticketBook(s, me).filter(t => t.own === me && t.state !== "closed");
      return ok({
        side: "am", readOnly: false, book: who(s, me).r === "kam" ? "kam" : "head",
        rows, waiting: rows.length, today: rows.filter(r => r.urg === "now").length,
        tiles: { goneQuiet: book.filter(x => quiet(s, me, x)).length, accountsHeld: book.length, ticketsOpenOnYou: mine.length,
          conversationsLogged: s.data.CONTACT.filter(c => c.by === me).length },
        accounts: book.map(x => { const l = lastC(s, me, x.id);
          return { id: x.id, name: x.n, tier: (tierOf(x) || { k: "C" }).k as CareRow["tier"], kamUserId: x.kam ?? null, lastHeardAt: l ? l.at : null, lastMood: l ? l.mood : null, overdue: overdue(s, me, x) }; }),
        tickets: mine.map(t => ({ id: t.id, number: t.id, investorId: t.inv, subject: t.t, priority: t.pri, sla: t.sla })),
        problems: [], asOf,
      });
    }
    if (readOnlySeat(s, me)) return ok({ side: "money", readOnly: true, rows: [], waiting: 0, today: 0, problems: [], asOf });
    const rows = mineQueue(s, me).flatMap(x => moneyRow(b, x) ?? []);
    return ok({ side: "money", readOnly: false, rows, waiting: rows.length, today: rows.filter(r => r.urg === "now").length, problems: [], asOf });
  },
};
