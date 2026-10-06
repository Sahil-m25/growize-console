/**
 * Cluster C2 setFc / setFcDate / setFcBy (ir-write-map.md) — the forecast drawer, on the Lead, on the person's own
 * token (D53), guarded by the Modified_Time the page loaded (D44).
 *
 *   Forecast          picklist Commit / Probable / Pipeline (FCATT)      — from Qualified on (manual §3.1)
 *   Forecast_Paid_By  date: the expected full-payment date               — not in the past, never once fully paid,
 *                                                                          and only on a lead that has a category
 * setFcBy's day count is turned into the date by the page; both reach this as `paidBy`.
 * Forecast evidence (setFcEv) is not written here: its home is PROVISIONAL (J4) and out of this round.
 */

import type { ZohoClient, ZohoFieldValue } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { FollowupAccessAuthority } from "./followup";
import { LEADS_MODULE } from "./capture";
import { createAdmit, istDay, RECORD_PREFIX, rejectedField, zohoError, type AdmitRefusal, type Principal, type Refused, type SourceError } from "./record-access";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The console's category keys → the Leads.Forecast picklist. */
export const FORECAST_OF: Readonly<Record<string, string>> = Object.freeze({ commit: "Commit", probable: "Probable", pipeline: "Pipeline" });

export type ForecastRefusal = AdmitRefusal | "lead-closed" | "not-qualified" | "category-invalid" | "date-invalid" | "date-past" | "already-paid"
  | "category-needed" | "nothing-changed" | "field-missing";
export type ForecastResult =
  | { readonly ok: true; readonly value: { readonly leadId: string; readonly modifiedTime: string | null; readonly forecast: string | null; readonly paidBy: string | null } }
  | Refused<ForecastRefusal>
  | SourceError;

export interface ForecastCommand {
  /** commit | probable | pipeline */
  readonly category?: unknown;
  /** YYYY-MM-DD */
  readonly paidBy?: unknown;
}

export interface ForecastDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update">;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export function createLeadForecast(deps: ForecastDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The forecast needs crm.getRecord/update, the access authority, the ops log and the CRM record-id prefix.");
  }
  const clock = deps.clock ?? Date.now;
  const { admit, refuse } = createAdmit({ crm: deps.crm, access: deps.access, log: deps.log, recordIdPrefix: deps.recordIdPrefix, clock, action: "lead-forecast" });

  return Object.freeze({
    async set(principal: Principal, leadId: unknown, expected: unknown, c: ForecastCommand, signal?: AbortSignal): Promise<ForecastResult> {
      const o = await admit(principal, leadId, expected, ["Qualified_At", "Fully_Paid_At", "Forecast", "Forecast_Paid_By"], signal);
      if (!("L" in o)) return o;
      const { me, L } = o;
      const id = leadId as string;
      if (!c || typeof c !== "object") return refuse(me, "invalid-request", "Not saved — the request is incomplete.", [id]);
      if (L.Lost_At) return refuse(me, "lead-closed", "Not saved — this lead is closed.", [id]);
      if (!L.Qualified_At) return refuse(me, "not-qualified", "Nothing is forecast before it qualifies.", [id]);
      const fields: Record<string, ZohoFieldValue> = {};
      if (c.category !== undefined) {
        const f = typeof c.category === "string" ? FORECAST_OF[c.category] : undefined;
        if (!f) return refuse(me, "category-invalid", "Choose Commit, Probable or Pipeline.", [id]);
        fields.Forecast = f;
      }
      if (c.paidBy !== undefined) {
        if (typeof c.paidBy !== "string" || !DATE.test(c.paidBy) || Number.isNaN(Date.parse(c.paidBy + "T00:00:00Z"))) {
          return refuse(me, "date-invalid", "Give the expected full-payment date.", [id]);
        }
        if (c.paidBy < istDay(clock())) return refuse(me, "date-past", "The expected full-payment date cannot be in the past.", [id]);
        if (L.Fully_Paid_At) return refuse(me, "already-paid", "This lead is paid in full; the date is the payment's now.", [id]);
        if (!fields.Forecast && !(typeof L.Forecast === "string" && L.Forecast)) return refuse(me, "category-needed", "Choose the forecast category first.", [id]);
        fields.Forecast_Paid_By = c.paidBy;
      }
      if (!Object.keys(fields).length) return refuse(me, "nothing-changed", "Nothing to save.", [id]);
      let put: Awaited<ReturnType<typeof deps.crm.update>>;
      try { put = await deps.crm.update(principal.credential, LEADS_MODULE, id, fields, { ifUnmodifiedSince: expected as string, signal }); } catch { return zohoError("unexpected"); }
      if (!put.ok) {
        if (put.error.kind === "conflict") return refuse(me, "lead-changed", "Not saved — the lead changed in Zoho since it was opened. Reload it and try again.", [id]);
        const f = rejectedField(put.error);
        if (f && Object.prototype.hasOwnProperty.call(fields, f)) return refuse(me, "field-missing", `Not saved — Zoho rejected Leads.${f}; the owner checks the field exists.`, [id], f);
        return zohoError(put.error.kind);
      }
      return { ok: true, value: { leadId: id, modifiedTime: put.value.modifiedTime,
        forecast: (fields.Forecast as string | undefined) ?? (typeof L.Forecast === "string" ? L.Forecast : null),
        paidBy: (fields.Forecast_Paid_By as string | undefined) ?? (typeof L.Forecast_Paid_By === "string" ? L.Forecast_Paid_By : null) } };
    },
  });
}
export type LeadForecast = ReturnType<typeof createLeadForecast>;
