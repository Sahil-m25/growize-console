/**
 * M15-S05-T01 — THE READER OF PLANES B AND C: the day files (or the in-memory ring) filtered by day, plane,
 * kind, person and outcome, with the reveal count and the API headroom worked out from what is read (D47).
 *
 * Who may read (the front end's rules, imported, never re-ported — lib/im/constants ROLE):
 *   an Investors role holding `log` (Digital Infrastructure `di`, Administrator, Super administrator), the
 *   lead-side Digital Infrastructure token `ops` (the super user's other half, D68 — read as `di`), and the
 *   Auditor (`audit`, read only). Everyone else is refused.
 * What they see: every row. A reader whose role lacks `pii` (identity rights) sees a reveal as "Identity
 * event", and no row carries record ids for them ("Investor details withheld") — the row is still counted.
 *
 * Lines on disk are data, not trusted: each is re-read through a narrow shape; anything else is skipped.
 * Nothing here writes. Sign-in history is not here: it lives in Zoho Directory (SIGN_IN_HISTORY).
 */

import { ROLE } from "../../lib/im/constants";
import type { ImRoleKey } from "../../lib/im/types";
import { dayOf } from "./jsonl";
import type { LogSinks } from "./factory";
import type { StorePlane } from "./sink";
import { REVEAL_WHY_LABEL } from "../identity/plane-c";

export type { StorePlane } from "./sink";
export type LogPlane = "b" | "c";
export type LogOutcome = "ok" | "failed" | "refused" | "ended";
export type LogGroup = "api" | "refusal" | "event" | "error" | "identity" | "session" | "access";

export interface LogRow {
  readonly at: number;
  /** Asia/Kolkata, "2026-09-28T11:30:00+05:30". */
  readonly when: string;
  readonly plane: LogPlane;
  /** zoho-call · refusal · event · route-error · client-error · a Plane C action ("reveal", "step-up"…) */
  readonly kind: string;
  readonly group: LogGroup;
  /** A Zoho user id, "service:<job>", or "unrecognised". */
  readonly actorId: string;
  /** The op, action or route; a short code. */
  readonly action: string;
  readonly outcome: LogOutcome;
  readonly reason: string | null;
  readonly endpoint: string | null;
  readonly status: number | null;
  readonly durationMs: number | null;
  readonly creditsRemaining: number | null;
  /** Plane C: the person an event was done to (a grant's holder). */
  readonly whom: string | null;
  readonly seat: string | null;
  readonly recordIds: readonly string[];
  /** Plane C rows only: "Revealed a PAN", "Identity event", "Step-up failed"… */
  readonly label: string | null;
  /** Record ids were removed for this reader. */
  readonly withheld: boolean;
  /** A reveal's chosen reason, a short code from REVEAL_WHY ("tds-filing"…); null otherwise or for a reader without `pii`. */
  readonly why: string | null;
  /** Plane C `test-link-issued`: when the link stops working (at + ttlMinutes); null otherwise. */
  readonly expiresAt: number | null;
}

export interface LogHeadroom {
  readonly calls: number;
  readonly r429: number;
  readonly failed: number;
  readonly lastCreditsRemaining: number | null;
  readonly lowestCreditsRemaining: number | null;
  /** X-API-CREDITS-REMAINING appeared at all: the org is past half its daily allowance (D47). */
  readonly creditsWarning: boolean;
}

export interface LogParams {
  readonly from?: string | null; readonly to?: string | null; readonly plane?: string | null; readonly kind?: string | null;
  readonly actor?: string | null; readonly outcome?: string | null; readonly offset?: string | null; readonly limit?: string | null;
}

/** TC-E11-019: there is no sign-in history screen in the console; this is where it lives. */
export const SIGN_IN_HISTORY = Object.freeze({
  where: "Zoho Directory → Security Control → Login History",
  who: "Digital Infrastructure",
  runbook: "ops/runbooks/sign-in-history.md",
});

export type LogResult =
  | { readonly ok: false; readonly reason: "not-a-log-reader" }
  | {
    readonly ok: true;
    readonly from: string; readonly to: string;
    readonly plane: LogPlane | null; readonly kind: string | null; readonly actor: string | null; readonly outcome: LogOutcome | null;
    /** Filters that were not valid and were ignored, by name. */
    readonly ignored: readonly string[];
    /** The reader sees identity details (holds `pii`). */
    readonly identity: boolean;
    /** Over the range and plane, before the kind/person/outcome filters: the chips' counts. */
    readonly byActor: Readonly<Record<string, number>>;
    readonly byKind: Readonly<Record<string, number>>;
    /** Identity reveals (Plane C `reveal`, outcome ok) in the range, and among the filtered rows. */
    readonly identityReveals: number;
    readonly identityRevealsShown: number;
    readonly total: number; readonly offset: number; readonly limit: number;
    readonly rows: readonly LogRow[];
    /** Plane B Zoho calls in the range (the System page's headroom check reads the same figures). */
    readonly headroom: LogHeadroom;
    readonly signInHistory: typeof SIGN_IN_HISTORY;
  };

export const MAX_RANGE_DAYS = 31;
export const MAX_LIMIT = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const USER_ID = /^\d{15,25}$/;
const RECORD_ID = /^\d{15,22}$/;
const CODE = /^[A-Za-z/][A-Za-z0-9._/{}-]{0,200}$/;
const ACTOR = /^(\d{15,25}|service:[A-Za-z0-9_.-]{1,64}|unrecognised)$/;
const OUTCOMES: ReadonlySet<string> = new Set(["ok", "failed", "refused", "ended"]);
const D = 86_400_000;

/* ---- who may read ------------------------------------------------------------------------------ */

const roleOfSeat = (seat: string): ImRoleKey | null => {
  const k = seat === "ops" ? "di" : seat; // the lead-side DI token is the super user (D68, data/scope.ts)
  return Object.hasOwn(ROLE, k) ? (k as ImRoleKey) : null;
};

/** The reader's rights over Planes B and C, from the front end's role table. */
export function logAccessOf(seat: string): { readonly read: boolean; readonly identity: boolean } {
  const r = typeof seat === "string" ? roleOfSeat(seat) : null;
  if (!r) return { read: false, identity: false };
  const can: readonly string[] = ROLE[r].can;
  return { read: can.includes("log") || r === "audit", identity: can.includes("pii") };
}

/* ---- sources ------------------------------------------------------------------------------------ */

export interface LogSource {
  /** The lines of one store whose UTC day falls in [fromDay, toDay]. */
  read(plane: StorePlane, fromDay: string, toDay: string): Promise<readonly unknown[]>;
}

/** Every UTC day from `fromDay` to `toDay` inclusive (capped at 400). */
export function daysBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(fromDay + "T00:00:00Z"), end = Date.parse(toDay + "T00:00:00Z"); Number.isFinite(t) && t <= end && out.length < 400; t += D) out.push(dayOf(t));
  return out;
}

/** The process's sinks as a source: the durable store (day files or Stratus segments), the in-memory rings otherwise. */
export function logSourceOf(sinks: Pick<LogSinks, "stores" | "ops" | "identity" | "errors">): LogSource {
  return Object.freeze({
    async read(plane: StorePlane, fromDay: string, toDay: string): Promise<readonly unknown[]> {
      const store = sinks.stores?.[plane] ?? null;
      if (store) {
        const out: unknown[] = [];
        for (const d of daysBetween(fromDay, toDay)) out.push(...await store.read(d)); // never lists a year of objects
        return out;
      }
      const ring: readonly unknown[] = plane === "ops" ? sinks.ops.records() : plane === "identity" ? sinks.identity.events() : sinks.errors.records();
      return ring.filter((r) => { const at = (r as { at?: unknown })?.at; return typeof at === "number" && dayOf(at) >= fromDay && dayOf(at) <= toDay; });
    },
  });
}

/* ---- lines → rows ------------------------------------------------------------------------------- */

const istIso = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
const str = (x: unknown): string | null => (typeof x === "string" && CODE.test(x) ? x : null);
const int = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 100_000_000 ? x : null);
const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && RECORD_ID.test(v)) : []);
const actorOf = (a: unknown): string => {
  const x = (typeof a === "object" && a !== null ? a : {}) as { kind?: unknown; userId?: unknown; job?: unknown };
  if (x.kind === "user" && typeof x.userId === "string" && USER_ID.test(x.userId)) return x.userId;
  if (x.kind === "service" && typeof x.job === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(x.job)) return `service:${x.job}`;
  return "unrecognised";
};

type Base = Omit<LogRow, "withheld">;
type Line = Record<string, unknown>;
const lineOf = (l: unknown): Line | null => {
  const r = typeof l === "object" && l !== null && !Array.isArray(l) ? (l as Line) : null;
  return r && typeof r.at === "number" && Number.isFinite(r.at) ? r : null;
};

function fromOps(l: unknown): Base | null {
  const r = lineOf(l);
  if (!r) return null;
  const at = r.at as number;
  const common = { at, when: istIso(at), plane: "b" as const, actorId: actorOf(r.actor), whom: null, seat: null, recordIds: ids(r.recordIds), label: null, why: null, expiresAt: null };
  if (r.kind === "zoho-call") {
    const failed = r.errorClass !== null && r.errorClass !== undefined;
    return { ...common, kind: "zoho-call", group: "api", action: str(r.op) ?? "unrecognised", outcome: failed ? "failed" : "ok",
      reason: str(r.errorClass), endpoint: str(r.endpoint), status: int(r.status), durationMs: int(r.durationMs), creditsRemaining: int(r.creditsRemaining) };
  }
  if (r.kind === "refusal" || r.kind === "event") {
    return { ...common, kind: r.kind, group: r.kind, action: str(r.action) ?? "unrecognised", outcome: r.kind === "event" ? "ok" : "refused",
      reason: str(r.reason), endpoint: null, status: null, durationMs: null, creditsRemaining: null };
  }
  return null;
}

function fromErrors(l: unknown): Base | null {
  const r = lineOf(l);
  if (!r || (r.kind !== "route-error" && r.kind !== "client-error")) return null;
  const at = r.at as number;
  const actorId = typeof r.userId === "string" && USER_ID.test(r.userId) ? r.userId : "unrecognised";
  return { at, when: istIso(at), plane: "b", kind: r.kind, group: "error", actorId, action: str(r.route) ?? "/unrecognised",
    outcome: "failed", reason: str(r.errorClass) ?? str(r.source) ?? str(r.zohoCode), endpoint: str(r.route), status: int(r.status) ?? int(r.zohoStatus),
    durationMs: int(r.durationMs), creditsRemaining: null, whom: null, seat: null, recordIds: [], label: null, why: null, expiresAt: null };
}

const C_GROUP: Readonly<Record<string, LogGroup>> = Object.freeze({
  reveal: "identity", "step-up": "identity", "seat-change": "identity",
  "sign-in": "session", "sign-in-refused": "session", "sign-out": "session", "session-expired": "session", "session-revoked": "session",
  "refused-page": "access", "refused-action": "access", "grant-change": "access",
  "access-granted": "access", "access-ended": "access", "manager-change": "access",
  "app-access-released": "access", "test-link-issued": "access", availability: "access",
  "test-signin-enrolled": "session", "test-signin-used": "session",
});
const C_LABEL: Readonly<Record<string, string>> = Object.freeze({
  "access-granted": "Console access granted", "access-ended": "Console access ended", "manager-change": "Changed who they report to",
  "test-link-issued": "Test sign-in link issued", availability: "Availability changed",
  "test-signin-enrolled": "Enrolled for staging test sign-in", "test-signin-used": "Signed in by the staging test runner",
});
/** A seat change's count (M03-S04-T02): "3 accounts returned to the pool"; null when none moved. */
export const pooledLabel = (n: unknown): string | null =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? `${n} account${n === 1 ? "" : "s"} returned to the pool` : null;
const REVEALED: Readonly<Record<string, string>> = Object.freeze({ pan: "Revealed a PAN", "bank-account": "Revealed a bank reference" });

function fromIdentity(l: unknown, identity: boolean): Base | null {
  const e = lineOf(l);
  if (!e || typeof e.action !== "string" || !Object.hasOwn(C_GROUP, e.action)) return null;
  const at = e.at as number;
  const action = e.action;
  const raw: LogOutcome = typeof e.outcome === "string" && OUTCOMES.has(e.outcome) ? (e.outcome as LogOutcome) : "refused";
  /* a step-up that did not pass is a failure, not a policy refusal (acceptance: outcome 'failed') */
  const outcome: LogOutcome = action === "step-up" && raw === "refused" ? "failed" : raw;
  const reason = str(e.reason);
  const label = action === "reveal"
    ? (!identity ? "Identity event" : outcome === "ok" ? REVEALED[reason ?? ""] ?? "Revealed an identity field" : "Reveal refused")
    : action === "step-up" ? (outcome === "ok" ? "Stepped up" : "Step-up failed")
      : action === "seat-change" ? (outcome === "ok" && pooledLabel(e.count) ? `Seat changed · ${pooledLabel(e.count)}` : "Seat changed")
        : action === "app-access-released" ? (outcome === "ok" ? "App access released" : "App access release refused")
          : C_LABEL[action] ?? null;
  const ttl = action === "test-link-issued" && typeof e.ttlMinutes === "number" && Number.isSafeInteger(e.ttlMinutes) && e.ttlMinutes > 0 && e.ttlMinutes <= 1440 ? e.ttlMinutes : null;
  return { at, when: istIso(at), plane: "c", kind: action, group: C_GROUP[action]!, actorId: typeof e.who === "string" && USER_ID.test(e.who) ? e.who : "unrecognised",
    action, outcome, reason: action === "reveal" && !identity ? null : reason, endpoint: null, status: null, durationMs: null, creditsRemaining: null,
    whom: typeof e.whom === "string" && USER_ID.test(e.whom) ? e.whom : null, seat: str(e.seat), recordIds: ids(e.recordIds), label,
    why: action === "reveal" && identity && typeof e.why === "string" && Object.hasOwn(REVEAL_WHY_LABEL, e.why) ? e.why : null,
    expiresAt: ttl === null ? null : at + ttl * 60_000 };
}

/* ---- the query ---------------------------------------------------------------------------------- */

export async function queryLogs(reader: { readonly seat: string }, p: LogParams, source: LogSource, now: number = Date.now()): Promise<LogResult> {
  const access = logAccessOf(reader.seat);
  if (!access.read) return { ok: false, reason: "not-a-log-reader" };
  const ignored: string[] = [];
  const valid = (d: string | null | undefined): d is string =>
    typeof d === "string" && DAY.test(d) && Number.isFinite(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
  let to = dayOf(now);
  if (p.to) { if (valid(p.to)) to = p.to; else ignored.push("to"); }
  let from = to;
  if (p.from) { if (valid(p.from) && p.from <= to) from = p.from; else ignored.push("from"); }
  if ((Date.parse(to) - Date.parse(from)) / D >= MAX_RANGE_DAYS) { from = dayOf(Date.parse(to) - (MAX_RANGE_DAYS - 1) * D); ignored.push("range"); }

  let plane: LogPlane | null = null;
  if (p.plane) { if (p.plane === "b" || p.plane === "c") plane = p.plane; else ignored.push("plane"); }
  let outcome: LogOutcome | null = null;
  if (p.outcome) { if (OUTCOMES.has(p.outcome)) outcome = p.outcome as LogOutcome; else ignored.push("outcome"); }
  let actor: string | null = null;
  if (p.actor) { if (ACTOR.test(p.actor)) actor = p.actor; else ignored.push("actor"); }
  let kind: string | null = null;
  if (p.kind) { if (/^[a-z][a-z-]{0,31}$/.test(p.kind)) kind = p.kind; else ignored.push("kind"); }
  const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(p.offset ?? "0", 10) || 0));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.parseInt(p.limit ?? "100", 10) || 100));

  const base: Base[] = [];
  if (plane !== "c") {
    for (const l of await source.read("ops", from, to)) { const r = fromOps(l); if (r) base.push(r); }
    for (const l of await source.read("errors", from, to)) { const r = fromErrors(l); if (r) base.push(r); }
  }
  if (plane !== "b") for (const l of await source.read("identity", from, to)) { const r = fromIdentity(l, access.identity); if (r) base.push(r); }
  const inRange = base.filter((r) => { const d = dayOf(r.at); return d >= from && d <= to; }).sort((a, b) => b.at - a.at);

  const rows: LogRow[] = inRange.map((r) => {
    const withheld = !access.identity && r.recordIds.length > 0;
    return Object.freeze({ ...r, recordIds: Object.freeze(withheld ? [] : [...r.recordIds]), withheld });
  });
  const byActor: Record<string, number> = {}, byKind: Record<string, number> = {};
  for (const r of rows) { byActor[r.actorId] = (byActor[r.actorId] ?? 0) + 1; byKind[r.kind] = (byKind[r.kind] ?? 0) + 1; }
  const isReveal = (r: LogRow) => r.kind === "reveal" && r.outcome === "ok";
  const kept = rows.filter((r) => (!kind || r.kind === kind || r.group === kind) && (!actor || r.actorId === actor) && (!outcome || r.outcome === outcome));

  const calls = rows.filter((r) => r.kind === "zoho-call");
  const credits = calls.filter((c) => c.creditsRemaining !== null);
  const headroom: LogHeadroom = Object.freeze({
    calls: calls.length,
    r429: calls.filter((c) => c.status === 429).length,
    failed: calls.filter((c) => c.outcome === "failed").length,
    lastCreditsRemaining: credits[0]?.creditsRemaining ?? null,
    lowestCreditsRemaining: credits.length ? Math.min(...credits.map((c) => c.creditsRemaining!)) : null,
    creditsWarning: credits.length > 0,
  });

  return {
    ok: true, from, to, plane, kind, actor, outcome, ignored: Object.freeze(ignored), identity: access.identity,
    byActor: Object.freeze(byActor), byKind: Object.freeze(byKind),
    identityReveals: rows.filter(isReveal).length, identityRevealsShown: kept.filter(isReveal).length,
    total: kept.length, offset, limit, rows: Object.freeze(kept.slice(offset, offset + limit)), headroom, signInHistory: SIGN_IN_HISTORY,
  };
}

/** Plane B's lines in [fromMs, toMs), for the System page's checks (server/system/checks.ts SystemFacts.ops). */
export async function planeBBetween(source: LogSource, fromMs: number, toMs: number): Promise<readonly unknown[]> {
  return (await source.read("ops", dayOf(fromMs), dayOf(toMs))).filter((l) => {
    const at = (l as { at?: unknown })?.at;
    return typeof at === "number" && at >= fromMs && at < toMs;
  });
}
