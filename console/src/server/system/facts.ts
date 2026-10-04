/**
 * M15-S05-NOTE-2 / M15-S03-NOTE-5 — the System checks' facts, gathered from what this process already
 * holds: Plane B (headroom, 429s, failures, signature refusals), the audit archive's last seal and the
 * investor-app outbox. Pure over its inputs; the route (app/api/system) passes the real ones.
 *
 * Not observable here, so left empty or null and said so on the page (the checks then read "attention"
 * or are absent, never "working"): service-token expiry (the provider keeps it private), cache
 * load errors (no counter), the Zoho Enterprise licence expiry (Zoho billing only; env
 * ZOHO_LICENCE_EXPIRES_ON, YYYY-MM-DD, when Digital Infrastructure sets it) and the last Zoho Sign event.
 */

import { ROLE } from "../../lib/im/constants";
import type { OpsRecord } from "../../lib/zoho/log";
import type { SystemFacts } from "./checks";

/** Who may read: seats whose role carries the `sys` capability (the front end's table, never re-ported). */
export function mayReadSystem(seat: string): boolean {
  const k = seat === "ops" ? "di" : seat;
  return Object.hasOwn(ROLE, k) && (ROLE[k as keyof typeof ROLE].can as readonly string[]).includes("sys");
}

export interface FactSources {
  readonly ops: readonly unknown[];
  readonly archiveLastRun: () => Promise<number | null>;
  readonly outbox: { stats(): { readonly lastDeliveredAt: number | null; readonly failures24h: number } };
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const isOps = (r: unknown): r is OpsRecord => typeof r === "object" && r !== null && typeof (r as { at?: unknown }).at === "number" && typeof (r as { kind?: unknown }).kind === "string";

export async function gatherFacts(src: FactSources, now: number): Promise<SystemFacts> {
  const ops = src.ops.filter(isOps);
  const badSigs = ops.filter((r) => r.kind === "refusal" && r.action === "signWebhook" && r.reason === "invalid-signature" && now - r.at <= 86_400_000).length;
  const lic = /^\d{4}-\d{2}-\d{2}$/.test((src.env ?? process.env).ZOHO_LICENCE_EXPIRES_ON ?? "") ? Date.parse(`${(src.env ?? process.env).ZOHO_LICENCE_EXPIRES_ON}T23:59:59+05:30`) : NaN;
  let archive: number | null = null;
  try { archive = await src.archiveLastRun(); } catch { archive = null; }
  const push = src.outbox.stats();
  return {
    ops, serviceTokenExpiry: {}, cache: { reads: 0, errors: 0 }, auditArchiveLastRun: archive,
    licenceExpiry: Number.isFinite(lic) ? lic : null,
    sign: { lastEventAt: null, failedHmac24h: badSigs },
    push: { lastDeliveredAt: push.lastDeliveredAt, failures24h: push.failures24h },
  };
}
