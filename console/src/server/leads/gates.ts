/**
 * M08-S02-T01 — the finance gates, read live from Zoho (D09, D44, D45, D52, D68, D70).
 *
 * The prototype's GATES / gateWho / gateWait (src/lib/selectors/ladder.ts), with Finance's facts read at
 * the source on the person's own token (D53) instead of from the demo's PAY and paper stores:
 *
 *   Lead ──Origin_Lead── Contact ──Customer── allotments (LLP_UnitAllocation_Module) ──Allotment── Receipts
 *
 *   advance  "the ten per cent in the bank"         met: MATCHED inbound money stands against the allotment
 *   balance  "the balance in the bank"              met: matched money ≥ units × unit price (Payment_Status Full)
 *   alloc    "the money in and every document verified"
 *                                                   met: balance met, the NDA verified (Lead.NDA_Verified_At) and
 *                                                        every live allotment's Supplementary_Verified_At set
 *
 * Who a shut gate waits on — never blame Finance for an investor's silence:
 *   "fin" — a receipt the IR recorded is Pending or Claimed (Finance has to find it), or, on alloc, the money
 *           is in and only Finance's verification is outstanding;
 *   "ir"  — nothing has been reported: the next move is the IR's.
 *
 * Read-only. Only Finance moves Match_State and the verification stamps, in the Investor Management portal
 * (D09, D44); no path here writes anything — the client handed in has no write methods — and Zoho's field-
 * level security keeps those fields read-only to every IR profile (M02-S04-T05). The answer names Finance
 * as the doer, never offers a confirm or reject control (`mayConfirm: false` for every seat, the IR Manager
 * and the super user included), and marks the super user's view (Digital Infrastructure) for its note.
 * Nothing is cached (rows are records, D52); logs carry ids and codes only.
 *
 * D69 (owner ruling 6 Oct 2026): the IR side never reads Receipts and never reads an allotment's Unit_Price. Only a
 * Finance seat (MONEY_SEATS) reads the money facts here; every other seat — and the journey's GateReader, which runs on
 * the IR's token — gets `moneyKnown: false`: the three gates count as not met, nobody is blamed (`who: null`), and the
 * drawer says the confirmation cannot be read here yet (GATE_UNKNOWN_TEXT). PROVISIONAL until Finance's
 * Advance_Confirmed_At / Balance_Confirmed_At Lead fields exist (ir-write-map.md "Claim redesign" step 5).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE } from "../money/register";
import type { LeadsAccess, LeadsAccessAuthority } from "./book";
import { LEADS_MODULE } from "./capture";
import { activeFor, istDate, rosterNow, type RosterReader } from "./cover";
import { RUNGS, doneOf, type GateReader } from "./journey";

export type GateKey = "advance" | "balance" | "alloc";
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const RECEIPT_PAGE = 2_000;
const IN_LIMIT = 100;
/** Kinds that bring money in; Part is the live name of D70's Balance. */
const INBOUND: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
/** Reported by the IR, not yet found by Finance: the only state in which "waiting on Finance" is honest. */
const REPORTED: ReadonlySet<string> = new Set(["Pending", "Claimed"]);
const MATCH_STATES: ReadonlySet<string> = new Set(["Pending", "Matched", "Not found", "Reversed", "Claimed"]);
/** The seats that may read Receipts and allotment prices (D69): Finance's two. */
export const MONEY_SEATS: ReadonlySet<string> = new Set(["head-of-finance", "finance-operations"]);
/** What a shut money gate says to a seat that cannot read Finance's confirmation (D69). */
export const GATE_UNKNOWN_TEXT = "Finance confirms this in the Investor Management portal; the console cannot read that confirmation here yet.";

/** The prototype's words (ladder.ts GATES), so the drawer and the refusal say the same thing. */
export const GATE_TEXT: Readonly<Record<GateKey, { readonly t: string; readonly chase: string; readonly wait: string }>> = Object.freeze({
  advance: {
    t: "the ten per cent in the bank",
    chase: "Nothing has arrived yet. Ask for it, and when they tell you it has gone, record what they said — Finance sees it on their day with one button on it.",
    wait: "Finance has to find the advance in the account and confirm it.",
  },
  balance: {
    t: "the balance in the bank",
    chase: "The hold is running and the balance is not in. That is your chase — record what the investor tells you and Finance picks it up.",
    wait: "Finance has to find the balance and confirm it. The hold is still running.",
  },
  alloc: {
    t: "the money in and every document verified",
    chase: "The paperwork is not finished. Whatever is outstanding on it is on the Paperwork card, and most of it is a signature you are chasing.",
    wait: "Finance has the money and has still to verify a signed agreement.",
  },
});

/** Finance's facts for one lead, as Zoho holds them now. */
export interface GateFacts {
  /** null: no investor yet (before "said yes"), so no allotment and no receipt. */
  readonly contactId: string | null;
  readonly allotmentIds: readonly string[];
  /** Units × unit price over the live (not Cancelled) allotments. */
  readonly amountRupees: number;
  /** Matched inbound less matched refunds. */
  readonly matchedRupees: number;
  /** A receipt the IR reported that Finance has not found yet (Pending / Claimed). */
  readonly reported: boolean;
  /** Finance looked and could not find one (Not found) — the IR's move to ask again. */
  readonly notFound: boolean;
  /** The earliest hold on a Reserved allotment (IST date). */
  readonly holdUntil: string | null;
  readonly ndaVerified: boolean;
  readonly supplementaryVerified: boolean;
  /** false: this seat may not read the money (D69) — amounts are 0 and no money gate is met. */
  readonly moneyKnown: boolean;
}

export interface GateState {
  readonly leadId: string;
  /** The rung the lead stands on (1–9); the next rung is done + 1. */
  readonly done: number;
  /** The gate on the next rung, or null when the next rung has none. */
  readonly gate: GateKey | null;
  readonly met: boolean;
  /** Who the shut gate waits on; null when it is open or there is none. */
  readonly who: "fin" | "ir" | null;
  /** The drawer text: the wait (fin) or the chase (ir). */
  readonly says: string | null;
  readonly payment: {
    readonly status: "Yet to initiate" | "Partial" | "Full" | null;
    readonly reported: boolean;
    readonly notFound: boolean;
    readonly matchedRupees: number;
    readonly dueRupees: number;
  } | null;
  readonly holdUntil: string | null;
  /** false: the money facts were not read for this seat (D69); `payment` is null and a money gate reads not met. */
  readonly moneyKnown: boolean;
  readonly docs: { readonly nda: boolean; readonly supplementary: boolean };
  /** Finance clears every gate, in the Investor Management portal. */
  readonly doer: "finance";
  /** No console seat confirms, matches or rejects a payment — not the IR Manager, not the super user. */
  readonly mayConfirm: false;
  /** The viewer is the super user (Digital Infrastructure): the drawer adds its "super user" note. */
  readonly superUser: boolean;
}

export type GateRefusal = "invalid-request" | "session-changed" | "capability-missing" | "not-visible" | "not-in-book" | "source-invalid";
export type GateResult =
  | { readonly ok: true; readonly value: GateState }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: GateRefusal }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface GateDependencies {
  /** Reads only: the gate never writes, so it is never handed a writer. */
  readonly crm: Pick<ZohoClient, "getRecord" | "coql">;
  readonly access: LeadsAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly roster?: RosterReader;
  readonly clock?: () => number;
}

const LEAD_FIELDS = ["Owner", "Secondary_Owner", "Cover_By", "Cover_Until", "Lost_At", "NDA_Verified_At", ...RUNGS.map((r) => r.field)];
const GATE_OF: Readonly<Record<number, GateKey>> = Object.freeze(Object.fromEntries(RUNGS.filter((r) => "gate" in r).map((r) => [r.n, (r as { gate: GateKey }).gate])));

class Unreadable { constructor(readonly ids: readonly string[]) {} }
class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** The prototype's `met`, over live facts. */
export function gateMet(gate: GateKey, f: GateFacts): boolean {
  if (!f.moneyKnown) return false;
  const full = f.amountRupees > 0 && f.matchedRupees >= f.amountRupees;
  if (gate === "advance") return f.matchedRupees > 0;
  if (gate === "balance") return full;
  return full && f.ndaVerified && f.supplementaryVerified;
}
/** The prototype's `gateWho`: "fin" only when the IR has handed something over and is stuck. */
export function gateWho(gate: GateKey | null, f: GateFacts): "fin" | "ir" | null {
  if (!gate || !f.moneyKnown || gateMet(gate, f)) return null;
  if (f.reported) return "fin";
  if (gate === "alloc" && f.amountRupees > 0 && f.matchedRupees >= f.amountRupees) return "fin";
  return "ir";
}

export function createGates(deps: GateDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The gates need crm.getRecord/coql, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  const refuse = (me: string, code: GateRefusal, ids: readonly unknown[] = []): GateResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "lead-gate", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code };
  };
  const coql = async (cred: UserCredential, q: string, signal?: AbortSignal) => {
    const r = await crm.coql(cred, q, { signal });
    if (!r.ok) throw new SourceFail(r.error.kind);
    if (r.value.invalidRecordIds) throw new Unreadable([]);
    return r.value;
  };

  /** Finance's facts for a lead the caller has already been admitted to. */
  async function facts(cred: UserCredential, L: ZohoRecord, money: boolean, signal?: AbortSignal): Promise<GateFacts> {
    const leadId = L.id;
    const ndaVerified = typeof L.NDA_Verified_At === "string" && DATETIME.test(L.NDA_Verified_At);
    const none: GateFacts = { contactId: null, allotmentIds: [], amountRupees: 0, matchedRupees: 0, reported: false, notFound: false,
      holdUntil: null, ndaVerified, supplementaryVerified: false, moneyKnown: money };
    const c = await coql(cred, `select id, Origin_Lead from Contacts where Origin_Lead = '${leadId}' limit 0, 2`, signal);
    if (c.records.length === 0) return none;
    const contact = c.records[0]!;
    if (c.records.length > 1 || !validId(contact.id) || idOf(contact.Origin_Lead) !== leadId) throw new Unreadable([leadId]);
    // D69: Unit_Price is read only on a Finance seat.
    const al = await coql(cred, `select id, Customer, Allocation_Status, Reserved_Units, Issued_Units, ${money ? "Unit_Price, " : ""}Hold_Until, Supplementary_Verified_At from ${ALLOTMENTS_MODULE} where Customer = '${contact.id}' limit 0, ${IN_LIMIT}`, signal);
    if (al.moreRecords) throw new Unreadable([contact.id]);
    let amount = 0, hold: string | null = null, supp = true;
    const live: string[] = [];
    for (const a of al.records) {
      const status = a.Allocation_Status;
      if (!validId(a.id) || idOf(a.Customer) !== contact.id || (status !== "Reserved" && status !== "Issued" && status !== "Cancelled")) throw new Unreadable([contact.id, a.id]);
      if (status === "Cancelled") continue;
      const units = status === "Issued" ? int(a.Issued_Units) : int(a.Reserved_Units), price = money ? int(a.Unit_Price) : 0;
      if (units === null || price === null || units < 0 || price < 0 || !Number.isSafeInteger(amount + units * price)) throw new Unreadable([a.id]);
      amount += units * price;
      live.push(a.id);
      if (status === "Reserved" && typeof a.Hold_Until === "string" && DATE.test(a.Hold_Until) && (hold === null || a.Hold_Until < hold)) hold = a.Hold_Until;
      if (!(typeof a.Supplementary_Verified_At === "string" && DATETIME.test(a.Supplementary_Verified_At))) supp = false;
    }
    if (live.length === 0) return { ...none, contactId: contact.id };
    // D69: Receipts are never read on an IR-side token.
    if (!money) return { ...none, contactId: contact.id, allotmentIds: live, holdUntil: hold, supplementaryVerified: supp };
    const rc = await coql(cred, `select id, Allotment, Kind, Amount, Match_State from ${RECEIPTS_MODULE} where Allotment in (${live.map((x) => `'${x}'`).join(", ")}) limit 0, ${RECEIPT_PAGE}`, signal);
    if (rc.moreRecords) throw new Unreadable(live);
    let inbound = 0, refunded = 0, reported = false, notFound = false;
    for (const r of rc.records) {
      const amt = int(r.Amount), allot = idOf(r.Allotment);
      if (!validId(r.id) || !allot || !live.includes(allot) || amt === null || amt <= 0 || typeof r.Kind !== "string"
        || typeof r.Match_State !== "string" || !MATCH_STATES.has(r.Match_State)) throw new Unreadable([r.id]);
      const inb = INBOUND.has(r.Kind);
      if (r.Match_State === "Matched") { if (inb) inbound += amt; else if (r.Kind === "Refund") refunded += amt; }
      else if (inb && REPORTED.has(r.Match_State)) reported = true;
      else if (inb && r.Match_State === "Not found") notFound = true;
    }
    return { contactId: contact.id, allotmentIds: live, amountRupees: amount, matchedRupees: Math.max(0, inbound - refunded),
      reported, notFound, holdUntil: hold, ndaVerified, supplementaryVerified: supp, moneyKnown: true };
  }

  const failure = (me: string, e: unknown, leadId: string): GateResult => {
    if (e instanceof Unreadable) return refuse(me, "source-invalid", [leadId, ...e.ids]);
    const k = e instanceof SourceFail ? e.kind : "unexpected";
    return { ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" || k === "unexpected" };
  };

  return Object.freeze({
    /** The gate on the lead's next rung, who it waits on, and the payment and paper behind it. */
    async read(principal: { credential: UserCredential; sessionId: string }, leadId: string, signal?: AbortSignal): Promise<GateResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId) || !validId(leadId)) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const me = cred.userId;
      let a: LeadsAccess | null;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch {
        return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
      }
      if (!a || a.actor?.userId !== me) return refuse(me, "session-changed");
      if (!a.mayViewLeads) return refuse(me, "capability-missing", [leadId]);
      let L: ZohoRecord;
      try {
        const got = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: LEAD_FIELDS, signal });
        if (!got.ok) {
          if (got.error.kind === "not-found" || got.error.kind === "forbidden") return refuse(me, "not-visible", [leadId]);
          throw new SourceFail(got.error.kind);
        }
        if (!got.value || got.value.id !== leadId) return refuse(me, "not-visible", [leadId]);
        L = got.value;
      } catch (e) {
        return failure(me, e, leadId);
      }
      const owner = idOf(L.Owner), today = istDate(clock());
      const roster = await rosterNow(deps.roster, signal);
      const inBook = a.teamOrgWide || owner === me || (owner !== null && a.teamOwnerIds !== null && a.teamOwnerIds.includes(owner))
        || activeFor(L, me, today, roster) !== null;
      if (!inBook) return refuse(me, "not-in-book", [leadId]);
      const done = doneOf(L);
      if (done === null) return refuse(me, "source-invalid", [leadId]);
      const gate = !L.Lost_At && done < 9 ? GATE_OF[done + 1] ?? null : null;
      const money = MONEY_SEATS.has(a.actor.seat);
      let f: GateFacts;
      try {
        // Before "said yes" there is no investor, so there is nothing of Finance's to read.
        f = done >= 5 ? await facts(cred, L, money, signal) : { contactId: null, allotmentIds: [], amountRupees: 0, matchedRupees: 0, reported: false,
          notFound: false, holdUntil: null, ndaVerified: typeof L.NDA_Verified_At === "string", supplementaryVerified: false, moneyKnown: money };
      } catch (e) {
        return failure(me, e, leadId);
      }
      const met = gate ? gateMet(gate, f) : true;
      const who = gateWho(gate, f);
      const status = f.allotmentIds.length === 0 ? null
        : f.matchedRupees <= 0 ? "Yet to initiate" as const : f.matchedRupees < f.amountRupees ? "Partial" as const : "Full" as const;
      return { ok: true, value: Object.freeze({
        leadId, done, gate, met, who,
        says: gate && who ? (who === "fin" ? GATE_TEXT[gate].wait : GATE_TEXT[gate].chase) : gate && !met && !f.moneyKnown ? GATE_UNKNOWN_TEXT : null,
        payment: f.contactId === null || !f.moneyKnown ? null : Object.freeze({ status, reported: f.reported, notFound: f.notFound,
          matchedRupees: f.matchedRupees, dueRupees: Math.max(0, f.amountRupees - f.matchedRupees) }),
        holdUntil: f.holdUntil,
        moneyKnown: f.moneyKnown,
        docs: Object.freeze({ nda: f.ndaVerified, supplementary: f.allotmentIds.length > 0 && f.supplementaryVerified }),
        doer: "finance" as const,
        mayConfirm: false as const,
        superUser: a.actor.seat === "digital-infrastructure",
      }) };
    },

    /** journey.ts's GateReader: the caller (the journey) has already admitted the person to the lead. The journey runs on
     *  the IR's token, which never reads the money (D69): every gate rests on it (alloc needs the balance), so no money
     *  gate opens from here until Finance's confirmation is a Lead field. Nothing is read; a shut rung says so. */
    reader(): GateReader {
      return {
        async met(credential, leadId) {
          if (!isUserCredential(credential) || !validId(leadId)) return false;
          return false;
        },
      };
    },
  });
}
export type Gates = ReturnType<typeof createGates>;
