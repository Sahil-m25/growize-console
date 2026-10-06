/**
 * M09-S08-T02 — THE INVESTORS LIST FOR AN IR (D69, D113 ruling 2).
 *
 * The same Investors page, scoped: one row per investor that came from THIS IR's own lead — the Contact whose
 * Originating_IR is the signed-in IR (the lead's owner at "Said yes") and that carries Origin_Lead. Read live on the
 * IR's own token (D53), asked for with the IR's own filter in the WHERE (ir-guard contactsWhere), and every row is
 * re-admitted by the one choke point (ir-guard filterContacts): one row that is not theirs refuses the whole read.
 *
 * What it selects: id, ARL code, name, the lead link and Said_Yes_At — never a phone, an email, an address, a nominee,
 * KYC, PAN, Aadhaar or bank (checkAmProjection refuses identity AND money names when this module loads). Allotments
 * come through the no-money projection (adapters.allotments money:false: units, farm, status — no price, no amount, no
 * receipt) and the farm is read by name and block only (no price, no yield). The answer is rebuilt from an allow-list:
 * no Zoho record is spread into it. Rows live for this response only (D45); nothing is cached.
 *
 * Offered to the `own-lead` book scope only (the IR seat); any other seat is refused and the refusal logged, no Zoho call.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { coqlWhere } from "../../lib/zoho/coql";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import { createInvestorsAdapters, DEFAULT_MAX_PAGES, IN_CHUNK, PAGE, type AllotmentRow } from "../data/adapters";
import { idOf, parseContact, str, type ContactRow } from "../data/contact-row";
import type { InvestorEvents } from "../data/events";
import { contactsWhere, createInvestorGuard, type PlaneCRefusal } from "../data/ir-guard";
import { checkAmProjection, MODULES } from "../data/projections";
import { scopesFor } from "../data/scope";
import { LIFECYCLE_FIELD, stateLabel, type InvestorStateLabel } from "./lifecycle";

/** What an IR's list reads of a Contact. Checked against identity and money names when this module loads. */
export const IR_LIST_FIELDS: readonly string[] = checkAmProjection(MODULES.contacts, [
  "id", "ARL_ID", "First_Name", "Last_Name", "Origin_Lead", "Originating_IR", "Said_Yes_At", ...(LIFECYCLE_FIELD ? [LIFECYCLE_FIELD] : []),
]);
/** The farm read for the list: its name and block only. */
export const IR_FARM_FIELDS: readonly string[] = checkAmProjection(MODULES.llps, ["id", "Name", "Block_Code"]);

const RECORD_ID = /^\d{15,22}$/;

export interface IrFarm { readonly llpId: string; readonly name: string; readonly block: string; readonly units: number }

/** The columns of M09-S08-NOTE-3: who, which ARL code, which farms, where it stands, which lead. Nothing else. */
export interface IrInvestorRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly farms: readonly IrFarm[];
  readonly state: InvestorStateLabel | null;
  /** The Lead this investor came from (Origin_Lead) — the link back to the IR's own lead. */
  readonly leadId: string | null;
}

export type IrListResult =
  | { readonly ok: true; readonly rows: readonly IrInvestorRow[]; readonly truncated: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly book: string; readonly errorKind: ZohoFailureKind | "unexpected" };

export interface IrListDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly events: InvestorEvents;
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
  readonly maxPages?: number;
}

/** Pure: the rows from what was read. Units and farms count live allotments only; the state is the allotments' (no money to tell Paid). */
export function buildIrRows(
  contacts: readonly ContactRow[], allots: readonly AllotmentRow[], farms: ReadonlyMap<string, { readonly name: string; readonly block: string }>,
  blueprint: ReadonlyMap<string, unknown> = new Map(),
): IrInvestorRow[] {
  const byContact = new Map<string, AllotmentRow[]>();
  for (const a of allots) byContact.set(a.Customer, [...(byContact.get(a.Customer) ?? []), a]);
  const rows = contacts.map((c): IrInvestorRow => {
    const mine = byContact.get(c.id) ?? [];
    const live = mine.filter((a) => a.Allocation_Status !== "Cancelled");
    const perFarm = new Map<string, IrFarm>();
    for (const a of live) {
      const f = farms.get(a.LLP_Lookup);
      const prev = perFarm.get(a.LLP_Lookup);
      perFarm.set(a.LLP_Lookup, Object.freeze({ llpId: a.LLP_Lookup, name: f?.name ?? "", block: f?.block ?? "", units: (prev?.units ?? 0) + a.Committed_Units }));
    }
    const derived = !mine.length ? null : !live.length ? "lapsed" as const : live.some((a) => a.Allocation_Status === "Issued") ? "allocated" as const : "reserved" as const;
    return Object.freeze({
      id: c.id, code: c.code, name: [c.firstName, c.lastName].filter(Boolean).join(" ").slice(0, 121),
      farms: Object.freeze([...perFarm.values()]), state: stateLabel({ blueprint: blueprint.get(c.id), derived, saidYesAt: c.saidYesAt }), leadId: c.originLeadId,
    });
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en-IN") || a.id.localeCompare(b.id));
}

export function createIrInvestorList(deps: IrListDeps) {
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const adapters = createInvestorsAdapters({ crm: deps.crm, events: deps.events, maxPages });
  const guard = createInvestorGuard({ events: deps.events, planeCRefusal: deps.planeCRefusal });

  async function paged(cred: UserCredential, select: string, from: string, where: string, signal?: AbortSignal):
    Promise<{ ok: true; rows: ZohoRecord[]; truncated: boolean } | { ok: false; errorKind: ZohoFailureKind | "unexpected" }> {
    const rows: ZohoRecord[] = [];
    for (let page = 0; page < maxPages; page++) {
      let r: Awaited<ReturnType<typeof deps.crm.coql>>;
      try { r = await deps.crm.coql(cred, `select ${select} from ${from} where ${coqlWhere(where)} order by id asc limit ${page * PAGE}, ${PAGE}`, { signal }); } catch { return { ok: false, errorKind: "unexpected" }; }
      if (!r.ok) return { ok: false, errorKind: r.error.kind };
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return { ok: true, rows, truncated: false };
    }
    return { ok: true, rows, truncated: true };
  }

  async function list(cred: UserCredential, seat: string, signal?: AbortSignal): Promise<IrListResult> {
    const me = cred.userId;
    const scope = scopesFor(seat, me).investors;
    const where = scope.kind === "own-lead" ? contactsWhere(scope) : null;
    if (!where) {
      deps.events.refusal(me, "ir-investors", "seat-denied");
      return { ok: false, kind: "refused", reason: "seat-denied" };
    }
    const c = await paged(cred, IR_LIST_FIELDS.join(", "), MODULES.contacts, where, signal);
    if (!c.ok) return { ok: false, kind: "source-error", book: "investors", errorKind: c.errorKind };
    const contacts: ContactRow[] = [];
    for (const raw of c.rows) {
      const parsed = parseContact(raw);
      if (!parsed) return { ok: false, kind: "refused", reason: "source-invalid" };
      contacts.push(parsed);
    }
    // One row that is not this IR's means sharing let through what the scope forbids: refuse the whole read, never trim.
    const admitted = guard.filterContacts(me, seat, scope, contacts, "ir-investors");
    if (!admitted.ok) return { ok: false, kind: "refused", reason: admitted.reason };

    const al = await adapters.allotments(cred, scope, admitted.rows.map((x) => x.id), signal, false, false);
    if (!al.ok) return al.kind === "refused" ? { ok: false, kind: "refused", reason: al.reason } : { ok: false, kind: "source-error", book: "allotments", errorKind: al.errorKind };
    const llpIds = [...new Set(al.rows.filter((a) => a.Allocation_Status !== "Cancelled" && RECORD_ID.test(a.LLP_Lookup)).map((a) => a.LLP_Lookup))];
    const farms = new Map<string, { name: string; block: string }>();
    let truncated = c.truncated || al.truncated;
    for (let i = 0; i < llpIds.length; i += IN_CHUNK) {
      const ids = llpIds.slice(i, i + IN_CHUNK).map((x) => `'${x}'`).join(", ");
      const l = await paged(cred, IR_FARM_FIELDS.join(", "), MODULES.llps, `id in (${ids})`, signal);
      if (!l.ok) return { ok: false, kind: "source-error", book: "farms", errorKind: l.errorKind };
      for (const f of l.rows) { const id = idOf(f.id); if (id) farms.set(id, { name: str(f, "Name", 120) ?? "", block: str(f, "Block_Code", 20) ?? "" }); }
      truncated ||= l.truncated;
    }
    const blueprint = new Map<string, unknown>();
    if (LIFECYCLE_FIELD) for (const raw of c.rows) blueprint.set(raw.id, raw[LIFECYCLE_FIELD]);
    return { ok: true, rows: Object.freeze(buildIrRows(admitted.rows, al.rows, farms, blueprint)), truncated };
  }

  return Object.freeze({ list });
}
export type IrInvestorList = ReturnType<typeof createIrInvestorList>;
