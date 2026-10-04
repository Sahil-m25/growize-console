/**
 * M13-S01-T01 — THE SIGNED OUTBOUND CLIENT: the console's push to the investor app (D73).
 *
 * `enqueue` builds nothing new: the event is validated against contracts/ (validateEvent) and checked
 * for identity values (PAN, Aadhaar, bank numbers, UTR/IFSC shapes — never in an event, AC6), then held
 * in the retry queue. `drain` makes one attempt per due event through `pushEvent` (sign, idempotency
 * key = event_id), stamping the envelope's `sent_at` on each attempt. A 5xx, a network failure or a 200
 * without a push.delivered answer is retried with exponential backoff; a 4xx or the last attempt moves
 * the event to the dead-letter shelf and calls `onFailure` (runtime: reportOpsFailure("push-failed")).
 * Delivered is only ever set by a push.delivered for that event — synchronous from pushEvent, or later
 * from the inbound endpoint (`markDelivered`). Until then the pages read "Not delivered yet" (AC3).
 *
 * The payload lives only in this queue (and the dead-letter shelf, for a replay); once delivered it is
 * dropped. The ledger, when given, receives ids, type, status and codes only (Plane B rule: no bodies).
 */

import { randomUUID } from "node:crypto";
import { pushEvent, validateEvent, SCHEMA_VERSION, type JsonSchema } from "./events";

export type DeliveryStatus = "queued" | "retrying" | "delivered" | "dead";
export const DELIVERY_LABEL: Readonly<Record<DeliveryStatus, string>> = Object.freeze({
  queued: "Not delivered yet", retrying: "Not delivered yet", delivered: "Delivered", dead: "Not delivered — needs attention",
});

export interface DeliveryState {
  readonly eventId: string;
  readonly type: string;
  readonly status: DeliveryStatus;
  readonly label: string;
  readonly attempts: number;
  /** A short code: "unreachable", "no-ack", "refused-404", "not-configured", "bounced"… */
  readonly lastReason: string | null;
  readonly nextAt: number | null;
  readonly deliveredAt: number | null;
  /** Zoho record ids the event concerns (Contact, Case…), so a page can ask "is this reply delivered?". */
  readonly recordIds: readonly string[];
}

export interface PushTarget { readonly url: string; readonly key: string }
export type PushFetch = Parameters<typeof pushEvent>[1]["fetch"];
/** An append-only sink for delivery lines (AppendOnlyStore from server/logs/jsonl.ts fits). */
export interface DeliveryLedger { append(line: object): void }

export interface OutboxDeps {
  readonly schemas: Readonly<Record<string, JsonSchema>>;
  /** The receiver: the stub or the real app (./stub.ts `investorAppTarget`). null → not configured, the event waits. */
  readonly target: () => PushTarget | null;
  readonly fetch: PushFetch;
  readonly clock?: () => number;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxQueue?: number;
  readonly ledger?: DeliveryLedger;
  /** Called once when an event is dead-lettered, with a short code. */
  readonly onFailure?: (code: string) => void;
}

export type EnqueueResult =
  | { readonly ok: true; readonly eventId: string; readonly state: DeliveryState }
  | { readonly ok: false; readonly reason: "invalid" | "unknown-type" | "unknown-version" | "identity-in-event" | "queue-full"; readonly errors: readonly string[] };

/* ---- identity guard (AC6) ------------------------------------------------------------------------- */

const IDENTITY_IN_TEXT: readonly RegExp[] = Object.freeze([
  /(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])/, // PAN
  /(?<![0-9])[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}(?![0-9])/, // Aadhaar, spaced
  /(?<![0-9])[0-9]{9,14}(?![0-9])/, // Aadhaar, account number, numeric UTR (record ids are 15–22 digits)
  /(?<![A-Za-z0-9])[A-Za-z]{4}0[A-Za-z0-9]{6}(?![A-Za-z0-9])/, // IFSC
  /(?<![A-Za-z0-9])[A-Za-z]{4}[A-Za-z0-9]?[0-9]{8,}/, // NEFT/RTGS UTR
]);
const UUID_OR_TIME = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))$/i;

/** The paths of string values that look like an identity value. Empty → the event may leave. */
export function identityPaths(value: unknown, at = "$"): string[] {
  if (typeof value === "string") return !UUID_OR_TIME.test(value) && IDENTITY_IN_TEXT.some((re) => re.test(value)) ? [at] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => identityPaths(v, `${at}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => identityPaths(v, `${at}.${k}`));
  return [];
}

/* ---- event builders ----------------------------------------------------------------------------- */

/** ISO 8601 in Asia/Kolkata with the +05:30 offset (rule 9: one clock). */
export const istIso = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;

export function newEvent(type: string, parts: {
  readonly actor: Record<string, unknown>; readonly ids: Record<string, unknown>; readonly payload: Record<string, unknown>; readonly occurredAt?: number;
}, clock: () => number = Date.now): Record<string, unknown> {
  return { event_id: randomUUID(), type, schema_version: SCHEMA_VERSION, occurred_at: istIso(parts.occurredAt ?? clock()),
    actor: parts.actor, ids: parts.ids, payload: parts.payload, origin: "console" };
}

/** A KAM's reply on a Case, for the app's case thread. `message` is the text meant for the investor. */
export const caseReplied = (a: { caseId: string; contactId: string; message: string; byUserId: string; at?: number }, clock: () => number = Date.now) =>
  newEvent("case.replied", { actor: { kind: "user", zoho_user_id: a.byUserId }, ids: { investor_contact_id: a.contactId },
    payload: { case_id: a.caseId, message: a.message, at: istIso(a.at ?? clock()) }, occurredAt: a.at }, clock);

/** The console's answer to request.raised (M13-S05): state "received" with the Case once it exists; the outcome later. */
export const requestExecuted = (a: {
  appRequestId: string; contactId: string; state: "received" | "executed" | "refused" | "withdrawn"; caseId?: string; byUserId?: string; at?: number;
}, clock: () => number = Date.now) =>
  newEvent("request.executed", { actor: a.byUserId ? { kind: "user", zoho_user_id: a.byUserId } : { kind: "system" }, ids: { investor_contact_id: a.contactId },
    payload: { app_request_id: a.appRequestId, state: a.state, ...(a.caseId ? { case_id: a.caseId } : {}), at: istIso(a.at ?? clock()) }, occurredAt: a.at }, clock);

/** A farm progress note for one investor's project. */
export const farmProgress = (a: { contactId: string; project: string; phase: string; note?: string; at?: number }, clock: () => number = Date.now) =>
  newEvent("farm.progress", { actor: { kind: "system" }, ids: { investor_contact_id: a.contactId },
    payload: { project: a.project, phase: a.phase, ...(a.note ? { note: a.note } : {}), at: istIso(a.at ?? clock()) }, occurredAt: a.at }, clock);

/**
 * A farm LLP's units put on the shelf or taken back (M13-S01-NOTE-4, PROVISIONAL schema). One event per change,
 * no investor in it: the app reads it as the farm's availability.
 */
export const farmShelfChanged = (a: {
  llpId: string; label: string; action: "released" | "taken_back"; unitsReleased: number; totalUnits?: number | null; byUserId: string; at?: number;
}, clock: () => number = Date.now) =>
  newEvent("farm.shelf_changed", { actor: { kind: "user", zoho_user_id: a.byUserId }, ids: {},
    payload: { llp_id: a.llpId, project: a.label, action: a.action, units_released: a.unitsReleased,
      ...(typeof a.totalUnits === "number" && a.totalUnits >= 0 ? { total_units: a.totalUnits } : {}), at: istIso(a.at ?? clock()), by: a.byUserId }, occurredAt: a.at }, clock);

/** An investor update for one investor in the resolved segment (M13-S06). `text` is exactly what the console shows. */
export const updatePublished = (a: {
  updateId: string; contactId: string; headline: string; kind: "Produce" | "Statement" | "Compliance" | "Notice"; body: string; byUserId: string; at: number;
}, clock: () => number = Date.now) =>
  newEvent("update.published", { actor: { kind: "user", zoho_user_id: a.byUserId }, ids: { investor_contact_id: a.contactId },
    payload: { update_id: a.updateId, headline: a.headline, kind: a.kind, body: a.body, published_at: istIso(a.at), by: a.byUserId }, occurredAt: a.at }, clock);

/* ---- the outbox ----------------------------------------------------------------------------------- */

const RECORD_ID = /^\d{15,22}$/;
const CODE = /^[a-z][a-z0-9:-]{0,47}$/;
const code = (s: string): string => { const c = s.replace(/:/g, "-"); return CODE.test(c) ? c : "unrecognised"; };

function recordIdsOf(event: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const ids = (event.ids ?? {}) as Record<string, unknown>;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  for (const v of Object.values(ids)) if (typeof v === "string" && RECORD_ID.test(v)) out.add(v);
  for (const [k, v] of Object.entries(payload)) if (/_id$/.test(k) && typeof v === "string" && RECORD_ID.test(v)) out.add(v);
  return [...out].slice(0, 10);
}

interface Item {
  event: Record<string, unknown> | null;
  readonly eventId: string;
  readonly type: string;
  readonly recordIds: readonly string[];
  status: DeliveryStatus;
  attempts: number;
  lastReason: string | null;
  nextAt: number | null;
  deliveredAt: number | null;
}

export function createOutbox(deps: OutboxDeps) {
  const clock = deps.clock ?? Date.now;
  const max = deps.maxAttempts ?? 8;
  const base = deps.baseDelayMs ?? 30_000;
  const cap = deps.maxDelayMs ?? 3_600_000;
  const maxQueue = deps.maxQueue ?? 1_000;
  const items = new Map<string, Item>();
  const failures: number[] = [];
  let lastDeliveredAt: number | null = null;
  let draining: Promise<number> | null = null;

  const view = (i: Item): DeliveryState => Object.freeze({
    eventId: i.eventId, type: i.type, status: i.status, label: DELIVERY_LABEL[i.status], attempts: i.attempts,
    lastReason: i.lastReason, nextAt: i.nextAt, deliveredAt: i.deliveredAt, recordIds: i.recordIds,
  });
  const note = (i: Item): void => {
    try {
      deps.ledger?.append({ at: clock(), eventId: i.eventId, type: i.type, status: i.status, attempts: i.attempts, reason: i.lastReason, recordIds: i.recordIds });
    } catch { /* the ledger never stops a delivery */ }
  };
  const open = (): number => [...items.values()].filter((i) => i.status === "queued" || i.status === "retrying").length;

  function delivered(i: Item, at: number): void {
    i.status = "delivered"; i.deliveredAt = at; i.nextAt = null; i.lastReason = null; i.event = null; // the payload leaves the queue
    lastDeliveredAt = Math.max(lastDeliveredAt ?? 0, at);
    note(i);
  }
  function failed(i: Item, reason: string, final: boolean): void {
    const now = clock();
    failures.push(now);
    while (failures.length && failures[0]! < now - 86_400_000) failures.shift();
    i.lastReason = code(reason);
    if (final || i.attempts >= max) {
      i.status = "dead"; i.nextAt = null;
      note(i);
      try { deps.onFailure?.(i.lastReason); } catch { /* never throws into the job */ }
      return;
    }
    i.status = "retrying";
    i.nextAt = now + Math.min(cap, base * 2 ** (i.attempts - 1));
    note(i);
  }

  async function attempt(i: Item): Promise<void> {
    const t = deps.target();
    if (!t) { i.lastReason = "not-configured"; i.nextAt = clock() + base; return; }
    i.attempts++;
    const event = { ...i.event!, sent_at: istIso(clock()) };
    const r = await pushEvent(event, { url: t.url, key: t.key, schemas: deps.schemas, fetch: deps.fetch, maxAttempts: 1, sleep: async () => {} });
    if (r.delivered) return delivered(i, clock());
    failed(i, r.reason, r.reason.startsWith("refused:") || r.reason.startsWith("invalid:"));
  }

  return Object.freeze({
    enqueue(event: Record<string, unknown>): EnqueueResult {
      const v = validateEvent(deps.schemas, event);
      if (!v.ok) return { ok: false, reason: v.reason, errors: v.errors };
      const pii = identityPaths({ ...event, event_id: undefined, occurred_at: undefined });
      if (pii.length) return { ok: false, reason: "identity-in-event", errors: pii };
      const eventId = event.event_id as string;
      const known = items.get(eventId);
      if (known) return { ok: true, eventId, state: view(known) }; // the same event twice is queued once
      if (open() >= maxQueue) return { ok: false, reason: "queue-full", errors: [] };
      const i: Item = { event: { ...event }, eventId, type: v.type, recordIds: recordIdsOf(event), status: "queued", attempts: 0, lastReason: null, nextAt: clock(), deliveredAt: null };
      items.set(eventId, i);
      note(i);
      return { ok: true, eventId, state: view(i) };
    },
    /** One attempt for every due event, in order. Concurrent calls share one pass. Returns how many were tried. */
    drain(): Promise<number> {
      if (draining) return draining;
      const pass = (async () => {
        await Promise.resolve(); // the pass is registered before it can finish
        let n = 0;
        for (const i of [...items.values()]) {
          if ((i.status !== "queued" && i.status !== "retrying") || i.nextAt === null || i.nextAt > clock()) continue;
          n++;
          try { await attempt(i); } catch { failed(i, "unexpected", false); }
        }
        return n;
      })();
      draining = pass.finally(() => { draining = null; });
      return draining;
    },
    /** From the inbound endpoint: a push.delivered answer for one of ours. */
    acknowledge(messageId: string, status: "delivered" | "bounced" | "deferred" = "delivered"): boolean {
      const i = items.get(messageId);
      if (!i || i.status === "delivered") return false;
      if (status === "delivered") { delivered(i, clock()); return true; }
      if (status === "bounced") { failed(i, "bounced", true); return true; }
      return false;
    },
    /** Put a dead-lettered event back in the queue (an operator's replay). */
    replay(eventId: string): boolean {
      const i = items.get(eventId);
      if (!i || i.status !== "dead" || !i.event) return false;
      i.status = "queued"; i.attempts = 0; i.nextAt = clock(); i.lastReason = null;
      note(i);
      return true;
    },
    state: (eventId: string): DeliveryState | null => { const i = items.get(eventId); return i ? view(i) : null; },
    forRecord: (recordId: string): readonly DeliveryState[] => [...items.values()].filter((i) => i.recordIds.includes(recordId)).map(view),
    deadLetters: (): readonly DeliveryState[] => [...items.values()].filter((i) => i.status === "dead").map(view),
    /** For the System page's "Investor app delivery" check. */
    stats() {
      const now = clock();
      return Object.freeze({ lastDeliveredAt, failures24h: failures.filter((t) => t >= now - 86_400_000).length, open: open(),
        dead: [...items.values()].filter((i) => i.status === "dead").length });
    },
  });
}
export type Outbox = ReturnType<typeof createOutbox>;

/**
 * M13-S05-T03 — delivery states for one record that survive a restart: the live outbox first, then the
 * ledger's last line per event for events this process no longer holds. The payload never outlives the
 * process, so a ledger-only event that was still queued or retrying cannot be delivered any more: it
 * reads as dead ("restarted"), never as delivered. Delivered only ever comes from a push.delivered line.
 */
export function deliveriesForRecord(live: readonly DeliveryState[], ledgerLines: readonly unknown[], recordId: string, type?: string): DeliveryState[] {
  const out = new Map<string, DeliveryState>();
  for (const l of ledgerLines) {
    const x = l as Partial<{ eventId: unknown; type: unknown; status: unknown; attempts: unknown; reason: unknown; recordIds: unknown; at: unknown }> | null;
    if (!x || typeof x.eventId !== "string" || typeof x.type !== "string" || !Array.isArray(x.recordIds) || !x.recordIds.includes(recordId)) continue;
    if (type && x.type !== type) continue;
    const status = x.status === "delivered" ? "delivered" : x.status === "dead" ? "dead" : x.status === "queued" || x.status === "retrying" ? "dead" : null;
    if (!status) continue;
    const reason = x.status === "queued" || x.status === "retrying" ? "restarted" : typeof x.reason === "string" ? x.reason : null;
    out.set(x.eventId, Object.freeze({
      eventId: x.eventId, type: x.type, status, label: DELIVERY_LABEL[status], attempts: typeof x.attempts === "number" ? x.attempts : 0,
      lastReason: status === "delivered" ? null : reason, nextAt: null, deliveredAt: status === "delivered" && typeof x.at === "number" ? x.at : null,
      recordIds: Object.freeze(x.recordIds.filter((v): v is string => typeof v === "string" && RECORD_ID.test(v)).slice(0, 10)),
    }));
  }
  for (const d of live) if (d.recordIds.includes(recordId) && (!type || d.type === type)) out.set(d.eventId, d);
  return [...out.values()];
}
