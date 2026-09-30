/* M05-S06-W1 / M05-S08-W1 — Today, Investors side: the four headline figures (GET /api/numbers/investors-today).
   Live: the route (banked, outstanding, units, tickets — each with when it was read; server/numbers/investors-today).
   Fixture: the same InvestorsToday projected from the demo book with the existing @/lib/im selectors. */

import type { InvestorsToday } from "@/server/numbers/investors-today";
import { allocated, banked, isAM, nowFull, pageReadable, released, reserved, tkOpen, UNIT, type ImState } from "@/lib/im";
import { fail, ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";

const NO_PAGE = () => fail(403, "no-book", "This page is not part of your seat.");
/** Balance outstanding as the route counts it (D21): over Reserved allotments, units × price less what is MATCHED — a receipt
 *  recorded and not yet matched does not move it. (The book's own outstandingReserved counts every recorded receipt.) */
export const outstandingMatched = (s: ImState): number =>
  s.data.INV.filter(x => x.st === "reserved").reduce((a, x) => {
    const got = s.data.TXN.filter(t => t.inv === x.id && t.rec === "matched" && t.kind !== "forfeit").reduce((n, t) => n + (t.kind === "refund" ? -t.amt : t.amt), 0);
    return a + Math.max(0, x.units * UNIT - got);
  }, 0);

const IST_MS = 5.5 * 3_600_000;

export const investorsToday: ReadEndpoint<ImBook, void, InvestorsToday> = {
  path: () => "/api/numbers/investors-today",
  pick: j => j as InvestorsToday,
  fixture({ s, me }) {
    if (!pageReadable(s, me, "dash") || isAM(s, me)) return NO_PAGE();
    /* the demo clock is a naive local time; the route's asOf is a real instant — shift so IST reads the same */
    const asOf = nowFull(s.data.NOW) - IST_MS;
    const tk = tkOpen(s, me);
    return ok({
      money: { state: "fresh", asOf, value: { banked: banked(s), outstanding: outstandingMatched(s),
        reservedAllotments: s.data.INV.filter(x => x.st === "reserved").length } },
      units: { state: "fresh", asOf, value: { held: allocated(s) + reserved(s), reserved: reserved(s), allotted: allocated(s), released: released(s),
        total: released(s) /* not read by the screen */ } },
      tickets: pageReadable(s, me, "tkt") ? { state: "fresh", asOf, value: { open: tk.length, high: tk.filter(t => t.pri === "high").length } } : { state: "hidden" },
      asOf, stale: false,
    });
  },
};
