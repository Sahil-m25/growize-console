/* M06-S03-W2 / M06-S05-W2 — the top-bar search: GET /api/leads/search?q=… (server/leads/seat-search, D110).
   The scope follows the seat: an IR their own book, an IR Manager the team, Digital Infrastructure and the
   business owner org-wide over leads AND investors (each hit carries its kind), Finance/KAM/Head of AM investors
   within their scope. Live: the route, on the person's own token. Fixture: the same answer from the demo book —
   the lead half is the prototype's own find (@/lib/selectors/find), the investor half the seat's own Investors
   book (@/lib/im readBook) matched as the Investors page matches. */

import { LADDER } from "@/domain";
import type { ConsoleState } from "@/lib/state";
import { digits, lost, navFor } from "@/lib/selectors";
import { FQMAX, fqFind, fqPhoneOK, orgSearchScope } from "@/lib/selectors/find";
import { invMatch, readBook, who, type ImRoleKey } from "@/lib/im";
import type { SeatHit, SeatSearchValue } from "@/server/leads/seat-search";
import { ok, type ReadEndpoint } from "../api";

export type TopSearch = Omit<SeatSearchValue, "hits"> & { hits: SeatHit[] };
export type TopPlan = { leads: boolean; investors: boolean };

const INVESTOR_SEATS: readonly ImRoleKey[] = ["head", "ops", "comp", "amlead", "kam"];

/** What this seat's top-bar search covers (the screen's mirror of server/leads/seat-search SEARCH_PLANS, read off
 *  the seat records the book holds for the signed-in person — in live mode, the session's own, M01-S01-W1). */
export function topPlan(s: ConsoleState): TopPlan {
  const lead = s.PEOPLE[s.WHO]?.seat as string | undefined;
  const im = s.IM.P[s.WHO]?.r;
  const org = lead === "ops" || lead === "bu" || im === "di";
  const leads = org || navFor(s).some((n) => n.k === "leads");
  return { leads, investors: org || (!!im && INVESTOR_SEATS.includes(im)) };
}

export const topSearch: ReadEndpoint<ConsoleState, string, TopSearch> = {
  path: (q) => (q.trim() ? `/api/leads/search?q=${encodeURIComponent(q.trim())}` : null),
  pick: (j) => j as TopSearch,
  fixture(s, q0) {
    const q = q0.trim(), plan = topPlan(s);
    const hits: SeatHit[] = [];
    let more = 0;
    let book: TopSearch["book"] = null, investorBook: TopSearch["investorBook"] = null;
    if (plan.leads && navFor(s).some((n) => n.k === "leads")) {
      /* PROVISIONAL: the prototype matches from one letter; the route asks for two letters or three digits */
      const all = fqFind(s, q);
      book = orgSearchScope(s) ? "all" : "yours";
      more += Math.max(0, all.length - FQMAX);
      for (const x of all.slice(0, FQMAX)) {
        const l = x.l, d = fqPhoneOK(s, l) ? digits(l.ph) : "";
        hits.push({ kind: "lead", id: l.id, name: l.n, phoneLast4: d.length >= 4 ? d.slice(-4) : null,
          stage: lost(l) ? "Closed as lost" : LADDER[Math.max(0, l.done - 1)]!.t, ownerId: l.own || null, mine: x.mine });
      }
    }
    if (plan.investors && s.IM.P[s.WHO]) {
      const im = { data: s.IM };
      const r = who(im, s.WHO).r;
      investorBook = r === "di" ? "all" : r === "kam" ? "own-book" : r === "amlead" ? "subtree" : "org";
      const found = readBook(im, s.WHO).filter((x) => invMatch(im, x, q));
      more += Math.max(0, found.length - FQMAX);
      for (const x of found.slice(0, FQMAX)) {
        const d = x.ph.replace(/\D/g, "");
        hits.push({ kind: "investor", id: x.id, name: x.n, code: x.id, city: x.city || null, phoneLast4: d.length >= 4 ? d.slice(-4) : null });
      }
    }
    return ok({ book, investorBook, hits, more });
  },
};
