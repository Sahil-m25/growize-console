/**
 * M03-S09-T03 — RECORD SHARE AT HAND-OFF (D74; jev "b" 1.00: filter + record share).
 *
 * When a lead's "said yes" hands the investor over, the Contact, its allotments and their receipts are
 * shared read-only with the originating IR through the Share Records API, so that IR's own token can read
 * them under Private sharing (D80). The console's IR guard (server/data/ir-guard) still re-checks every
 * row, so the share never widens what an IR sees beyond Originating_IR = me.
 *
 * Runs on the "handoff-share" service credential (D53: a background job, never a screen). Related records
 * are never shared implicitly (client.share sets share_related_records false): each id is shared on its
 * own. Nothing here logs values — the client's ops log already records job, record ids and status, and
 * the result carries record ids only. Reads are COQL over ids, IN capped at 100 per call.
 */

import type { ServiceCredential, ZohoServiceClient } from "../../lib/zoho/client";
import { assertServiceCredential } from "../../lib/zoho/client";

export const HANDOFF_MODULES = Object.freeze({ contacts: "Contacts", allotments: "LLP_UnitAllocation_Module", receipts: "Receipts" } as const);
const RECORD_ID = /^\d{15,22}$/;
const IN_CHUNK = 100;
const PAGE = 200;
const MAX_PAGES = 10;

export interface HandOff {
  readonly contactId: string;
  /** The originating IR's Zoho user id (Contacts.Originating_IR). */
  readonly irUserId: string;
}

export interface ShareOutcome {
  readonly module: string;
  readonly id: string;
  readonly ok: boolean;
}

export type HandOffShareResult =
  | { readonly ok: true; readonly shared: readonly ShareOutcome[]; readonly failed: readonly ShareOutcome[] }
  | { readonly ok: false; readonly reason: "invalid-request" | "read-failed" | "not-the-originating-ir" };

type Client = Pick<ZohoServiceClient, "coql" | "share">;

async function idsWhere(client: Client, as: ServiceCredential, module: string, field: string, ids: readonly string[]): Promise<string[] | null> {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await client.coql(as, `select id, ${field} from ${module} where (${field} in (${chunk.map((x) => `'${x}'`).join(", ")})) order by id asc limit ${page * PAGE}, ${PAGE}`);
      if (!r.ok) return null;
      for (const rec of r.value.records) if (RECORD_ID.test(rec.id)) out.push(rec.id);
      if (!r.value.moreRecords) break;
    }
  }
  return [...new Set(out)];
}

/**
 * Shares one handed-off investor's records read-only with the originating IR. The Contact is read first
 * (service token) and must name that IR as Originating_IR and carry Origin_Lead — the share never goes to
 * anybody else. A failed share is reported by id and does not stop the rest; re-running is idempotent.
 */
export async function shareAtHandOff(client: Client, as: ServiceCredential, h: HandOff): Promise<HandOffShareResult> {
  assertServiceCredential(as, "handoff-share");
  if (!h || !RECORD_ID.test(h.contactId) || !RECORD_ID.test(h.irUserId)) return { ok: false, reason: "invalid-request" };
  const c = await client.coql(as, `select id, Origin_Lead, Originating_IR from ${HANDOFF_MODULES.contacts} where (id = '${h.contactId}') limit 0, 1`);
  if (!c.ok) return { ok: false, reason: "read-failed" };
  const rec = c.value.records.find((x) => x.id === h.contactId);
  const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { id?: unknown }).id : v);
  if (!rec || !idOf(rec.Origin_Lead) || idOf(rec.Originating_IR) !== h.irUserId) return { ok: false, reason: "not-the-originating-ir" };

  const allots = await idsWhere(client, as, HANDOFF_MODULES.allotments, "Customer", [h.contactId]);
  if (!allots) return { ok: false, reason: "read-failed" };
  const receipts = await idsWhere(client, as, HANDOFF_MODULES.receipts, "Allotment", allots);
  if (!receipts) return { ok: false, reason: "read-failed" };

  const todo: [string, string][] = [
    [HANDOFF_MODULES.contacts, h.contactId],
    ...allots.map((id): [string, string] => [HANDOFF_MODULES.allotments, id]),
    ...receipts.map((id): [string, string] => [HANDOFF_MODULES.receipts, id]),
  ];
  const shared: ShareOutcome[] = [];
  const failed: ShareOutcome[] = [];
  for (const [module, id] of todo) {
    let ok = false;
    try { ok = (await client.share(as, module, id, h.irUserId, "read")).ok; } catch { ok = false; }
    (ok ? shared : failed).push(Object.freeze({ module, id, ok }));
  }
  return { ok: true, shared: Object.freeze(shared), failed: Object.freeze(failed) };
}

/**
 * A receipt or allotment added after hand-off needs the same share. Called with the new record's ids
 * by whatever writes it (M10 receipts, allotment create); shares each read-only with the IR.
 */
export async function shareLaterRecords(client: Client, as: ServiceCredential, irUserId: string, records: readonly { readonly module: "LLP_UnitAllocation_Module" | "Receipts"; readonly id: string }[]): Promise<readonly ShareOutcome[]> {
  assertServiceCredential(as, "handoff-share");
  if (!RECORD_ID.test(irUserId)) return [];
  const out: ShareOutcome[] = [];
  for (const r of records) {
    if (!RECORD_ID.test(r.id)) continue;
    let ok = false;
    try { ok = (await client.share(as, r.module, r.id, irUserId, "read")).ok; } catch { ok = false; }
    out.push(Object.freeze({ module: r.module, id: r.id, ok }));
  }
  return Object.freeze(out);
}
