/**
 * Writing availability (D49): "out from, back on" filed as one Plane C `availability` line; "mark back in" / "cancel" as
 * an `ended` line. The roster (./roster.ts) reads them back. Who may: the person themself, or — for someone else — a
 * seat that reads the org's leads (an IR Manager or Digital Infrastructure; PROVISIONAL, the same reach cover.ts uses
 * until a subtree reader exists). The reason is private and is never taken or filed. Checks mirror the absence drawer:
 * a start from today, a later return date, at most 60 days long, at most 30 days ahead.
 */

import type { PlaneCLog } from "../identity/plane-c";
import { addDays, isoDay, istToday, MAX_ABSENCE_DAYS, MAX_AHEAD_DAYS, type RosterService } from "./roster";

const USER_ID = /^\d{15,25}$/;

export interface AvailabilityActor {
  readonly userId: string;
  readonly seat: string | null;
  /** Reads the whole org's leads (manager or Digital Infrastructure): may change someone else's availability. */
  readonly mayChangeOthers: boolean;
}
export type AvailabilityRefusal = "invalid-request" | "not-yours-to-change" | "bad-dates";
export type AvailabilityResult =
  | { readonly ok: true; readonly value: { readonly personId: string; readonly from: string | null; readonly to: string | null } }
  | { readonly ok: false; readonly reasonCode: AvailabilityRefusal; readonly reason: string };

const REASON: Readonly<Record<AvailabilityRefusal, string>> = Object.freeze({
  "invalid-request": "the request is invalid",
  "not-yours-to-change": "you can change your own availability, or a team member's if you manage them",
  "bad-dates": `choose a start date from today and a later return date, at most ${MAX_AHEAD_DAYS} days ahead and ${MAX_ABSENCE_DAYS} days long`,
});

export function createAvailability(deps: { readonly planeC: PlaneCLog; readonly roster: Pick<RosterService, "forget">; readonly clock?: () => number }) {
  const clock = deps.clock ?? Date.now;
  const no = (reasonCode: AvailabilityRefusal, me: string, whom: string | undefined, seat: string | null): AvailabilityResult => {
    deps.planeC.record({ at: clock(), who: me, ...(whom ? { whom } : {}), action: "refused-action", outcome: "refused", reason: "availability", seat });
    return { ok: false, reasonCode, reason: REASON[reasonCode] };
  };
  const who = (a: AvailabilityActor, person: unknown): string | null => {
    if (!a || !USER_ID.test(a.userId)) return null;
    return person === undefined || person === null ? a.userId : typeof person === "string" && USER_ID.test(person) ? person : null;
  };
  const file = (a: AvailabilityActor, personId: string, outcome: "ok" | "ended", from?: string, to?: string) => {
    deps.planeC.record({ at: clock(), who: a.userId, ...(personId !== a.userId ? { whom: personId } : {}), action: "availability", outcome,
      reason: outcome === "ok" ? "out" : "back", seat: a.seat, ...(from && to ? { from, to } : {}) });
    deps.roster.forget();
  };
  return Object.freeze({
    /** Out from `from`, back on `to` (the first day back). `person` omitted = the actor. */
    set(a: AvailabilityActor, req: { person?: unknown; from?: unknown; to?: unknown }): AvailabilityResult {
      const p = who(a, req?.person);
      if (!p) return no("invalid-request", a?.userId ?? "unrecognised", undefined, a?.seat ?? null);
      if (p !== a.userId && !a.mayChangeOthers) return no("not-yours-to-change", a.userId, p, a.seat);
      const today = istToday(clock());
      const from = isoDay(req?.from), to = isoDay(req?.to);
      if (!from || !to || from < today || to <= from || from > addDays(today, MAX_AHEAD_DAYS) || to > addDays(from, MAX_ABSENCE_DAYS)) return no("bad-dates", a.userId, p !== a.userId ? p : undefined, a.seat);
      file(a, p, "ok", from, to);
      return { ok: true, value: { personId: p, from, to } };
    },
    /** Mark back in now, or cancel a planned absence. */
    clear(a: AvailabilityActor, req: { person?: unknown }): AvailabilityResult {
      const p = who(a, req?.person);
      if (!p) return no("invalid-request", a?.userId ?? "unrecognised", undefined, a?.seat ?? null);
      if (p !== a.userId && !a.mayChangeOthers) return no("not-yours-to-change", a.userId, p, a.seat);
      file(a, p, "ended");
      return { ok: true, value: { personId: p, from: null, to: null } };
    },
  });
}
