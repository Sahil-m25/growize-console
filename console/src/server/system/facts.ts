/**
 * M15-S05-NOTE-2 / M15-S03-NOTE-5 — the System checks' facts, gathered from what this process already
 * holds: Plane B (headroom, 429s, failures, signature refusals), the audit archive's last seal and the
 * investor-app outbox. Pure over its inputs; the route (app/api/system) passes the real ones.
 *
 * Sources added 4 Oct (M15-S05-NOTE-10): service-token expiry (each provider's read-only `expiresAt`, time only),
 * cache load errors (the rolling 24 h read/failed-load window in lib/zoho/cache) and the last verified Zoho Sign
 * event (the webhook stamps it in the shared state store). A source that is not passed, or that cannot answer,
 * leaves the fact empty or null and the checks read "attention" or are absent, never "working". Still not
 * observable here: the Zoho Enterprise licence expiry (Zoho billing only; env ZOHO_LICENCE_EXPIRES_ON,
 * YYYY-MM-DD, when Digital Infrastructure sets it).
 *
 * A service token is minted on demand, so an idle job holds none and is not a fault: a job appears on the card
 * only while it holds a live token (hours left) or when its last refresh failed (then "missing"/"expired", down).
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
  /** Plane C chain verdict for the last closed day; omitted → no card. */
  readonly auditChain?: () => Promise<{ readonly day: string; readonly ok: boolean | null; readonly problems?: readonly { readonly kind: string }[] }>;
  readonly archiveLastRun: () => Promise<number | null>;
  readonly outbox: { stats(): { readonly lastDeliveredAt: number | null; readonly failures24h: number } };
  /** Service-token providers (server/oauth/service-token serviceTokenProviders()); omitted → no token cards. */
  readonly serviceTokens?: readonly { readonly job: string; expiresAt(): number | null; refreshFailed(): boolean }[];
  /** Cache read / failed-load totals for the last 24 h (lib/zoho/cache LoadWindow.totals); omitted → 0 of 0. */
  readonly cacheLoads?: () => { readonly reads: number; readonly errors: number };
  /** Time of the last verified Zoho Sign event (zoho-sign/webhook signLastEventAt); omitted or failing → none yet. */
  readonly signLastEventAt?: () => Promise<number | null>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const isOps = (r: unknown): r is OpsRecord => typeof r === "object" && r !== null && typeof (r as { at?: unknown }).at === "number" && typeof (r as { kind?: unknown }).kind === "string";

export async function gatherFacts(src: FactSources, now: number): Promise<SystemFacts> {
  const ops = src.ops.filter(isOps);
  const badSigs = ops.filter((r) => r.kind === "refusal" && r.action === "signWebhook" && r.reason === "invalid-signature" && now - r.at <= 86_400_000).length;
  const lic = /^\d{4}-\d{2}-\d{2}$/.test((src.env ?? process.env).ZOHO_LICENCE_EXPIRES_ON ?? "") ? Date.parse(`${(src.env ?? process.env).ZOHO_LICENCE_EXPIRES_ON}T23:59:59+05:30`) : NaN;
  let archive: number | null = null;
  try { archive = await src.archiveLastRun(); } catch { archive = null; }
  let chain: SystemFacts["auditChain"] = null;
  if (src.auditChain) { try { chain = await src.auditChain(); } catch { chain = null; } }
  const push = src.outbox.stats();
  const tokenExpiry: Record<string, number | null> = {};
  for (const t of src.serviceTokens ?? []) {
    const at = t.expiresAt();
    if (at !== null) tokenExpiry[t.job] = Math.max(tokenExpiry[t.job] ?? 0, at);
    else if (t.refreshFailed() && !(t.job in tokenExpiry)) tokenExpiry[t.job] = null;
  }
  let signAt: number | null = null;
  if (src.signLastEventAt) { try { signAt = await src.signLastEventAt(); } catch { signAt = null; } }
  return {
    ops, serviceTokenExpiry: tokenExpiry, cache: src.cacheLoads ? { ...src.cacheLoads() } : { reads: 0, errors: 0 }, auditArchiveLastRun: archive,
    licenceExpiry: Number.isFinite(lic) ? lic : null,
    sign: { lastEventAt: signAt, failedHmac24h: badSigs },
    push: { lastDeliveredAt: push.lastDeliveredAt, failures24h: push.failures24h },
    ...(src.auditChain ? { auditChain: chain } : {}),
  };
}
