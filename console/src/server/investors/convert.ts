/**
 * GC-1527 / D137 ruling 1 — THE INVESTOR IS CREATED ONLY AFTER FINANCE CONFIRMS THE 10%, BY FINANCE, ON FINANCE'S OWN TOKEN.
 *
 * Before D137 nothing in the console created a Contact from a lead (the old D60 story — "the investor record is created at Said
 * yes" — lived only in the demo's investor-copy action and in the Transfers page's words; add-paid creates Contacts only for people
 * who paid before the console). Now the lead stays a lead until Finance has matched money worth 10% of what the investor commits:
 *
 *   record   Finance (Finance Operations, Head of Finance — `authority.mayConfirm`) records a receipt AGAINST THE LEAD: one Receipts
 *            record with the D137 lookup Receipts.Lead (no allotment exists yet), Kind Advance / Part / Full, Amount, Mode, UTR,
 *            Received_On and — Finance recording IS Finance's match (D113 ruling 1) — Match_State Matched, Matched_By = the recorder,
 *            Matched_At = now (IST). Recording is never refused for the 10% (rule 3). UTR is unique in Zoho, so a double press or a
 *            lost answer is resolved by reading the reference back: exactly one record.
 *   convert  with the terms (farm = LLP, units; units default to the lead's Units_Interested), the committed amount is units × the
 *            farm's Pet_Unit_Price and the 10% is lib/money/ten-percent over the lead's matched receipts (Parts summed, ruling 2(a)).
 *            Reached → in this order, each step resumable (a second press continues where the first stopped, no rollback):
 *              1. the Contact — read first by Origin_Lead (already converted → `already`); else inserted with the lead's name,
 *                 email and mobile, a fresh ARL_ID, App_Access = Hold (D115 ruling 1), Origin_Lead = the lead, Said_Yes_At copied,
 *                 Originating_IR = the lead's Owner (D122 keeps that field to Admin / AM Head / DI: if Zoho refuses it the Contact
 *                 is written without it; and since Zoho may also ACCEPT the insert and drop the field, the answer says `originatingIr:
 *                 "written"` only when the Contact read back carries it (W7-FIN-2), else "not-written" — see D137 / D138 §7);
 *              2. the allotment — Reserved, Reserved_Units, Unit_Price, Investment_Date = today (IST), Hold_Until = 30 days from
 *                 this confirmation (the 10% is in: the balance is due within 30 days, D136's workflow), through the oversell
 *                 guard first (farms/oversell);
 *              3. every lead receipt not yet on an allotment is linked to it (Receipts.Allotment, guarded by its Modified_Time);
 *              4. D140: the allotment's Total_Amount_Received is brought in line with its matched receipts (money/received-total,
 *                 its one writer, on Finance's token, guarded) — reported as `received`, never undoing the conversion;
 *              5. if the money already covers the commitment, the full conversion runs (investors/full-paid auto).
 *            Not reached → nothing is written and the answer carries the trail and what is still to go.
 *   trail    the same reads, no writes: what Finance (and Digital Infrastructure, read-only) sees on the lead's Money view.
 *
 * The Transfers page (/xfer, G3) becomes the read-only log of leads that became investors this way; there is no manual copy action.
 * Logs carry ids and codes only — never the name, email, mobile, amount or reference. The full UTR is never logged or answered.
 */
import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord, ZohoResult } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { RecordOutcome, ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { maskReference, tenPercentTrail, type TenPercentTrail } from "../../lib/money/ten-percent";
import type { OversellGuard } from "../farms/oversell";
import { MATCHED_AT_FIELD, RECEIPT_LEAD_FIELD, readReceipts } from "../money/matched-receipts";
import { RECEIPT_MODES } from "../money/receipt-replay";
import { syncReceived, type ReceivedSync } from "../money/received-total";
import { nextArlCode, splitName } from "./add-paid";
import { istIso, type FullPaid, type AutoOutcome } from "./full-paid";

export const LEADS = "Leads";
export const CONTACTS = "Contacts";
export const ALLOTMENTS = "LLP_UnitAllocation_Module";
export const LLPS = "LLP_Creation_Module";
export const RECEIPTS = "Receipts";
export const HOLD_DAYS = 30;
export const LEAD_FIELDS = Object.freeze(["First_Name", "Last_Name", "Email", "Mobile", "Owner", "Units_Interested", "Lost_At", "Said_Yes_At", "Lead_Status"]);
const ON_SALE: ReadonlySet<string> = new Set(["Open for Reservation", "Open for Issuance"]);
const RECORD_KINDS: ReadonlySet<string> = new Set(["Advance", "Part", "Full"]);
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const UTR = /^[A-Z0-9][A-Z0-9._/-]{2,79}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const ARL_CODE = /^ARL-INV-\d{4}$/;
const MAX_CODE_ATTEMPTS = 3;

export const istDay = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
export const holdFrom = (ms: number): string => new Date(Date.parse(`${istDay(ms)}T00:00:00Z`) + HOLD_DAYS * 86_400_000).toISOString().slice(0, 10);

export type ConvertRefusal =
  | "invalid-request" | "not-finance" | "lead-not-visible" | "lead-lost" | "fields-missing" | "receipt-invalid" | "reference-reused"
  | "terms-invalid" | "farm-not-visible" | "farm-closed" | "units-not-free" | "ten-percent-not-reached" | "duplicate-email" | "receipts-unread";

const MESSAGE: Readonly<Record<ConvertRefusal, string>> = Object.freeze({
  "invalid-request": "Not saved — reload the lead and try again.",
  "not-finance": "Finance confirms the 10% — Finance Operations or the Head of Finance.",
  "lead-not-visible": "This lead is not shared with Finance in Zoho yet, so it cannot be read here. Digital Infrastructure adds the Finance sharing rule on Leads.",
  "lead-lost": "This lead is closed as lost — it does not become an investor.",
  "fields-missing": "Receipts on a lead need the Receipts.Lead field in Zoho (D137). Digital Infrastructure creates it; until then record the money after the investor exists.",
  "receipt-invalid": "Not saved — the receipt needs a kind (advance, part or full), a whole-rupee amount, the mode, the bank reference and a received day not in the future.",
  "reference-reused": "Not saved — that bank reference is already on another receipt.",
  "terms-invalid": "Pick the farm and the units (whole units) the investor commits to.",
  "farm-not-visible": "Pick the farm.",
  "farm-closed": "That farm takes no new holdings.",
  "units-not-free": "That farm does not have the free units.",
  "ten-percent-not-reached": "Not converted — Finance-matched money on this lead does not reach 10% of the committed amount yet.",
  "duplicate-email": "That email already belongs to an investor. Open their record instead of creating them twice.",
  "receipts-unread": "The lead's receipts could not be read, so the 10% cannot be confirmed. Try again.",
});

export interface ConvertPrincipal { readonly credential: UserCredential; readonly sessionId: string; readonly seat?: string | null }
export interface ConvertAuthority {
  /** Fresh on the live session: Finance Operations or the Head of Finance (the ones who confirm money). */
  mayConfirm(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
  /** May read the lead's money trail (Finance, Digital Infrastructure). Absent: mayConfirm decides. */
  mayRead?(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}
export interface ReceiptInput { readonly kind: string; readonly amount: number; readonly mode: string; readonly utr: string; readonly receivedOn: string }
export interface Terms { readonly llpId: string; readonly units: number }

export interface LeadMoney {
  readonly leadId: string;
  readonly unitsInterested: number | null;
  /** the investor this lead became, when it already has (read by Origin_Lead on the person's own token) */
  readonly investor: { readonly contactId: string; readonly code: string | null } | null;
  readonly farm: { readonly llpId: string; readonly name: string; readonly unitPrice: number } | null;
  readonly units: number | null;
  readonly trail: TenPercentTrail;
}
export interface Converted {
  readonly contactId: string;
  readonly code: string;
  readonly allotmentId: string;
  readonly holdUntil: string;
  readonly relinked: number;
  readonly relinkLeft: readonly string[];
  readonly originatingIr: "written" | "not-written";
  readonly fullPaid: AutoOutcome | null;
  readonly already: boolean;
  /** D140: Total_Amount_Received on the allotment after this press (money/received-total), or why it was not written */
  readonly received?: ReceivedSync | null;
}
export type ConvertResult =
  | { readonly ok: true; readonly value: { readonly money: LeadMoney; readonly recorded: { readonly receiptId: string; readonly duplicate: boolean; readonly refMasked: string } | null; readonly converted: Converted | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: ConvertRefusal; readonly message: string; readonly money?: LeadMoney; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly step: string; readonly errorKind: ZohoFailureKind | "unexpected" | string; readonly message: string; readonly retryable: boolean };

export interface ConvertDeps {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "insert" | "update">;
  readonly oversell: Pick<OversellGuard, "check">;
  readonly authority: ConvertAuthority;
  readonly fullPaid?: Pick<FullPaid, "auto">;
  readonly log: OpsLog;
  readonly events?: { investorConverted?(userId: string, seat: string | null, recordIds: readonly string[], outcome: "ok" | "refused", reason: string): void };
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

class Fail { constructor(readonly step: string, readonly kind: ZohoFailureKind | "unexpected" | string) {} }
const retryable = (k: string): boolean => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected" || k === "aborted";
const outcomesOf = (r: ZohoResult<readonly RecordOutcome[]>): readonly RecordOutcome[] | null =>
  r.ok ? r.value : r.error.kind === "partial" ? r.error.records : r.error.kind === "invalid-data" ? r.error.records : null;
const names = (e: { field?: string | null; records?: readonly { field?: string | null }[] }, f: string): boolean =>
  e.field === f || (e.records ?? []).some((r) => r.field === f);

export function createConversion(deps: ConvertDeps) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.crm?.update !== "function" || typeof deps.oversell?.check !== "function"
    || typeof deps.authority?.mayConfirm !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("conversion needs crm (getRecord/coql/insert/update), the oversell guard, the Finance authority, the ops log and the record-id prefix");
  }
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const now = () => { try { return clock(); } catch { return 0; } };
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    if (validId(v)) return v;
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  const note = (me: string, reason: string, ids: readonly unknown[]) =>
    log.refusal({ at: now(), actor: { kind: "user", userId: me }, action: "lead-convert", reason, recordIds: ids.filter(validId) });
  const planeC = (me: string, seat: string | null, ids: readonly unknown[], outcome: "ok" | "refused", reason: string) => {
    try { deps.events?.investorConverted?.(me, seat, ids.filter(validId) as string[], outcome, reason); } catch { /* never blocks */ }
  };
  const refuse = (p: ConvertPrincipal | null, code: ConvertRefusal, ids: readonly unknown[] = [], money?: LeadMoney): ConvertResult => {
    const me = p?.credential.userId ?? "unrecognised";
    note(me, code, ids);
    return { ok: false, kind: "refused", reasonCode: code, message: MESSAGE[code], ...(money ? { money } : {}), retryable: false };
  };
  const failed = (p: ConvertPrincipal, f: Fail): ConvertResult => {
    note(p.credential.userId, `not-saved-${f.step}-${f.kind}`.slice(0, 48), []);
    return { ok: false, kind: "source-error", step: f.step, errorKind: f.kind, retryable: retryable(String(f.kind)),
      message: retryable(String(f.kind)) ? "Not finished — Zoho is not answering. Press again; it continues where it stopped." : "Not finished — Zoho refused it." };
  };
  const trusted = (x: unknown): ConvertPrincipal | null => {
    const c = x && typeof x === "object" ? (x as { credential?: unknown; sessionId?: unknown; seat?: unknown }) : null;
    return c && isUserCredential(c.credential) && typeof c.sessionId === "string" && SESSION_ID.test(c.sessionId)
      ? { credential: c.credential, sessionId: c.sessionId, seat: typeof c.seat === "string" ? c.seat : null } : null;
  };

  /* ---- reads (the person's own token) -------------------------------------------------------------- */
  async function readLead(cred: UserCredential, leadId: string, signal?: AbortSignal): Promise<ZohoRecord | null> {
    const r = await crm.getRecord(cred, LEADS, leadId, { fields: LEAD_FIELDS, signal }).catch(() => null);
    if (!r) throw new Fail("lead", "unexpected");
    if (!r.ok) { if (r.error.kind === "not-found" || r.error.kind === "forbidden") return null; throw new Fail("lead", r.error.kind); }
    return r.value && r.value.id === leadId ? r.value : null;
  }
  async function investorOf(cred: UserCredential, leadId: string, signal?: AbortSignal): Promise<{ contactId: string; code: string | null } | null> {
    const r = await crm.coql(cred, `select id, ARL_ID from ${CONTACTS} where Origin_Lead = '${leadId}' order by id asc limit 0, 2`, { signal }).catch(() => null);
    if (!r || !r.ok) throw new Fail("contact", r && !r.ok ? r.error.kind : "unexpected");
    const c = r.value.records.find((x) => validId(x.id));
    return c ? { contactId: c.id, code: typeof c.ARL_ID === "string" && ARL_CODE.test(c.ARL_ID) ? c.ARL_ID : null } : null;
  }
  async function readFarm(cred: UserCredential, llpId: string, signal?: AbortSignal): Promise<{ name: string; price: number; open: boolean } | null> {
    const r = await crm.getRecord(cred, LLPS, llpId, { fields: ["Name", "Pet_Unit_Price", "LLP_Status"], signal }).catch(() => null);
    if (!r) throw new Fail("farm", "unexpected");
    if (!r.ok) { if (r.error.kind === "not-found" || r.error.kind === "forbidden") return null; throw new Fail("farm", r.error.kind); }
    const l = r.value;
    if (!l || l.id !== llpId || typeof l.Pet_Unit_Price !== "number" || !Number.isSafeInteger(l.Pet_Unit_Price) || l.Pet_Unit_Price <= 0) return null;
    return { name: typeof l.Name === "string" ? l.Name.slice(0, 80) : "", price: l.Pet_Unit_Price, open: typeof l.LLP_Status === "string" && ON_SALE.has(l.LLP_Status) };
  }
  const termsOf = (raw: unknown, lead: ZohoRecord): Terms | null | "invalid" => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
    const t = raw as Record<string, unknown>;
    const units = t.units === undefined || t.units === null ? lead.Units_Interested : t.units;
    if (!validId(t.llpId) || typeof units !== "number" || !Number.isSafeInteger(units) || units <= 0 || units > 10_000) return "invalid";
    return { llpId: t.llpId, units };
  };

  /** The lead's money as Finance sees it: its receipts (Receipts.Lead) and, with terms, the 10% of what is committed. */
  async function money(p: ConvertPrincipal, leadId: string, lead: ZohoRecord, terms: Terms | null, signal?: AbortSignal)
    : Promise<LeadMoney | ConvertRefusal> {
    const cred = p.credential;
    const r = await readReceipts(crm, cred, `${RECEIPT_LEAD_FIELD} = '${leadId}'`, signal, { withLead: true });
    if (!r.ok) return r.kind === "fields-missing" ? "fields-missing" : "receipts-unread";
    let farm: LeadMoney["farm"] = null;
    if (terms) {
      const f = await readFarm(cred, terms.llpId, signal);
      if (!f) return "farm-not-visible";
      farm = { llpId: terms.llpId, name: f.name, unitPrice: f.price };
    }
    const committed = farm && terms ? farm.unitPrice * terms.units : null;
    const ui = lead.Units_Interested;
    return Object.freeze({
      leadId, unitsInterested: typeof ui === "number" && Number.isSafeInteger(ui) ? ui : null,
      investor: await investorOf(cred, leadId, signal), farm, units: terms?.units ?? null,
      trail: tenPercentTrail(committed !== null && Number.isSafeInteger(committed) ? committed : null, r.rows.filter((x) => x.leadId === leadId)),
    });
  }

  /* ---- writes (the person's own token) ------------------------------------------------------------- */
  async function insertOne(cred: UserCredential, module: string, fields: ZohoFields, signal?: AbortSignal)
    : Promise<{ id: string } | { failed: RecordOutcome | null; kind: string }> {
    let r: ZohoResult<readonly RecordOutcome[]>;
    try { r = await crm.insert(cred, module, [fields], { signal }); } catch { return { failed: null, kind: "network" }; }
    const outs = outcomesOf(r);
    const o = outs && outs.length === 1 ? outs[0]! : null;
    if (r.ok && o && o.ok && validId(o.id)) return { id: o.id };
    return { failed: o && !o.ok ? o : null, kind: r.ok ? "invalid-data" : r.error.kind };
  }

  async function recordOnLead(p: ConvertPrincipal, leadId: string, raw: unknown, signal?: AbortSignal)
    : Promise<{ receiptId: string; duplicate: boolean; refMasked: string } | ConvertRefusal> {
    const cred = p.credential, me = cred.userId;
    const x = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const utr = typeof x.utr === "string" ? x.utr.trim().toUpperCase() : "";
    const today = istDay(now());
    const r: ReceiptInput | null = typeof x.kind === "string" && RECORD_KINDS.has(x.kind) && typeof x.amount === "number" && Number.isSafeInteger(x.amount) && x.amount > 0
      && typeof x.mode === "string" && (RECEIPT_MODES as readonly string[]).includes(x.mode) && UTR.test(utr)
      && typeof x.receivedOn === "string" && DAY.test(x.receivedOn) && x.receivedOn <= today
      ? { kind: x.kind, amount: x.amount, mode: x.mode, utr, receivedOn: x.receivedOn } : null;
    if (!r) return "receipt-invalid";
    const byRef = async (): Promise<ZohoRecord | null> => {
      const q = await crm.coql(cred, `select id, ${RECEIPT_LEAD_FIELD}, Allotment from ${RECEIPTS} where UTR = '${r.utr}' limit 0, 2`, { signal }).catch(() => null);
      return q && q.ok ? q.value.records.find((y) => validId(y.id)) ?? null : null;
    };
    const fields: ZohoFields = {
      Name: (`Lead ${leadId} · ${r.kind}`).slice(0, 120), [RECEIPT_LEAD_FIELD]: { id: leadId }, Kind: r.kind, Amount: r.amount, Mode: r.mode, UTR: r.utr,
      Received_On: `${r.receivedOn}T00:00:00+05:30`, Match_State: "Matched", Matched_By: { id: me }, [MATCHED_AT_FIELD]: istIso(now()),
      Note: "Recorded by Finance against the lead, before the investor exists (D137)",
    };
    let w = await insertOne(cred, RECEIPTS, fields, signal);
    if (!("id" in w) && w.failed && w.failed.field === MATCHED_AT_FIELD) {
      const { [MATCHED_AT_FIELD]: _drop, ...rest } = fields;
      w = await insertOne(cred, RECEIPTS, rest, signal);
    }
    if ("id" in w) { note(me, "lead-receipt-recorded", [leadId, w.id]); return { receiptId: w.id, duplicate: false, refMasked: maskReference(r.utr) }; }
    if (w.failed?.field === RECEIPT_LEAD_FIELD) return "fields-missing";
    if (w.failed?.code === "DUPLICATE_DATA" || w.kind === "network" || w.kind === "server" || w.kind === "aborted") {
      const had = await byRef();
      if (had && idOf(had[RECEIPT_LEAD_FIELD]) === leadId) return { receiptId: had.id, duplicate: true, refMasked: maskReference(r.utr) };
      if (had) return "reference-reused";
    }
    throw new Fail("receipt", w.kind);
  }

  async function highestCode(cred: UserCredential, signal?: AbortSignal): Promise<string | null> {
    const r = await crm.coql(cred, `select ARL_ID from ${CONTACTS} where ARL_ID like 'ARL-INV-%' order by ARL_ID desc limit 0, 1`, { signal }).catch(() => null);
    if (!r || !r.ok) throw new Fail("contact", r && !r.ok ? r.error.kind : "unexpected");
    const v = r.value.records[0]?.ARL_ID;
    return typeof v === "string" && ARL_CODE.test(v) ? v : null;
  }

  /** W7-FIN-2: "written" only when the Contact READ BACK on Finance's token carries an Originating_IR. Zoho accepts an insert
   *  naming a field the profile may not edit and silently drops it (D122 keeps Originating_IR to Admin / AM Head / DI), so the
   *  insert's success proves nothing. A refused or failed read is not proof either: "not-written". */
  async function originatingIrOf(cred: UserCredential, contactId: string, signal?: AbortSignal): Promise<"written" | "not-written"> {
    const r = await crm.getRecord(cred, CONTACTS, contactId, { fields: ["Originating_IR"], signal }).catch(() => null);
    return r && r.ok && r.value && validId(idOf(r.value.Originating_IR)) ? "written" : "not-written";
  }

  /** Step 1: the Contact (resumable: found by Origin_Lead first). */
  async function ensureContact(p: ConvertPrincipal, leadId: string, lead: ZohoRecord, signal?: AbortSignal)
    : Promise<{ contactId: string; code: string; originatingIr: "written" | "not-written"; created: boolean } | "duplicate-email"> {
    const cred = p.credential;
    const have = await investorOf(cred, leadId, signal);
    if (have) return { contactId: have.contactId, code: have.code ?? "", originatingIr: await originatingIrOf(cred, have.contactId, signal), created: false };
    /* Zoho needs Last_Name: the lead's, else the last word of its first name (splitName, as add-paid does) */
    const leadFirst = typeof lead.First_Name === "string" ? lead.First_Name.trim() : "";
    const hasLast = typeof lead.Last_Name === "string" && !!lead.Last_Name.trim();
    const split = splitName(leadFirst || "Investor");
    const last = hasLast ? (lead.Last_Name as string).trim() : split.last;
    const first = hasLast ? leadFirst : split.first ?? "";
    const owner = idOf(lead.Owner);
    let highest = await highestCode(cred, signal);
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      const code = nextArlCode(highest);
      const base: ZohoFields = {
        ...(first ? { First_Name: first } : {}), Last_Name: last,
        ...(typeof lead.Email === "string" && lead.Email ? { Email: lead.Email } : {}),
        ...(typeof lead.Mobile === "string" && lead.Mobile ? { Mobile: lead.Mobile } : {}),
        ARL_ID: code, App_Access: "Hold", Origin_Lead: { id: leadId },
        ...(typeof lead.Said_Yes_At === "string" && ZDT.test(lead.Said_Yes_At) ? { Said_Yes_At: lead.Said_Yes_At } : {}),
      };
      let originatingIr: "written" | "not-written" = owner ? "written" : "not-written";
      let w = await insertOne(cred, CONTACTS, owner ? { ...base, Originating_IR: { id: owner } } : base, signal);
      /* D122: Originating_IR is editable by Admin / AM Head / DI only — refused for Finance, the Contact is written without it */
      if (!("id" in w) && owner && (w.failed?.field === "Originating_IR" || w.kind === "forbidden")) {
        originatingIr = "not-written";
        w = await insertOne(cred, CONTACTS, base, signal);
      }
      if ("id" in w) return { contactId: w.id, code, originatingIr: originatingIr === "written" ? await originatingIrOf(cred, w.id, signal) : originatingIr, created: true };
      if (w.failed?.code === "DUPLICATE_DATA" && w.failed.field === "ARL_ID") { highest = code; continue; }
      if (w.failed?.code === "DUPLICATE_DATA" && w.failed.field === "Email") {
        const raced = await investorOf(cred, leadId, signal);   // a racing press of the same conversion took it
        if (raced) return { contactId: raced.contactId, code: raced.code ?? "", originatingIr: await originatingIrOf(cred, raced.contactId, signal), created: false };
        return "duplicate-email";
      }
      if (w.kind === "network" || w.kind === "server") {
        const late = await investorOf(cred, leadId, signal);
        if (late) return { contactId: late.contactId, code: late.code ?? code, originatingIr: await originatingIrOf(cred, late.contactId, signal), created: true };
      }
      throw new Fail("contact", w.kind);
    }
    throw new Fail("contact", "arl-code-taken");
  }

  /** Step 2: the Reserved allotment (resumable: the Contact's live allotment on this farm is reused). */
  async function ensureAllotment(p: ConvertPrincipal, contactId: string, code: string, farm: NonNullable<LeadMoney["farm"]>, units: number, signal?: AbortSignal)
    : Promise<{ allotmentId: string; holdUntil: string; created: boolean } | "units-not-free" | "farm-closed"> {
    const cred = p.credential;
    const q = await crm.coql(cred, `select id, LLP, Allocation_Status, Hold_Until from ${ALLOTMENTS} where Customer = '${contactId}' order by id asc limit 0, 50`, { signal }).catch(() => null);
    if (!q || !q.ok) throw new Fail("allotment", q && !q.ok ? q.error.kind : "unexpected");
    const live = q.value.records.find((a) => validId(a.id) && idOf(a.LLP) === farm.llpId && a.Allocation_Status !== "Cancelled");
    if (live) return { allotmentId: live.id, holdUntil: typeof live.Hold_Until === "string" ? live.Hold_Until.slice(0, 10) : "", created: false };
    const g = await deps.oversell.check(cred, { llpId: farm.llpId, units }, signal).catch(() => null);
    if (!g) throw new Fail("allotment", "unexpected");
    if (!g.ok) {
      if (g.kind === "source-error") throw new Fail("allotment", g.errorKind);
      return g.reason === "not-released" ? "farm-closed" : "units-not-free";
    }
    const holdUntil = holdFrom(now());
    const w = await insertOne(cred, ALLOTMENTS, {
      Name: (`${code || contactId} — ${farm.name}`).slice(0, 120), Customer: { id: contactId }, LLP: { id: farm.llpId },
      Unit_Price: farm.unitPrice, Total_Amount_Receivable: units * farm.unitPrice, Investment_Date: istDay(now()), Allocation_Status: "Reserved", Reserved_Units: units, Issued_Units: 0, Hold_Until: holdUntil,
    }, signal);
    if ("id" in w) return { allotmentId: w.id, holdUntil, created: true };
    throw new Fail("allotment", w.kind);
  }

  /** Step 3: the lead's receipts onto the allotment. Each guarded by its own Modified_Time; what is left is reported. */
  async function relink(p: ConvertPrincipal, leadId: string, allotmentId: string, signal?: AbortSignal): Promise<{ done: number; left: string[] }> {
    const r = await readReceipts(crm, p.credential, `${RECEIPT_LEAD_FIELD} = '${leadId}'`, signal, { withLead: true });
    if (!r.ok) return { done: 0, left: ["unread"] };
    let done = 0;
    const left: string[] = [];
    for (const x of r.rows) {
      if (x.allotmentId) continue;
      const w = await crm.update(p.credential, RECEIPTS, x.id, { Allotment: { id: allotmentId } }, { ifUnmodifiedSince: x.modifiedTime, signal }).catch(() => null);
      if (w && w.ok) done++; else left.push(x.id);
    }
    if (left.length) note(p.credential.userId, "relink-left", [leadId, allotmentId, ...left]);
    return { done, left };
  }

  async function begin(principal: unknown, leadId: unknown, signal: AbortSignal | undefined, write: boolean)
    : Promise<{ p: ConvertPrincipal; lead: ZohoRecord } | ConvertResult> {
    const p = trusted(principal);
    if (!p) return refuse(null, "invalid-request");
    let may = false;
    try {
      may = write || typeof deps.authority.mayRead !== "function"
        ? (await deps.authority.mayConfirm(p.credential, p.sessionId, signal)) === true
        : (await deps.authority.mayRead(p.credential, p.sessionId, signal)) === true;
    } catch { may = false; }
    if (!may) return refuse(p, "not-finance", [leadId]);
    if (!validId(leadId)) return refuse(p, "invalid-request");
    let lead: ZohoRecord | null;
    try { lead = await readLead(p.credential, leadId, signal); } catch (e) { return failed(p, e instanceof Fail ? e : new Fail("lead", "unexpected")); }
    if (!lead) return refuse(p, "lead-not-visible", [leadId]);
    if (typeof lead.Lost_At === "string" && lead.Lost_At) return refuse(p, "lead-lost", [leadId]);
    return { p, lead };
  }

  return Object.freeze({
    /** The lead's Money view: receipts on the lead and, with terms, the 10% trail. No writes. */
    async trail(principal: unknown, leadId: unknown, terms?: unknown, signal?: AbortSignal): Promise<ConvertResult> {
      const b = await begin(principal, leadId, signal, false);
      if ("ok" in b) return b;
      const t = termsOf(terms, b.lead);
      if (t === "invalid") return refuse(b.p, "terms-invalid", [leadId]);
      try {
        const m = await money(b.p, leadId as string, b.lead, t, signal);
        if (typeof m === "string") return refuse(b.p, m, [leadId]);
        return { ok: true, value: { money: m, recorded: null, converted: null } };
      } catch (e) { return failed(b.p, e instanceof Fail ? e : new Fail("read", "unexpected")); }
    },

    /**
     * Finance's press: optionally record a receipt on the lead, then — with terms — confirm the 10% and create the investor.
     * body: { receipt?: { kind, amount, mode, utr, receivedOn }, terms?: { llpId, units? } }.
     */
    async confirm(principal: unknown, leadId: unknown, body: unknown, signal?: AbortSignal): Promise<ConvertResult> {
      const b = await begin(principal, leadId, signal, true);
      if ("ok" in b) return b;
      const { p, lead } = b, me = p.credential.userId, id = leadId as string;
      const x = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const t = termsOf(x.terms, lead);
      if (t === "invalid") return refuse(p, "terms-invalid", [id]);
      try {
        let recorded: { receiptId: string; duplicate: boolean; refMasked: string } | null = null;
        if (x.receipt !== undefined && x.receipt !== null) {
          const r = await recordOnLead(p, id, x.receipt, signal);
          if (typeof r === "string") return refuse(p, r, [id]);
          recorded = r;
        }
        const m = await money(p, id, lead, t, signal);
        if (typeof m === "string") return refuse(p, m, [id]);
        if (!t || !m.farm) return { ok: true, value: { money: m, recorded, converted: null } };
        if (!m.investor && !m.trail.reached) {
          planeC(me, p.seat ?? null, [id], "refused", "ten-percent-not-reached");
          return recorded ? { ok: true, value: { money: m, recorded, converted: null } } : refuse(p, "ten-percent-not-reached", [id], m);
        }
        const farm = await readFarm(p.credential, m.farm.llpId, signal);
        if (!m.investor && farm && !farm.open) return refuse(p, "farm-closed", [id, m.farm.llpId], m);
        const c = await ensureContact(p, id, lead, signal);
        if (c === "duplicate-email") return refuse(p, "duplicate-email", [id], m);
        const a = await ensureAllotment(p, c.contactId, c.code, m.farm, t.units, signal);
        if (a === "units-not-free" || a === "farm-closed") return refuse(p, a, [id, c.contactId, m.farm.llpId], m);
        const rl = await relink(p, id, a.allotmentId, signal);
        const received = await syncReceived(crm, p.credential, a.allotmentId, signal, log, now).catch((): ReceivedSync => ({ ok: false, value: null, code: "unexpected" }));
        let full: AutoOutcome | null = null;
        if (m.trail.fullyPaid && deps.fullPaid) full = await deps.fullPaid.auto(p.credential, a.allotmentId, signal).catch(() => ({ ok: false, value: null, code: "unexpected" }));
        const already = !c.created && !a.created;
        note(me, already ? "already-converted" : "converted", [id, c.contactId, a.allotmentId]);
        if (!already) planeC(me, p.seat ?? null, [id, c.contactId, a.allotmentId], "ok", "ten-percent-confirmed");
        const fresh = await money(p, id, lead, t, signal).catch(() => m);
        return { ok: true, value: { money: typeof fresh === "string" ? m : fresh, recorded, converted: Object.freeze({
          contactId: c.contactId, code: c.code, allotmentId: a.allotmentId, holdUntil: a.holdUntil, relinked: rl.done, relinkLeft: Object.freeze(rl.left),
          originatingIr: c.originatingIr, fullPaid: full, already, received,
        }) } };
      } catch (e) { return failed(p, e instanceof Fail ? e : new Fail("convert", "unexpected")); }
    },
  });
}
export type Conversion = ReturnType<typeof createConversion>;
