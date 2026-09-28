/**
 * M13-S01-T02 — THE INBOUND ENDPOINT: request.raised and push.delivered from the investor app (D73).
 *
 * The same verify → validate → dedupe path as the stub (events.ts createStubReceiver), accepting only
 * request.raised and push.delivered. A bad signature, bad JSON, an unknown type or version or an
 * invalid body is refused and written to Plane B as a refusal with a short code (AC4) — the body is
 * never logged. An event_id already applied answers 200 and does nothing (AC5). If handling fails (Zoho
 * down) the event is not marked seen and the error propagates, so the app redelivers.
 */

import type { OpsLog } from "../../lib/zoho/log";
import type { AppendOnlyStore } from "../logs/jsonl";
import { createStubReceiver, type JsonSchema, type ReceiveResult, type SeenEvents } from "./events";

export const INBOUND_TYPES = Object.freeze(["request.raised", "push.delivered"] as const);
export const INBOUND_SIGNATURE_HEADER = "x-signature";
export const MAX_INBOUND_BYTES = 64 * 1024;

export interface InboundDeps {
  readonly schemas: Readonly<Record<string, JsonSchema>>;
  readonly keys: readonly string[];
  readonly seen: SeenEvents;
  readonly log: OpsLog;
  /** request.raised → a Case (events.ts requestToCase). Throw to have the app redeliver. */
  readonly onRequest: (event: Record<string, unknown>) => Promise<void>;
  /** push.delivered → the outbox marks that event delivered. */
  readonly onDelivered: (event: Record<string, unknown>) => void | Promise<void>;
  readonly newId: () => string;
  readonly clock?: () => number;
}

export function createInboundEndpoint(deps: InboundDeps) {
  const clock = deps.clock ?? Date.now;
  const receiver = createStubReceiver({
    schemas: deps.schemas, keys: deps.keys, seen: deps.seen, accepts: INBOUND_TYPES, newId: deps.newId, clock,
    async record(event) {
      if (event.type === "request.raised") await deps.onRequest(event);
      else await deps.onDelivered(event);
    },
  });
  const refuse = (reason: string): void => {
    try {
      deps.log.refusal({ at: clock(), actor: { kind: "service", job: "provider-callback" }, action: "investorAppWebhook", reason: `inbound-${reason}`, recordIds: [] });
    } catch { /* logging never takes the callback down */ }
  };
  return Object.freeze({
    async handle(rawBody: string, signature: unknown): Promise<ReceiveResult> {
      const r = await receiver.receive(rawBody, signature);
      if (r.status !== 200) refuse(r.reason);
      return r;
    },
  });
}

/** Applied event ids: in memory, and in an append-only file when one is given (survives a restart). */
export function createSeenEvents(store?: AppendOnlyStore | null, keepDays = 14): SeenEvents {
  let ids: Set<string> | null = null;
  const load = (): Set<string> => {
    if (ids) return ids;
    ids = new Set();
    if (store) for (const day of store.days().slice(-keepDays)) for (const l of store.read(day)) {
      const id = (l as { eventId?: unknown } | null)?.eventId;
      if (typeof id === "string") ids.add(id);
    }
    return ids;
  };
  return Object.freeze({
    has: async (id: string) => load().has(id),
    add: async (id: string) => { load().add(id); store?.append({ eventId: id }); },
  });
}
