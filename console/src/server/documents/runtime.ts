/**
 * Server-only composition for the Documents routes (M12-S02/S03). The uploader is one per process so its
 * double-press memory (Idempotency-Key → answer) spans requests; it holds keys and fingerprints, never bytes.
 * documentsList() is the Documents read with the per-viewer Zoho Sign status reader wired in (D53: each Sign read
 * on the viewer's own token; nothing cached) — the one composition the Documents route, the Investors queue and
 * Numbers → Paper use, so all three show the same Viewed / Declined / Recalled and sent dates.
 */

import { createZohoClient, type ZohoClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { dataRuntime } from "../data/zoho-source";
import { createSignApi } from "../zoho-sign/api";
import { createSignStatusReader } from "../zoho-sign/status";
import { createDocumentsList, type DocumentsList, type SignStatusReader } from "./list";
import { sharedState } from "../state/runtime";
import { createUploader, type Uploader } from "./upload";

const G = globalThis as typeof globalThis & { __gzDocUploader?: Uploader; __gzDocSignStatus?: SignStatusReader | null };
const INDIA_SIGN_ORIGIN = "https://sign.zoho.in";

export function documentUploader(env: NodeJS.ProcessEnv = process.env): Uploader {
  if (G.__gzDocUploader) return G.__gzDocUploader;
  const rt = dataRuntime();
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX! });
  G.__gzDocUploader = createUploader({ crm, log: rt.log, state: sharedState() });
  return G.__gzDocUploader;
}

/** The per-viewer Sign status reader, or undefined when Zoho Sign is not configured (India DC only). */
export function documentsSignStatus(env: NodeJS.ProcessEnv = process.env): SignStatusReader | undefined {
  if (G.__gzDocSignStatus !== undefined) return G.__gzDocSignStatus ?? undefined;
  if (env.ZOHO_SIGN_API_ORIGIN !== INDIA_SIGN_ORIGIN) return undefined;
  const rt = dataRuntime();
  G.__gzDocSignStatus = createSignStatusReader(createSignApi({ origin: INDIA_SIGN_ORIGIN, gate: rt.gate, log: rt.log }));
  return G.__gzDocSignStatus;
}

/** The Documents read on the given client, with the Sign status reader when configured. */
export function documentsList(crm: Pick<ZohoClient, "coql" | "getRelated">, log: OpsLog, env: NodeJS.ProcessEnv = process.env): DocumentsList {
  return createDocumentsList({ crm, log, signStatus: documentsSignStatus(env) });
}
