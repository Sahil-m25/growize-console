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
import type { DeliveryState } from "../contracts/outbox";
import { readableCases } from "./reach";

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

/** The ticket's one line: the worst state among its replies (anything undelivered wins over delivered). */
const RANK: Readonly<Record<DeliveryState["status"], number>> = Object.freeze({ dead: 3, retrying: 2, queued: 2, delivered: 1 });

/** A list form (M13-S05-W1): the deliveries of every Case asked for, in one read — a Case the person may not read is absent. */
export type CaseDeliveriesList =
  | { readonly ok: true; readonly cases: Readonly<Record<string, { readonly replies: readonly ReplyDelivery[]; readonly label: string | null }>> }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "invalid-request" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

function deliveriesOf(deps: Pick<CaseDeliveriesDeps, "deliveries">, id: string): { readonly replies: readonly ReplyDelivery[]; readonly label: string | null } {
  const replies = deps.deliveries(id, "case.replied").map((d): ReplyDelivery => Object.freeze({
    eventId: d.eventId, status: d.status, label: d.label, attempts: d.attempts, reason: d.lastReason, deliveredAt: d.deliveredAt,
  }));
  const worst = replies.reduce<ReplyDelivery | null>((w, d) => (!w || RANK[d.status] > RANK[w.status] ? d : w), null);
  return { replies, label: worst ? worst.label : null };
}

export function createCaseDeliveries(deps: CaseDeliveriesDeps) {
  return Object.freeze({
    /** Deliveries for up to MAX_CASE_IDS Cases at once (the register's open rows): one Cases read, no per-row GET. */
    async forCases(p: { readonly credential: UserCredential; readonly seat: string }, ids: readonly unknown[], signal?: AbortSignal): Promise<CaseDeliveriesList> {
      const seen = await readableCases(deps, p, ids, signal);
      if (!seen.ok) {
        if (seen.kind === "refused" && seen.reason === "no-book") deps.events.refusal(p.credential.userId, "case-deliveries", "seat-denied");
        return seen;
      }
      const cases: Record<string, ReturnType<typeof deliveriesOf>> = {};
      for (const id of ids as string[]) if (seen.ids.has(id)) cases[id] = deliveriesOf(deps, id);
      return { ok: true, cases };
    },

    async forCase(p: { readonly credential: UserCredential; readonly seat: string }, id: unknown, signal?: AbortSignal): Promise<CaseDeliveriesResult> {
      const me = p.credential.userId;
      const seen = await readableCases(deps, p, [id], signal);
      if (!seen.ok) {
        if (seen.kind === "refused" && seen.reason === "no-book") deps.events.refusal(me, "case-deliveries", "seat-denied");
        return seen;
      }
      if (!seen.ids.has(id as string)) { deps.events.refusal(me, "case-deliveries", "not-found", [id as string]); return { ok: false, kind: "refused", reason: "not-found" }; }
      const one = deliveriesOf(deps, id as string);
      return { ok: true, caseId: id as string, ...one };
    },
  });
}
