/**
 * M13-S04-T01 — HAND A BANK OR COMPLIANCE TICKET TO FINANCE, AND KEEP WATCHING (D12, D13, D45, D53).
 *
 * The prototype's handToFinance / needsFin / watchedTkt, made on the server:
 *   - only a Bank or Compliance Case whose Owner is on Account Management is handed on, by that owner
 *     (a KAM or the Head of AM working their own ticket) or by the super user; nobody else
 *   - Finance is Finance Operations, else the Head of Finance (prototype finSeats: "ops" first) — an active
 *     Zoho user seated from their role/profile ids, read on the person's own token (GET /users)
 *   - ONE write on the person's own token: PUT /Cases/{id} { Owner: Finance, Handed_By: me, Handed_At: now },
 *     guarded by If-Unmodified-Since (D44). Zoho applies a record's update whole or not at all, so the owner and
 *     the watcher move together — there is no state where the ticket says "handed" and is still the KAM's.
 *     W2-KAM-6 (8 Oct 2026): it was two writes (Handed_By first, then actions/change_owner). On staging the KAM
 *     profile may not change a Case's owner; Zoho answered change_owner with a per-record NO_PERMISSION inside a
 *     400 (read as invalid-data), after Handed_By was already written — a half-written ticket, the owner unchanged,
 *     and "Zoho is not answering" on screen. Now a refused owner change writes nothing and is said as a refusal
 *     ("owner-change-refused"). Zoho's change_owner e-mail to the new owner is not sent by an update; Finance
 *     finds the ticket in their queue (Tickets, Today).
 *     Zoho config (HUMAN; not yet in zoho/access/spec.json): the KAM and AM Head profiles need Edit + Change Owner on Cases, and
 *     Handed_By's lookup must give its user read access to the record (the "keep watching" below).
 *   - the watcher is Handed_By (a user lookup; jev decide a=0.62, PROVISIONAL). The KAM's register reads
 *     `Owner = me or Handed_By = me` (./register), and Zoho's user-lookup sharing on Handed_By keeps their
 *     token able to read the Case after it changes owner — a Zoho config item (HUMAN). They cannot work it:
 *     ./writes mayWork refuses a Case whose Owner is not them.
 *   - the evidence is Zoho's own field history (Owner, Handed_By): nothing is written to a log of ours
 *     beyond the client's call lines (ids and status) and one Plane B line on a refusal.
 */

import type { ScopedCache } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { conflictOf } from "../data/events";
import { scopesFor } from "../data/scope";
import { ZOHO_SEAT_SIDES } from "../access/policy";
import type { ZohoSeat, ZohoSeatDirectory } from "../oauth/seat";
import { seatOrg } from "../teams/teams";
import { RECORD_ID, str } from "./predicate";
import { CASE_FIELDS, CASES_MODULE, caseOf, READ_ONLY_SEATS, type CaseRow } from "./register";
import { imRightsOf, type ImRights } from "./rights";
import { istIso, REFUSAL_TEXT as WRITE_TEXT } from "./writes";

/** The categories that belong to Finance's side, not the investor's manager's (prototype needsFin). */
export const FINANCE_CATEGORIES: ReadonlySet<string> = new Set(["Bank", "Compliance"]);
/** Who a ticket is handed to: Finance Operations first, the Head of Finance when there is none. */
export const FINANCE_ORDER: readonly ZohoSeat[] = Object.freeze(["finance-operations", "head-of-finance"] as ZohoSeat[]);
const ZOHO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const USERS_PER_PAGE = 200;
const MAX_USER_PAGES = 10;

export type HandRefusal = "read-only" | "invalid-request" | "no-book" | "not-found" | "not-yours" | "not-finance-work" | "already-finance" | "no-finance"
  | "owner-change-refused" | "handover-refused";

export const HAND_TEXT: Readonly<Record<HandRefusal, string>> = Object.freeze({
  "read-only": WRITE_TEXT["read-only"],
  "invalid-request": "That is not a ticket id.",
  "no-book": WRITE_TEXT["no-book"],
  "not-found": WRITE_TEXT["not-found"],
  "not-yours": "Only the manager who owns this ticket hands it on.",
  "not-finance-work": "Only a bank or compliance ticket held by Account Management is handed to Finance.",
  "already-finance": "This ticket is already with Finance.",
  "no-finance": "There is nobody on the Finance team to hand this to.",
  "owner-change-refused": "Zoho did not let you hand this ticket on: your Zoho profile may not change a ticket's owner. Nothing was changed — it is still yours. Tell Digital Infrastructure.",
  "handover-refused": "Zoho refused the hand-over: a field it writes (Handed By, Handed At or the owner) is missing or hidden from your seat. Nothing was changed — it is still yours. Tell Digital Infrastructure.",
});

/** Zoho's per-record codes for "this user may not do that to this record" (answered inside a 400, or as a 403). */
const NO_PERMISSION: ReadonlySet<string> = new Set(["NO_PERMISSION", "PERMISSION_DENIED", "OPERATION_NOT_PERMITTED"]);

export type HandResult =
  | { readonly ok: true; readonly row: CaseRow; readonly to: string; readonly already: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: HandRefusal; readonly message: string }
  | { readonly ok: false; readonly kind: "conflict"; readonly recordId: string | null; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

export interface HandoverDeps {
  readonly crm: Pick<ZohoClient, "coql" | "update" | "listUsers">;
  readonly seats: Pick<ZohoSeatDirectory, "resolveDirectoryUser">;
  readonly cache: ScopedCache;
  readonly events: InvestorEvents;
  readonly rights?: (seat: string, userId: string) => ImRights;
  readonly clock?: () => number;
}

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";

/** The Finance person a ticket goes to, from the org's users as Zoho lists them. Pure: exported for tests. */
export function financeTarget(users: readonly unknown[], seats: Pick<ZohoSeatDirectory, "resolveDirectoryUser">): string | null {
  const org = seatOrg(users, seats as ZohoSeatDirectory);
  for (const seat of FINANCE_ORDER) {
    const hit = org.members.filter((m) => !m.left && m.seat === seat).map((m) => m.id).sort()[0];
    if (hit) return hit;
  }
  return null;
}

export function createCaseHandover(deps: HandoverDeps) {
  const clock = deps.clock ?? Date.now;
  const rightsOf = deps.rights ?? imRightsOf;

  const refuse = (me: string, reason: HandRefusal, ids: readonly string[] = []): HandResult => {
    deps.events.refusal(me, "case-hand", reason, ids);
    return { ok: false, kind: "refused", reason, message: HAND_TEXT[reason] };
  };
  const zohoFail = (kind: string): HandResult => ({ ok: false, kind: "source-error", errorKind: kind, retryable: retryable(kind) });

  async function dropCuts(): Promise<void> {
    await Promise.all(["org", "own-book", "subtree", "all"].map((k) => deps.cache.invalidate({ prefix: `${k}.cases.` }).catch(() => 0)));
  }

  async function activeUsers(cred: UserCredential, signal?: AbortSignal): Promise<unknown[] | null> {
    const out: unknown[] = [];
    for (let page = 1; page <= MAX_USER_PAGES; page++) {
      let r;
      try { r = await deps.crm.listUsers(cred, { type: "ActiveUsers", page, perPage: USERS_PER_PAGE, signal }); } catch { return null; }
      if (!r.ok) return null;
      out.push(...r.value.users);
      if (!r.value.moreRecords) return out;
    }
    return null;
  }

  return Object.freeze({
    /** Hand one Case to Finance. `expectedModifiedTime` is the Modified_Time the screen loaded. */
    async handToFinance(p: { readonly credential: UserCredential; readonly seat: string }, id: unknown, expectedModifiedTime?: unknown, signal?: AbortSignal): Promise<HandResult> {
      const me = p.credential.userId;
      const rights = rightsOf(p.seat, me);
      if (!rights.tkt || READ_ONLY_SEATS.has(p.seat)) return refuse(me, "read-only");
      if (typeof id !== "string" || !RECORD_ID.test(id)) return refuse(me, "invalid-request");
      if (expectedModifiedTime !== undefined && expectedModifiedTime !== null && (typeof expectedModifiedTime !== "string" || !ZOHO_DT.test(expectedModifiedTime))) {
        return refuse(me, "invalid-request");
      }
      const scope = scopesFor(p.seat, me).cases;
      if (scope.kind === "none") return refuse(me, "no-book");
      const superUser = rights.team === "di" || rights.team === "sys";
      if (rights.team !== "am" && !superUser) return refuse(me, "not-yours", [id]);

      let got;
      try {
        got = await deps.crm.coql(p.credential, `select ${CASE_FIELDS.join(", ")} from ${CASES_MODULE} where id = '${id}' limit 0, 1`, { signal });
      } catch { return zohoFail("unexpected"); }
      if (!got.ok) return zohoFail(got.error.kind);
      const rec: ZohoRecord | undefined = got.value.records[0];
      const row = rec ? caseOf(rec) : null;
      if (!rec || !row) return refuse(me, "not-found", [id]);
      if (!FINANCE_CATEGORIES.has(row.cat)) return refuse(me, "not-finance-work", [id]);
      // Handed on before by this person (a repeated press): nothing more to do.
      if (row.handed && row.handed.by === me && row.own !== me) return { ok: true, row: Object.freeze({ ...row, watched: true }), to: row.own, already: true };
      if (!superUser && row.own !== me) return refuse(me, "not-yours", [id]);

      const users = await activeUsers(p.credential, signal);
      if (!users) return zohoFail("unexpected");
      const org = seatOrg(users, deps.seats as ZohoSeatDirectory);
      const seatOfOwner = org.members.find((m) => m.id === row.own)?.seat ?? null;
      const ownerTeam = seatOfOwner ? ZOHO_SEAT_SIDES[seatOfOwner].im : null;
      if (ownerTeam !== "kam" && ownerTeam !== "amlead") return refuse(me, ownerTeam === "ops" || ownerTeam === "head" ? "already-finance" : "not-finance-work", [id]);
      const to = financeTarget(users, deps.seats);
      if (!to) return refuse(me, "no-finance", [id]);

      const modified = str(rec, "Modified_Time", 40);
      if (typeof expectedModifiedTime === "string" && modified && Date.parse(modified) !== Date.parse(expectedModifiedTime)) {
        deps.events.conflict(me, "case-hand", id);
        return { ok: false, kind: "conflict", recordId: id, reason: "Someone else changed this ticket after you opened it. Their change is kept; reload to see it, then hand it on again." };
      }
      // The watcher is whoever pressed (prototype: handed.by = the super user when they did it).
      const at = istIso(clock());
      // One update: the owner and the watcher together, or neither (W2-KAM-6).
      let put;
      try {
        put = await deps.crm.update(p.credential, CASES_MODULE, id, { Owner: { id: to }, Handed_By: { id: me }, Handed_At: at },
          { ifUnmodifiedSince: typeof expectedModifiedTime === "string" ? expectedModifiedTime : modified ?? null, signal });
      } catch { return zohoFail("unexpected"); }
      if (!put.ok) {
        const c = conflictOf(deps.events, me, "case-hand", put.error);
        if (c) return { ok: false, kind: "conflict", recordId: c.recordId, reason: c.reason };
        const e = put.error;
        const code = "code" in e && typeof e.code === "string" ? e.code : "";
        const field = "field" in e && typeof e.field === "string" ? e.field : null;
        if (e.kind === "forbidden" || (e.kind === "invalid-data" && (NO_PERMISSION.has(code) || field === "Owner"))) return refuse(me, "owner-change-refused", [id, to]);
        if (e.kind === "invalid-data") return refuse(me, "handover-refused", [id]);
        return zohoFail(e.kind);
      }
      await dropCuts();
      const handed = Object.freeze({ by: me, at: at.slice(0, 16) });
      const version = put.value.modifiedTime ?? null;   // Zoho's new Modified_Time, from the one write
      return { ok: true, to, already: false, row: Object.freeze({ ...row, own: to, handed, watched: true, version }) };
    },
  });
}
export type CaseHandover = ReturnType<typeof createCaseHandover>;
