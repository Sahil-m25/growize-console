/**
 * M15-S03 — server-only composition for the Activity API.
 *
 *   AUDIT_ARCHIVE_DIR        absolute directory of the local append-only archive (./archive.ts); unset →
 *                            the page reads Plane C only and says the archive is not configured.
 *                            With LOG_SINK=stratus the archive is the Stratus bucket instead (../logs/stratus.ts)
 *                            and AUDIT_ARCHIVE_DIR is ignored — an AppSail disk does not outlive its instance.
 *   ZOHO_FINANCE_USER_IDS    comma-separated Zoho user ids of the Finance people, for the Auditor (optional)
 *
 * Every Zoho read here is on the signed-in person's own token (D53): the visibility check and the record
 * history. The archive and Plane C are read by the server; the query scopes them to the reader.
 */

import { createZohoClient, type ServiceCredential, type UserCredential } from "../../lib/zoho/client";
import { dataRuntime } from "../data/zoho-source";
import { logSinks } from "../logs/factory";
import { reportOpsFailure } from "../ops/runtime";
import { createZohoAuditExportSource, fetchUserDirectory, runAuditExport, type ExportRun, type HttpFetch } from "./export-job";
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
export async function nightlyAuditExport(credential: ServiceCredential, day?: string): Promise<ExportRun> {
  const archive = auditArchive();
  const alert = (code: string) => reportOpsFailure("backup-failed", code);
  if (!archive) { alert("archive-not-configured"); return { ok: false, day: day ?? "", code: "archive-not-configured" }; }
  let userIdOf: (label: string) => string | null;
  try { userIdOf = await fetchUserDirectory({ credential, fetch: netFetch }); } catch { alert("users-unavailable"); return { ok: false, day: day ?? "", code: "users-unavailable" }; }
  return runAuditExport({ source: createZohoAuditExportSource({ credential, fetch: netFetch }), archive, userIdOf, day, onFailure: alert });
}
