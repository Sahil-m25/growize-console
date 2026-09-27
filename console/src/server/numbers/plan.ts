/**
 * M16-S04 — read the plan: the team periods in Sales_Plans (window, target units, collection target)
 * and, per window, what was actually paid — worked out from confirmed Receipts, never typed. A
 * period's paid units are the units on the allotments whose Full receipt was matched inside it; its
 * banked money is the sum of matched receipts inside it, shown only to a seat that may see money.
 *
 * Read-only: nothing here writes (D60: the IR Manager reads the plan; changing it is not theirs).
 * Every read is on the person's own token; a seat whose token cannot read Receipts gets the plan
 * with "paid" unknown rather than a guessed zero.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { SeatedZohoUser } from "../oauth/seat";

const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface PlanAccess { readonly actor: SeatedZohoUser; readonly seesPlan: boolean; readonly seesMoney: boolean }
export interface PlanAccessAuthority { recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<PlanAccess | null> }

export interface PlanPeriod {
  readonly id: string; readonly name: string | null; readonly from: string; readonly to: string;
  readonly targetUnits: number; readonly paidUnits: number | null; readonly remainingUnits: number | null;
  readonly status: "done" | "current" | "next" | "later"; readonly collectionTarget: number | null; readonly banked: number | null;
}
export type PlanResult =
  | { readonly ok: true; readonly value: { readonly periods: readonly PlanPeriod[]; readonly total: { readonly targetUnits: number; readonly paidUnits: number | null };
      readonly focus: string | null; readonly paidKnown: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface PlanDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly access: PlanAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const istDate = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function createPlanRead(deps: PlanDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The plan read needs crm.coql, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => { const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined; return validId(id) ? id : null; };
  const all = async (cred: UserCredential, q: string): Promise<ZohoRecord[] | ZohoFailureKind> => {
    const rows: ZohoRecord[] = [];
    for (let off = 0; off < 10_000; off += 2_000) {
      const r = await crm.coql(cred, `${q} limit ${off}, 2000`);
      if (!r.ok) return r.error.kind;
      if (r.value.invalidRecordIds) return "unexpected";
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return rows;
    }
    return "unexpected";
  };

  return Object.freeze({
    async read(principal: { credential: UserCredential; sessionId: string }, signal?: AbortSignal): Promise<PlanResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) {
        return { ok: false, kind: "refused", reasonCode: "invalid-request" };
      }
      let a: PlanAccess | null;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true }; }
      if (!a || a.actor?.userId !== cred.userId) return { ok: false, kind: "refused", reasonCode: "session-changed" };
      if (!a.seesPlan) {
        log.refusal({ at: clock(), actor: { kind: "user", userId: cred.userId }, action: "plan-read", reason: "capability-missing", recordIds: [] });
        return { ok: false, kind: "refused", reasonCode: "capability-missing" };
      }
      const plans = await all(cred, "select id, Name, Period_From, Period_To, Target_Units, Collection_Target from Sales_Plans where Plan_Scope = 'Team' order by Period_From asc");
      if (typeof plans === "string") return { ok: false, kind: "source-error", errorKind: plans, retryable: plans === "network" || plans === "server" || plans === "busy" };
      const periods = plans.map((p) => ({ id: p.id, name: typeof p.Name === "string" ? p.Name.slice(0, 120) : null, from: p.Period_From, to: p.Period_To,
        target: p.Target_Units, collection: typeof p.Collection_Target === "number" ? p.Collection_Target : null }));
      if (periods.some((p) => !validId(p.id) || typeof p.from !== "string" || !DATE.test(p.from) || typeof p.to !== "string" || !DATE.test(p.to)
        || p.to < p.from || !Number.isSafeInteger(p.target) || (p.target as number) < 0)) {
        return { ok: false, kind: "refused", reasonCode: "source-invalid" };
      }

      // Paid, from confirmed receipts: matched Full receipts give the allotments whose units are paid.
      let paidKnown = true;
      const paidOn: { day: string; units: number; amount: number }[] = [];
      const banked: { day: string; amount: number }[] = [];
      if (periods.length) {
        const first = periods[0].from, last = periods[periods.length - 1].to;
        const receipts = await all(cred, `select id, Allotment, Kind, Amount, Received_On from Receipts where (Match_State = 'Matched' and Received_On between '${first}T00:00:00+05:30' and '${last}T23:59:59+05:30') order by id asc`);
        if (typeof receipts === "string") {
          if (receipts === "forbidden" || receipts === "not-found") paidKnown = false;
          else return { ok: false, kind: "source-error", errorKind: receipts, retryable: receipts === "network" || receipts === "server" || receipts === "busy" };
        } else {
          const full = new Map<string, string>();
          for (const r of receipts) {
            const day = typeof r.Received_On === "string" ? istDate(Date.parse(r.Received_On)) : null;
            if (!day || typeof r.Amount !== "number") return { ok: false, kind: "refused", reasonCode: "source-invalid" };
            banked.push({ day, amount: r.Amount });
            const allot = idOf(r.Allotment);
            if (r.Kind === "Full" && allot) full.set(allot, day);
          }
          const ids = [...full.keys()];
          for (let i = 0; i < ids.length; i += 100) {
            const rows = await all(cred, `select id, Issued_Units, Reserved_Units from LLP_UnitAllocation_Module where id in (${ids.slice(i, i + 100).map((x) => `'${x}'`).join(", ")}) order by id asc`);
            if (typeof rows === "string") return { ok: false, kind: "source-error", errorKind: rows, retryable: false };
            for (const r of rows) {
              const u = typeof r.Issued_Units === "number" && r.Issued_Units > 0 ? r.Issued_Units : typeof r.Reserved_Units === "number" ? r.Reserved_Units : 0;
              paidOn.push({ day: full.get(r.id) as string, units: u, amount: 0 });
            }
          }
        }
      }

      const today = istDate(clock());
      let nextSeen = false;
      const out: PlanPeriod[] = periods.map((p) => {
        const paid = paidKnown ? paidOn.filter((x) => x.day >= (p.from as string) && x.day <= (p.to as string)).reduce((s, x) => s + x.units, 0) : null;
        const status: PlanPeriod["status"] = (p.to as string) < today ? "done" : (p.from as string) <= today ? "current" : !nextSeen ? (nextSeen = true, "next") : "later";
        const money = a!.seesMoney && paidKnown ? banked.filter((x) => x.day >= (p.from as string) && x.day <= (p.to as string)).reduce((s, x) => s + x.amount, 0) : null;
        return Object.freeze({ id: p.id, name: p.name, from: p.from as string, to: p.to as string, targetUnits: p.target as number,
          paidUnits: paid, remainingUnits: paid === null ? null : Math.max(0, (p.target as number) - paid), status,
          collectionTarget: a!.seesMoney ? p.collection : null, banked: money });
      });
      const focus = out.find((p) => p.status === "current")?.id ?? out.find((p) => p.status === "next")?.id ?? null;
      const targetUnits = out.reduce((s, p) => s + p.targetUnits, 0);
      const paidUnits = paidKnown ? out.reduce((s, p) => s + (p.paidUnits ?? 0), 0) : null;
      return { ok: true, value: { periods: Object.freeze(out), total: { targetUnits, paidUnits }, focus, paidKnown } };
    },
  });
}
