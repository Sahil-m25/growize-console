/**
 * M20-S07 — the signed event contracts between the console and the investor app (D73).
 *
 * - `validateEvent` checks an event against its schema in contracts/ (the subset of JSON Schema those
 *   files use: type, properties, required, additionalProperties:false, const, enum, pattern, minimum,
 *   format uuid/date-time, items, and allOf → _envelope.json). An unknown schema_version dead-letters.
 * - Deliveries are HTTPS POSTs signed with HMAC-SHA256 over the exact body, two keys live during
 *   rotation (contracts/README.md); a signature that does not verify is dropped.
 * - The stub receiver stands in for the investor app until its codebase is in the repo: it verifies,
 *   validates, applies each event_id once, records it, and answers push.delivered.
 * - `pushEvent` is the console's side: sign, send with the event_id as the idempotency key, retry
 *   with backoff, and report delivered only on a push.delivered answer for that event.
 * - `requestToCase` turns a verified request.raised into a Case on the investor's Contact with the
 *   provider-callback service identity (D53: background work, never a screen), once per event_id.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ServiceCredential, ZohoServiceClient } from "../../lib/zoho/client";

export type JsonSchema = Readonly<Record<string, unknown>>;
export const SCHEMA_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const typeOk = (t: unknown, v: unknown): boolean =>
  t === "object" ? typeof v === "object" && v !== null && !Array.isArray(v)
    : t === "array" ? Array.isArray(v)
      : t === "integer" ? Number.isSafeInteger(v)
        : t === "number" ? typeof v === "number" && Number.isFinite(v)
          : t === "string" ? typeof v === "string"
            : t === "boolean" ? typeof v === "boolean"
              : t === "null" ? v === null : true;

/** Returns the paths that fail; empty means valid. `resolve` maps a $ref ("_envelope.json") to its schema. */
export function validateSchema(schema: JsonSchema, value: unknown, resolve: (ref: string) => JsonSchema | undefined, at = "$"): string[] {
  const errs: string[] = [];
  const s = schema as Record<string, unknown>;
  for (const sub of (s.allOf as JsonSchema[] | undefined) ?? []) {
    const ref = (sub as Record<string, unknown>).$ref;
    const target = typeof ref === "string" ? resolve(ref) : sub;
    if (!target) { errs.push(`${at}: unresolved ${String(ref)}`); continue; }
    errs.push(...validateSchema(target, value, resolve, at));
  }
  if (s.type !== undefined && !(Array.isArray(s.type) ? s.type.some((t) => typeOk(t, value)) : typeOk(s.type, value))) return [...errs, `${at}: type`];
  if ("const" in s && value !== s.const) errs.push(`${at}: const`);
  if (Array.isArray(s.enum) && !s.enum.includes(value)) errs.push(`${at}: enum`);
  if (typeof value === "string") {
    if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(value)) errs.push(`${at}: pattern`);
    if (s.format === "uuid" && !UUID.test(value)) errs.push(`${at}: format uuid`);
    if (s.format === "date-time" && (!DATE_TIME.test(value) || Number.isNaN(Date.parse(value)))) errs.push(`${at}: format date-time`);
  }
  if (typeof value === "number" && typeof s.minimum === "number" && value < s.minimum) errs.push(`${at}: minimum`);
  if (Array.isArray(value) && s.items) value.forEach((v, i) => errs.push(...validateSchema(s.items as JsonSchema, v, resolve, `${at}[${i}]`)));
  if (typeOk("object", value)) {
    const o = value as Record<string, unknown>;
    const props = (s.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const r of (s.required as string[] | undefined) ?? []) if (!(r in o)) errs.push(`${at}.${r}: required`);
    for (const [k, v] of Object.entries(o)) {
      if (props[k]) errs.push(...validateSchema(props[k], v, resolve, `${at}.${k}`));
      else if (s.additionalProperties === false && !(s.allOf && allowedByAllOf(s, k, resolve))) errs.push(`${at}.${k}: not allowed`);
    }
  }
  return errs;
}
const allowedByAllOf = (s: Record<string, unknown>, k: string, resolve: (ref: string) => JsonSchema | undefined): boolean =>
  ((s.allOf as JsonSchema[]) ?? []).some((sub) => {
    const ref = (sub as Record<string, unknown>).$ref;
    const t = (typeof ref === "string" ? resolve(ref) : sub) as Record<string, unknown> | undefined;
    return !!t && !!(t.properties as Record<string, unknown> | undefined)?.[k];
  });

/** A contracts registry: `{"_envelope.json": …, "case.replied.json": …}`. */
export function validateEvent(schemas: Readonly<Record<string, JsonSchema>>, event: unknown): { ok: true; type: string } | { ok: false; reason: "unknown-type" | "unknown-version" | "invalid"; errors: string[] } {
  const type = (event as { type?: unknown } | null)?.type;
  const schema = typeof type === "string" ? schemas[`${type}.json`] : undefined;
  if (!schema) return { ok: false, reason: "unknown-type", errors: [] };
  if ((event as { schema_version?: unknown }).schema_version !== SCHEMA_VERSION) return { ok: false, reason: "unknown-version", errors: [] };
  const errors = validateSchema(schema, event, (ref) => schemas[ref]);
  return errors.length ? { ok: false, reason: "invalid", errors } : { ok: true, type: type as string };
}

export const sign = (body: string, key: string): string => createHmac("sha256", key).update(body).digest("hex");
/** True if the signature matches the body under any live key (two during rotation). */
export function verify(body: string, signature: unknown, keys: readonly string[]): boolean {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const got = Buffer.from(signature, "hex");
  return keys.filter((k) => typeof k === "string" && k.length >= 32).some((k) => {
    const want = Buffer.from(sign(body, k), "hex");
    return want.length === got.length && timingSafeEqual(want, got);
  });
}

/** Where a receiver remembers which events it has applied. Plane B/C store, injected (D47). */
export interface SeenEvents { has(eventId: string): Promise<boolean>; add(eventId: string): Promise<void> }

export type ReceiveResult =
  | { readonly status: 200; readonly applied: boolean; readonly ack: Record<string, unknown> | null }
  | { readonly status: 400 | 401; readonly reason: string };

export function createStubReceiver(deps: {
  readonly schemas: Readonly<Record<string, JsonSchema>>; readonly keys: readonly string[]; readonly seen: SeenEvents;
  readonly accepts: readonly string[]; readonly record: (event: Record<string, unknown>) => Promise<void>;
  readonly newId: () => string; readonly clock?: () => number;
}) {
  const clock = deps.clock ?? Date.now;
  return Object.freeze({
    async receive(rawBody: string, signature: unknown): Promise<ReceiveResult> {
      if (!verify(rawBody, signature, deps.keys)) return { status: 401, reason: "signature" };
      let event: Record<string, unknown>;
      try { event = JSON.parse(rawBody); } catch { return { status: 400, reason: "json" }; }
      const v = validateEvent(deps.schemas, event);
      if (!v.ok) return { status: 400, reason: v.reason };
      if (!deps.accepts.includes(v.type)) return { status: 400, reason: "not-accepted" };
      const id = event.event_id as string;
      if (await deps.seen.has(id)) return { status: 200, applied: false, ack: null };
      await deps.record(event);
      await deps.seen.add(id);
      const ack = {
        event_id: deps.newId(), type: "push.delivered", schema_version: SCHEMA_VERSION,
        occurred_at: `${new Date(clock() + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`,
        actor: { kind: "external", source: "fcm" }, ids: { ...(event.ids as Record<string, unknown>) },
        payload: { message_id: id, at: `${new Date(clock() + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`, status: "delivered" },
      };
      return { status: 200, applied: true, ack };
    },
  });
}

export type PushResult = { readonly delivered: true; readonly attempts: number } | { readonly delivered: false; readonly attempts: number; readonly reason: string };

/** Sends one event, signed, with its event_id as the idempotency key; retries 5xx/network with backoff. */
export async function pushEvent(event: Record<string, unknown>, opts: {
  readonly url: string; readonly key: string; readonly schemas: Readonly<Record<string, JsonSchema>>;
  readonly fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;
  readonly sleep?: (ms: number) => Promise<void>; readonly maxAttempts?: number;
}): Promise<PushResult> {
  const v = validateEvent(opts.schemas, event);
  if (!v.ok) return { delivered: false, attempts: 0, reason: `invalid:${v.reason}` };
  const body = JSON.stringify(event);
  const headers = { "Content-Type": "application/json", "X-Signature": sign(body, opts.key), "Idempotency-Key": event.event_id as string };
  const max = opts.maxAttempts ?? 5, sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; attempt <= max; attempt++) {
    let status = 0, text = "";
    try { const r = await opts.fetch(opts.url, { method: "POST", headers, body }); status = r.status; text = await r.text(); } catch { status = 0; }
    if (status === 200) {
      try {
        const ack = JSON.parse(text)?.ack;
        if (ack === null) return { delivered: true, attempts: attempt };        // already applied earlier
        if (ack?.type === "push.delivered" && ack?.payload?.message_id === event.event_id && validateEvent(opts.schemas, ack).ok) return { delivered: true, attempts: attempt };
      } catch { /* fall through */ }
      return { delivered: false, attempts: attempt, reason: "no-ack" };
    }
    if (status >= 400 && status < 500) return { delivered: false, attempts: attempt, reason: `refused:${status}` };
    if (attempt < max) await sleep(Math.min(30_000, 500 * 2 ** (attempt - 1)));
  }
  return { delivered: false, attempts: max, reason: "unreachable" };
}

/** request.raised → a Case on the investor's Contact, with the provider-callback service identity. */
export async function requestToCase(event: Record<string, unknown>, deps: {
  readonly crm: Pick<ZohoServiceClient, "insert">; readonly credential: ServiceCredential; readonly seen: SeenEvents; readonly contactIdPrefix: string;
}): Promise<{ ok: true; caseId: string | null } | { ok: false; reason: string }> {
  if (deps.credential?.kind !== "service" || deps.credential.job !== "provider-callback") return { ok: false, reason: "wrong-identity" };
  if (event.type !== "request.raised") return { ok: false, reason: "not-a-request" };
  const id = event.event_id as string;
  if (await deps.seen.has(id)) return { ok: true, caseId: null };
  const contact = (event.ids as Record<string, unknown> | undefined)?.investor_contact_id;
  const p = event.payload as { kind: string; app_request_id: string };
  if (typeof contact !== "string" || !/^\d{15,22}$/.test(contact) || !contact.startsWith(deps.contactIdPrefix)) return { ok: false, reason: "no-contact" };
  const r = await deps.crm.insert(deps.credential, "Cases", [{
    Subject: `App request: ${p.kind.replace(/_/g, " ")}`.slice(0, 120),
    // The org's Cases name the investor Related_To and the origin Case_Origin (getFields, 28 Sep 2026);
    // Contact_Name / Origin do not exist there. Web is the app until an "App" origin value exists (M13-S02 GAP).
    Related_To: { id: contact }, Case_Origin: "Web", Status: "New",
    Description: `From the investor app, request ${p.app_request_id} (event ${id}).`,
  }]);
  const o = r.ok && r.value.length === 1 ? r.value[0] : null;
  if (!o || !o.ok || !o.id) return { ok: false, reason: r.ok ? "case-refused" : r.error.kind };
  await deps.seen.add(id);
  return { ok: true, caseId: o.id };
}
