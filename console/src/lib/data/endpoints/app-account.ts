/* M08-S08-W1 — the investor's app account panel: GET / POST / DELETE /api/investors/[id]/unlock (server/investors/unlock).
   The card reads Contacts.App_Access (Hold | Invite) and the welcome the investor app writes back (D73, D93):
   the account opens On hold at the first MATCHED receipt — recording opens nothing — and "Send welcome and unlock" is the
   one button that sets Invite; the console mails nothing itself.
   Live: the route on Finance's own token. Fixture: the same card from the demo book's ACCESS record (the stub receiver:
   the demo's `welcomeDelivered` stands in for the investor app's write-back), and the two writes run sendWelcome / lockApp. */

import type { AppAccessCard } from "@/server/investors/unlock";
import { I, accessOf, accessView, imReducer, mayAccess, pageReadable } from "@/lib/im";
import type { ImAction, ImState } from "@/lib/im";
import { fail, ok, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imLiveError, type ImBook, type ImDispatch } from "./im";

export type AppCard = { card: AppAccessCard };
export type AppCardChanged = { card: AppAccessCard; already: boolean };

const NOT_YOURS = () => fail(404, "not-visible", "Not found, or not yours to open.");

/** The card as the route answers it, read off a demo book (`s`) for `me`. */
export function fixtureAppCard(s: ImState, me: string, id: string): AppAccessCard {
  const a = accessOf(s, me, id), v = accessView(a);
  return {
    contactId: id, code: id, access: a ? a.App_Access : null, state: v.k, text: v.t,
    welcomeAt: a?.App_Welcome_At ?? null, welcomeChannel: a?.App_Welcome_Channel ?? null,
    modifiedTime: null, history: [], mayChange: mayAccess(s, me), historyRead: true,
  };
}

export const appAccount: ReadEndpoint<ImBook, string | null, AppCard> = {
  path: id => (id ? `/api/investors/${encodeURIComponent(id)}/unlock` : null),
  pick: j => j as AppCard,
  fixture({ s, me }, id) {
    if (!pageReadable(s, me, "inv") || !I(s, me, id)) return NOT_YOURS();
    return ok({ card: fixtureAppCard(s, me, id!) });
  },
};

/** Run the action, then its confirmation (the caller has already confirmed in the page), and answer from what it left. */
function confirmed(b: ImBook, d: ImDispatch, id: string, a: ImAction, was: AppCard["card"]): ApiResult<AppCardChanged> {
  const first = imReducer({ ...b.s, ui: { ...b.s.ui, NOTE: null, PENDING: null } }, b.me, a);
  const next = imReducer(first, b.me, { type: "confirmYes" });
  if (next.ui.NOTE) return fail(422, "refused", next.ui.NOTE.msg);
  d(a); d({ type: "confirmYes" });
  const card = fixtureAppCard(next, b.me, id);
  return ok({ card, already: card.state === was.state });
}

export type UnlockArgs = { id: string; expectedModifiedTime: string | null };
export const appUnlock: WriteEndpoint<ImBook, UnlockArgs, AppCardChanged, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${encodeURIComponent(a.id)}/unlock`,
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as AppCardChanged,
  fixture: (b, d, a) => (I(b.s, b.me, a.id) ? confirmed(b, d, a.id, { type: "sendWelcome", id: a.id }, fixtureAppCard(b.s, b.me, a.id)) : NOT_YOURS()),
  onLiveError: imLiveError,
};

export type LockArgs = { id: string; reason: string; expectedModifiedTime: string | null };
export const appLock: WriteEndpoint<ImBook, LockArgs, AppCardChanged, ImDispatch> = {
  method: "DELETE",
  path: a => `/api/investors/${encodeURIComponent(a.id)}/unlock`,
  body: a => ({ reason: a.reason, expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as AppCardChanged,
  fixture: (b, d, a) => (I(b.s, b.me, a.id) ? confirmed(b, d, a.id, { type: "lockApp", id: a.id, why: a.reason }, fixtureAppCard(b.s, b.me, a.id)) : NOT_YOURS()),
  onLiveError: imLiveError,
};
