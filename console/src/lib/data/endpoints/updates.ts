/* M13-S06-W1 — Investor updates: GET /api/updates and POST /api/updates (server/updates/publish).
   Live: the routes, on the person's own token — the audience is resolved as COQL at publish and the count stored.
   Fixture: the same rows projected from the demo book (UPD), and a publish runs the reducer's `publish`. */

import type { UpdateKind, UpdateRow } from "@/server/updates/publish";
import { imReducer, may, pageReadable, ROLE, who, type ImAction, type ImUpdate } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

export type UpdateList = { rows: UpdateRow[]; truncated: boolean; readOnly: boolean; kinds: UpdateKind[] };
export type Published = { row: UpdateRow; count: number };

const ALL_KINDS: UpdateKind[] = ["Produce", "Statement", "Compliance", "Notice"];
const NO_PAGE = () => fail(403, "no-book", "This page is not part of your seat.");

/** What a seat may publish: Finance and Digital Infrastructure all four; the rest not Statement or Compliance (server kindsFor). */
export function fixtureKinds(b: ImBook): UpdateKind[] {
  if (!may(b.s, b.me, "upd")) return [];
  const tm = (ROLE[who(b.s, b.me).r] || { tm: "" }).tm;
  return tm === "fin" || tm === "di" ? ALL_KINDS : ALL_KINDS.filter(k => k !== "Statement" && k !== "Compliance");
}

/** One demo update as the route's UpdateRow. The route cannot store an NRI audience (422), so the demo's NRI updates
 *  read as an audience "this console cannot read" by `to`, and keep their own words in `toText`. */
export function fixtureUpdateRow(b: ImBook, u: ImUpdate): UpdateRow {
  const to = u.to === "all" ? "all" : u.to === "allocated" ? "allotted" : "unknown";
  return {
    id: u.id, t: u.t, kind: u.cat, on: u.on, by: u.by, byName: who(b.s, u.by).n, to,
    toText: u.to === "all" ? "everyone on the book" : u.to === "allocated" ? "allotted investors only" : "NRI investors only",
    llp: null, n: u.n, delivered: null, d: u.d,
  };
}

export const updateList: ReadEndpoint<ImBook, void, UpdateList> = {
  path: () => "/api/updates",
  pick: j => j as UpdateList,
  fixture(b) {
    if (!pageReadable(b.s, b.me, "upd")) return NO_PAGE();
    return ok({ rows: b.s.data.UPD.map(u => fixtureUpdateRow(b, u)), truncated: false, readOnly: !may(b.s, b.me, "upd"), kinds: fixtureKinds(b) });
  },
};

export type PublishArgs = { headline: string; kind: string; audience: "all" | "allotted" | "farm" | "nri"; llpId?: string | null; body: string };
export const updatePublish: WriteEndpoint<ImBook, PublishArgs, Published, ImDispatch> = {
  method: "POST",
  path: () => "/api/updates",
  body: a => ({ headline: a.headline, kind: a.kind, audience: a.audience, llpId: a.llpId ?? undefined, body: a.body }),
  pick: j => { const r = j as { row: UpdateRow; count: number }; return { row: r.row, count: r.count }; },
  fixture(b, d, a) {
    if (!may(b.s, b.me, "upd")) return fail(403, "read-only", "This seat reads updates; it does not publish them.");
    if (!a.headline.trim()) return fail(400, "invalid-request", "An update needs a headline.");
    if (!fixtureKinds(b).includes(a.kind as UpdateKind)) return fail(403, "kind-not-yours", "That kind of update is Finance's to publish.");
    const to = a.audience === "allotted" ? "allocated" : a.audience === "nri" ? "nri" : "all";
    const act: ImAction = { type: "publish", t: a.headline, cat: a.kind, d: a.body, to };
    const next = imReducer({ ...b.s, ui: { ...b.s.ui, NOTE: null, PENDING: null } }, b.me, act).data.UPD[0];
    if (!next) return fail(422, "refused", "Nothing was published.");
    return imFixtureWrite(b, d, act, { row: fixtureUpdateRow(b, next), count: next.n });
  },
  onLiveError: imLiveError,
};

/** The chips' audience (the prototype's "allocated") as the route names it. */
export const audienceOf = (to: string): PublishArgs["audience"] => (to === "allocated" ? "allotted" : to === "nri" ? "nri" : "all");
