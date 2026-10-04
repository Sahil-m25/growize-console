/**
 * M15-S03-T05 — THE PER-RECORD HISTORY (Plane A) AND THE PLANE C READER.
 *
 * A record page's history is read live from Zoho's __timeline on the reader's own token: exactly one
 * call (TC-E11-013), and Zoho's sharing decides whether they may see it. Only which fields changed is
 * returned — client.timeline drops the values at the parse.
 * Plane C's reveals, step-ups and seat changes come from the durable store (server/logs/factory.ts: the day
 * files when LOG_STORE=jsonl, Stratus segments when LOG_SINK=stratus), else from the in-memory ring.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { PlaneCEvent } from "../identity/plane-c";
import { daysBetween } from "../logs/reader";
import type { PlaneStore } from "../logs/sink";
import { auditTime } from "./export-job";

export interface HistoryEntry { readonly at: string; readonly byId: string | null; readonly action: string; readonly fields: readonly string[] }

export async function recordHistory(crm: Pick<ZohoClient, "timeline">, as: UserCredential, module: string, id: string, signal?: AbortSignal)
  : Promise<{ readonly ok: true; readonly entries: readonly HistoryEntry[]; readonly more: boolean } | { readonly ok: false; readonly error: string }> {
  const r = await crm.timeline(as, module, id, { perPage: 100, signal });
  if (!r.ok) return { ok: false, error: r.error.kind };
  return {
    ok: true, more: r.value.moreRecords,
    entries: r.value.entries.map((e) => ({ at: auditTime(e.at) ?? e.at, byId: e.byId, action: e.action, fields: e.fields })),
  };
}

/** Plane C events in [fromMs, toMs): the durable store when there is one, else the ring. */
export async function planeCBetween(o: { readonly store: PlaneStore | null; readonly ring: () => readonly PlaneCEvent[] }, fromMs: number, toMs: number): Promise<readonly PlaneCEvent[]> {
  const inRange = (e: PlaneCEvent) => typeof e?.at === "number" && e.at >= fromMs && e.at < toMs;
  if (!o.store) return o.ring().filter(inRange);
  const first = new Date(fromMs).toISOString().slice(0, 10), last = new Date(toMs).toISOString().slice(0, 10);
  const out: PlaneCEvent[] = [];
  for (const d of daysBetween(first, last)) for (const l of await o.store.read(d)) if (inRange(l as PlaneCEvent)) out.push(l as PlaneCEvent);
  return out;
}
