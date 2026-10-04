/**
 * M12-S11-NOTE-3 — FINANCE'S PAPERWORK QUEUE, in the order Finance should work it (D72, D53).
 *
 * The papers out for signature (the Documents read, cut "out") plus the IR's word on each ("they say it's signed",
 * server/leads/hints.ts), ordered by `rankForFinance`: papers the IR says are back first (newest word first), then
 * age (oldest sent first). One read on the VIEWER'S OWN token (Finance's seat; nothing cached, nothing written).
 * An allotment paper finds its lead through its Contact (Origin_Lead); a FEMA declaration or an allocation letter
 * can never carry a hint (hints.ts matches by paper), so only a supplementary paper pays for the extra reads.
 *
 * A hint read that fails is said, not guessed: the rows come back in age order with `irSideRead: false` and a note.
 * A seat that does not verify papers (an IR, KAM, a viewer, the Auditor) is refused: this is Finance's queue.
 * Logs hold ids and codes only (rule 7).
 */

import type { UserCredential } from "../../lib/zoho/client";
import { rankForFinance } from "../../lib/selectors/finance-rank";
import type { DocRow, DocumentsList } from "./list";
import type { Hint, HintReader } from "../leads/hints";

export interface QueueRow extends DocRow {
  /** the lead the paper belongs to (an allotment paper: the lead its Contact came from), or null */
  readonly leadId: string | null;
  readonly hint: Hint | null;
}
export interface PaperworkQueue {
  readonly rows: readonly QueueRow[];
  readonly outCount: number;
  /** false = the IR's side could not be read; rows are in age order */
  readonly irSideRead: boolean;
  readonly note: string | null;
}
export type QueueResult =
  | { readonly ok: true; readonly queue: PaperworkQueue }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "seat-denied" | "invalid-request" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export interface QueueDeps {
  readonly documents: Pick<DocumentsList, "read">;
  readonly hints: Pick<HintReader, "byLeads" | "leadsForContacts">;
}

export function createPaperworkQueue(deps: QueueDeps) {
  return Object.freeze({
    async read(cred: UserCredential, seat: string, signal?: AbortSignal): Promise<QueueResult> {
      const r = await deps.documents.read(cred, seat, "out", signal);
      if (!r.ok) return r.kind === "refused" ? r : { ok: false, kind: "source-error", errorKind: r.errorKind };
      const page = r.page;
      if (page.side !== "investors" || !page.actions.verify) return { ok: false, kind: "refused", reason: "seat-denied" };

      // Only the supplementary paper can carry an IR hint: resolve those rows' leads and read their hints.
      const supp = page.rows.filter((x) => x.paper === "supplementary" && x.contactId);
      let leadOf = new Map<string, string>();
      let hints: Awaited<ReturnType<typeof deps.hints.byLeads>> = { ok: true, hints: new Map() };
      if (supp.length) {
        const l = await deps.hints.leadsForContacts(cred, supp.map((x) => x.contactId as string), signal);
        if (l.ok) {
          leadOf = new Map(l.leads);
          hints = await deps.hints.byLeads(cred, [...new Set(l.leads.values())], signal);
        } else hints = { ok: false, errorKind: "unexpected" };
      }
      const items = page.rows.map((x) => ({ ...x, leadId: x.paper === "supplementary" && x.contactId ? leadOf.get(x.contactId) ?? null : null, sentAt: x.sign ? x.sign.sentAt : null }));
      const ranked = rankForFinance(items, hints);
      const rows: QueueRow[] = ranked.items.map(({ sentAt: _s, ...row }) => Object.freeze(row as QueueRow));
      return { ok: true, queue: Object.freeze({ rows: Object.freeze(rows), outCount: page.outCount, irSideRead: ranked.irSideRead, note: ranked.note }) };
    },
  });
}
export type PaperworkQueueReader = ReturnType<typeof createPaperworkQueue>;
