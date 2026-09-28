/**
 * M10-S22-T02 — THE APP PREVIEW'S DATA: one investor's app screens (Home, Projects, a project, Financials,
 * Documents, Activity, Profile) filled from Zoho on the viewer's own token (D53), for the read-only mock-up.
 *
 * Built on the investor record (./record.ts — imported, not re-read): the same admission (a seat without the
 * investor in scope is refused, so the button has nothing to open), the same sections. Plus, for that
 * Contact's allotments only, one COQL on Investor_Payouts (≤100 allotment ids a call). What the viewer's seat
 * does not see is not read (D52): payout amounts only for a seat whose record has the Money section (Finance
 * side, super user); dates and states for everyone with the record (Jev 0.75, PROVISIONAL). Documents only
 * where the record has Paper. No identity field is read; the Profile says "Finance only" for PAN and bank.
 *
 * Nothing is kept (D45): the preview lives for this response. Plane B keeps one `event` line (who, which
 * Contact) when a preview is built; refusals are the record's own.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { PREVIEW_TABS } from "../../lib/im/money";
import type { InvestorEvents } from "../data/events";
import type { PlaneCRefusal } from "../data/ir-guard";
import { createInvestorRecordReader, type InvestorRecord, type RecordResult } from "./record";

export const PREVIEW_LABEL = "Preview — mock-up, not the live app";
export const PAYOUTS_MODULE = "Investor_Payouts";
/** Read for every seat with the record. */
export const PAYOUT_FIELDS = Object.freeze(["id", "Allotment", "Payout_Kind", "Instalment_No", "Period_Month", "Due_On", "Payout_State", "Paid_On"]);
/** Read only where the record has Money. Payout_UTR and Payout_Note are never read. */
export const PAYOUT_AMOUNT_FIELDS = Object.freeze(["Gross_Amount", "TDS_Amount", "Net_Amount"]);
const RECORD_ID = /^\d{15,22}$/;
const DATE = /^\d{4}-\d{2}-\d{2}/;
const STATES: ReadonlySet<string> = new Set(["Scheduled", "Paid", "Held", "Failed", "Cancelled"]);

export interface PreviewPayout {
  readonly id: string; readonly allotmentId: string; readonly kind: string | null; readonly instalment: number | null;
  readonly month: string | null; readonly dueOn: string | null; readonly state: string | null; readonly paidOn: string | null;
  /** null where the viewer's seat does not read amounts */
  readonly net: number | null; readonly gross: number | null; readonly tds: number | null;
}

export interface AppPreview {
  readonly investorId: string;
  readonly label: typeof PREVIEW_LABEL;
  readonly readOnly: true;
  readonly tabs: readonly string[];
  /** The seat reads money figures (invested, payout amounts). */
  readonly amounts: boolean;
  readonly home: {
    readonly name: string; readonly firstName: string; readonly units: number;
    readonly invested: number | null; readonly paidOut: number | null;
    readonly nextPayout: { readonly dueOn: string; readonly net: number | null } | null;
    readonly stages: readonly { readonly t: string; readonly done: boolean }[];
  };
  readonly projects: readonly {
    readonly allotmentId: string; readonly llpId: string; readonly name: string; readonly block: string;
    readonly units: number; readonly issued: number; readonly status: string; readonly paymentStatus: string | null; readonly holdUntil: string | null;
  }[];
  readonly financials: { readonly invested: number | null; readonly due: number | null; readonly paidOut: number | null; readonly payouts: readonly PreviewPayout[] };
  /** null where the seat's record has no Paper */
  readonly documents: readonly { readonly id: string; readonly name: string; readonly at: string | null; readonly scope: "personal" | "allotment" | "farm" }[] | null;
  readonly activity: readonly { readonly at: string; readonly t: string }[];
  readonly profile: { readonly name: string; readonly city: string; readonly nominee: string; readonly email: string; readonly mobile: string; readonly pan: "Finance only"; readonly bank: "Finance only" };
}

export type PreviewResult =
  | { readonly ok: true; readonly preview: AppPreview }
  | Exclude<RecordResult, { ok: true }>;

export interface PreviewDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRecord" | "getRelated">;
  readonly events: InvestorEvents;
  readonly log?: Pick<OpsLog, "event">;
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
  readonly clock?: () => number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const day = (v: unknown): string | null => (typeof v === "string" && DATE.test(v) ? v.slice(0, 10) : null);
const code = (v: unknown, max = 40): string | null => (typeof v === "string" && v.length <= max && v !== "-None-" ? v : null);
const lookupId = (v: unknown): string | null => {
  const id = typeof v === "object" && v !== null ? (v as { id?: unknown }).id : v;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};

/** The pure part: the screens from a record and its payouts. */
export function previewOf(rec: InvestorRecord, payouts: readonly PreviewPayout[]): AppPreview {
  const amounts = rec.money !== null;
  const x = rec.investor;
  const live = rec.holdings.filter((h) => h.status !== "Cancelled");
  const paid = payouts.filter((p) => p.state === "Paid");
  const paidOut = amounts ? paid.reduce((t, p) => t + (p.net ?? 0), 0) : null;
  const next = payouts.filter((p) => p.state === "Scheduled" && p.dueOn).sort((a, b) => (a.dueOn! < b.dueOn! ? -1 : 1))[0] ?? null;
  const st = x.st;
  const docs = rec.paper === null ? null : Object.freeze([
    ...rec.paper.personal.map((f) => ({ id: f.id, name: f.name, at: f.at, scope: "personal" as const })),
    ...rec.paper.allotments.flatMap((a) => a.files.map((f) => ({ id: f.id, name: f.name, at: f.at, scope: "allotment" as const }))),
    ...rec.paper.farms.flatMap((a) => a.files.map((f) => ({ id: f.id, name: f.name, at: f.at, scope: "farm" as const }))),
  ].map((d) => Object.freeze(d)));
  const activity: { at: string; t: string }[] = [];
  if (rec.origin.saidYesAt) activity.push({ at: rec.origin.saidYesAt.slice(0, 16), t: "Joined Growize" });
  for (const p of paid) if (p.paidOn) activity.push({ at: p.paidOn, t: `Payout paid${p.month ? " for " + p.month.slice(0, 7) : ""}` });
  for (const d of docs ?? []) if (d.at) activity.push({ at: d.at, t: `Document added: ${d.name}` });
  activity.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return Object.freeze({
    investorId: rec.id, label: PREVIEW_LABEL, readOnly: true, tabs: Object.freeze([...PREVIEW_TABS]), amounts,
    home: Object.freeze({
      name: x.n, firstName: x.n.split(" ")[0] ?? x.n, units: x.units,
      invested: amounts ? rec.money!.paid : null, paidOut,
      nextPayout: next ? Object.freeze({ dueOn: next.dueOn!, net: amounts ? next.net : null }) : null,
      stages: Object.freeze([
        { t: "Reserved", done: rec.holdings.length > 0 },
        { t: "Paid in full", done: st === "paid" || st === "allocated" },
        { t: "Allotted", done: st === "allocated" },
        { t: "Monthly payouts", done: paid.length > 0 },
      ].map((s) => Object.freeze(s))),
    }),
    projects: Object.freeze(live.map((h) => Object.freeze({
      allotmentId: h.id, llpId: h.llpId, name: h.llpName, block: h.block, units: h.committed, issued: h.issued, status: h.status,
      paymentStatus: h.paymentStatus, holdUntil: h.holdUntil,
    }))),
    financials: Object.freeze({ invested: amounts ? rec.money!.paid : null, due: amounts ? rec.money!.due : null, paidOut, payouts: Object.freeze([...payouts]) }),
    documents: docs,
    activity: Object.freeze(activity.slice(0, 20).map((a) => Object.freeze(a))),
    profile: Object.freeze({ name: x.n, city: x.city, nominee: x.nominee, email: x.em, mobile: x.ph, pan: "Finance only", bank: "Finance only" }),
  });
}

export function createAppPreviewReader(deps: PreviewDeps) {
  const records = createInvestorRecordReader({ crm: deps.crm, events: deps.events, planeCRefusal: deps.planeCRefusal });
  const clock = deps.clock ?? Date.now;

  async function payoutsOf(cred: UserCredential, allotmentIds: readonly string[], amounts: boolean, signal?: AbortSignal)
    : Promise<{ ok: true; rows: PreviewPayout[] } | { ok: false; errorKind: string }> {
    const ids = [...new Set(allotmentIds.filter((x) => RECORD_ID.test(x)))];
    const fields = [...PAYOUT_FIELDS, ...(amounts ? PAYOUT_AMOUNT_FIELDS : [])];
    const rows: PreviewPayout[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const q = `select ${fields.join(", ")} from ${PAYOUTS_MODULE} where Allotment in (${chunk.map((x) => `'${x}'`).join(", ")}) order by Due_On asc limit 0, 2000`;
      let r: Awaited<ReturnType<typeof deps.crm.coql>>;
      try { r = await deps.crm.coql(cred, q, { signal }); } catch { return { ok: false, errorKind: "unexpected" }; }
      if (!r.ok) {
        /* the module or its fields are not visible to this viewer: no payouts shown, never someone else's view */
        if (r.error.kind === "forbidden" || r.error.kind === "not-found") return { ok: true, rows: [] };
        return { ok: false, errorKind: r.error.kind };
      }
      for (const p of r.value.records) {
        const allotmentId = lookupId(p.Allotment);
        if (!RECORD_ID.test(p.id) || !allotmentId || !chunk.includes(allotmentId)) continue;
        const state = code(p.Payout_State);
        rows.push(Object.freeze({
          id: p.id, allotmentId, kind: code(p.Payout_Kind), instalment: num(p.Instalment_No), month: day(p.Period_Month), dueOn: day(p.Due_On),
          state: state && STATES.has(state) ? state : null, paidOn: day(p.Paid_On),
          net: amounts ? num(p.Net_Amount) : null, gross: amounts ? num(p.Gross_Amount) : null, tds: amounts ? num(p.TDS_Amount) : null,
        }));
      }
    }
    rows.sort((a, b) => ((a.dueOn ?? "") < (b.dueOn ?? "") ? -1 : (a.dueOn ?? "") > (b.dueOn ?? "") ? 1 : 0));
    return { ok: true, rows };
  }

  async function read(cred: UserCredential, seat: string, contactId: string, signal?: AbortSignal): Promise<PreviewResult> {
    const r = await records.read(cred, seat, contactId, signal);
    if (!r.ok) return r;
    const rec = r.record;
    const po = await payoutsOf(cred, rec.holdings.filter((h) => h.status !== "Cancelled").map((h) => h.id), rec.money !== null, signal);
    if (!po.ok) return { ok: false, kind: "source-error", errorKind: po.errorKind };
    try { deps.log?.event?.({ at: clock(), actor: { kind: "user", userId: cred.userId }, action: "app-preview", reason: "built", recordIds: [rec.id] }); } catch { /* never fails the read */ }
    return { ok: true, preview: previewOf(rec, po.rows) };
  }

  return Object.freeze({ read });
}
export type AppPreviewReader = ReturnType<typeof createAppPreviewReader>;
