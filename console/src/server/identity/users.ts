/**
 * M03-S02-T01 — THE ZOHO USERS A GRANT IS BOUNDED BY: one person looked up by id (GET /crm/v8/users/{id})
 * on the signed-in granter's own token (D53), seated from their role/profile ids exactly as the
 * sign-in door seats them (seat.ts `resolveDirectoryUser`, which also names Administrator-profile
 * managers), with their manager from `Reporting_To`. `chainOf` walks up to MAX_CHAIN managers,
 * stopping on a loop. Nothing is cached (a role change applies at once) and nothing but ids and the
 * seat leaves this module; Plane B gets one call line per request, no body.
 *
 * PROVISIONAL: the manager key is read as `Reporting_To` (Zoho CRM v8 users), with `reports_to`
 * accepted too; confirm on the sandbox with a user who has a manager.
 */

import type { UserCredential } from "../../lib/zoho/client";
import type { Gate } from "../../lib/zoho/gate";
import type { OpsLog } from "../../lib/zoho/log";
import type { SeatedPerson } from "../access/grant-rules";
import type { ZohoSeatDirectory } from "../oauth/seat";

export const MAX_CHAIN = 8;
const USER_ID = /^\d{15,25}$/;
const TIMEOUT_MS = 10_000;

export type UsersFetch = (url: string, init: { readonly method: "GET"; readonly headers: Readonly<Record<string, string>>; readonly redirect: "error"; readonly signal?: AbortSignal }) =>
  Promise<{ readonly status: number; text(): Promise<string>; readonly headers: { get(name: string): string | null } }>;

export interface ZohoUserDirectory {
  /** null: not found, not visible to this person, not a seated user, or Zoho could not be asked */
  lookup(as: UserCredential, userId: string): Promise<SeatedPerson | null>;
  /** the person and every manager above them (the person first); null if the person is unknown */
  chainOf(as: UserCredential, userId: string): Promise<readonly SeatedPerson[] | null>;
}

function managerOf(u: Record<string, unknown>): string | null {
  for (const key of ["Reporting_To", "reports_to"]) {
    const m = u[key];
    if (typeof m === "object" && m !== null && typeof (m as { id?: unknown }).id === "string" && USER_ID.test((m as { id: string }).id)) return (m as { id: string }).id;
  }
  return null;
}

export function createZohoUserDirectory(d: {
  readonly seats: ZohoSeatDirectory;
  readonly gate: Gate;
  readonly log: OpsLog;
  readonly fetch?: UsersFetch;
  readonly clock?: () => number;
}): ZohoUserDirectory {
  const clock = d.clock ?? Date.now;
  const get: UsersFetch = d.fetch ?? ((url, init) => fetch(url, init) as never);

  async function lookup(as: UserCredential, userId: string): Promise<SeatedPerson | null> {
    if (typeof userId !== "string" || !USER_ID.test(userId) || !d.seats.resolveDirectoryUser) return null;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    const startedAt = clock();
    let status: number | null = null;
    let errorClass: "network" | "unexpected" | "aborted" | null = null;
    let lease: { release(): void; waitedMs: number } | null = null;
    try {
      lease = await d.gate.acquire("simple", deadline.signal);
      const token = (as as unknown as { accessToken: string }).accessToken;
      const res = await get(`${as.apiDomain}/crm/v8/users/${userId}`, {
        method: "GET", headers: { Accept: "application/json", Authorization: `Zoho-oauthtoken ${token}` }, redirect: "error", signal: deadline.signal,
      });
      status = res.status;
      if (status === 204 || status === 404) { errorClass = "unexpected"; return null; }
      if (status !== 200) { errorClass = "unexpected"; return null; }
      const text = await res.text();
      if (text.length > 262_144) { errorClass = "unexpected"; return null; }
      const body = JSON.parse(text) as { users?: unknown };
      const r = d.seats.resolveDirectoryUser(body);
      if (!r.ok || r.value.userId !== userId) { errorClass = "unexpected"; return null; }
      const u = (body.users as Record<string, unknown>[])[0]!;
      const mgr = managerOf(u);
      return Object.freeze({ who: userId, seat: r.value.seat, mgr: mgr === userId ? null : mgr });
    } catch {
      errorClass ??= deadline.signal.aborted ? "aborted" : "network";
      return null;
    } finally {
      clearTimeout(timer);
      lease?.release();
      try {
        d.log.call({
          at: startedAt, actor: { kind: "user", userId: as.userId }, op: "getUser", method: "GET", endpoint: "/users/{id}",
          callClass: "simple", status, durationMs: Math.max(0, clock() - startedAt), gateWaitMs: lease?.waitedMs ?? 0,
          attempt: 1, creditsRemaining: null, errorClass: errorClass as never, recordIds: [userId],
        });
      } catch {
        /* never let logging take the request down */
      }
    }
  }

  return Object.freeze({
    lookup,
    async chainOf(as: UserCredential, userId: string): Promise<readonly SeatedPerson[] | null> {
      const first = await lookup(as, userId);
      if (!first) return null;
      const out: SeatedPerson[] = [first];
      const seen = new Set([first.who]);
      let next = first.mgr;
      while (next && !seen.has(next) && out.length <= MAX_CHAIN) {
        const m = await lookup(as, next);
        if (!m) return null;       /* an unreadable manager would drop a bound from reachCeil: fail closed */
        out.push(m);
        seen.add(m.who);
        next = m.mgr;
      }
      return Object.freeze(out);
    },
  });
}
