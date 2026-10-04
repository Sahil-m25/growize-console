/**
 * M17-S06 — the System page's checks, worked out from the console's own operational log (Plane B,
 * D47) and a handful of facts the server already holds. Nothing here is typed in: the prototype's
 * CHECKS list (mirror, leads DB, second org) described an architecture D45/D52 replaced.
 *
 * Each check says working / needs attention / not working, with who owns it and what fixes it.
 * Digital Infrastructure only (D60, D68).
 */

import type { OpsRecord } from "../../lib/zoho/log";
import type { SeatedZohoUser } from "../oauth/seat";

export type CheckState = "working" | "attention" | "down";
export interface Check { readonly key: string; readonly t: string; readonly state: CheckState; readonly figure: string; readonly owner: string; readonly fix: string }

export interface SystemFacts {
  /** Plane B records (Zoho calls and refusals) for at least the last 24 hours. */
  readonly ops: readonly OpsRecord[];
  /** Expiry of the service tokens the background jobs hold (ms since epoch), by job. */
  readonly serviceTokenExpiry: Readonly<Record<string, number | null>>;
  readonly cache: { readonly reads: number; readonly errors: number };
  readonly auditArchiveLastRun: number | null;
  readonly licenceExpiry: number | null;
  readonly sign: { readonly lastEventAt: number | null; readonly failedHmac24h: number };
  readonly push: { readonly lastDeliveredAt: number | null; readonly failures24h: number };
  /** Plane C's hash chain for the last closed day (server/logs/runtime auditChain().verify); omitted → no card. */
  readonly auditChain?: { readonly day: string; readonly ok: boolean | null; readonly problems?: readonly { readonly kind: string }[] } | null;
}

const H = 3_600_000, D = 24 * H;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const days = (ms: number) => Math.floor(ms / D);

/** Pure: the checks at `now` from `facts`. Thresholds are the runbooks' (ops/runbooks). */
export function systemChecks(facts: SystemFacts, now: number): readonly Check[] {
  const calls = facts.ops.filter((r): r is Extract<OpsRecord, { kind: "zoho-call" }> => r.kind === "zoho-call" && now - r.at <= D);
  const credits = calls.filter((c) => c.creditsRemaining !== null).sort((a, b) => b.at - a.at)[0]?.creditsRemaining ?? null;
  const r429 = calls.filter((c) => c.status === 429).length;
  const failed = calls.filter((c) => c.errorClass !== null && c.errorClass !== "not-found" && c.errorClass !== "conflict").length;
  const out: Check[] = [];
  out.push({ key: "credits", t: "Zoho API credits left", figure: credits === null ? "no call in 24 h" : String(credits),
    state: credits === null ? "attention" : credits < 1_000 ? "down" : credits < 5_000 ? "attention" : "working",
    owner: "Digital Infrastructure", fix: "ops/runbooks/api-budget.md — slow background jobs, check for a loop, buy an add-on" });
  out.push({ key: "429s", t: "Rate-limited calls (429) in 24 h", figure: String(r429),
    state: r429 > 20 ? "down" : r429 > 0 ? "attention" : "working",
    owner: "Digital Infrastructure", fix: "ops/runbooks/api-budget.md — lower the gate's concurrency, find the burst" });
  out.push({ key: "errors", t: "Failed Zoho calls in 24 h", figure: `${failed} of ${calls.length} (${pct(failed, calls.length)}%)`,
    state: pct(failed, calls.length) > 5 ? "down" : failed > 0 ? "attention" : "working",
    owner: "Digital Infrastructure", fix: "System → the failing endpoint in the operational log" });
  for (const [job, exp] of Object.entries(facts.serviceTokenExpiry)) {
    out.push({ key: `token:${job}`, t: `Service token (${job})`, figure: exp === null ? "missing" : exp <= now ? "expired" : `${Math.round((exp - now) / H)} h left`,
      state: exp === null || exp <= now ? "down" : exp - now < H ? "attention" : "working",
      owner: "Digital Infrastructure", fix: "Re-consent the service client in the Zoho API console; rotate the refresh token" });
  }
  const cacheRate = pct(facts.cache.errors, facts.cache.reads);
  out.push({ key: "cache", t: "Cache load errors", figure: `${cacheRate}%`, state: cacheRate > 10 ? "down" : cacheRate > 1 ? "attention" : "working",
    owner: "Digital Infrastructure", fix: "Loads failing behind the cache are Zoho errors: see Failed Zoho calls" });
  out.push({ key: "archive", t: "Audit archive last run", figure: facts.auditArchiveLastRun === null ? "never" : `${days(now - facts.auditArchiveLastRun)} days ago`,
    state: facts.auditArchiveLastRun === null || now - facts.auditArchiveLastRun > 8 * D ? "down" : now - facts.auditArchiveLastRun > 2 * D ? "attention" : "working",
    owner: "Digital Infrastructure", fix: "ops/runbooks/heartbeat-silent.md — the weekly archive job" });
  out.push({ key: "licence", t: "Zoho Enterprise licence", figure: facts.licenceExpiry === null ? "unknown" : `${days(facts.licenceExpiry - now)} days left`,
    state: facts.licenceExpiry === null || facts.licenceExpiry <= now ? "down" : facts.licenceExpiry - now < 30 * D ? "attention" : "working",
    owner: "Sahil", fix: "Renew in Zoho billing before it lapses" });
  out.push({ key: "sign", t: "Zoho Sign webhooks", figure: `${facts.sign.lastEventAt === null ? "no event yet" : `last ${Math.round((now - facts.sign.lastEventAt) / H)} h ago`} · ${facts.sign.failedHmac24h} failed signatures`,
    state: facts.sign.failedHmac24h > 0 ? "down" : facts.sign.lastEventAt === null || now - facts.sign.lastEventAt > 7 * D ? "attention" : "working",
    owner: "Digital Infrastructure", fix: "ops/runbooks/webhook-stopped.md — check the callback URL and the HMAC key" });
  out.push({ key: "push", t: "Investor app delivery", figure: `${facts.push.lastDeliveredAt === null ? "nothing delivered yet" : `last ${Math.round((now - facts.push.lastDeliveredAt) / H)} h ago`} · ${facts.push.failures24h} failures`,
    state: facts.push.failures24h > 5 ? "down" : facts.push.failures24h > 0 || facts.push.lastDeliveredAt === null ? "attention" : "working",
    owner: "Digital Infrastructure", fix: "ops/runbooks/outbox-stuck.md — the outbox and the app's receiver" });
  if (facts.auditChain) {
    const a = facts.auditChain;
    const kinds = [...new Set((a.problems ?? []).map((p) => p.kind))].join(", ");
    out.push({ key: "audit-chain", t: `Audit trail chain (${a.day})`,
      figure: a.ok === null ? "logs kept in memory only" : a.ok ? "intact" : `broken — ${kinds || "see the verifier"}`,
      state: a.ok === null ? "attention" : a.ok ? "working" : "down",
      owner: "Digital Infrastructure", fix: "docs/architecture/log-sink.md — run scripts/verify-audit-chain.mjs for the day; treat a break as an incident" });
  }
  return Object.freeze(out.map((c) => Object.freeze(c)));
}

export type SystemResult =
  | { readonly ok: true; readonly value: { readonly working: number; readonly attention: number; readonly down: number; readonly cards: readonly Check[]; readonly all: readonly Check[] } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "not-digital-infrastructure" };

/** The page: counts, and a card for every check that is not working. DI only. */
export function systemPage(actor: SeatedZohoUser | null, facts: SystemFacts, now: number): SystemResult {
  if (!actor || actor.seat !== "digital-infrastructure") return { ok: false, kind: "refused", reasonCode: "not-digital-infrastructure" };
  const all = systemChecks(facts, now);
  const n = (s: CheckState) => all.filter((c) => c.state === s).length;
  const order: Record<CheckState, number> = { down: 0, attention: 1, working: 2 };
  return { ok: true, value: { working: n("working"), attention: n("attention"), down: n("down"),
    cards: all.filter((c) => c.state !== "working").sort((a, b) => order[a.state] - order[b.state]), all } };
}
