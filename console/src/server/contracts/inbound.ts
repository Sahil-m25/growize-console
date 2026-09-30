/**
 * M13-S01-T02 — THE INBOUND ENDPOINT: request.raised and push.delivered from the investor app (D73).
 *
 * The same verify → validate → dedupe path as the stub (events.ts createStubReceiver), accepting only
 * request.raised and push.delivered. A bad signature, bad JSON, an unknown type or version or an
 * invalid body is refused and written to Plane B as a refusal with a short code (AC4) — the body is
 * never logged. An event_id already applied answers 200 and does nothing (AC5). If handling fails (Zoho
 * down) the event is not marked seen and the error propagates, so the app redelivers.
 * M13-S05: a request.raised the handler refuses (the Contact check) answers 422 with a short code and a
 * Plane B line, and is not marked applied; a request.raised answers with its Case id, the replay too.
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
  /** request.raised → a Case (requests.ts). Throw to have the app redeliver; `refused` answers 422. */
  readonly onRequest: (event: Record<string, unknown>) => Promise<void | { readonly caseId?: string | null; readonly refused?: string }>;
  /** The Case already filed for an app_request_id, for the answer to a replayed event. */
  readonly caseFor?: (appRequestId: string) => Promise<string | null>;
  /** push.delivered → the outbox marks that event delivered. */
  readonly onDelivered: (event: Record<string, unknown>) => void | Promise<void>;
  readonly newId: () => string;
  readonly clock?: () => number;
}

export type InboundResult =
  | { readonly status: 200; readonly applied: boolean; readonly ack: Record<string, unknown> | null; readonly caseId?: string | null }
  | { readonly status: 400 | 401 | 422; readonly reason: string };

class Refused extends Error { constructor(readonly code: string) { super(code); } }

export function createInboundEndpoint(deps: InboundDeps) {
  const clock = deps.clock ?? Date.now;
  // One receiver per call, so the Case id of one request never answers another running beside it.
  // M12-S05-H5: an id is marked seen only after it is applied, so two concurrent deliveries would both apply it. The claim
  // below is made in the same synchronous step as the check (after the await), and released when the call ends.
  const inFlight = new Set<string>();
  const receiverFor = (out: { caseId?: string | null }, claimed: string[]) => createStubReceiver({
    schemas: deps.schemas, keys: deps.keys,
    seen: {
      has: async (id) => {
        if (inFlight.has(id)) return true;
        if (await deps.seen.has(id)) return true;
        if (inFlight.has(id)) return true;
        inFlight.add(id); claimed.push(id);
        return false;
      },
      add: (id) => deps.seen.add(id),
    },
    accepts: INBOUND_TYPES, newId: deps.newId, clock,
    async record(event) {
      if (event.type === "request.raised") {
        const r = await deps.onRequest(event);
        if (r && typeof r.refused === "string") throw new Refused(r.refused);
        if (r) out.caseId = r.caseId ?? null;
      } else await deps.onDelivered(event);
    },
  });
  const refuse = (reason: string): void => {
    try {
      deps.log.refusal({ at: clock(), actor: { kind: "service", job: "provider-callback" }, action: "investorAppWebhook", reason: `inbound-${reason}`, recordIds: [] });
    } catch { /* logging never takes the callback down */ }
  };
  return Object.freeze({
    async handle(rawBody: string, signature: unknown): Promise<InboundResult> {
      const out: { caseId?: string | null } = {};
      let r: ReceiveResult;
      const claimed: string[] = [];
      try { r = await receiverFor(out, claimed).receive(rawBody, signature); } catch (e) {
        if (e instanceof Refused) { refuse(e.code); return { status: 422, reason: e.code }; }
        throw e;
      } finally { for (const id of claimed) inFlight.delete(id); }
      if (r.status !== 200) { refuse(r.reason); return r; }
      if (out.caseId !== undefined) return { ...r, caseId: out.caseId };
      if (!r.applied && deps.caseFor) {
        // A replay: answer with the Case filed the first time (the body verified and validated above).
        const e = JSON.parse(rawBody) as { type?: unknown; payload?: { app_request_id?: unknown } };
        if (e.type === "request.raised" && typeof e.payload?.app_request_id === "string") return { ...r, caseId: await deps.caseFor(e.payload.app_request_id) };
      }
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
