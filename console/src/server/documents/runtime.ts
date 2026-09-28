/**
 * Server-only composition for the Documents routes (M12-S02/S03). The uploader is one per process so its
 * double-press memory (Idempotency-Key → answer) spans requests; it holds keys and fingerprints, never bytes.
 */

import { createZohoClient } from "../../lib/zoho/client";
import { dataRuntime } from "../data/zoho-source";
import { createUploader, type Uploader } from "./upload";

const G = globalThis as typeof globalThis & { __gzDocUploader?: Uploader };

export function documentUploader(env: NodeJS.ProcessEnv = process.env): Uploader {
  if (G.__gzDocUploader) return G.__gzDocUploader;
  const rt = dataRuntime();
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX! });
  G.__gzDocUploader = createUploader({ crm, log: rt.log });
  return G.__gzDocUploader;
}
