/**
 * M08-S07-T02 — "SAID YES" ON INVESTORS: the state label and the originating IR (D11, D43, D69).
 *
 * The IR's Said yes upserts a Contact (no native lead conversion); from then on the Contact is on the
 * Investors side even before any allotment exists. Its state label comes from the Contacts lifecycle
 * blueprint (Said yes → Reserved → Paid → Allotted, M08-S07-T01) when that blueprint's field is read;
 * until the field exists in the org (GAP, 28 Sep 2026: no lifecycle field on Contacts) the label is
 * derived — allotment states first, then Said_Yes_At — never invented.
 *
 * The IR is Contacts.Originating_IR (the lead's owner at said yes, D69). A Contact without it is
 * resolved through its Origin_Lead lookup — the Lead's Owner, read on the viewer's own token (D53).
 * A Lead the viewer cannot see resolves to nobody; it is never guessed.
 */

import type { ImSt } from "../../lib/im/types";
import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { idOf } from "../data/contact-row";

export type InvestorStateLabel = "said yes" | "reserved" | "paid" | "allocated" | "lapsed";

/** PROVISIONAL: the Contacts blueprint's state field (Sahil's M08-S07-T01). null → the label is derived. */
export const LIFECYCLE_FIELD: string | null = null;

const BLUEPRINT: Readonly<Record<string, InvestorStateLabel>> = Object.freeze({
  "Said yes": "said yes", "Said Yes": "said yes", Reserved: "reserved", Paid: "paid",
  Allotted: "allocated", Allocated: "allocated", Lapsed: "lapsed",
});

/** The state tag of an investor: the blueprint's when read and known, else the allotments', else said yes. */
export function stateLabel(input: { readonly blueprint?: unknown; readonly derived: ImSt | null; readonly saidYesAt: string | null }): InvestorStateLabel | null {
  const b = typeof input.blueprint === "string" ? BLUEPRINT[input.blueprint] : undefined;
  if (b) return b;
  if (input.derived) return input.derived;
  return input.saidYesAt ? "said yes" : null;
}

const RECORD_ID = /^\d{15,22}$/;
export const LEAD_IN_CHUNK = 100;

/**
 * Lead id → owner id for the given leads, read in chunks of ≤100 on the viewer's own token. Leads the
 * token cannot see, or a failed read, are simply absent — the IR then reads as nobody.
 */
export async function leadOwners(crm: Pick<ZohoClient, "coql">, cred: UserCredential, leadIds: readonly string[], signal?: AbortSignal): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(leadIds.filter((x) => RECORD_ID.test(x)))].sort();
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += LEAD_IN_CHUNK) {
    const chunk = ids.slice(i, i + LEAD_IN_CHUNK);
    let r: Awaited<ReturnType<typeof crm.coql>>;
    try {
      r = await crm.coql(cred, `select id, Owner from Leads where (id in (${chunk.map((x) => `'${x}'`).join(", ")})) order by id asc limit 0, ${LEAD_IN_CHUNK}`, { signal });
    } catch { continue; }
    if (!r.ok) continue;
    for (const rec of r.value.records) {
      const owner = idOf(rec.Owner);
      if (chunk.includes(rec.id) && owner) out.set(rec.id, owner);
    }
  }
  return out;
}

/** The IR of each row: Originating_IR, else the Origin_Lead's owner, else null. */
export async function resolveIrs<T extends { readonly originLeadId: string | null; readonly originatingIrId: string | null }>(
  crm: Pick<ZohoClient, "coql">, cred: UserCredential, rows: readonly T[], signal?: AbortSignal,
): Promise<(string | null)[]> {
  const need = rows.filter((r) => !r.originatingIrId && r.originLeadId).map((r) => r.originLeadId!);
  const owners = need.length ? await leadOwners(crm, cred, need, signal) : new Map<string, string>();
  return rows.map((r) => r.originatingIrId ?? (r.originLeadId ? owners.get(r.originLeadId) ?? null : null));
}
