/* M10-S02-W1 — "Match it": POST /api/receipts/[id]/match { expectedModifiedTime } (server/money/match).
   Live: the route (Head of Finance / super user, never the recorder; 409 when the row changed).
   Fixture: the reducer's matchReceipt, which applies the same second-hand rule to the demo book. */

import type { MatchView } from "@/server/money/match";
import type { WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

export type MatchArgs = { id: string; expectedModifiedTime: string | null };
export type Matched = Pick<MatchView, "receiptId" | "state">;

export const receiptMatch: WriteEndpoint<ImBook, MatchArgs, Matched, ImDispatch> = {
  method: "POST",
  path: a => `/api/receipts/${encodeURIComponent(a.id)}/match`,
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => (j as { match: MatchView }).match,
  fixture: (b, d, a) => imFixtureWrite(b, d, { type: "matchReceipt", tid: a.id }, { receiptId: a.id, state: "matched" as const }),
  onLiveError: imLiveError,
};
