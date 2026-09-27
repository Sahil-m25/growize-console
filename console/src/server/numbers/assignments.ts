/**
 * M16-S01 — "Assignments by IR" (D59): per IR, the leads assigned in four non-overlapping periods,
 * how many of them were worked, and the breakdown inside. Ported from the prototype's arPeriods /
 * arLead / arDeadline as one pure function over Zoho rows, so the report is counts only and may sit
 * in the scope-keyed cache (D53: an IR's key is their own, a manager's their subtree).
 *
 * The assignment time is Owner_Assigned_At, falling back to the capture date (the footnote case).
 * A "touch" is a Touch the owner logged after assignment (D76); it is "reached" when it is a reply,
 * or its outcome (the start of its Note, as the follow-up save writes it) is one of AR_REACHED.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { CacheError, CacheFresh, CacheStale, ScopedCache, Scope } from "../../lib/zoho/cache";
import { cacheKey } from "../../lib/zoho/cache";
import type { SeatedZohoUser } from "../oauth/seat";

export const PERIODS = ["tw", "lw", "em", "bm", "all"] as const;
export const METRICS = ["assigned", "worked", "notWorked", "missed", "capFallback", "att", "rch", "qual", "yes", "paid", "lost", "nonx", "ovd", "touches", "fstHours"] as const;
type Period = (typeof PERIODS)[number];
export const AR_REACHED = ["Connected", "Interested", "Call back", "Not now", "Not interested", "Reply received", "Visit completed"];
const TOUCHSLA: Readonly<Record<string, number>> = { WhatsApp: 0, Email: 1, Call: 3 };
const CONSENT_OF: Readonly<Record<string, string>> = { WhatsApp: "Consent_WhatsApp", Email: "Consent_Email", Call: "Consent_Call" };
const IST = 5.5 * 3_600_000;
const DAY = 86_400_000;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

export interface ArLead { readonly id: string; readonly ownerId: string; readonly assignedAt: string | null; readonly createdAt: string;
  readonly lostAt: string | null; readonly stamps: Readonly<Record<string, string | null>>; readonly nextStepAt: string | null;
  readonly lastReplyAt: string | null; readonly consent: Readonly<Record<string, boolean>> }
export interface ArTouch { readonly leadId: string; readonly byId: string; readonly at: string; readonly channel: string | null; readonly isReply: boolean; readonly note: string | null }

/** Start of the IST day of `ms`, as a UTC instant. */
const sod = (ms: number): number => Math.floor((ms + IST) / DAY) * DAY - IST;
export function periodBounds(now: number): { w0: number; w1: number; m0: number; cut: number } {
  const d0 = sod(now);
  const dow = new Date(d0 + IST).getUTCDay();           // 0 Sunday … 6 Saturday, in IST
  const w0 = d0 - ((dow + 6) % 7) * DAY;               // Monday
  const w1 = w0 - 7 * DAY;
  const ist = new Date(now + IST);
  const m0 = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST;
  return { w0, w1, m0, cut: Math.min(m0, w1) };
}
const inPeriod = (p: Period, t: number, b: ReturnType<typeof periodBounds>): boolean =>
  p === "tw" ? t >= b.w0 : p === "lw" ? t >= b.w1 && t < b.w0 : p === "em" ? t >= b.m0 && t < b.w1 : p === "bm" ? t < b.cut : true;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The whole report as a flat record of numbers: `${irId}|${period}|${metric}`, plus `team|…`. */
export function computeAssignments(irIds: readonly string[], leads: readonly ArLead[], touches: readonly ArTouch[], now: number): Record<string, number> {
  const b = periodBounds(now);
  const out: Record<string, number> = {};
  const add = (who: string, p: Period, m: string, v = 1) => { const k = `${who}|${p}|${m}`; out[k] = (out[k] ?? 0) + v; };
  const firsts: Record<string, number[]> = {};
  const byLead = new Map<string, ArTouch[]>();
  for (const t of touches) (byLead.get(t.leadId) ?? byLead.set(t.leadId, []).get(t.leadId)!).push(t);
  for (const l of leads) {
    if (!irIds.includes(l.ownerId)) continue;
    const cap = !l.assignedAt;
    const t0 = Date.parse(l.assignedAt ?? l.createdAt);
    if (!Number.isFinite(t0)) continue;
    // every attempt the owner made after assignment, one per channel per 15 minutes
    const T: { t: number; ch: string | null }[] = [];
    for (const t of (byLead.get(l.id) ?? []).filter((x) => x.byId === l.ownerId && !x.isReply)) {
      const at = Date.parse(t.at);
      if (!Number.isFinite(at) || at < t0 || T.some((x) => x.ch === t.channel && Math.abs(x.t - at) <= 15 * 60_000)) continue;
      T.push({ t: at, ch: t.channel });
    }
    T.sort((x, y) => x.t - y.t);
    const first = T[0]?.t ?? null;
    const slas = Object.entries(TOUCHSLA).filter(([ch]) => l.consent[CONSENT_OF[ch]]).map(([, d]) => d);
    const deadline = slas.length ? sod(t0) + (Math.min(...slas) + 1) * DAY : null;
    const reached = (l.lastReplyAt !== null && Date.parse(l.lastReplyAt) >= t0)
      || (byLead.get(l.id) ?? []).some((t) => Date.parse(t.at) >= t0
        && (t.isReply || AR_REACHED.some((o) => (t.note ?? "").startsWith(o))));
    const worked = T.length > 0;
    const lost = !!l.lostAt;
    const done = (f: string) => !!l.stamps[f] && !lost;
    const active = !lost && !l.stamps.Onboarded_At;
    const flags: Record<string, boolean> = {
      assigned: true, worked, notWorked: !worked, capFallback: cap,
      missed: deadline !== null && (first !== null ? first >= deadline : now >= deadline),
      att: worked && !reached, rch: reached, qual: done("Qualified_At"), yes: done("Said_Yes_At"), paid: done("Reserved_At"), lost,
      nonx: worked && !l.nextStepAt, ovd: active && l.nextStepAt !== null && Date.parse(l.nextStepAt) < now,
    };
    for (const p of PERIODS) {
      if (!inPeriod(p, t0, b)) continue;
      for (const who of [l.ownerId, "team"]) {
        for (const [m, on] of Object.entries(flags)) if (on) add(who, p, m);
        if (worked) add(who, p, "touches", T.length);
        if (first !== null) (firsts[`${who}|${p}`] ??= []).push((first - t0) / 3_600_000);
      }
    }
  }
  for (const [k, xs] of Object.entries(firsts)) { const m = median(xs); if (m !== null) out[`${k}|fstHours`] = Math.round(m * 10) / 10; }
  for (const who of [...irIds, "team"]) for (const p of PERIODS) out[`${who}|${p}|assigned`] ??= 0;
  return out;
}

export interface NumbersAccess {
  readonly actor: SeatedZohoUser;
  readonly seesAssignments: boolean;
  /** The IRs whose rows this seat sees: an IR themselves, a manager their reports, an org-wide seat every IR. */
  readonly irIds: readonly string[];
  readonly scope: Scope;
}
export interface NumbersAccessAuthority {
  recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<NumbersAccess | null>;
}
export type AssignmentsResult =
  | { readonly ok: true; readonly value: { readonly irIds: readonly string[]; readonly cells: Readonly<Record<string, number>>; readonly asOf: number; readonly stale: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected" | string; readonly retryable: boolean };

export interface AssignmentsDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly access: NumbersAccessAuthority;
  readonly cache: Pick<ScopedCache, "readSettled">;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const LEAD_FIELDS = ["id", "Owner", "Owner_Assigned_At", "Created_Time", "Lost_At", "Qualified_At", "Said_Yes_At", "Reserved_At", "Onboarded_At",
  "Next_Step_At", "Last_Reply_At", "Consent_WhatsApp", "Consent_Email", "Consent_Call"];

export function createAssignmentsReport(deps: AssignmentsDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.access?.recheck !== "function" || typeof deps.cache?.readSettled !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The assignments report needs crm.coql, the access authority, the scoped cache, the ops log and the record-id prefix.");
  }
  const { crm, access, cache, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => { const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined; return validId(id) ? id : null; };
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

  const coqlAll = async (cred: UserCredential, base: string): Promise<ZohoRecord[]> => {
    const rows: ZohoRecord[] = [];
    for (let offset = 0; offset < 10_000; offset += 2_000) {
      const r = await crm.coql(cred, `${base} limit ${offset}, 2000`);
      if (!r.ok) throw Object.assign(new Error("zoho"), { kind: r.error.kind });
      if (r.value.invalidRecordIds) throw Object.assign(new Error("zoho"), { kind: "unexpected" });
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return rows;
    }
    throw Object.assign(new Error("zoho"), { kind: "unexpected" });
  };

  const load = async (cred: UserCredential, irIds: readonly string[]): Promise<Record<string, number>> => {
    const leads: ArLead[] = [];
    for (let i = 0; i < irIds.length; i += 100) {
      const owners = irIds.slice(i, i + 100).map((id) => `'${id}'`).join(", ");
      for (const r of await coqlAll(cred, `select ${LEAD_FIELDS.join(", ")} from Leads where Owner in (${owners}) order by id asc`)) {
        const owner = idOf(r.Owner), created = str(r.Created_Time);
        if (!validId(r.id) || !owner || !created) continue;
        leads.push({ id: r.id, ownerId: owner, assignedAt: str(r.Owner_Assigned_At), createdAt: created, lostAt: str(r.Lost_At),
          stamps: { Qualified_At: str(r.Qualified_At), Said_Yes_At: str(r.Said_Yes_At), Reserved_At: str(r.Reserved_At), Onboarded_At: str(r.Onboarded_At) },
          nextStepAt: str(r.Next_Step_At), lastReplyAt: str(r.Last_Reply_At),
          consent: { Consent_WhatsApp: r.Consent_WhatsApp === true, Consent_Email: r.Consent_Email === true, Consent_Call: r.Consent_Call === true } });
      }
    }
    const touches: ArTouch[] = [];
    const ids = leads.map((l) => l.id);
    for (let i = 0; i < ids.length; i += 100) {
      const list = ids.slice(i, i + 100).map((id) => `'${id}'`).join(", ");
      for (const t of await coqlAll(cred, `select id, Lead, Owner, Occurred_At, Channel, Is_Reply, Note from Touches where Lead in (${list}) order by id asc`)) {
        const lead = idOf(t.Lead), by = idOf(t.Owner), at = str(t.Occurred_At);
        if (!lead || !by || !at) continue;
        touches.push({ leadId: lead, byId: by, at, channel: str(t.Channel), isReply: t.Is_Reply === true, note: typeof t.Note === "string" ? t.Note.slice(0, 40) : null });
      }
    }
    return computeAssignments(irIds, leads, touches, clock());
  };

  return Object.freeze({
    async report(principal: { credential: UserCredential; sessionId: string }, signal?: AbortSignal): Promise<AssignmentsResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) {
        return { ok: false, kind: "refused", reasonCode: "invalid-request" };
      }
      let a: NumbersAccess | null;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch {
        return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
      }
      if (!a || a.actor?.userId !== cred.userId) return { ok: false, kind: "refused", reasonCode: "session-changed" };
      if (!a.seesAssignments || !a.irIds.every(validId)) {
        log.refusal({ at: clock(), actor: { kind: "user", userId: cred.userId }, action: "numbers-assignments", reason: "capability-missing", recordIds: [] });
        return { ok: false, kind: "refused", reasonCode: "capability-missing" };
      }
      // An IR's scope is always their own row, whatever else the session layer says.
      const irIds = a.actor.seat === "investor-relations" ? [cred.userId] : [...new Set(a.irIds)].sort();
      const scope: Scope = a.actor.seat === "investor-relations" ? { kind: "user", userId: cred.userId } : a.scope;
      // The scope decides which IRs are in it (D53), so the key needs nothing more.
      const key = cacheKey<Readonly<Record<string, number>>>(scope, "numbers.assignments");
      const got = await cache.readSettled(key, () => load(cred, irIds)) as CacheFresh<Record<string, number>> | CacheStale<Record<string, number>> | CacheError<Record<string, number>>;
      if (got.state === "error") return { ok: false, kind: "source-error", source: "zoho", errorKind: got.reason, retryable: true };
      return { ok: true, value: { irIds, cells: got.value, asOf: got.asOf, stale: got.state !== "fresh" } };
    },
  });
}
