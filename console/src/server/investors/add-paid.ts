/**
 * M09-S09-T02 — ADD AN INVESTOR WHO HAS ALREADY PAID, STRAIGHT FROM THE CONSOLE (D45, D52, D53, D70, D93).
 *
 * Finance (and the super user) adds someone who paid before the console: name, email, mobile, farm (LLP),
 * units, amount paid and investment date. On the person's own token (D53) this writes, in order:
 *   1. one Contact — First_Name / Last_Name / Email / Mobile, a fresh ARL_ID and App_Access = Hold (D115 ruling 1:
 *      an app account is created On hold by every path — data synced, sign-in locked — and stays Hold until a
 *      person with the release right presses "Send welcome and unlock", server/investors/unlock.ts). When Finance
 *      matches the Pending receipt below (D113), money/match.ts sets the Tentative mark and publishes
 *      account.opened as for any investor, and never touches App_Access that is already set.
 *      NO email of any kind goes to the investor from here (D93);
 *   The farm's free units are checked by ../farms/oversell (M11-S07: the one oversell rule, Units_Released − held,
 *   read fresh) BEFORE anything is written; a Zoho oversell refusal of the allotment insert is named the same way.
 *   2. one allotment in LLP_UnitAllocation_Module — Customer, LLP, Unit_Price, Investment_Date and, per D70
 *      ("reserved until the balance lands"), Issued with Issued_Units + Capital_Invested when the amount
 *      covers units × unit price, else Reserved with Reserved_Units and a 30-day Hold_Until (PROVISIONAL,
 *      jev decide 0.87 — the story's Zoho line says Issued; the front-end and the mapping say Reserved
 *      until paid);
 *   3. one Pending receipt for the money already paid, through the allotment guard
 *      (money/allotment-receipts `guarded`: allotment required, Cancelled takes refunds only, 412 →
 *      allotment-changed). The M01-S08 replay path needs a UTR, a mode and a sealed context the form does
 *      not ask for, so the writer here is create-once keyed on the fresh allotment (PROVISIONAL, jev 0.47).
 *      It is Pending: Finance matches it with "Match it" (D113 — no second person; the paper gate still applies).
 *
 * "One commit": Zoho has no transaction, so a failure after the Contact is written deletes what this call
 * wrote, newest first, and answers "Not saved yet". If that clean-up cannot finish the answer says so with
 * the ids (kind "incomplete") and one refusal line goes to Plane B for the operator.
 *
 * Idempotent: an email that already belongs to a Contact is refused with a link to that investor (the
 * Email field is unique in the org, so Zoho refuses a racing duplicate too); a lost insert response is
 * resolved by re-reading the natural key (email → Contact, Customer → allotment, Allotment → receipt);
 * and an Idempotency-Key repeated by the same person within ten minutes gets the first answer back
 * (ids and codes only are held — never a record, D45).
 *
 * Logs carry ids and short codes only; the name, email and mobile never reach Plane B.
 */

import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord, ZohoResult } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { RecordOutcome, ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { AllotmentReceiptWrites } from "../money/allotment-receipts";
import type { OversellGuard } from "../farms/oversell";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE, type ReceiptReplayResult } from "../money/receipt-replay";
import { ALLOTMENT_UNLINKED, unlinkedMessage, writeMissing } from "./allotment-guard";

export const CONTACTS_MODULE = "Contacts";
export const LLPS_MODULE = "LLP_Creation_Module";
export const ADD_PAID_HOLD_DAYS = 30;
export const ADD_PAID_APP = "App: on hold — data synced, sign-in locked, no email sent. It stays locked until Finance presses Send welcome and unlock";
export const ADD_PAID_REPLAY_TTL_MS = 10 * 60 * 1_000;
const MAX_REPLAYS = 500;
const MAX_CODE_ATTEMPTS = 3;
const ARL_CODE = /^ARL-INV-(\d{4})$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MOBILE = /^\+?[0-9][0-9 ()-]{6,20}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ON_SALE: ReadonlySet<string> = new Set(["Open for Reservation", "Open for Issuance"]);

export interface AddPaidForm {
  readonly name: string;
  readonly email: string;
  readonly mobile: string;
  readonly llpId: string;
  readonly units: number;
  readonly amountPaid: number;
  /** YYYY-MM-DD, not in the future (Asia/Kolkata) */
  readonly investmentDate: string;
}

export interface AddPaidPrincipal {
  readonly credential: UserCredential;
  readonly sessionId: string;
}

/** Re-derived from the live session on every call: may this person add investors (Finance, super user)? */
export interface AddPaidAuthority {
  mayAdd(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}

export type AddPaidRefusal =
  | "invalid-request"
  | "not-finance"
  | "missing"
  | "email-invalid"
  | "mobile-invalid"
  | "units-invalid"
  | "date-invalid"
  | "duplicate-email"
  | "farm-not-visible"
  | "farm-closed"
  | "units-not-free"
  | "allotment-unlinked"
  | "overpaid"
  | "idempotency-key-invalid"
  | "in-progress";

export interface AddPaidCreated {
  readonly contactId: string;
  readonly code: string;
  readonly allotmentId: string;
  readonly allocationStatus: "Issued" | "Reserved";
  readonly receiptId: string;
  /** what the investor record shows: no account until the receipt is matched (M08-S08) */
  readonly app: typeof ADD_PAID_APP;
  readonly replayed: boolean;
}

export type AddPaidResult =
  | { readonly ok: true; readonly value: AddPaidCreated }
  | {
      readonly ok: false;
      readonly kind: "refused";
      readonly reasonCode: AddPaidRefusal;
      /** the in-page line, starting "Not saved yet" where the form stays open */
      readonly message: string;
      /** duplicate-email: the investor the email belongs to, when this person can see them */
      readonly existing?: { readonly contactId: string; readonly code: string | null; readonly name: string | null };
      readonly retryable: false;
    }
  | {
      readonly ok: false;
      readonly kind: "not-saved";
      readonly step: "contact" | "allotment" | "receipt";
      readonly errorKind: ZohoFailureKind | "unexpected" | string;
      readonly message: string;
      readonly retryable: boolean;
    }
  | {
      /** A step failed and the clean-up could not remove everything: an operator must look. */
      readonly ok: false;
      readonly kind: "incomplete";
      readonly step: "allotment" | "receipt";
      readonly left: { readonly contactId: string; readonly allotmentId: string | null; readonly receiptId: string | null };
      readonly message: string;
      readonly retryable: false;
    };

export interface AddPaidDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "search" | "insert" | "deleteRecord">;
  readonly receipts: Pick<AllotmentReceiptWrites, "guarded">;
  /** ../farms/oversell createOversellGuard — the one free-units rule (M11-S07). */
  readonly oversell: Pick<OversellGuard, "check" | "explain">;
  readonly authority: AddPaidAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export interface AddPaidService {
  add(principal: AddPaidPrincipal, form: unknown, idempotencyKey?: string | null, signal?: AbortSignal): Promise<AddPaidResult>;
}

/* ---- pure helpers (exported for the tests and the route) ------------------------------------------ */

/** "YYYY-MM-DD" of the Asia/Kolkata day at `ms` (rule 9: one clock, from the event). */
export function kolkataDay(ms: number): string {
  return new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
const addDays = (day: string, n: number): string => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const realDay = (d: string): boolean => {
  const m = DAY.exec(d);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return t.getUTCFullYear() === +m[1]! && t.getUTCMonth() === +m[2]! - 1 && t.getUTCDate() === +m[3]!;
};

/** "Asha K. Menon" → First "Asha K.", Last "Menon"; one word → Last only (Zoho requires Last_Name). */
export function splitName(full: string): { readonly first: string | null; readonly last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const last = parts.pop() ?? "";
  return { first: parts.length ? parts.join(" ") : null, last };
}

/** The next ARL code after the highest one seen (ARL-INV-0205 → ARL-INV-0206). */
export function nextArlCode(highest: string | null): string {
  const m = highest ? ARL_CODE.exec(highest) : null;
  const n = (m ? +m[1]! : 0) + 1;
  if (n > 9_999) throw new RangeError("ARL codes are four digits (ARL-INV-nnnn)");
  return "ARL-INV-" + String(n).padStart(4, "0");
}

const inr = (n: number): string => "₹" + n.toLocaleString("en-IN");
const pl = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

type Checked = { readonly form: AddPaidForm } | { readonly code: AddPaidRefusal; readonly message: string };

/** The form's own rules — the same lines the drawer shows (lib/im/money addInvestorGate). */
export function checkForm(raw: unknown, today: string): Checked {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { code: "invalid-request", message: "Not saved yet — the form is incomplete." };
  const r = raw as Record<string, unknown>;
  const text = (k: string, max: number): string => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, max + 1) : "");
  const f = {
    name: text("name", 120), email: text("email", 100), mobile: text("mobile", 30), llpId: text("llpId", 22),
    units: typeof r.units === "number" ? r.units : NaN, amountPaid: typeof r.amountPaid === "number" ? r.amountPaid : NaN,
    investmentDate: text("investmentDate", 10),
  };
  const miss: string[] = [];
  if (!f.name) miss.push("name");
  if (!f.email) miss.push("email");
  if (!f.mobile) miss.push("mobile");
  if (!f.llpId) miss.push("farm");
  if (!f.investmentDate) miss.push("investment date");
  if (!(f.units > 0)) miss.push("units");
  if (!(f.amountPaid > 0)) miss.push("amount paid");
  if (miss.length) return { code: "missing", message: "Not saved yet — " + miss.join(", ") + (miss.length === 1 ? " is" : " are") + " missing." };
  if (f.name.length > 120) return { code: "invalid-request", message: "Not saved yet — the name is too long." };
  if (f.email.length > 100 || !EMAIL.test(f.email)) return { code: "email-invalid", message: "Not saved yet — that is not an email address." };
  if (!MOBILE.test(f.mobile)) return { code: "mobile-invalid", message: "Not saved yet — that is not a mobile number." };
  if (!RECORD_ID.test(f.llpId)) return { code: "farm-not-visible", message: "Not saved yet — pick the farm." };
  if (!Number.isSafeInteger(f.units)) return { code: "units-invalid", message: "Not saved yet — units are whole units." };
  if (!Number.isSafeInteger(f.amountPaid)) return { code: "invalid-request", message: "Not saved yet — the amount is whole rupees." };
  if (!realDay(f.investmentDate) || f.investmentDate > today) return { code: "date-invalid", message: "Not saved yet — the investment date cannot be in the future." };
  return { form: Object.freeze(f) };
}

/* ---- the service ---------------------------------------------------------------------------------- */

class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
class Unreadable { constructor(readonly ids: readonly string[]) {} }

const retryableKind = (k: string): boolean =>
  k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";
const outcomesOf = (r: ZohoResult<readonly RecordOutcome[]>): readonly RecordOutcome[] | null =>
  r.ok ? r.value : r.error.kind === "partial" ? r.error.records : r.error.kind === "invalid-data" ? r.error.records : null;
const ambiguous = (k: ZohoFailureKind): boolean => k === "network" || k === "aborted" || k === "server" || k === "unexpected";

export function createAddPaid(deps: AddPaidDependencies): AddPaidService {
  if (!deps || typeof deps.crm?.insert !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.crm?.search !== "function"
    || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.deleteRecord !== "function"
    || typeof deps.receipts?.guarded !== "function" || typeof deps.authority?.mayAdd !== "function"
    || typeof deps.oversell?.check !== "function" || typeof deps.oversell?.explain !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("add-paid needs crm (getRecord/coql/search/insert/deleteRecord), the allotment receipt guard, the oversell guard, the Finance authority, the ops log and the record-id prefix");
  }
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  const note = (userId: string, reason: string, ids: readonly unknown[] = []) => {
    let at = 0;
    try { at = clock(); } catch { /* the line still stands */ }
    log.refusal({ at, actor: { kind: "user", userId }, action: "add-paid-investor", reason, recordIds: ids.filter(validId) });
  };
  const refuse = (userId: string, reasonCode: AddPaidRefusal, message: string, ids: readonly unknown[] = [],
    existing?: { contactId: string; code: string | null; name: string | null }): AddPaidResult => {
    note(userId, reasonCode, ids);
    return { ok: false, kind: "refused", reasonCode, message, ...(existing ? { existing: Object.freeze(existing) } : {}), retryable: false };
  };
  const replays = new Map<string, { at: number; result: Promise<AddPaidResult> }>();

  /* the email → the Contact it belongs to, as this person sees it */
  const byEmail = async (cred: UserCredential, email: string, signal?: AbortSignal): Promise<ZohoRecord | null> => {
    const r = await crm.search(cred, CONTACTS_MODULE, { email }, { perPage: 2, fields: ["id", "ARL_ID", "First_Name", "Last_Name", "Email"], signal });
    if (!r.ok) {
      if (r.error.kind === "not-found" || r.error.kind === "forbidden") return null;
      throw new SourceFail(r.error.kind);
    }
    const hit = r.value.records.find((x) => typeof x.Email === "string" && x.Email.toLowerCase() === email.toLowerCase());
    if (hit && !validId(hit.id)) throw new Unreadable([]);
    return hit ?? null;
  };
  const existingOf = (c: ZohoRecord) => ({
    contactId: c.id,
    code: typeof c.ARL_ID === "string" && ARL_CODE.test(c.ARL_ID) ? c.ARL_ID : null,
    name: [c.First_Name, c.Last_Name].filter((x) => typeof x === "string" && x).join(" ") || null,
  });

  interface Farm { name: string; price: number }
  const readFarm = async (cred: UserCredential, llpId: string, signal?: AbortSignal): Promise<Farm | "not-visible" | { closed: string; name: string }> => {
    const r = await crm.getRecord(cred, LLPS_MODULE, llpId, { fields: ["Name", "Unit_Price", "Total_Units", "LLP_Status"], signal });
    if (!r.ok) {
      if (r.error.kind === "not-found" || r.error.kind === "forbidden") return "not-visible";
      throw new SourceFail(r.error.kind);
    }
    if (!r.value) return "not-visible";
    const l = r.value;
    if (l.id !== llpId) throw new Unreadable([llpId]);
    const name = typeof l.Name === "string" ? l.Name.slice(0, 80) : "";
    const price = l.Unit_Price, total = l.Total_Units, status = typeof l.LLP_Status === "string" ? l.LLP_Status : "";
    if (!ON_SALE.has(status)) return { closed: status || "not open", name };
    if (typeof price !== "number" || !Number.isSafeInteger(price) || price <= 0 || typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
      throw new Unreadable([llpId]);
    }
    return { name, price }; // free units: ../farms/oversell (Units_Released − held), never counted here
  };

  const highestCode = async (cred: UserCredential, signal?: AbortSignal): Promise<string | null> => {
    const r = await crm.coql(cred, `select ARL_ID from ${CONTACTS_MODULE} where ARL_ID like 'ARL-INV-%' order by ARL_ID desc limit 0, 1`, { signal });
    if (!r.ok) throw new SourceFail(r.error.kind);
    const v = r.value.records[0]?.ARL_ID;
    return typeof v === "string" && ARL_CODE.test(v) ? v : null;
  };

  /** Insert one record; a lost answer is settled by `recover` (the natural key re-read). */
  const insertOne = async (cred: UserCredential, module: string, fields: ZohoFields, recover: () => Promise<string | null>, signal?: AbortSignal)
    : Promise<{ id: string } | { failed: RecordOutcome | null; kind: ZohoFailureKind | "unexpected" }> => {
    let r: ZohoResult<readonly RecordOutcome[]>;
    try { r = await crm.insert(cred, module, [fields], { signal }); } catch { r = { ok: false, error: { kind: "network", status: null }, creditsRemaining: null }; }
    const outs = outcomesOf(r);
    const o = outs && outs.length === 1 ? outs[0]! : null;
    if (r.ok && o && o.ok && validId(o.id)) return { id: o.id };
    if (!r.ok && ambiguous(r.error.kind)) {
      const found = await recover().catch(() => null);
      if (found) return { id: found };
      return { failed: null, kind: r.error.kind };
    }
    return { failed: o && !o.ok ? o : null, kind: r.ok ? "unexpected" : r.error.kind };
  };

  const remove = async (cred: UserCredential, module: string, id: string | null): Promise<boolean> => {
    if (!id) return true;
    try {
      const r = await crm.deleteRecord(cred, module, id);
      return r.ok || r.error.kind === "not-found";
    } catch { return false; }
  };

  const run = async (p: AddPaidPrincipal, raw: unknown, signal?: AbortSignal): Promise<AddPaidResult> => {
    const cred = p.credential, me = cred.userId;
    const today = kolkataDay(clock());
    const checked = checkForm(raw, today);
    if ("code" in checked) return refuse(me, checked.code, checked.message);
    const f = checked.form;

    // 1. the reads: duplicate email, the farm and what it has free
    let farm: Farm;
    try {
      const dup = await byEmail(cred, f.email, signal);
      if (dup) {
        const e = existingOf(dup);
        return refuse(me, "duplicate-email", "That email already belongs to " + (e.name ?? "an investor") + (e.code ? " (" + e.code + ")" : "")
          + ". Open their record instead of adding them twice.", [dup.id], e);
      }
      const fr = await readFarm(cred, f.llpId, signal);
      if (fr === "not-visible") return refuse(me, "farm-not-visible", "Not saved yet — pick the farm.", [f.llpId]);
      if ("closed" in fr) return refuse(me, "farm-closed", (fr.name || "That farm") + " is " + fr.closed + " — it takes no new holdings.", [f.llpId]);
      farm = fr;
    } catch (e) {
      return readFailure(me, e, "contact");
    }
    const ask = { llpId: f.llpId, units: f.units, investorName: f.name };
    let g: Awaited<ReturnType<AddPaidDependencies["oversell"]["check"]>>;
    try { g = await deps.oversell.check(cred, ask, signal); } catch { return notSaved(me, "contact", "unexpected", [f.llpId]); }
    if (!g.ok) {
      if (g.kind === "source-error") return notSaved(me, "contact", g.errorKind, [f.llpId]);
      if (g.reason === "not-found") return refuse(me, "farm-not-visible", "Not saved yet — pick the farm.", [f.llpId]);
      return refuse(me, "units-not-free", "Not saved yet — " + g.message, [f.llpId]);
    }
    const total = f.units * farm.price;
    if (!Number.isSafeInteger(total)) return refuse(me, "units-invalid", "Not saved yet — units are whole units.", [f.llpId]);
    if (f.amountPaid > total) return refuse(me, "overpaid", "Not saved yet — " + inr(f.amountPaid) + " is more than " + pl(f.units, "unit") + " cost (" + inr(total) + ").", [f.llpId]);
    const full = f.amountPaid >= total;

    // 2. the Contact, App_Access = Hold (D115 ruling 1: created On hold, released only by unlock.ts). No email is sent from here (D93).
    const nm = splitName(f.name);
    let contactId: string | null = null, code = "";
    try {
      let highest = await highestCode(cred, signal);
      for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS && !contactId; attempt++) {
        code = nextArlCode(highest);
        const fields: ZohoFields = {
          ...(nm.first ? { First_Name: nm.first } : {}), Last_Name: nm.last, Email: f.email, Mobile: f.mobile,
          ARL_ID: code, App_Access: "Hold", // D115 ruling 1: created On hold; only the release (unlock.ts) moves it to Invite
        };
        const tryCode = code;
        const r = await insertOne(cred, CONTACTS_MODULE, fields, async () => {
          const c = await byEmail(cred, f.email, signal);
          return c && c.ARL_ID === tryCode ? c.id : null;
        }, signal);
        if ("id" in r) { contactId = r.id; break; }
        if (r.failed?.code === "DUPLICATE_DATA" && r.failed.field === "Email") {
          const dup = await byEmail(cred, f.email, signal).catch(() => null);
          const e = dup ? existingOf(dup) : undefined;
          return refuse(me, "duplicate-email", "That email already belongs to " + (e?.name ?? "an investor") + (e?.code ? " (" + e.code + ")" : "")
            + ". Open their record instead of adding them twice.", dup ? [dup.id] : [], e);
        }
        if (r.failed?.code === "DUPLICATE_DATA" && r.failed.field === "ARL_ID") { highest = code; continue; } // another add took this code
        return notSaved(me, "contact", r.kind === "unexpected" && r.failed ? "invalid-data" : r.kind, []);
      }
      if (!contactId) return notSaved(me, "contact", "unexpected", []);
    } catch (e) {
      return readFailure(me, e, "contact");
    }

    // 3. the allotment
    const allot: ZohoFields = {
      Name: (code + " — " + farm.name).slice(0, 120),
      Customer: { id: contactId }, LLP: { id: f.llpId }, Unit_Price: farm.price, Investment_Date: f.investmentDate,
      ...(full
        ? { Allocation_Status: "Issued", Issued_Units: f.units, Reserved_Units: 0, Capital_Invested: total }
        : { Allocation_Status: "Reserved", Reserved_Units: f.units, Issued_Units: 0, Hold_Until: addDays(today, ADD_PAID_HOLD_DAYS) }),
    };
    // M11-S02 AC1: no allotment is written without its Customer and its LLP; what this call wrote so far is taken back.
    const unlinked = writeMissing("create", allot);
    if (unlinked.length) {
      await rollBack(cred, "allotment", ALLOTMENT_UNLINKED, contactId, null, null);
      return refuse(me, ALLOTMENT_UNLINKED, "Not saved yet — " + unlinkedMessage(unlinked), [f.llpId]);
    }
    const firstOf = async (q: string): Promise<string | null> => {
      const r = await crm.coql(cred, q, { signal });
      if (!r.ok) return null;
      const id = r.value.records[0]?.id;
      return validId(id) ? id : null;
    };
    const cid = contactId;
    const a = await insertOne(cred, ALLOTMENTS_MODULE, allot,
      () => firstOf(`select id from ${ALLOTMENTS_MODULE} where Customer = '${cid}' limit 0, 1`), signal);
    if (!("id" in a)) {
      // Zoho's oversell guard (zoho/deluge/oversell_guard.dg) refusing the insert is named with the LLP's free units.
      let named: Awaited<ReturnType<AddPaidDependencies["oversell"]["explain"]>> = null;
      if (a.failed) {
        try {
          named = await deps.oversell.explain(cred, ask, { kind: "invalid-data", status: 200, code: a.failed.code ?? "INVALID_DATA", field: a.failed.field ?? null, records: [a.failed] }, signal);
        } catch { named = null; }
      }
      const back = await rollBack(cred, "allotment", a.failed ? "invalid-data" : a.kind, cid, null, null);
      return named && !back.ok && back.kind === "not-saved" ? refuse(me, "units-not-free", "Not saved yet — " + named.message, [f.llpId]) : back;
    }
    const allotmentId = a.id;

    // 4. the receipt, Pending, through the allotment guard
    const kind = full ? "Full" : "Advance";
    const writer = async (s?: AbortSignal): Promise<ReceiptReplayResult> => {
      const q = `select id from ${RECEIPTS_MODULE} where Allotment = '${allotmentId}' limit 0, 1`;
      const had = await firstOf(q);
      if (had) return { ok: true, receiptId: had, duplicate: true };
      const r = await insertOne(cred, RECEIPTS_MODULE, {
        Name: (code + " · " + kind).slice(0, 120),
        Allotment: { id: allotmentId }, Kind: kind, Amount: f.amountPaid,
        Received_On: f.investmentDate + "T00:00:00+05:30", Match_State: "Pending",
        Note: "Paid before the console — added with the investor",
      }, () => firstOf(q), s);
      if ("id" in r) return { ok: true, receiptId: r.id, duplicate: false };
      return { ok: false, kind: "source-error", source: "zoho", errorKind: r.failed ? "invalid-data" : r.kind, retryable: retryableKind(r.kind) };
    };
    let receiptId: string | null = null, why = "unexpected";
    try {
      const w = await deps.receipts.guarded(p, allotmentId, kind, writer, signal);
      if (w.ok) receiptId = w.receiptId;
      else why = w.kind === "refused" ? w.reasonCode : "errorKind" in w ? w.errorKind : w.kind;
    } catch { why = "unexpected"; }
    if (!receiptId) {
      // the receipt may have landed even though the guard's answer did not
      const late = await firstOf(`select id from ${RECEIPTS_MODULE} where Allotment = '${allotmentId}' limit 0, 1`).catch(() => null);
      return rollBack(cred, "receipt", why, cid, allotmentId, late);
    }

    note(me, "added", [contactId, allotmentId, receiptId]);
    return {
      ok: true,
      value: Object.freeze({
        contactId, code, allotmentId, allocationStatus: full ? "Issued" as const : "Reserved" as const, receiptId,
        app: ADD_PAID_APP, replayed: false,
      }),
    };
  };

  function notSaved(me: string, step: "contact" | "allotment" | "receipt", kind: string, ids: readonly unknown[]): AddPaidResult {
    note(me, "not-saved-" + step, ids);
    return { ok: false, kind: "not-saved", step, errorKind: kind, message: "Not saved yet — Zoho did not take it. Nothing was kept; try again.", retryable: retryableKind(kind) };
  }
  function readFailure(me: string, e: unknown, step: "contact"): AddPaidResult {
    if (e instanceof Unreadable) return notSaved(me, step, "source-invalid", e.ids);
    if (e instanceof SourceFail) return notSaved(me, step, e.kind, []);
    return notSaved(me, step, "unexpected", []);
  }
  async function rollBack(cred: UserCredential, step: "allotment" | "receipt", kind: string, contactId: string, allotmentId: string | null, receiptId: string | null): Promise<AddPaidResult> {
    const gone = [
      await remove(cred, RECEIPTS_MODULE, receiptId),
      await remove(cred, ALLOTMENTS_MODULE, allotmentId),
    ];
    const contactGone = gone.every(Boolean) ? await remove(cred, CONTACTS_MODULE, contactId) : false;
    if (gone.every(Boolean) && contactGone) return notSaved(cred.userId, step, kind, [contactId, allotmentId, receiptId]);
    note(cred.userId, "rollback-incomplete", [contactId, allotmentId, receiptId]);
    return {
      ok: false, kind: "incomplete", step,
      left: Object.freeze({ contactId, allotmentId: gone[1] ? null : allotmentId, receiptId: gone[0] ? null : receiptId }),
      message: "Not saved yet — and part of it could not be taken back. Digital Infrastructure has been told; do not add them again.",
      retryable: false,
    };
  }

  const service: AddPaidService = {
    async add(principal, form, idempotencyKey, signal) {
      const c = principal && typeof principal === "object" ? principal : null;
      if (!c || !isUserCredential(c.credential) || typeof c.sessionId !== "string" || !SESSION_ID.test(c.sessionId)) {
        note("unrecognised", "invalid-request");
        return { ok: false, kind: "refused", reasonCode: "invalid-request", message: "Not saved yet — sign in again.", retryable: false };
      }
      const me = c.credential.userId;
      if (idempotencyKey !== undefined && idempotencyKey !== null && (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey))) {
        return refuse(me, "idempotency-key-invalid", "Not saved yet — reload the page and try again.");
      }
      let allowed = false;
      try { allowed = await deps.authority.mayAdd(c.credential, c.sessionId, signal); } catch { allowed = false; }
      if (!allowed) return refuse(me, "not-finance", "Adding an investor is Finance's.");
      if (!idempotencyKey) return run(c, form, signal);

      const now = clock();
      for (const [k, v] of replays) if (now - v.at > ADD_PAID_REPLAY_TTL_MS) replays.delete(k);
      const key = me + ":" + idempotencyKey;
      const held = replays.get(key);
      if (held) {
        const r = await held.result;
        return r.ok ? { ok: true, value: Object.freeze({ ...r.value, replayed: true }) } : r;
      }
      if (replays.size >= MAX_REPLAYS) return refuse(me, "in-progress", "Not saved yet — the console is busy. Try again in a minute.");
      const result = run(c, form, signal);
      replays.set(key, { at: now, result });
      const r = await result;
      if (!r.ok) replays.delete(key); // only a success is replayed; a failure may be retried with the same key
      return r;
    },
  };
  return Object.freeze(service);
}
