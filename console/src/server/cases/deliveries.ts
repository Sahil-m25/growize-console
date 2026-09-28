/**
 * M13-S05-T03 — "is my reply delivered?" for one ticket: the case.replied delivery states the investor-app
 * outbox holds for that Case (ids, status, label, attempts, a short reason; never the reply text).
 *
 * The same reach as the register: the Case is read on the person's own token (D53) and a KAM (own-book)
 * sees only a Case they own, a Head of AM their subtree. "Delivered" appears only after the app answered
 * push.delivered for that event; anything else reads "Not delivered yet" or "Not delivered — needs attention".
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { scopesFor } from "../data/scope";
import type { DeliveryState } from "../contracts/outbox";
import { idOf, RECORD_ID } from "./predicate";
import { CASES_MODULE } from "./register";

export interface ReplyDelivery {
  readonly eventId: string;
  readonly status: DeliveryState["status"];
  readonly label: string;
  readonly attempts: number;
  readonly reason: string | null;
  readonly deliveredAt: number | null;
}

export interface CaseDeliveriesDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly events: InvestorEvents;
  /** server/contracts/runtime investorAppDeliveries. */
  readonly deliveries: (recordId: string, type: string) => readonly DeliveryState[];
  readonly subtreeOf?: (managerId: string, signal?: AbortSignal) => Promise<readonly string[] | null>;
}

export type CaseDeliveriesResult =
  | { readonly ok: true; readonly caseId: string; readonly replies: readonly ReplyDelivery[]; readonly label: string | null }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "not-found" | "invalid-request" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";
/** The ticket's one line: the worst state among its replies (anything undelivered wins over delivered). */
const RANK: Readonly<Record<DeliveryState["status"], number>> = Object.freeze({ dead: 3, retrying: 2, queued: 2, delivered: 1 });

export function createCaseDeliveries(deps: CaseDeliveriesDeps) {
  return Object.freeze({
    async forCase(p: { readonly credential: UserCredential; readonly seat: string }, id: unknown, signal?: AbortSignal): Promise<CaseDeliveriesResult> {
      const me = p.credential.userId;
      if (typeof id !== "string" || !RECORD_ID.test(id)) return { ok: false, kind: "refused", reason: "invalid-request" };
      const scope = scopesFor(p.seat, me).cases;
      if (scope.kind === "none") { deps.events.refusal(me, "case-deliveries", "seat-denied"); return { ok: false, kind: "refused", reason: "no-book" }; }
      let r;
      try { r = await deps.crm.coql(p.credential, `select id, Owner from ${CASES_MODULE} where id = '${id}' limit 0, 1`, { signal }); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: false }; }
      if (!r.ok) return { ok: false, kind: "source-error", errorKind: r.error.kind, retryable: retryable(r.error.kind) };
      const rec = r.value.records[0];
      const owner = rec ? idOf(rec.Owner) : null;
      let mine = !!rec && rec.id === id;
      if (mine && scope.kind === "own-book") mine = owner === me;
      if (mine && scope.kind === "subtree" && deps.subtreeOf) {
        const team = await deps.subtreeOf(scope.managerId, signal);
        if (team) mine = !!owner && [scope.managerId, ...team].includes(owner);
      }
      if (!mine) { deps.events.refusal(me, "case-deliveries", "not-found", [id]); return { ok: false, kind: "refused", reason: "not-found" }; }
      const replies = deps.deliveries(id, "case.replied").map((d): ReplyDelivery => Object.freeze({
        eventId: d.eventId, status: d.status, label: d.label, attempts: d.attempts, reason: d.lastReason, deliveredAt: d.deliveredAt,
      }));
      const worst = replies.reduce<ReplyDelivery | null>((w, d) => (!w || RANK[d.status] > RANK[w.status] ? d : w), null);
      return { ok: true, caseId: id, replies, label: worst ? worst.label : null };
    },
  });
}
