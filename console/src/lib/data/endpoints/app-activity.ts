/* GC-1525 — App activity: GET /api/investors/app-activity?ids=… (server/investors/app-activity).
   One endpoint serves the card on the record (one id) and the list badge (the ids on screen, at most 200).
   Live: the Contacts' sign-in facts the investor app wrote back, on the person's own token. Fixture: the demo book has
   App_Access / App_Welcome_* only, so an invited account reads "never signed in" and the sign-in fields are empty. */

import { I, irMayOpen, when } from "@/lib/im";
import type { AppActivity, AppActivityAnswer } from "@/lib/im/app-activity";
import { ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";

export const MAX_ACTIVITY_IDS = 200;

/** the demo's "02 Sep 14:20" (IST wall time kept as UTC ms) as a Zoho datetime */
const zdt = (now: string, at: string | null): string | null => {
  const t = at ? when(now, at) : null;
  return t == null ? null : new Date(t).toISOString().slice(0, 19) + "+05:30";
};

export const appActivity: ReadEndpoint<ImBook, readonly string[] | null, AppActivityAnswer> = {
  path: ids => (ids && ids.length ? `/api/investors/app-activity?ids=${ids.slice(0, MAX_ACTIVITY_IDS).map(encodeURIComponent).join(",")}` : null),
  pick: j => ({ rows: Array.isArray((j as AppActivityAnswer).rows) ? (j as AppActivityAnswer).rows : [], activityUnavailable: (j as AppActivityAnswer).activityUnavailable === true }),
  fixture({ s, me }, ids) {
    const rows: AppActivity[] = [];
    for (const id of ids ?? []) {
      if (!I(s, me, id) && !irMayOpen(s, me, id)) continue;
      const a = (s.data.ACCESS || {})[id] ?? null;
      rows.push({
        contactId: id, access: a ? a.App_Access : null, welcomeAt: a ? zdt(s.data.NOW, a.App_Welcome_At) : null, welcomeChannel: a ? a.App_Welcome_Channel : null,
        firstSignInAt: null, lastSignInAt: null, signInCount: null, lastFailedAt: null, failedCount: null,
      });
    }
    return ok({ rows, activityUnavailable: false });
  },
};
