/**
 * Who carries a book (D44, D49, M14-S02): users with at least one OPEN lead they own or one contact they are KAM of.
 * Read as COUNT … GROUP BY on the VIEWER's own token (rule 2) — counts only, never a record (rule 7, D52) and nothing
 * cached. What the viewer's Zoho scope hides reads as zero, so a person outside the viewer's reach reads "no book"; that is
 * the same limit as the Teams counts (M14-S01-NOTE-1), and the refusal says "no book" in the viewer's terms.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";

const USER_ID = /^\d{15,25}$/;
const IN_MAX = 50;

export type Carriers = { readonly ok: true; readonly carriers: ReadonlySet<string> } | { readonly ok: false; readonly errorKind: string };

export async function bookCarriers(crm: Pick<ZohoClient, "aggregate">, cred: UserCredential, ids: readonly string[], signal?: AbortSignal): Promise<Carriers> {
  const clean = [...new Set(ids.filter((id) => USER_ID.test(id)))];
  const carriers = new Set<string>();
  const queries = (list: string) => [
    ["Owner", `select Owner, COUNT(id) from Leads where Owner in (${list}) and Lost_At is null and Onboarded_At is null group by Owner limit 0, 2000`],
    ["KAM", `select KAM, COUNT(id) from Contacts where KAM in (${list}) group by KAM limit 0, 2000`],
  ] as const;
  for (let i = 0; i < clean.length; i += IN_MAX) {
    const part = clean.slice(i, i + IN_MAX);
    for (const [field, q] of queries(part.map((id) => `'${id}'`).join(", "))) {
      let r: Awaited<ReturnType<typeof crm.aggregate>>;
      try { r = await crm.aggregate(cred, q, { signal }); } catch { return { ok: false, errorKind: "unexpected" }; }
      if (!r.ok) return { ok: false, errorKind: r.error.kind };
      for (const row of r.value) {
        const k = row[field], n = row["COUNT(id)"];
        if (typeof k === "string" && part.includes(k) && typeof n === "number" && n > 0) carriers.add(k);
      }
    }
  }
  return { ok: true, carriers };
}
