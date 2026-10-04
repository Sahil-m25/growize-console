/**
 * M13-S01 — server-only composition of the contract push and the inbound endpoint.
 *
 * Writers elsewhere (the Case reply, the farm shelf, investor updates once their schema exists) call
 * `publishToInvestorApp(event)`; the outbox drains on a timer while anything is open. Pages read the
 * delivery state through GET /api/contracts/deliveries. Failures alert via reportOpsFailure("push-failed").
 */

import { randomUUID } from "node:crypto";
import { createGate } from "../../lib/zoho/gate";
import { createOpsLog } from "../../lib/zoho/log";
import { createZohoServiceClient } from "../../lib/zoho/client";
import { createServiceTokenProvider, type ServiceTokenProvider } from "../oauth/service-token";
import { logSinks, sharedOpsSink } from "../logs/factory";
import { createJsonlStore } from "../logs/jsonl";
import { alertingOpsSink, reportOpsFailure } from "../ops/runtime";
import type { JsonSchema } from "./events";
import { createInboundEndpoint, createSeenEvents } from "./inbound";
import { sharedState } from "../state/runtime";
import { createOutbox, deliveriesForRecord, type DeliveryState, type Outbox, type PushFetch } from "./outbox";
import { createRequestIndex, createRequestIntake } from "./requests";
import { contractKeys, createInProcessStub, investorAppMode, loadSchemas } from "./stub";

const log = createOpsLog(alertingOpsSink(sharedOpsSink()));

type Held = {
  schemas: Readonly<Record<string, JsonSchema>>;
  outbox: Outbox;
  stub: ReturnType<typeof createInProcessStub> | null;
  timer: ReturnType<typeof setInterval> | null;
  inbound: ReturnType<typeof createInboundEndpoint> | null;
  provider: ServiceTokenProvider | null;
};
const G = globalThis as typeof globalThis & { __gzContracts?: Held };

const planeStore = (plane: string) => {
  const s = logSinks();
  return s.kind === "jsonl" && s.dir ? createJsonlStore({ dir: s.dir, plane }) : null;
};

const networkFetch: PushFetch = async (url, init) => {
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: "error", signal: AbortSignal.timeout(10_000) });
  return { status: r.status, text: () => r.text() };
};

function held(): Held {
  if (G.__gzContracts) return G.__gzContracts;
  const schemas = loadSchemas();
  const mode = investorAppMode();
  const keys = contractKeys(process.env, mode);
  const stub = mode.kind === "stub" && keys.current ? createInProcessStub({ schemas, keys: keys.all }) : null;
  const outbox = createOutbox({
    schemas,
    target: () => (!keys.current ? null : mode.kind === "app" ? { url: mode.url, key: keys.current } : mode.kind === "stub" ? { url: "stub://investor-app/events", key: keys.current } : null),
    fetch: stub ? stub.fetch : networkFetch,
    ledger: planeStore("push") ?? undefined,
    onFailure: (code) => reportOpsFailure("push-failed", code),
  });
  G.__gzContracts = { schemas, outbox, stub, timer: null, inbound: null, provider: null };
  return G.__gzContracts;
}

export const investorAppOutbox = (): Outbox => held().outbox;

/**
 * M13-S05-T03 — the delivery states for one Zoho record (a Case), optionally of one event type: the live
 * outbox, and the push ledger for events sent before a restart (the last 14 days). Ids and status only.
 */
export function investorAppDeliveries(recordId: string, type?: string): DeliveryState[] {
  const ledger = planeStore("push");
  const lines: unknown[] = [];
  if (ledger) for (const day of ledger.days().slice(-14)) lines.push(...ledger.read(day));
  return deliveriesForRecord(held().outbox.forRecord(recordId), lines, recordId, type);
}
/** Tests and the fixture demo only: what the stub received. Null when the real app is configured. */
export const investorAppStub = () => held().stub;

function schedule(h: Held): void {
  if (h.timer) return;
  h.timer = setInterval(() => {
    void h.outbox.drain().finally(() => {
      if (h.outbox.stats().open === 0 && h.timer) { clearInterval(h.timer); h.timer = null; }
    });
  }, 15_000);
  (h.timer as { unref?: () => void }).unref?.();
}

/** Queue one event for the investor app and try it now. Returns the delivery state or the refusal. */
export async function publishToInvestorApp(event: Record<string, unknown>) {
  const h = held();
  const r = h.outbox.enqueue(event);
  if (!r.ok) {
    reportOpsFailure("push-failed", r.reason);
    return r;
  }
  await h.outbox.drain();
  if (h.outbox.stats().open > 0) schedule(h);
  return { ok: true as const, eventId: r.eventId, state: h.outbox.state(r.eventId) ?? r.state };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}.`);
  return v;
}

/** The inbound endpoint (POST /api/webhooks/investor-app). Throws when not configured (the route answers 503). */
export function investorAppInbound() {
  const h = held();
  if (h.inbound) return h.inbound;
  const keys = contractKeys();
  if (!keys.all.length) throw new Error("CONTRACT_SIGNING_KEY is not set.");
  const seen = createSeenEvents(planeStore("inbound"));
  const crm = createZohoServiceClient({ gate: createGate(), log, recordIdPrefix: required("ZOHO_CRM_RECORD_ID_PREFIX"), maxAttempts: 1 });
  const provider = (): ServiceTokenProvider => (h.provider ??= createServiceTokenProvider({
    job: "provider-callback", accountsOrigin: "https://accounts.zoho.in", clientId: required("ZOHO_OAUTH_CLIENT_ID"),
    clientSecret: required("ZOHO_OAUTH_CLIENT_SECRET"), refreshToken: required("ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN"),
    expectedApiDomain: "https://www.zohoapis.in", refreshTimeoutMs: 2_500, log,
  }));
  const intake = createRequestIntake({
    crm, log, credential: () => provider().credential(), index: createRequestIndex(planeStore("requests")),
    contactIdPrefix: required("ZOHO_CRM_RECORD_ID_PREFIX"), publish: publishToInvestorApp,
  });
  h.inbound = createInboundEndpoint({
    schemas: h.schemas, keys: keys.all, seen, log, newId: randomUUID, caseFor: intake.caseFor, state: sharedState(),
    async onRequest(event) {
      try {
        const r = await intake.handle(event);
        return r.ok ? { caseId: r.caseId } : { refused: r.refused };
      } catch (e) {
        reportOpsFailure("push-failed", "case-unavailable");
        throw e;
      }
    },
    onDelivered(event) {
      const p = event.payload as { message_id: string; status?: "delivered" | "bounced" | "deferred" };
      h.outbox.acknowledge(p.message_id, p.status ?? "delivered");
    },
  });
  return h.inbound;
}
