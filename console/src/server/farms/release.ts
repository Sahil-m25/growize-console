/**
 * M11-S04-T01 — RELEASE A FARM LLP'S UNITS, OR TAKE THEM BACK (D15, D48, D68).
 *
 * Release puts the LLP's units on the shelf: Units_Released = Total_Units. Take it back takes them off:
 * Units_Released = 0 — refused while any unit on the LLP is held (Reserved or Issued allotments, counted fresh
 * by ./occupancy heldOn), with an in-page refusal that names the units held (the prototype's holdBlockGate:
 * "Block A has 29 units held by investors and cannot be taken back."). Only Units_Released is written; LLP_Status
 * is left as it is (OD7 — PROVISIONAL, jev decide a 0.56).
 *
 * Who: the Investors-side "farm" capability through the one policy (../access/policy seatAccess) — the Head of
 * Finance. Finance Operations, Compliance, KAMs and IRs are refused ("read-only"). The super user's role holds
 * "farm" too, but its Zoho seat is an Administrator profile the policy admits to no console page, so the policy
 * refuses it here as everywhere (the front end's "super user" note is the front end's).
 *
 * Guarded writes (D44): the screen sends the LLP's version (Modified_Time as it loaded it, FarmRow.version); a
 * different version now is a conflict before anything is written, and the write itself carries If-Unmodified-Since
 * so a change between our read and our write is Zoho's 412. The lock that holds whichever door is used is the
 * Deluge guard zoho/deluge/take_back_guard.dg on Units_Released; its refusal is named through lib/zoho/client
 * guardRefusalOf as "units-held". Every read and write is on the person's own token (D53). Logs: ids and codes.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { guardRefusalOf } from "../../lib/zoho/client";
import { seatAccess } from "../access/policy";
import type { InvestorEvents } from "../data/events";
import { zohoSeatOf } from "../data/live";
import { RECORD_ID } from "../cases/predicate";
import { heldOn } from "./occupancy";
import { readGuardedLlp, type GuardedLlp } from "./oversell";
import { LLP_MODULE } from "./shelf";

export interface ReleasePrincipal { readonly credential: UserCredential; readonly seat: string }
export interface ReleaseDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate" | "update">;
  readonly events: Pick<InvestorEvents, "refusal" | "conflict">;
}

export type ReleaseRefusalReason = "read-only" | "invalid-request" | "not-found" | "no-total" | "already-released" | "not-released" | "units-held";
export type ReleaseResult =
  | { readonly ok: true; readonly llpId: string; readonly label: string; readonly released: number; readonly version: string | null }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: ReleaseRefusalReason; readonly message: string; readonly held?: number }
  | { readonly ok: false; readonly kind: "conflict"; readonly recordId: string | null; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

/** May this session's seat release land or take it back? The "farm" capability, through the one policy. */
export function mayReleaseLand(seatToken: string, userId: string): boolean {
  const seat = typeof seatToken === "string" ? zohoSeatOf(seatToken) : null;
  if (!seat) return false;
  const a = seatAccess(seat, userId, {});
  return a.admission.ok && a.imCan("farm");
}

const plural = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;
export const heldMessage = (label: string, held: number): string =>
  `${label} has ${plural(held)} held by investors and cannot be taken back. Land cannot come off the shelf while somebody is standing on it.`;
const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";
const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/;

export function createFarmRelease(deps: ReleaseDeps) {
  type Step = { ok: true; cred: UserCredential; llp: GuardedLlp } | Extract<ReleaseResult, { ok: false }>;

  const refused = (userId: string, action: string, reason: ReleaseRefusalReason, message: string, ids: string[], held?: number): Extract<ReleaseResult, { ok: false }> => {
    deps.events.refusal(userId, action, reason, ids);
    return held === undefined ? { ok: false, kind: "refused", reason, message } : { ok: false, kind: "refused", reason, message, held };
  };

  /** Seat, id, the LLP now, and the screen's version against it. */
  async function open(p: ReleasePrincipal, action: string, llpId: string, version: string | null | undefined, signal?: AbortSignal): Promise<Step> {
    const me = p.credential.userId;
    if (!mayReleaseLand(p.seat, me)) return refused(me, action, "read-only", "Releasing land or taking it back is the Head of Finance's.", []);
    if (typeof llpId !== "string" || !RECORD_ID.test(llpId)) return refused(me, action, "invalid-request", "That is not an LLP.", []);
    if (version !== undefined && version !== null && (typeof version !== "string" || !VERSION.test(version))) {
      return refused(me, action, "invalid-request", "Reload the farm and try again.", [llpId]);
    }
    const read = await readGuardedLlp(deps.crm, p.credential, llpId, signal);
    if (!read.ok) return read.kind === "refused" ? refused(me, action, "not-found", "That LLP is not in Zoho, or not yours to open.", [llpId]) : read;
    if (version && read.llp.version && version !== read.llp.version) {
      deps.events.conflict(me, action, llpId);
      return { ok: false, kind: "conflict", recordId: llpId, reason: `${read.llp.label} changed since you loaded it. Reload it and try again.` };
    }
    return { ok: true, cred: p.credential, llp: read.llp };
  }

  async function write(p: ReleasePrincipal, action: string, llp: GuardedLlp, released: number, signal?: AbortSignal): Promise<ReleaseResult> {
    const me = p.credential.userId;
    const r = await deps.crm.update(p.credential, LLP_MODULE, llp.id, { Units_Released: released }, { ifUnmodifiedSince: llp.version, signal });
    if (r.ok) return { ok: true, llpId: llp.id, label: llp.label, released, version: r.value.modifiedTime };
    if (r.error.kind === "conflict") {
      deps.events.conflict(me, action, llp.id);
      return { ok: false, kind: "conflict", recordId: llp.id, reason: `${llp.label} changed since you loaded it. Reload it and try again.` };
    }
    const g = guardRefusalOf(LLP_MODULE, r.error);
    if (g && g.name === "units-held") {
      // The Deluge guard refused: count again to name the units (this token may see fewer than Zoho did).
      const again = await heldOn(deps.crm, p.credential, llp.id, { signal });
      const held = again.ok && again.held > 0 ? again.held : undefined;
      return refused(me, action, "units-held",
        held ? heldMessage(llp.label, held) : `${llp.label} has units held by investors and cannot be taken back — Zoho refused.`, [llp.id], held);
    }
    return { ok: false, kind: "source-error", errorKind: r.error.kind, retryable: retryable(r.error.kind) };
  }

  return Object.freeze({
    /** Put every unit of the LLP on the shelf (Units_Released = Total_Units). */
    async release(p: ReleasePrincipal, llpId: string, version?: string | null, signal?: AbortSignal): Promise<ReleaseResult> {
      const s = await open(p, "farm-release", llpId, version, signal);
      if (!s.ok) return s;
      const { llp } = s, me = p.credential.userId;
      if (llp.totalUnits === null || llp.totalUnits <= 0) return refused(me, "farm-release", "no-total", `${llp.label} has no total units in Zoho, so there is nothing to release.`, [llp.id]);
      if (llp.released >= llp.totalUnits) return refused(me, "farm-release", "already-released", `${llp.label} is already released — ${plural(llp.released)}.`, [llp.id]);
      return write(p, "farm-release", llp, llp.totalUnits, signal);
    },

    /** Take the LLP's units off the shelf (Units_Released = 0) — refused while any unit is held. */
    async takeBack(p: ReleasePrincipal, llpId: string, version?: string | null, signal?: AbortSignal): Promise<ReleaseResult> {
      const s = await open(p, "farm-take-back", llpId, version, signal);
      if (!s.ok) return s;
      const { llp } = s, me = p.credential.userId;
      if (llp.released === 0) return refused(me, "farm-take-back", "not-released", `${llp.label} is not released, so there is nothing to take back.`, [llp.id]);
      const held = await heldOn(deps.crm, p.credential, llp.id, { signal });
      if (!held.ok) return held;
      if (held.held > 0) return refused(me, "farm-take-back", "units-held", heldMessage(llp.label, held.held), [llp.id], held.held);
      return write(p, "farm-take-back", llp, 0, signal);
    },
  });
}
export type FarmRelease = ReturnType<typeof createFarmRelease>;
