/**
 * M16-S08-T01 / M16-S09-T01 — THE INVESTORS SIDE OF NUMBERS: Collection, balance ageing ("At risk"), Paper and
 * Compliance, worked out live from Zoho on the signed-in person's own token (D45, D53), and refused server-side to a
 * seat that may not read money (D13, D40, D68).
 *
 * Sections (prototype vIns keys):
 *   cash   Collection — banked (matched Receipts, D21) and committed (allotment units × unit price) per farm LLP,
 *          committed-not-yet-in (Reserved balance due), the full programme (Σ LLP Total_Units × Pet_Unit_Price),
 *          per cent collected of committed and of the programme. Four COQL aggregates (≤ 4 group fields,
 *          ≤ 5 aggregates each, checked by `checkAggregate`) + the live allotment rows the balance needs (the rule
 *          of ../holds/rules, the same as Today's headline). Only the NUMBERS are cached, keyed by the seat's money
 *          scope (../data/scope scopedKey: `role:org|org.numbers.investors.cash` for Finance, never a KAM's key).
 *   risk   Balance ageing — every live allotment part-paid (matched net > 0 and still due > 0; the org has no
 *          Payment_Status field, allotments.ts) with days since its last matched inbound Receipt, oldest first.
 *          COQL cannot MIN/MAX dates, so the receipts are grouped by Allotment, Kind, Received_On and aged here.
 *          Rows: never cached.
 *   paper  Out for signature, oldest first — ../documents/list (cut "out", the Investors side), with the document,
 *          the allotment or Contact, the signing method, and sender / days out / link expiry from the Zoho Sign
 *          status when a per-viewer reader is wired (none yet — those read null and sort last).
 *   comp   Who is not compliant — Contacts whose KYC is not Completed/NA, whose FEMA declaration is outstanding,
 *          or whose PAN proof / bank proof is not on file. The proof slots are file-upload fields COQL cannot filter
 *          ("unsupported column in criteria", checked 28 Sep 2026), so a slot counts as missing while its
 *          *_Proof_Verified_At is empty (PROVISIONAL, jev "a" 0.95). No PAN, bank or Aadhaar value is selected.
 *
 * Money rule (reported): the Payments register (../money/register) counts Pending receipts in net banked; this page
 * follows Today and D21 — MATCHED receipts only — so "banked" here equals Today's headline figure.
 *
 * Who is offered what (`investorsSideFor`): an IR, channel partner or IR Manager has no Investors side; a KAM or
 * Head of AM gets Service only (no rupee figure); a seat whose record carries Money over an org/all money scope
 * (Finance, Head of Finance, Compliance, Auditor, viewers, Digital Infrastructure) gets Collection and At risk;
 * Paper where the Documents page is its Investors side; Compliance for org/all Investors books outside AM.
 * A request for a section the seat is not offered is refused BEFORE any cache or Zoho read and logged in Plane C
 * (refused-action) and Plane B; a Zoho 403 on Receipts is refused the same way.
 */

import type { AggregateRow, UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { CacheError, CacheFresh, CacheStale, ScopedCache } from "../../lib/zoho/cache";
import { isAmSeat } from "../data/am-scope";
import { idOf, str } from "../data/contact-row";
import { checkProjection, MODULES } from "../data/projections";
import { scopedKey, scopesFor } from "../data/scope";
import { createDocumentsList, documentsSideFor, type SignStatusReader } from "../documents/list";
import { commitmentOf, dayOf, dueOf, INBOUND_KINDS, istDay, matchedMoneyOf } from "../holds/rules";
import { sectionsFor } from "../investors/record";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE } from "../money/register";
import type { OpsLog } from "../../lib/zoho/log";
import type { AmServiceResult, AmServiceView } from "../investors/am-service";

export const INVESTORS_SIDE_SECTIONS = ["cash", "risk", "paper", "comp", "svc"] as const;
export type InvestorsSideSection = (typeof INVESTORS_SIDE_SECTIONS)[number];
/** Sections that carry a rupee figure (M16-S09). */
export const MONEY_SECTIONS: ReadonlySet<InvestorsSideSection> = new Set(["cash", "risk"]);
/** Sections this module serves. Service (M16-S08-T02) is read by the AM service (../investors/am-service), injected as `service`. */
const SERVED: ReadonlySet<InvestorsSideSection> = new Set(["cash", "risk", "paper", "comp", "svc"]);

export const COLLECTION_TTL_MS = 45_000;
const PAGE = 2_000;
const MAX_PAGES = 5;
const IN_LIMIT = 100;
const DAY_MS = 86_400_000;
const RECORD_ID = /^\d{15,22}$/;
const MAX_GROUP_FIELDS = 4;
const MAX_AGGREGATES = 5;

/** A COQL aggregate within Zoho's limits (≤ 4 GROUP BY fields, ≤ 5 aggregate functions); throws otherwise. */
export function checkAggregate(q: string): string {
  const sel = /^select\s+(.+?)\s+from\s/i.exec(q);
  const grp = /\sgroup by\s+(.+?)(\s+limit\s|\s+order by\s|$)/i.exec(q);
  const aggs = sel ? (sel[1].match(/\b(count|sum|min|max|avg)\s*\(/gi) ?? []).length : 0;
  const groups = grp ? grp[1].split(",").map((s) => s.trim()).filter(Boolean).length : 0;
  if (!sel || aggs < 1 || aggs > MAX_AGGREGATES || groups > MAX_GROUP_FIELDS) {
    throw new TypeError(`COQL aggregate out of limits (${groups} group fields, ${aggs} aggregates).`);
  }
  return q;
}

const LIVE = "Allocation_Status in ('Reserved', 'Issued')";
/** Banked per farm LLP: matched receipts through the allotment's LLP (inbound minus refunds, worked out below). */
export const BANKED_BY_LLP = checkAggregate(`select Allotment.LLP, Kind, SUM(Amount) from ${RECEIPTS_MODULE} where Match_State = 'Matched' group by Allotment.LLP, Kind limit 0, 2000`);
/** Committed per farm LLP: units (Reserved_Units while Reserved, Issued_Units once Issued) × the allotment's price. */
export const COMMITTED_BY_LLP = checkAggregate(`select LLP, Allocation_Status, Unit_Price, SUM(Reserved_Units), SUM(Issued_Units) from ${ALLOTMENTS_MODULE} where ${LIVE} group by LLP, Allocation_Status, Unit_Price limit 0, 2000`);
/** The full programme: Σ Total_Units × Pet_Unit_Price over the LLPs. */
export const PROGRAMME = checkAggregate(`select Pet_Unit_Price, SUM(Total_Units) from ${MODULES.llps} where id is not null group by Pet_Unit_Price limit 0, 2000`);
/** Matched money per allotment and per receipt day — the balance due and the ageing (COQL cannot MAX a date). */
export const MATCHED_BY_ALLOTMENT_DAY = checkAggregate(`select Allotment, Kind, Received_On, SUM(Amount) from ${RECEIPTS_MODULE} where Match_State = 'Matched' group by Allotment, Kind, Received_On limit 0, 2000`);
/** Live allotment rows (no identity field; checked at load). */
export const LIVE_ALLOTMENT_FIELDS = checkProjection(MODULES.allotments, ["id", "Customer", "LLP", "Allocation_Status", "Reserved_Units", "Issued_Units", "Unit_Price"]);
/** Compliance status fields — status, never identity (checked at load). */
export const COMPLIANCE_CONTACT_FIELDS = (() => {
  const f = ["id", "ARL_ID", "First_Name", "Last_Name", "Residency", "KYC", "FEMA_Applicable", "FEMA_Verified_At"];
  if (f.some((x) => /(^|_)(pan|bank|aadhaar|ifsc|isfc)(_|$)/i.test(x))) throw new TypeError("Compliance may not select identity fields.");
  return Object.freeze(f);
})();
const NOT_COMPLIANT = "((((KYC is null or KYC not in ('Completed', 'NA')) or (FEMA_Applicable = true and FEMA_Verified_At is null)) or PAN_Proof_Verified_At is null) or Bank_Proof_Verified_At is null)";

/* ---- who is offered what ---- */

export interface InvestorsSideAccess { readonly sections: readonly InvestorsSideSection[] }

/** The Investors side of Numbers for one seat, or null when the switch is not offered at all (IR, CP, IR Manager). */
export function investorsSideFor(seat: string, userId: string): InvestorsSideAccess | null {
  const rec = sectionsFor(seat, userId);
  const s = scopesFor(seat, userId);
  if (!rec || s.investors.kind === "own-lead") return null;
  if (isAmSeat(seat)) return Object.freeze({ sections: Object.freeze(["svc"] as InvestorsSideSection[]) });
  const orgWide = (k: string) => k === "org" || k === "all";
  const out: InvestorsSideSection[] = [];
  if (rec.includes("money") && orgWide(s.money.kind)) out.push("cash", "risk");
  if (rec.includes("paper") && documentsSideFor(seat, userId) === "investors") out.push("paper");
  if (orgWide(s.investors.kind)) out.push("comp");
  out.push("svc");
  return Object.freeze({ sections: Object.freeze(out) });
}

/* ---- results ---- */

export interface LlpCollection { readonly llpId: string; readonly banked: number; readonly committed: number; readonly outstanding: number }
export interface Collection {
  readonly banked: number;
  readonly committed: number;
  /** Σ over Reserved allotments of units × price − matched net, ≥ 0 ("committed, not yet in"). */
  readonly outstanding: number;
  readonly programme: number;
  readonly programmeUnits: number;
  /** banked / committed, whole per cent; null when nothing is committed. */
  readonly pctOfCommitted: number | null;
  /** banked / programme, whole per cent; null without a programme. */
  readonly pctOfProgramme: number | null;
  readonly byLlp: readonly LlpCollection[];
  /** Matched money not linked to an allotment's LLP (still banked). */
  readonly unlinkedBanked: number;
}
export interface AgeingRow {
  readonly allotmentId: string;
  readonly investor: { readonly id: string | null; readonly name: string | null };
  readonly llp: { readonly id: string | null; readonly name: string | null };
  readonly committed: number;
  readonly received: number;
  readonly due: number;
  readonly lastReceiptOn: string | null;
  readonly days: number | null;
}
export interface PaperRow {
  readonly key: string;
  readonly document: string;
  readonly module: string;
  readonly recordId: string;
  readonly contactId: string | null;
  readonly llpId: string | null;
  readonly party: string | null;
  readonly method: string | null;
  readonly sentAt: string | null;
  readonly sentBy: string | null;
  readonly expiresAt: string | null;
  readonly daysOut: number | null;
  /** Zoho Sign's word for the request, read on the viewer's token ("Viewed", "Declined", "Recalled"…); null unread. */
  readonly status: string | null;
}
export type ComplianceItem = "kyc" | "fema" | "pan-proof" | "bank-proof";
export interface ComplianceRow {
  readonly contactId: string;
  readonly arlId: string | null;
  readonly name: string | null;
  readonly kyc: "passed" | "pending" | "failed" | "na";
  readonly nri: boolean;
  readonly missing: readonly ComplianceItem[];
  /** What is held up: allotment (KYC, FEMA) — nothing here blocks a conversation or a reservation. */
  readonly blocks: "allotment" | null;
}

/** Service: the four tiles, the tier counts and the load, and — for the Head of AM — the managers and the pool. No money. */
export type ServiceSection = Pick<AmServiceView, "book" | "tiles" | "tiers" | "load" | "managers" | "pool" | "team" | "problems">;
export type InvestorsSideValue =
  | ({ readonly section: "svc" } & ServiceSection)
  | { readonly section: "cash"; readonly collection: Collection }
  | { readonly section: "risk"; readonly rows: readonly AgeingRow[]; readonly due: number }
  | { readonly section: "paper"; readonly rows: readonly PaperRow[]; readonly truncated: boolean }
  | { readonly section: "comp"; readonly rows: readonly ComplianceRow[]; readonly count: number; readonly truncated: boolean };

export type InvestorsSideResult =
  | { readonly ok: true; readonly value: InvestorsSideValue & { readonly asOf: number; readonly stale: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "invalid-request" | "no-book" | "money-hidden" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean; readonly lastGoodAt: number | null };

export interface InvestorsSideDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate" | "getRelated">;
  readonly cache: Pick<ScopedCache, "readSettled">;
  readonly log: OpsLog;
  /** Plane C: the access layer refused an action (identity/authority refusedAction). */
  readonly refusedAction?: (who: string, seat: string | null, action: string) => void;
  readonly signStatus?: SignStatusReader;
  /** The AM service read on the person's own token (Service section); absent → Service is not served. */
  readonly service?: (signal?: AbortSignal) => Promise<AmServiceResult>;
  readonly clock?: () => number;
}

class ZohoFail extends Error { constructor(readonly kind: string) { super("zoho"); } }
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 100) : null);
const daysSince = (day: string | null, nowMs: number): number | null =>
  day ? Math.round((Date.parse(`${istDay(nowMs)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS) : null;
const lookupName = (v: unknown): string | null => {
  const n = v && typeof v === "object" && !Array.isArray(v) ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" && n !== "" ? n.slice(0, 200) : null;
};
const kycOf = (v: string | null): ComplianceRow["kyc"] => (v === "Completed" ? "passed" : v === "Failed" ? "failed" : v === "NA" ? "na" : "pending");

/** Signed money per group key from `… Kind, SUM(Amount) … group by <key>, Kind` rows (inbound +, refund −). */
function signedBy(rows: readonly AggregateRow[], key: string): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const r of rows) {
    const amount = r["SUM(Amount)"];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) continue;
    const kind = typeof r.Kind === "string" ? r.Kind : "";
    const sign = INBOUND_KINDS.has(kind) ? 1 : kind === "Refund" ? -1 : 0;
    if (!sign) continue;
    const k = typeof r[key] === "string" && RECORD_ID.test(r[key] as string) ? (r[key] as string) : null;
    out.set(k, (out.get(k) ?? 0) + sign * amount);
  }
  return out;
}

export function createInvestorsSide(deps: InvestorsSideDeps) {
  const clock = deps.clock ?? Date.now;

  const agg = async (cred: UserCredential, q: string, signal?: AbortSignal) => {
    const r = await deps.crm.aggregate(cred, q, { signal });
    if (!r.ok) throw new ZohoFail(r.error.kind);
    if (r.value.length >= 2_000) throw new ZohoFail("truncated");
    return r.value;
  };
  const liveAllotments = async (cred: UserCredential, signal?: AbortSignal): Promise<ZohoRecord[]> => {
    const out: ZohoRecord[] = [];
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new ZohoFail("truncated");
      const r = await deps.crm.coql(cred, `select ${LIVE_ALLOTMENT_FIELDS.join(", ")} from ${ALLOTMENTS_MODULE} where ${LIVE} order by id asc limit ${page * PAGE}, ${PAGE}`, { signal });
      if (!r.ok) throw new ZohoFail(r.error.kind);
      out.push(...r.value.records);
      if (!r.value.moreRecords) return out;
    }
  };
  /** One live allotment: its committed amount (status-dependent units × price), or a source-invalid failure. */
  const committedOf = (x: ZohoRecord): number => {
    const c = commitmentOf(x.Allocation_Status === "Issued" ? x.Issued_Units : x.Reserved_Units, x.Unit_Price);
    if (c === null) throw new ZohoFail("source-invalid");
    return c;
  };

  const collection = async (cred: UserCredential, signal?: AbortSignal): Promise<Record<string, number>> => {
    const [bankedRows, committedRows, programmeRows, matchedRows] = await Promise.all([
      agg(cred, BANKED_BY_LLP, signal), agg(cred, COMMITTED_BY_LLP, signal), agg(cred, PROGRAMME, signal), agg(cred, MATCHED_BY_ALLOTMENT_DAY, signal),
    ]);
    const rows = await liveAllotments(cred, signal);
    const out: Record<string, number> = {};
    const add = (k: string, v: number) => { out[k] = (out[k] ?? 0) + v; };
    let banked = 0;
    for (const [llp, v] of signedBy(bankedRows, "Allotment.LLP")) { banked += v; add(llp ? `banked:${llp}` : "banked:none", v); }
    let committed = 0;
    for (const r of committedRows) {
      const llp = typeof r.LLP === "string" && RECORD_ID.test(r.LLP) ? r.LLP : null;
      const units = r.Allocation_Status === "Issued" ? num(r["SUM(Issued_Units)"]) : r.Allocation_Status === "Reserved" ? num(r["SUM(Reserved_Units)"]) : 0;
      const c = units * num(r.Unit_Price);
      committed += c;
      add(llp ? `committed:${llp}` : "committed:none", c);
    }
    let programme = 0, programmeUnits = 0;
    for (const r of programmeRows) { programme += num(r["SUM(Total_Units)"]) * num(r.Pet_Unit_Price); programmeUnits += num(r["SUM(Total_Units)"]); }
    const m = matchedMoneyOf(matchedRows);
    let outstanding = 0;
    for (const x of rows) {
      if (x.Allocation_Status !== "Reserved") continue;
      const id = idOf(x.id);
      if (!id) throw new ZohoFail("source-invalid");
      const due = dueOf(committedOf(x), m.byAllotment.get(id) ?? 0);
      outstanding += due;
      const llp = idOf(x.LLP);
      add(llp ? `outstanding:${llp}` : "outstanding:none", due);
    }
    Object.assign(out, { banked, committed, outstanding, programme, programmeUnits });
    return out;
  };

  const shapeCollection = (v: Readonly<Record<string, number>>): Collection => {
    const llps = new Set<string>();
    for (const k of Object.keys(v)) { const m = /^(banked|committed|outstanding):(\d{15,22})$/.exec(k); if (m) llps.add(m[2]!); }
    const byLlp = [...llps].sort().map((id) => Object.freeze({ llpId: id, banked: v[`banked:${id}`] ?? 0, committed: v[`committed:${id}`] ?? 0, outstanding: v[`outstanding:${id}`] ?? 0 }));
    const banked = v.banked ?? 0, committed = v.committed ?? 0, programme = v.programme ?? 0;
    return Object.freeze({
      banked, committed, outstanding: v.outstanding ?? 0, programme, programmeUnits: v.programmeUnits ?? 0,
      pctOfCommitted: pct(banked, committed), pctOfProgramme: pct(banked, programme), byLlp: Object.freeze(byLlp), unlinkedBanked: v["banked:none"] ?? 0,
    });
  };

  const ageing = async (cred: UserCredential, signal?: AbortSignal): Promise<{ rows: AgeingRow[]; due: number }> => {
    const [matchedRows, rows] = await Promise.all([agg(cred, MATCHED_BY_ALLOTMENT_DAY, signal), liveAllotments(cred, signal)]);
    const m = matchedMoneyOf(matchedRows);
    const last = new Map<string, string>();
    for (const r of matchedRows) {
      const a = typeof r.Allotment === "string" ? r.Allotment : null, d = dayOf(r.Received_On);
      if (!a || !d || !INBOUND_KINDS.has(typeof r.Kind === "string" ? r.Kind : "") || num(r["SUM(Amount)"]) <= 0) continue;
      if (!last.has(a) || last.get(a)! < d) last.set(a, d);
    }
    const now = clock();
    const out: AgeingRow[] = [];
    for (const x of rows) {
      const id = idOf(x.id);
      if (!id) throw new ZohoFail("source-invalid");
      const committed = committedOf(x), received = Math.max(0, m.byAllotment.get(id) ?? 0), due = dueOf(committed, received);
      if (!(received > 0 && due > 0)) continue;   // Partial: some money in, a balance still due
      const on = last.get(id) ?? null;
      out.push(Object.freeze({
        allotmentId: id, investor: { id: idOf(x.Customer), name: lookupName(x.Customer) }, llp: { id: idOf(x.LLP), name: lookupName(x.LLP) },
        committed, received, due, lastReceiptOn: on, days: daysSince(on, now),
      }));
    }
    out.sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.allotmentId.localeCompare(b.allotmentId));
    return { rows: out, due: out.reduce((s, r) => s + r.due, 0) };
  };

  const compliance = async (cred: UserCredential, signal?: AbortSignal): Promise<{ rows: ComplianceRow[]; truncated: boolean }> => {
    const found: ZohoRecord[] = [];
    let truncated = false;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) { truncated = true; break; }
      const r = await deps.crm.coql(cred, `select ${COMPLIANCE_CONTACT_FIELDS.join(", ")} from ${MODULES.contacts} where ${NOT_COMPLIANT} order by id asc limit ${page * PAGE}, ${PAGE}`, { signal });
      if (!r.ok) throw new ZohoFail(r.error.kind);
      found.push(...r.value.records);
      if (!r.value.moreRecords) break;
    }
    const ids = found.map((c) => idOf(c.id)).filter((x): x is string => x !== null);
    const without = async (field: string): Promise<Set<string>> => {
      const s = new Set<string>();
      for (let i = 0; i < ids.length; i += IN_LIMIT) {
        const chunk = ids.slice(i, i + IN_LIMIT);
        const r = await deps.crm.coql(cred, `select id from ${MODULES.contacts} where (id in (${chunk.map((x) => `'${x}'`).join(", ")}) and ${field} is null) limit 0, 200`, { signal });
        if (!r.ok) throw new ZohoFail(r.error.kind);
        for (const x of r.value.records) { const id = idOf(x.id); if (id) s.add(id); }
      }
      return s;
    };
    const [noPan, noBank] = [await without("PAN_Proof_Verified_At"), await without("Bank_Proof_Verified_At")];
    const rows: ComplianceRow[] = [];
    for (const c of found) {
      const id = idOf(c.id);
      if (!id) continue;
      const kyc = kycOf(str(c, "KYC", 40));
      const residency = str(c, "Residency", 20);
      const femaOut = c.FEMA_Applicable === true && !str(c, "FEMA_Verified_At", 40);
      const missing: ComplianceItem[] = [];
      if (kyc === "pending" || kyc === "failed") missing.push("kyc");
      if (femaOut) missing.push("fema");
      if (noPan.has(id)) missing.push("pan-proof");
      if (noBank.has(id)) missing.push("bank-proof");
      if (!missing.length) continue;
      const name = [str(c, "First_Name", 100), str(c, "Last_Name", 100)].filter(Boolean).join(" ") || null;
      rows.push(Object.freeze({
        contactId: id, arlId: str(c, "ARL_ID", 40), name, kyc, nri: residency === "NRI" || residency === "OCI",
        missing: Object.freeze(missing), blocks: missing.includes("kyc") || missing.includes("fema") ? "allotment" as const : null,
      }));
    }
    return { rows, truncated };
  };

  const paper = async (cred: UserCredential, seat: string, signal?: AbortSignal): Promise<{ rows: PaperRow[]; truncated: boolean } | { failed: string }> => {
    const list = createDocumentsList({ crm: deps.crm, log: deps.log, signStatus: deps.signStatus, clock });
    const r = await list.read(cred, seat, "out", signal);
    if (!r.ok) return { failed: r.kind === "refused" ? "refused" : r.errorKind };
    if (r.page.side !== "investors") return { failed: "refused" };
    const now = clock();
    const rows = r.page.rows.filter((d) => d.state === "sent").map((d): PaperRow => Object.freeze({
      key: d.key, document: d.label, module: d.module, recordId: d.recordId, contactId: d.contactId, llpId: d.llpId, party: d.party,
      method: d.method, sentAt: d.sign?.sentAt ?? null, sentBy: d.sign?.sentBy ?? null, expiresAt: d.sign?.expiresAt ?? null,
      daysOut: daysSince(dayOf(d.sign?.sentAt ?? null), now), status: d.sign?.label ?? null,
    }));
    rows.sort((a, b) => (b.daysOut ?? -1) - (a.daysOut ?? -1) || a.key.localeCompare(b.key));
    return { rows, truncated: r.page.truncated };
  };

  return Object.freeze({
    async read(p: { readonly credential: UserCredential; readonly seat: string }, section: string, signal?: AbortSignal): Promise<InvestorsSideResult> {
      const me = p?.credential?.userId;
      const refuse = (reason: "invalid-request" | "no-book" | "money-hidden"): InvestorsSideResult => {
        const action = `numbers-${typeof section === "string" && /^[a-z]{1,8}$/.test(section) ? section : "section"}`;
        if (typeof me === "string" && RECORD_ID.test(me)) {
          try { deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action, reason, recordIds: [] }); } catch { /* a log never breaks the refusal */ }
          try { deps.refusedAction?.(me, typeof p?.seat === "string" ? p.seat : null, `${action}-${reason}`); } catch { /* idem */ }
        }
        return { ok: false, kind: "refused", reason };
      };
      if (typeof me !== "string" || !RECORD_ID.test(me) || typeof p.seat !== "string") return refuse("invalid-request");
      if (!(INVESTORS_SIDE_SECTIONS as readonly string[]).includes(section) || !SERVED.has(section as InvestorsSideSection)) return refuse("invalid-request");
      const sec = section as InvestorsSideSection;
      const side = investorsSideFor(p.seat, me);
      if (!side) return refuse("no-book");
      if (!side.sections.includes(sec)) return refuse(MONEY_SECTIONS.has(sec) ? "money-hidden" : "no-book");
      const fail = (kind: string, lastGoodAt: number | null = null): InvestorsSideResult =>
        kind === "forbidden" ? refuse(MONEY_SECTIONS.has(sec) ? "money-hidden" : "no-book")
          : { ok: false, kind: "source-error", errorKind: kind, retryable: kind !== "source-invalid" && kind !== "truncated", lastGoodAt };
      const scopes = scopesFor(p.seat, me);

      if (sec === "svc") {
        if (!deps.service) return refuse("invalid-request");
        const r = await deps.service(signal).catch(() => null);
        if (!r) return fail("unexpected");
        if (!r.ok) return r.kind === "refused" ? refuse("no-book") : fail(r.errorKind);
        const { book, tiles, tiers, load, managers, pool, team, problems } = r.view;
        return { ok: true, value: Object.freeze({ section: "svc" as const, book, tiles, tiers, load, managers, pool, team, problems, asOf: r.view.asOf, stale: false }) };
      }
      if (sec === "cash") {
        const got = await deps.cache.readSettled<Readonly<Record<string, number>>>(
          scopedKey<Readonly<Record<string, number>>>(scopes.money, "numbers.investors.cash"), () => collection(p.credential, signal), { ttlMs: COLLECTION_TTL_MS },
        ) as CacheFresh<Readonly<Record<string, number>>> | CacheStale<Readonly<Record<string, number>>> | CacheError<Readonly<Record<string, number>>>;
        if (got.state === "error") return fail(got.reason, got.lastGoodAt);
        return { ok: true, value: Object.freeze({ section: "cash" as const, collection: shapeCollection(got.value), asOf: got.asOf, stale: got.state !== "fresh" }) };
      }
      try {
        const now = clock();
        if (sec === "risk") {
          const a = await ageing(p.credential, signal);
          return { ok: true, value: Object.freeze({ section: "risk" as const, rows: Object.freeze(a.rows), due: a.due, asOf: now, stale: false }) };
        }
        if (sec === "comp") {
          const c = await compliance(p.credential, signal);
          return { ok: true, value: Object.freeze({ section: "comp" as const, rows: Object.freeze(c.rows), count: c.rows.length, truncated: c.truncated, asOf: now, stale: false }) };
        }
        const d = await paper(p.credential, p.seat, signal);
        if ("failed" in d) return d.failed === "refused" ? refuse("no-book") : fail(d.failed);
        return { ok: true, value: Object.freeze({ section: "paper" as const, rows: Object.freeze(d.rows), truncated: d.truncated, asOf: now, stale: false }) };
      } catch (e) {
        return fail(e instanceof ZohoFail ? e.kind : "unexpected");
      }
    },
  });
}
export type InvestorsSideReader = ReturnType<typeof createInvestorsSide>;
