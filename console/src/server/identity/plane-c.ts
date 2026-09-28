/**
 * PLANE C — THE IDENTITY AND AUTHORITY LOG (D47): sign-ins, sign-outs and refusals at the door.
 *
 * M01-S02 writes the sign-in events; M01-S04 supplies the durable append-only sink
 * (`server/logs/factory.ts`: daily JSONL under LOG_DIR, or the in-memory ring in tests and fixtures). A line carries who (a Zoho user id, never an
 * email or a name), what, when, the outcome and a short reason code. Like Plane B the writer does not
 * trust the type: every field is rebuilt from an allow-list, so a caller who spreads a token
 * response or a CurrentUser body into an event keeps nothing but the allowed fields. A sink that
 * throws never takes a sign-in down with it.
 */

import { looksLikeIdentity } from "../../lib/zoho/log";

export type PlaneCAction = "sign-in" | "sign-in-refused" | "sign-out" | "session-expired" | "session-revoked"
  /* M01-S03-T05: the Investors side's authority events — an identity reveal, a step-up, a seat change */
  | "reveal" | "step-up" | "seat-change"
  /* M01-S04-T01: access-policy refusals and grant changes (see identity/authority.ts) */
  | "refused-page" | "refused-action" | "grant-change";
export type PlaneCOutcome = "ok" | "refused" | "ended";

export interface PlaneCEvent {
  readonly at: number;
  /** A Zoho user id of this org, or "unrecognised" when Zoho did not vouch for one. */
  readonly who: string;
  readonly action: PlaneCAction;
  readonly outcome: PlaneCOutcome;
  /** A short code: "no-seat", "no-grant", "chose", "expired", "revoked"… */
  readonly reason: string;
  /** The console seat token, when one was resolved. */
  readonly seat: string | null;
  /** M01-S03-T05: the Zoho record ids the event concerns (a reveal's Contact); ids only, never values. */
  readonly recordIds?: readonly string[];
  /** M01-S04-T01: the person the event was done to (a grant's holder), a Zoho user id; never a name. */
  readonly whom?: string;
}

export interface PlaneCSink {
  write(event: PlaneCEvent): void;
}

export interface PlaneCLog {
  record(event: PlaneCEvent): void;
}

const ACTIONS: ReadonlySet<string> = new Set(["sign-in", "sign-in-refused", "sign-out", "session-expired", "session-revoked", "reveal", "step-up", "seat-change",
  "refused-page", "refused-action", "grant-change"]);
const RECORD_ID = /^\d{15,22}$/;
const OUTCOMES: ReadonlySet<string> = new Set(["ok", "refused", "ended"]);
const USER_ID = /^\d{15,25}$/;
const CODE = /^[a-z][a-z0-9-]{0,47}$/;

function clean(e: PlaneCEvent): PlaneCEvent {
  const x = (typeof e === "object" && e !== null ? e : {}) as Partial<Record<keyof PlaneCEvent, unknown>>;
  return Object.freeze({
    at: typeof x.at === "number" && Number.isFinite(x.at) ? x.at : 0,
    who: typeof x.who === "string" && USER_ID.test(x.who) ? x.who : "unrecognised",
    action: (typeof x.action === "string" && ACTIONS.has(x.action) ? x.action : "sign-in-refused") as PlaneCAction,
    outcome: (typeof x.outcome === "string" && OUTCOMES.has(x.outcome) ? x.outcome : "refused") as PlaneCOutcome,
    reason: typeof x.reason === "string" && CODE.test(x.reason) && !looksLikeIdentity(x.reason) ? x.reason : "unrecognised",
    seat: typeof x.seat === "string" && CODE.test(x.seat) && !looksLikeIdentity(x.seat) ? x.seat : null,
    ...(x.whom !== undefined ? { whom: typeof x.whom === "string" && USER_ID.test(x.whom) ? x.whom : "unrecognised" } : {}),
    ...(Array.isArray(x.recordIds)
      ? { recordIds: Object.freeze([...new Set((x.recordIds as unknown[]).filter((v): v is string => typeof v === "string" && RECORD_ID.test(v)))].slice(0, 50)) }
      : {}),
  });
}

export function createPlaneCLog(sink: PlaneCSink, onSinkError?: (error: unknown) => void): PlaneCLog {
  return Object.freeze({
    record(event: PlaneCEvent): void {
      try {
        sink.write(clean(event));
      } catch (error) {
        try {
          onSinkError?.(error);
        } catch {
          /* never let logging take the request down */
        }
      }
    },
  });
}

export interface PlaneCMemorySink extends PlaneCSink {
  readonly events: () => readonly PlaneCEvent[];
}

export function createPlaneCMemorySink(capacity = 5_000): PlaneCMemorySink {
  const buf: PlaneCEvent[] = [];
  return Object.freeze({
    write(event: PlaneCEvent): void {
      buf.push(event);
      if (buf.length > capacity) buf.splice(0, buf.length - capacity);
    },
    events: () => buf.slice(),
  });
}
