/**
 * M13-S05-W1 — THE TICKET THREAD: the Notes on a Case, oldest first (D45, D53). A reply the person sent through
 * POST /reply is a Note titled "Reply to the investor" (kind "reply"); any other Note on the Case is an internal
 * note (kind "note"). Read on the person's own token through the Case's Notes related list; the same reach as the
 * register (./reach). Nothing is stored here; the text is returned for this one response and never logged.
 *
 * An identity-shaped value in a note (PAN, Aadhaar, account number — the console's own SECRETS shapes) is masked
 * before it leaves (rule 7): the thread is read by seats that hold no identity.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { SECRETS } from "../../lib/im/constants";
import type { InvestorEvents } from "../data/events";
import { idOf, istStamp, nameOf, RECORD_ID, str } from "./predicate";
import { readableCases, type ReachDeps } from "./reach";

export const REPLY_TITLE = "Reply to the investor";
export const NOTE_FIELDS = Object.freeze(["Note_Title", "Note_Content", "Created_Time", "Created_By"]);
const MASK = "••••••";

export interface CaseMessage {
  readonly id: string;
  readonly kind: "reply" | "note";
  readonly text: string;
  /** naive IST "YYYY-MM-DDTHH:mm" (rule 9) */
  readonly at: string;
  readonly by: { readonly id: string; readonly name: string | null } | null;
}

export interface CaseMessagesDeps extends ReachDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRelated">;
  readonly events: InvestorEvents;
}

export type CaseMessagesResult =
  | { readonly ok: true; readonly caseId: string; readonly messages: readonly CaseMessage[]; readonly truncated: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "not-found" | "invalid-request" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";
/** A note's text with every identity-shaped value masked. Pure: exported for tests. */
export const maskIdentity = (t: string): string => SECRETS.reduce((out, re) => out.replace(re, MASK), t);

export function createCaseMessages(deps: CaseMessagesDeps) {
  return Object.freeze({
    async forCase(p: { readonly credential: UserCredential; readonly seat: string }, id: unknown, signal?: AbortSignal): Promise<CaseMessagesResult> {
      const me = p.credential.userId;
      const seen = await readableCases(deps, p, [id], signal);
      if (!seen.ok) {
        if (seen.kind === "refused" && seen.reason === "no-book") deps.events.refusal(me, "case-messages", "seat-denied");
        return seen;
      }
      if (!seen.ids.has(id as string)) { deps.events.refusal(me, "case-messages", "not-found", [id as string]); return { ok: false, kind: "refused", reason: "not-found" }; }
      let r;
      try { r = await deps.crm.getRelated(p.credential, "Cases", id as string, "Notes", { fields: [...NOTE_FIELDS], perPage: 200, signal }); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: false }; }
      if (!r.ok) return { ok: false, kind: "source-error", errorKind: r.error.kind, retryable: retryable(r.error.kind) };
      if (r.value.invalidRecordIds) return { ok: false, kind: "refused", reason: "source-invalid" };
      const rows: CaseMessage[] = [];
      for (const n of r.value.records) {
        const nid = idOf(n.id), text = str(n, "Note_Content", 4000), at = istStamp(str(n, "Created_Time", 40));
        if (!nid || !RECORD_ID.test(nid) || !text || !at) continue;
        const by = idOf(n.Created_By);
        rows.push(Object.freeze({
          id: nid, kind: str(n, "Note_Title", 120) === REPLY_TITLE ? "reply" as const : "note" as const,
          text: maskIdentity(text), at, by: by ? Object.freeze({ id: by, name: nameOf(n.Created_By) }) : null,
        }));
      }
      rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
      return { ok: true, caseId: id as string, messages: Object.freeze(rows), truncated: r.value.moreRecords };
    },
  });
}
export type CaseMessages = ReturnType<typeof createCaseMessages>;
