/**
 * M16-S06 — Transfers: leads that became investors, per month (D60: "transferred" = reached
 * "Investor said yes", when the investor record is created).
 *
 * Leads with Said_Yes_At in the last six months are read in the person's scope; a lead lost after
 * yes still counts on its yes date; a legacy record (M18-S06) never counts. Units come from the
 * investor's allotments (the Contact whose Origin_Lead is the lead), never from a typed field; the
 * value is the allotments' amount receivable and is returned only to a seat that may see money.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { coqlAll } from "../../lib/zoho/coql";
import type { SeatedZohoUser } from "../oauth/seat";

export const MONTHS = 6;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const IST = 5.5 * 3_600_000;

export interface TransfersAccess {
  readonly actor: SeatedZohoUser; readonly seesTransfers: boolean; readonly seesMoney: boolean;
  /** Owners in scope, or null with orgWide for every book. */
  readonly ownerIds: readonly string[] | null; readonly orgWide: boolean;
}
export interface TransfersAccessAuthority { recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<TransfersAccess | null> }
export interface TransferMonth { readonly month: string; readonly count: number; readonly units: number; readonly value: number | null }
export type TransfersResult =
  | { readonly ok: true; readonly value: { readonly since: string; readonly total: number; readonly medianDays: number | null; readonly months: readonly TransferMonth[] } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface TransfersDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly access: TransfersAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  /** True once Leads.Legacy_Record exists (M18-S06); until then there are no legacy rows to leave out. */
  readonly legacyField?: boolean;
  readonly clock?: () => number;
}

const monthOf = (ms: number): string => new Date(ms + IST).toISOString().slice(0, 7);

export function createTransfers(deps: TransfersDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Transfers need crm.coql, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => { const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined; return validId(id) ? id : null; };
  const all = async (cred: UserCredential, q: string): Promise<ZohoRecord[] | ZohoFailureKind> => {
    const rows: ZohoRecord[] = [];
    for (let off = 0; off < 10_000; off += 2_000) {
      const r = await crm.coql(cred, `${q} limit ${off}, 2000`);
      if (!r.ok) return r.error.kind;
      if (r.value.invalidRecordIds) return "unexpected";
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return rows;
    }
    return "unexpected";
  };
  const fail = (k: ZohoFailureKind): TransfersResult => ({ ok: false, kind: "source-error", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" });

  return Object.freeze({
    async read(principal: { credential: UserCredential; sessionId: string }, signal?: AbortSignal): Promise<TransfersResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) {
        return { ok: false, kind: "refused", reasonCode: "invalid-request" };
      }
      let a: TransfersAccess | null;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true }; }
      if (!a || a.actor?.userId !== cred.userId) return { ok: false, kind: "refused", reasonCode: "session-changed" };
      const owners = a.ownerIds ?? [];
      if (!a.seesTransfers || a.actor.seat === "investor-relations" || (!a.orgWide && (!owners.length || owners.length > 100 || !owners.every(validId)))) {
        log.refusal({ at: clock(), actor: { kind: "user", userId: cred.userId }, action: "transfers", reason: "capability-missing", recordIds: [] });
        return { ok: false, kind: "refused", reasonCode: "capability-missing" };
      }
      const now = clock();
      const ist = new Date(now + IST);
      const sinceMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - (MONTHS - 1), 1) - IST;
      const since = monthOf(sinceMs);
      const scope = a.orgWide ? "id is not null" : `Owner in (${owners.map((id) => `'${id}'`).join(", ")})`;
      const legacy = deps.legacyField ? ["(Legacy_Record is null or Legacy_Record = false)"] : [];
      const leads = await all(cred, `select id, Created_Time, Said_Yes_At from Leads where ${coqlAll([scope, `Said_Yes_At >= '${since}-01T00:00:00+05:30'`, ...legacy])} order by id asc`);
      if (typeof leads === "string") return fail(leads);
      const yes = new Map<string, { month: string; days: number }>();
      for (const l of leads) {
        const y = typeof l.Said_Yes_At === "string" ? Date.parse(l.Said_Yes_At) : NaN;
        const c = typeof l.Created_Time === "string" ? Date.parse(l.Created_Time) : NaN;
        if (!validId(l.id) || !Number.isFinite(y) || y > now + 60_000) continue;
        yes.set(l.id, { month: monthOf(y), days: Number.isFinite(c) ? Math.max(0, (y - c) / 86_400_000) : NaN });
      }

      // Units and value from the investors' allotments (Contact.Origin_Lead → allotment.Customer).
      const byLead = new Map<string, { units: number; value: number }>();
      const leadIds = [...yes.keys()];
      const contactLead = new Map<string, string>();
      for (let i = 0; i < leadIds.length; i += 100) {
        const cs = await all(cred, `select id, Origin_Lead from Contacts where Origin_Lead in (${leadIds.slice(i, i + 100).map((x) => `'${x}'`).join(", ")}) order by id asc`);
        if (typeof cs === "string") return fail(cs);
        for (const c of cs) { const lead = idOf(c.Origin_Lead); if (validId(c.id) && lead && yes.has(lead)) contactLead.set(c.id, lead); }
      }
      const contacts = [...contactLead.keys()];
      for (let i = 0; i < contacts.length; i += 100) {
        const as = await all(cred, `select id, Customer, Issued_Units, Reserved_Units, Total_Amount_Receivable, Allocation_Status from LLP_UnitAllocation_Module where (Customer in (${contacts.slice(i, i + 100).map((x) => `'${x}'`).join(", ")}) and Allocation_Status != 'Cancelled') order by id asc`);
        if (typeof as === "string") return fail(as);
        for (const r of as) {
          const lead = contactLead.get(idOf(r.Customer) ?? "");
          if (!lead) continue;
          const units = typeof r.Issued_Units === "number" && r.Issued_Units > 0 ? r.Issued_Units : typeof r.Reserved_Units === "number" ? r.Reserved_Units : 0;
          const value = typeof r.Total_Amount_Receivable === "number" ? r.Total_Amount_Receivable : 0;
          const cur = byLead.get(lead) ?? { units: 0, value: 0 };
          byLead.set(lead, { units: cur.units + units, value: cur.value + value });
        }
      }

      const months: TransferMonth[] = [];
      for (let k = 0; k < MONTHS; k++) {
        const m = monthOf(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - k, 1) - IST);
        const ids = [...yes].filter(([, v]) => v.month === m).map(([id]) => id);
        months.push(Object.freeze({ month: m, count: ids.length,
          units: ids.reduce((s, id) => s + (byLead.get(id)?.units ?? 0), 0),
          value: a.seesMoney ? ids.reduce((s, id) => s + (byLead.get(id)?.value ?? 0), 0) : null }));
      }
      const days = [...yes.values()].map((v) => v.days).filter(Number.isFinite).sort((x, y) => x - y);
      const medianDays = days.length ? Math.round((days.length % 2 ? days[days.length >> 1] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2)) : null;
      return { ok: true, value: { since, total: yes.size, medianDays, months: Object.freeze(months) } };
    },
  });
}
