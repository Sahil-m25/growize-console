/**
 * M11-S07-T01 — NO UNIT IS SOLD TWICE: the oversell guard (D21, D54).
 *
 * Two locks, one rule. The rule: an allotment (LLP_UnitAllocation_Module) may hold at most the LLP's free units —
 *     free = Units_Released − Σ units of the OTHER live allotments on the LLP (Reserved counts Reserved_Units,
 *            Issued counts Issued_Units, Cancelled nothing — ./occupancy heldOn, read fresh, never the cache).
 * 1. The lock that holds whichever door is used is in Zoho: zoho/deluge/oversell_guard.dg, a validation-rule
 *    function on the allotment's unit fields (Sahil attaches it, M11-S07-T02). A refusal comes back through
 *    lib/zoho/client guardRefusalOf as "oversell".
 * 2. This pre-check, run by every console writer before it creates or grows an allotment, so the person gets the
 *    reason on the page before anything is sent, and no reserved allotment is created (TC-IM06-012).
 * Units_Reserved / Units_Issued / Units_Available are plain integers in the org (getFields, 28 Sep 2026): never read
 * as the count. Reads are on the person's own token (D53); a token that sees fewer allotments than the org may pass
 * the pre-check and still be refused by Zoho — `explain()` names that refusal the same way.
 * Logs: ids and reason codes only (D47).
 */

import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailure } from "../../lib/zoho/errors";
import { guardRefusalOf } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { MODULES } from "../data/projections";
import { num, pagedSelect, RECORD_ID, str } from "../cases/predicate";
import { heldOn } from "./occupancy";
import { LLP_MODULE } from "./shelf";

export const ALLOTMENT_MODULE = MODULES.allotments;
/** What a guard needs of an LLP: its name, block, units, released figure and version. */
export const LLP_GUARD_FIELDS = Object.freeze(["id", "Name", "Block_Code", "Total_Units", "Units_Released", "Modified_Time"]);

export interface GuardedLlp {
  readonly id: string;
  /** "Block B" where the LLP has a block code, else its name (production's "EKA LLP"). */
  readonly label: string;
  readonly totalUnits: number | null;
  readonly released: number;
  readonly version: string | null;
}
export type GuardSourceError = { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };
export type GuardRead = { readonly ok: true; readonly llp: GuardedLlp } | { readonly ok: false; readonly kind: "refused"; readonly reason: "not-found" } | GuardSourceError;

export const llpLabel = (r: ZohoRecord): string => {
  const block = str(r, "Block_Code", 20);
  return block ? `Block ${block}` : str(r, "Name", 120) ?? "This LLP";
};

/** One LLP as a guard reads it, on the person's own token. */
export async function readGuardedLlp(crm: Pick<ZohoClient, "coql">, cred: UserCredential, llpId: string, signal?: AbortSignal): Promise<GuardRead> {
  const r = await pagedSelect(crm, cred, LLP_GUARD_FIELDS, LLP_MODULE, `id = '${llpId}'`, "id asc", signal, 1);
  if (!r.ok) return r.kind === "refused" ? { ok: false, kind: "refused", reason: "not-found" } : r;
  const rec = r.rows.find((x) => x.id === llpId);
  if (!rec) return { ok: false, kind: "refused", reason: "not-found" };
  return {
    ok: true,
    llp: Object.freeze({
      id: llpId, label: llpLabel(rec), totalUnits: num(rec, "Total_Units"),
      released: Math.max(0, num(rec, "Units_Released") ?? 0), version: str(rec, "Modified_Time", 40),
    }),
  };
}

export interface OversellAsk {
  readonly llpId: string;
  /** The units the allotment would hold after the write (Reserved_Units for a reservation, Issued_Units when issued). */
  readonly units: number;
  /** The allotment being edited, left out of the count; null/absent for a new one. */
  readonly exceptAllotmentId?: string | null;
  /** For the message only ("for Kiran Rao's 2 units"); never logged. */
  readonly investorName?: string | null;
}
export type OversellRefusalReason = "no-free-units" | "not-released" | "not-found" | "invalid-request";
export interface OversellRefusal {
  readonly ok: false;
  readonly kind: "refused";
  readonly reason: OversellRefusalReason;
  /** The in-page message: names the LLP and its free units (M11-S07-T03). */
  readonly message: string;
  readonly llpId: string;
  readonly label: string | null;
  readonly free: number | null;
  readonly units: number;
  /** "console": our pre-check said no; "zoho": the Deluge guard refused the write. */
  readonly by: "console" | "zoho";
}
export type OversellCheck =
  | { readonly ok: true; readonly llp: GuardedLlp; readonly held: number; readonly free: number }
  | OversellRefusal | GuardSourceError;

const plural = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;
/** "Block B has no free units for Kiran Rao's 2 units." / "Block B has only 1 free unit for 2 units." */
export function oversellMessage(label: string, free: number, units: number, investorName?: string | null): string {
  const forWhom = investorName ? `${investorName}'s ${plural(units)}` : plural(units);
  return free <= 0 ? `${label} has no free units for ${forWhom}.` : `${label} has only ${free} free unit${free === 1 ? "" : "s"} for ${forWhom}.`;
}

export interface OversellDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate" | "insert" | "update">;
  readonly events: Pick<InvestorEvents, "refusal">;
}

export function createOversellGuard(deps: OversellDeps) {
  const refuse = (cred: UserCredential, ask: OversellAsk, reason: OversellRefusalReason, message: string,
    label: string | null, free: number | null, by: "console" | "zoho"): OversellRefusal => {
    deps.events.refusal(cred.userId, "allotment-oversell", reason, [ask.llpId, ...(ask.exceptAllotmentId ? [ask.exceptAllotmentId] : [])]);
    return Object.freeze({ ok: false, kind: "refused", reason, message, llpId: ask.llpId, label, free, units: ask.units, by });
  };

  async function check(cred: UserCredential, ask: OversellAsk, signal?: AbortSignal, by: "console" | "zoho" = "console"): Promise<OversellCheck> {
    const except = ask.exceptAllotmentId ?? null;
    if (typeof ask.llpId !== "string" || !RECORD_ID.test(ask.llpId) || (except !== null && !RECORD_ID.test(except))
      || !Number.isInteger(ask.units) || ask.units < 0) {
      return refuse(cred, { ...ask, units: Number.isInteger(ask.units) ? ask.units : 0 }, "invalid-request", "That is not an LLP and a whole number of units.", null, null, by);
    }
    const read = await readGuardedLlp(deps.crm, cred, ask.llpId, signal);
    if (!read.ok) return read.kind === "refused" ? refuse(cred, ask, "not-found", "That LLP is not in Zoho, or not yours to open.", null, null, by) : read;
    const { llp } = read;
    const held = await heldOn(deps.crm, cred, ask.llpId, { exceptAllotmentId: except, signal });
    if (!held.ok) return held;
    const free = Math.max(0, llp.released - held.held);
    if (ask.units === 0) return { ok: true, llp, held: held.held, free };
    if (llp.released === 0) return refuse(cred, ask, "not-released", `${llp.label} is not released for sale, so it has no free units for ${ask.investorName ? `${ask.investorName}'s ` : ""}${plural(ask.units)}.`, llp.label, 0, by);
    if (ask.units > free) return refuse(cred, ask, "no-free-units", oversellMessage(llp.label, free, ask.units, ask.investorName), llp.label, free, by);
    return { ok: true, llp, held: held.held, free };
  }

  /** A failed allotment write: the oversell guard's refusal, named with the LLP and its free units — or null. */
  async function explain(cred: UserCredential, ask: OversellAsk, failure: ZohoFailure, signal?: AbortSignal): Promise<OversellRefusal | null> {
    const g = guardRefusalOf(ALLOTMENT_MODULE, failure);
    if (!g || g.name !== "oversell") return null;
    const again = await check(cred, ask, signal, "zoho");
    if (!again.ok && again.kind === "refused") return again;
    // Zoho counted what this token cannot see (or the count moved): Zoho's word stands; name what we know.
    const label = again.ok ? again.llp.label : null, free = again.ok ? again.free : null;
    return refuse(cred, ask, "no-free-units",
      `${label ?? "This LLP"} does not have ${plural(ask.units)} free — Zoho refused the allotment.`, label, free, "zoho");
  }

  return Object.freeze({
    check,
    explain,
    /**
     * Pre-check, then insert ONE allotment, then name a Zoho refusal. For writers that create an allotment (a hold,
     * a recorded advance, an add-paid): `units` is the allotment's Reserved_Units or Issued_Units.
     */
    async insertAllotment(cred: UserCredential, ask: OversellAsk, fields: ZohoFields, signal?: AbortSignal): Promise<
      | { readonly ok: true; readonly id: string | null; readonly free: number }
      | OversellRefusal | GuardSourceError | { readonly ok: false; readonly kind: "write-failed"; readonly error: ZohoFailure }
    > {
      const pre = await check(cred, ask, signal);
      if (!pre.ok) return pre;
      const r = await deps.crm.insert(cred, ALLOTMENT_MODULE, [fields], { signal });
      if (r.ok) {
        const first = r.value[0];
        if (first && first.ok) return { ok: true, id: first.id, free: pre.free - ask.units };
        const failure: ZohoFailure = { kind: "invalid-data", status: 200, code: first?.code ?? "INVALID_DATA", field: first?.field ?? null, records: r.value };
        return (await explain(cred, ask, failure, signal)) ?? { ok: false, kind: "write-failed", error: failure };
      }
      return (await explain(cred, ask, r.error, signal)) ?? { ok: false, kind: "write-failed", error: r.error };
    },
  });
}
export type OversellGuard = ReturnType<typeof createOversellGuard>;
