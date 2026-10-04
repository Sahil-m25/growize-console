/**
 * M14-S02-NOTE-3 / D44 — may these people be named to work an event on these days? Two facts, neither a screen's own copy:
 * they are in on the event's days (the roster, Plane C — ./roster.ts) and they carry a book (Zoho counts on the VIEWER's
 * own token — ./carries.ts). Out is said before no-book (the more useful word: they come back). A failed read of either
 * fails closed: the save is refused with the source error rather than staffing someone unchecked.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { StaffRefusal, StaffVerdict } from "../events/writes";
import { bookCarriers } from "./carries";
import type { RosterService } from "./roster";

export async function checkStaff(
  deps: { readonly roster: Pick<RosterService, "view">; readonly crm: Pick<ZohoClient, "aggregate"> },
  cred: UserCredential, ids: readonly string[], from: string, to: string, signal?: AbortSignal,
): Promise<StaffVerdict> {
  let view: Awaited<ReturnType<RosterService["view"]>>;
  try { view = await deps.roster.view(signal); } catch { return { ok: false, errorKind: "unexpected" }; }
  const book = await bookCarriers(deps.crm, cred, ids, signal);
  if (!book.ok) return { ok: false, errorKind: book.errorKind };
  return {
    ok: true,
    refused: ids.flatMap((userId): StaffRefusal[] => {
      const backOn = view.outDuring(userId, from, to);
      if (backOn) return [{ userId, why: "out" as const, backOn }];
      return book.carriers.has(userId) ? [] : [{ userId, why: "no-book" as const, backOn: null }];
    }),
  };
}
