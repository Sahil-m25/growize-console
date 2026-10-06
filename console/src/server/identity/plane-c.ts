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
  | "refused-page" | "refused-action" | "grant-change"
  /* M03-S04-T01: a person crossing the sign-in line — first page granted / last page taken (D40/D60) */
  | "access-granted" | "access-ended"
  /* M17-S02-T01: who someone reports to changed (their manager is their ceiling, D60) */
  | "manager-change"
  /* M08-S08-NOTE-10: "Send welcome and unlock" — app access released (or the release refused); recordIds = [Contact] */
  | "app-access-released"
  /* M15-S05-NOTE-1 / M10-S23: a one-time test sign-in link issued for a Contact; ttlMinutes = how long it lives */
  | "test-link-issued"
  /* D49 / M08-S05-NOTE-4: out of office / back on. who = the person who recorded it, whom = the person it is about (omitted when
     the same); from and to are IST days (YYYY-MM-DD), `to` the first day back. outcome ok = set, ended = cleared (back early / cancelled). */
  | "availability"
  /* D124 staging test sign-in (sandbox only): a test user's token enrolled by their own normal sign-in / a session minted from it */
  | "test-signin-enrolled" | "test-signin-used";
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
  /** M03-S04-T02: how many records the event moved (a seat change's accounts returned to the pool). */
  readonly count?: number;
  /** M15-S05-NOTE-1: a reveal's chosen reason, a code from REVEAL_WHY — never free text, never identity. */
  readonly why?: RevealWhy;
  /** M10-S23: a test link's lifetime in minutes (expiry = at + ttlMinutes). Minutes, not an epoch: the sink's guard nulls
   *  any 9+ digit integer outside `at`, so an expiry timestamp would never survive it. */
  readonly ttlMinutes?: number;
  /** D49 availability: the first day out and the first day back, as YYYY-MM-DD; never a reason (it is private). */
  readonly from?: string;
  readonly to?: string;
}

/**
 * M15-S05-NOTE-1 — the reasons a person may give for a reveal, as the short codes Plane C stores. The labels are
 * the prototype's chips (lib/im/constants REVWHY); `unstated` marks a reveal whose screen asks no reason yet.
 */
export const REVEAL_WHY_LABEL = Object.freeze({
  "tds-filing": "A filing or a TDS check",
  "identity-check": "An identity check against a document",
  "own-record-query": "An investor query about their own record",
  "payout-refund": "A payout or a refund",
  "cheque-name-match": "A name match against a cancelled cheque",
  unstated: "No reason was asked",
} as const);
export type RevealWhy = keyof typeof REVEAL_WHY_LABEL;

/** A reason code, or the exact chip label, as its code; anything else is null (the caller files "unstated"). */
export function revealWhyOf(x: unknown): RevealWhy | null {
  if (typeof x !== "string") return null;
  if (Object.hasOwn(REVEAL_WHY_LABEL, x)) return x as RevealWhy;
  const hit = (Object.entries(REVEAL_WHY_LABEL) as [RevealWhy, string][]).find(([, label]) => label === x);
  return hit ? hit[0] : null;
}

export interface PlaneCSink {
  write(event: PlaneCEvent): void;
}

export interface PlaneCLog {
  record(event: PlaneCEvent): void;
}

const ACTIONS: ReadonlySet<string> = new Set(["sign-in", "sign-in-refused", "sign-out", "session-expired", "session-revoked", "reveal", "step-up", "seat-change",
  "refused-page", "refused-action", "grant-change", "access-granted", "access-ended", "manager-change",
  "app-access-released", "test-link-issued", "availability", "test-signin-enrolled", "test-signin-used"]);
const RECORD_ID = /^\d{15,22}$/;
const OUTCOMES: ReadonlySet<string> = new Set(["ok", "refused", "ended"]);
const USER_ID = /^\d{15,25}$/;
const CODE = /^[a-z][a-z0-9-]{0,47}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
    ...(x.from !== undefined ? { from: typeof x.from === "string" && DAY.test(x.from) ? x.from : "0000-00-00" } : {}),
    ...(x.to !== undefined ? { to: typeof x.to === "string" && DAY.test(x.to) ? x.to : "0000-00-00" } : {}),
    ...(x.why !== undefined ? { why: revealWhyOf(x.why) ?? "unstated" } : {}),
    ...(x.ttlMinutes !== undefined ? { ttlMinutes: typeof x.ttlMinutes === "number" && Number.isSafeInteger(x.ttlMinutes) && x.ttlMinutes > 0 && x.ttlMinutes <= 1440 ? x.ttlMinutes : 0 } : {}),
    ...(x.count !== undefined ? { count: typeof x.count === "number" && Number.isSafeInteger(x.count) && x.count >= 0 ? x.count : 0 } : {}),
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
