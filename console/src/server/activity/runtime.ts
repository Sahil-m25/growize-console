/**
 * M15-S03 — server-only composition for the Activity API.
 *
 *   AUDIT_ARCHIVE_DIR        absolute directory of the local append-only archive (./archive.ts); unset →
 *                            the page reads Plane C only and says the archive is not configured.
 *                            With LOG_SINK=stratus the archive is the Stratus bucket instead (../logs/stratus.ts)
 *                            and AUDIT_ARCHIVE_DIR is ignored — an AppSail disk does not outlive its instance.
 *   ZOHO_FINANCE_USER_IDS    comma-separated Zoho user ids of the Finance people, for the Auditor (optional)
 *   ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN  the "audit-archive" service grant (D53) the nightly export runs on (B-27), with
 *                            ZOHO_ACCOUNTS_ORIGIN, ZOHO_OAUTH_CLIENT_ID and ZOHO_OAUTH_CLIENT_SECRET. Unset → the job answers
 *                            "credential-not-configured" and alerts backup-failed.
 *   The scheduler calls POST /api/jobs/audit-export (JOB_SECRET), every 10 minutes from 01:30 to 03:30 IST: each call
 *   claims the job, then requests or resumes yesterday's export and polls it for at most ~20 s (catalyst/README.md).
 *
 * Every Zoho read here is on the signed-in person's own token (D53): the visibility check and the record
 * history. The archive and Plane C are read by the server; the query scopes them to the reader.
 */

import { createZohoClient, type ServiceCredential, type UserCredential } from "../../lib/zoho/client";
import { claimJob, type JobRun, type JobSummary } from "../jobs/claim";
import { createServiceTokenProvider, type ServiceTokenProvider } from "../oauth/service-token";
import { sharedState } from "../state/runtime";
import { dataRuntime } from "../data/zoho-source";
import { logSinks } from "../logs/factory";
import { reportOpsFailure } from "../ops/runtime";
import { createZohoAuditExportSource, fetchUserDirectory, runAuditExport, type ExportRun, type HttpFetch, type PendingExports } from "./export-job";
import { cleanRow, createLocalAuditArchive, type AuditArchive } from "./archive";
import { createStratusAuditArchive } from "../logs/stratus";
import type { ActivityDeps } from "./query";
import { planeCBetween } from "./sources";

const RECORD_ID = /^\d{15,22}$/;
const G = globalThis as typeof globalThis & { __gzAuditArchive?: AuditArchive | null };

export function auditArchive(env: NodeJS.ProcessEnv = process.env): AuditArchive | null {
  if (G.__gzAuditArchive !== undefined) return G.__gzAuditArchive;
  const objects = logSinks(env).objects;
  if (objects) return (G.__gzAuditArchive = createStratusAuditArchive({ client: objects, clean: cleanRow }));
  const dir = (env.AUDIT_ARCHIVE_DIR ?? "").trim();
  G.__gzAuditArchive = dir ? createLocalAuditArchive({ dir }) : null;
  return G.__gzAuditArchive;
}

const EMPTY = { days: async () => [] as string[], read: async () => [] };

export function userCrm(env: NodeJS.ProcessEnv = process.env) {
  const rt = dataRuntime();
  return createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX ?? "" });
}

export function activityDeps(credential: UserCredential, env: NodeJS.ProcessEnv = process.env): ActivityDeps {
  const crm = userCrm(env);
  const sinks = logSinks(env);
  const finance = (env.ZOHO_FINANCE_USER_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{15,25}$/.test(s));
  return {
    archive: auditArchive(env) ?? EMPTY,
    planeC: (from, to) => planeCBetween({ store: sinks.stores?.identity ?? null, ring: () => sinks.identity.events() }, from, to),
    financeUserIds: async () => (finance.length ? finance : null),
    async visible(module, ids) {
      const good = ids.filter((x) => RECORD_ID.test(x)).slice(0, 100);
      if (!good.length) return new Set<string>();
      const r = await crm.coql(credential, `select id from ${module} where id in (${good.map((x) => `'${x}'`).join(", ")}) limit 0, 200`);
      if (!r.ok) return null;
      return new Set(r.value.records.map((x) => x.id));
    },
  };
}

const netFetch: HttpFetch = async (url, init) => {
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: "error", signal: AbortSignal.timeout(60_000) });
  return { status: r.status, text: () => r.text(), arrayBuffer: () => r.arrayBuffer() };
};

/** M15-S03-T01 in-process: archive yesterday (IST) on the audit-archive service credential; failures alert as backup-failed. */
export async function nightlyAuditExport(credential: ServiceCredential, day?: string,
  o: { readonly pending?: PendingExports; readonly maxPolls?: number; readonly pollMs?: number } = {}): Promise<ExportRun> {
  const archive = auditArchive();
  const alert = (code: string) => reportOpsFailure("backup-failed", code);
  if (!archive) { alert("archive-not-configured"); return { ok: false, day: day ?? "", code: "archive-not-configured" }; }
  let userIdOf: (label: string) => string | null;
  try { userIdOf = await fetchUserDirectory({ credential, fetch: netFetch }); } catch { alert("users-unavailable"); return { ok: false, day: day ?? "", code: "users-unavailable" }; }
  return runAuditExport({ source: createZohoAuditExportSource({ credential, fetch: netFetch }), archive, userIdOf, day, onFailure: alert, ...o });
}

const G2 = globalThis as typeof globalThis & { __gzAuditTokens?: ServiceTokenProvider | null };
/** The audit-archive service token (D53: background work only), or null when its grant is not configured. */
function auditTokens(env: NodeJS.ProcessEnv): ServiceTokenProvider | null {
  if (G2.__gzAuditTokens !== undefined) return G2.__gzAuditTokens;
  if (!env.ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN || !env.ZOHO_ACCOUNTS_ORIGIN || !env.ZOHO_OAUTH_CLIENT_ID || !env.ZOHO_OAUTH_CLIENT_SECRET) return null;
  return (G2.__gzAuditTokens = createServiceTokenProvider({
    job: "audit-archive", accountsOrigin: env.ZOHO_ACCOUNTS_ORIGIN, clientId: env.ZOHO_OAUTH_CLIENT_ID,
    clientSecret: env.ZOHO_OAUTH_CLIENT_SECRET, refreshToken: env.ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN, log: dataRuntime().log,
  }));
}

/** Pending export job ids per day, in SharedState for 6 hours (a Zoho export link does not outlive that usefully). */
const sharedPending = (): PendingExports => {
  const key = (day: string) => `audit-export|pending|${day}`;
  return { get: (d) => sharedState().get(key(d)), set: (d, id) => sharedState().set(key(d), id, 6 * 3_600), clear: (d) => sharedState().release(key(d)) };
};

/** B-27: one claimed, bounded run of the nightly export for POST /api/jobs/audit-export. Each call requests yesterday's
 *  (IST) export or resumes the one already requested, polls for ~20 s, and stops; the next scheduled call carries on. */
export function runAuditExportClaimed(env: NodeJS.ProcessEnv = process.env): Promise<JobRun> {
  return claimJob(sharedState(), "audit-export", async (): Promise<JobSummary> => {
    const tokens = auditTokens(env);
    if (!tokens) { reportOpsFailure("backup-failed", "credential-not-configured"); return { ok: false, code: "credential-not-configured" }; }
    let credential: ServiceCredential;
    try { credential = await tokens.credential(AbortSignal.timeout(10_000)); } catch {
      reportOpsFailure("backup-failed", "credential-unavailable");
      return { ok: false, code: "credential-unavailable" };
    }
    const r = await nightlyAuditExport(credential, undefined, { pending: sharedPending(), maxPolls: 3, pollMs: 8_000 });
    return r.ok ? { ok: true, day: r.day, rows: r.rows, skipped: r.skipped } : { ok: false, day: r.day, code: r.code };
  }, 5 * 60);
}
