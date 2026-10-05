/**
 * MOVE A WHOLE BOOK (R5, owner ask 5 Oct 2026): "Move all of <KAM>'s investors to <other KAM>" — a KAM leaves, or the
 * Head of Account Management rebalances.
 *
 * Nothing new is decided here. Each Contact goes through `kam-assign` (the same PUT, the same live "assign" right, the
 * same Key-Account-Manager-only assignee, the same Issued-allotment rule, the same If-Unmodified-Since guard — the
 * Modified_Time read a moment ago), so the Plane C kam-move line per Contact is kam-assign's own. The book is read on the
 * person's OWN token (D53: they move what they can see; a Contact they cannot read is not in the list). 4 at a time, and
 * no move starts inside the request deadline's stop margin (like seat-change.ts, M18-S09-NOTE-3): what is left comes
 * back as `continueFrom` (the first Contact id not tried; the book is read in id order) and the page sends the same ask
 * again with it. A moved Contact no longer carries the old KAM, so a re-read excludes it; one that could not be moved
 * stays in the book and is not retried inside the request (it is reported, with a count per reason).
 * D122: no share step here; Zoho-native sharing (workflow on Contacts.KAM) grants the new KAM access. The Teams "move their accounts, then change the seat" flow posts here too.
 * Ids and codes only — never a name (CLAUDE.md rule 7).
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { DEFAULT_STOP_MARGIN_MS, pastStopMargin, runBounded } from "../../lib/zoho/deadline";
import type { InvestorEvents } from "../data/events";
import type { ZohoUserDirectory } from "../identity/users";
import { KAM_ASSIGNEE_SEATS, type KamAssignment, type KamAssignPrincipal } from "./kam-assign";

export const BOOK_PAGE = 200;
export const BOOK_MAX = 2_000;
const RECORD_ID = /^\d{15,22}$/;
const ACTION = "kam-move-book";

export interface MoveBookCommand {
  readonly fromKamUserId: string;
  readonly toKamUserId: string;
  /** the first Contact id not tried by the previous request, or null for the first request */
  readonly continueFrom: string | null;
}

export type MoveBookRefusal = "invalid-request" | "seat-denied" | "assignee-not-am" | "same-kam";

export interface BookMoved {
  /** Contact ids now with the new KAM */
  readonly moved: readonly string[];
  /** Contact ids left where they were (changed meanwhile, not allotted, not visible …) */
  readonly notMoved: readonly string[];
  /** why, as a count per code (kam-assign's refusal codes, "conflict", "source-error") */
  readonly reasons: Readonly<Record<string, number>>;
  /** the first Contact not tried inside the request deadline; ask again with it. null = done. */
  readonly continueFrom: string | null;
}

export type MoveBookResult =
  | { readonly ok: true; readonly value: BookMoved }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: MoveBookRefusal }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export interface MoveBookDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly assignment: Pick<KamAssignment, "assign">;
  readonly users: Pick<ZohoUserDirectory, "lookup">;
  readonly events: Pick<InvestorEvents, "refusal">;
  readonly authority: { mayAssign(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<string | null> };
  readonly concurrency?: number;
  readonly stopMarginMs?: number;
}

/** The request as a command, or null. Only these keys; anything else is refused. */
export function parseMoveBook(fromKam: unknown, body: unknown): MoveBookCommand | null {
  if (typeof fromKam !== "string" || !RECORD_ID.test(fromKam)) return null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== "toKamUserId" && k !== "continueFrom")) return null;
  if (typeof b.toKamUserId !== "string" || !RECORD_ID.test(b.toKamUserId)) return null;
  const cf = b.continueFrom ?? null;
  if (cf !== null && (typeof cf !== "string" || !RECORD_ID.test(cf))) return null;
  return Object.freeze({ fromKamUserId: fromKam, toKamUserId: b.toKamUserId, continueFrom: cf });
}

export function createKamMoveBook(deps: MoveBookDeps) {
  return Object.freeze({
    async move(p: KamAssignPrincipal, cmd: MoveBookCommand | null, signal?: AbortSignal): Promise<MoveBookResult> {
      const me = p.credential.userId;
      const refuse = (reason: MoveBookRefusal): MoveBookResult => {
        deps.events.refusal(me, ACTION, reason, cmd ? [cmd.fromKamUserId] : []);
        return Object.freeze({ ok: false as const, kind: "refused" as const, reason });
      };
      if (!cmd) return refuse("invalid-request");
      if (cmd.fromKamUserId === cmd.toKamUserId) return refuse("same-kam");

      let seat: string | null;
      try { seat = await deps.authority.mayAssign(p.credential, p.sessionId, signal); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected" }; }
      if (!seat) return refuse("seat-denied");

      let who: Awaited<ReturnType<typeof deps.users.lookup>>;
      try { who = await deps.users.lookup(p.credential, cmd.toKamUserId); } catch { who = null; }
      if (!who || who.who !== cmd.toKamUserId || !KAM_ASSIGNEE_SEATS.has(who.seat)) return refuse("assignee-not-am");

      /* the whole book, ids and versions only, in id order, on the person's own token */
      const book: { id: string; modifiedTime: string | null }[] = [];
      for (let offset = 0; ; offset += BOOK_PAGE) {
        let r: Awaited<ReturnType<typeof deps.crm.coql>>;
        try {
          r = await deps.crm.coql(p.credential,
            `select id, Modified_Time from Contacts where KAM = '${cmd.fromKamUserId}' order by id asc limit ${offset}, ${BOOK_PAGE}`, { signal });
        } catch { return { ok: false, kind: "source-error", errorKind: "unexpected" }; }
        if (!r.ok) return { ok: false, kind: "source-error", errorKind: r.error.kind };
        for (const rec of r.value.records) {
          if (!RECORD_ID.test(rec.id)) return { ok: false, kind: "source-error", errorKind: "unexpected" };
          const mt = (rec as { Modified_Time?: unknown }).Modified_Time;
          book.push({ id: rec.id, modifiedTime: typeof mt === "string" ? mt : null });
        }
        if (!r.value.moreRecords || r.value.records.length < BOOK_PAGE) break;
        if (book.length >= BOOK_MAX) return { ok: false, kind: "source-error", errorKind: "book-too-large" };
      }
      const from = cmd.continueFrom === null ? null : BigInt(cmd.continueFrom);
      const rows = from === null ? book : book.filter((x) => BigInt(x.id) >= from);

      const reasons: Record<string, number> = {};
      const stop = () => pastStopMargin(deps.stopMarginMs ?? DEFAULT_STOP_MARGIN_MS);
      const out = await runBounded(rows, deps.concurrency ?? 4, async (row): Promise<string | null> => {
        if (!row.modifiedTime) return "not-visible";
        const r = await deps.assignment.assign(p, { contactId: row.id, kamUserId: cmd.toKamUserId, expectedModifiedTime: row.modifiedTime }, signal);
        if (!r.ok) return r.kind === "refused" ? r.reason : r.kind === "conflict" ? "conflict" : "source-error";
        return null;
      }, stop);
      const moved: string[] = [], notMoved: string[] = [];
      for (const x of out.done) {
        if (x.value === null) moved.push(rows[x.index]!.id);
        else { notMoved.push(rows[x.index]!.id); reasons[x.value] = (reasons[x.value] ?? 0) + 1; }
      }
      return { ok: true, value: Object.freeze({ moved, notMoved, reasons, continueFrom: out.notStarted.length ? rows[out.notStarted[0]!]!.id : null }) };
    },
  });
}
export type KamMoveBook = ReturnType<typeof createKamMoveBook>;
