/**
 * D121 A — server-only composition of the KAM share service (kam-share.ts, kam-share-queue.ts).
 *
 *   ZOHO_KAM_SHARE_REFRESH_TOKEN   the "kam-share" service grant of the share-service Zoho user (profile "Share Service",
 *                                  zoho/access/spec.json: View + Share on Contacts / allotments / Touches, View on Leads,
 *                                  identity, bank and money hidden). Scopes: ZohoCRM.coql.READ, ZohoCRM.modules.contacts.READ,
 *                                  ZohoCRM.modules.custom.READ, ZohoCRM.share.{module}.ALL for contacts, LLP_UnitAllocation_Module
 *                                  and Touches (v8 update-share-permissions names ZohoCRM.share.{module_name}.UPDATE; read
 *                                  5 Oct 2026). UNVERIFIED: the custom-module spelling of {module_name} — probe on the sandbox.
 *   ZOHO_SHARE_SERVICE_USER_ID     that user's Zoho id: the reconcile keeps shares a person made by hand (manual override).
 * Without the token every share stays "pending" (nothing fails silently) and the job answers not-configured.
 */

import { createZohoServiceClient, type ServiceCredential } from "../../lib/zoho/client";
import { createServiceTokenProvider, type ServiceTokenProvider } from "../oauth/service-token";
import { oauthParts } from "../oauth/runtime";
import { planeBLog } from "../logs/runtime";
import { sharedState } from "../state/runtime";
import { createKamShareQueue, type KamShareQueue } from "./kam-share-queue";
import type { KamShareClient } from "./kam-share";

type Held = { queue: KamShareQueue; client: KamShareClient; credential: (signal?: AbortSignal) => Promise<ServiceCredential | null> };
const G = globalThis as typeof globalThis & { __gzKamShareRuntime?: Held };

function held(): Held {
  if (G.__gzKamShareRuntime) return G.__gzKamShareRuntime;
  const o = oauthParts();
  const env = process.env;
  let provider: ServiceTokenProvider | null = null;
  const credential = async (signal?: AbortSignal) => {
    if (!env.ZOHO_KAM_SHARE_REFRESH_TOKEN || !env.ZOHO_ACCOUNTS_ORIGIN || !env.ZOHO_OAUTH_CLIENT_ID || !env.ZOHO_OAUTH_CLIENT_SECRET) return null;
    provider ??= createServiceTokenProvider({
      job: "kam-share", accountsOrigin: env.ZOHO_ACCOUNTS_ORIGIN, clientId: env.ZOHO_OAUTH_CLIENT_ID,
      clientSecret: env.ZOHO_OAUTH_CLIENT_SECRET, refreshToken: env.ZOHO_KAM_SHARE_REFRESH_TOKEN, log: o.log,
    });
    return provider.credential(signal);
  };
  const client = createZohoServiceClient({ gate: o.gate, log: o.log, recordIdPrefix: o.recordIdPrefix, maxAttempts: 2 });
  const queue = createKamShareQueue({ state: sharedState(), client, credential, log: planeBLog() });
  G.__gzKamShareRuntime = { queue, client, credential };
  return G.__gzKamShareRuntime;
}

export const kamShareQueue = (): KamShareQueue => held().queue;
export const kamShareService = () => held();
export const shareServiceUserId = (): string | null => {
  const v = process.env.ZOHO_SHARE_SERVICE_USER_ID ?? "";
  return /^\d{15,25}$/.test(v) ? v : null;
};
