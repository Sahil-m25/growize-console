/**
 * D121 A — the KAM share's state for the investor drawer ("Shared with KAM ✓ / pending / failed — retry"), and Retry.
 *
 * Both run on the signed-in person's own token first (rule 2): the Contact must be visible to them (GET Contacts/{id},
 * id and KAM only), so the state of a record they cannot see is never answered. Retry also needs kam-assign's authority
 * (the Investors-side "assign" right, re-derived from the live session); it then queues the share service again with the
 * KAM the Contact names now — the share itself is the service's, never this person's token. Answers carry a state code
 * and a time, never a value.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import type { KamShareQueue, KamShareState, KamShareStatus } from "./kam-share-queue";

const RECORD_ID = /^\d{15,22}$/;
const idOf = (v: unknown): string | null => {
  const x = v && typeof v === "object" ? (v as { id?: unknown }).id : v;
  return typeof x === "string" && RECORD_ID.test(x) ? x : null;
};

export interface KamShareStatusDeps {
  readonly crm: Pick<ZohoClient, "getRecord">;
  readonly queue: Pick<KamShareQueue, "status" | "task" | "run">;
  readonly events: Pick<InvestorEvents, "refusal">;
  readonly authority: { mayAssign(credential: UserCredential, sessionId: string): Promise<string | null> };
  readonly shouldStop?: () => boolean;
}

export type StatusAnswer =
  | { readonly ok: true; readonly value: KamShareStatus }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "invalid-request" | "not-visible" | "seat-denied" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

type Seen = { ok: true; kam: string | null } | Exclude<StatusAnswer, { ok: true }>;

async function visible(d: KamShareStatusDeps, as: UserCredential, contactId: string): Promise<Seen> {
  let got: Awaited<ReturnType<typeof d.crm.getRecord>>;
  try { got = await d.crm.getRecord(as, "Contacts", contactId, { fields: ["id", "KAM"] }); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected" }; }
  if (!got.ok) {
    if (got.error.kind === "not-found" || got.error.kind === "forbidden") return { ok: false, kind: "refused", reason: "not-visible" };
    return { ok: false, kind: "source-error", errorKind: got.error.kind };
  }
  if (!got.value || got.value.id !== contactId) return { ok: false, kind: "refused", reason: "not-visible" };
  return { ok: true, kam: idOf(got.value.KAM) };
}

export function createKamShareStatus(d: KamShareStatusDeps) {
  return Object.freeze({
    async status(as: UserCredential, contactId: string): Promise<StatusAnswer> {
      if (!RECORD_ID.test(contactId)) return { ok: false, kind: "refused", reason: "invalid-request" };
      const v = await visible(d, as, contactId);
      if (!v.ok) {
        if (v.kind === "refused") d.events.refusal(as.userId, "kam-share-status", v.reason, [contactId]);
        return v;
      }
      try { return { ok: true, value: await d.queue.status(contactId) }; } catch { return { ok: false, kind: "source-error", errorKind: "state-unavailable" }; }
    },

    async retry(as: UserCredential, sessionId: string, contactId: string): Promise<StatusAnswer> {
      if (!RECORD_ID.test(contactId)) return { ok: false, kind: "refused", reason: "invalid-request" };
      let seat: string | null;
      try { seat = await d.authority.mayAssign(as, sessionId); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected" }; }
      if (!seat) { d.events.refusal(as.userId, "kam-share-retry", "seat-denied", [contactId]); return { ok: false, kind: "refused", reason: "seat-denied" }; }
      const v = await visible(d, as, contactId);
      if (!v.ok) {
        if (v.kind === "refused") d.events.refusal(as.userId, "kam-share-retry", v.reason, [contactId]);
        return v;
      }
      let stored: Awaited<ReturnType<typeof d.queue.task>>;
      try { stored = await d.queue.task(contactId); } catch { return { ok: false, kind: "source-error", errorKind: "state-unavailable" }; }
      // The KAM the Contact names now gets the share; whoever the last task named and no longer holds it loses theirs.
      const fromKam = stored ? (stored.toKam && stored.toKam !== v.kam ? stored.toKam : stored.fromKam !== v.kam ? stored.fromKam : null) : null;
      if (!v.kam && !fromKam) return { ok: true, value: { state: "none", lastTriedAt: null } };
      const state: KamShareState = await d.queue.run({ contactId, toKam: v.kam, fromKam }, { shouldStop: d.shouldStop });
      return { ok: true, value: await d.queue.status(contactId).catch(() => ({ state, lastTriedAt: null })) };
    },
  });
}
