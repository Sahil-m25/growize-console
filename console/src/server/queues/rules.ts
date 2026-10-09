/**
 * M05-S07-T01 / M05-S08-T01 — THE QUEUE RULES, pure (D12, D21, D40).
 *
 * Every rule is the front end's (lib/im/selectors.ts finQueue / careQueue / mineQueue, lib/im/constants.ts TIERS):
 * the tier, the cadence and "needs a manager" are imported from there, applied to a minimal holding shape; the
 * row words and the now/soon urgency are the same strings the front end writes. The IST day arithmetic is the one
 * hold clock (../holds/rules daysLeft / istDay).
 *
 * Zoho has no Tier and no next-contact field: the tier is computed from the account's issued units (TIERS: A 4+,
 * B 2–3, C 1), and the next contact is always cadence after the last conversation (Touches) or, with none, after
 * the day the manager was named (KAM_Since, else Said_Yes_At).
 */
import { CAN } from "../../lib/im/constants";
import { cadence, needsKam, tierOf } from "../../lib/im/selectors";
import type { ImCan, ImInvestor } from "../../lib/im/types";
import { daysLeft, istDay } from "../holds/rules";

export type Urgency = "now" | "soon";
const URG: Readonly<Record<Urgency, number>> = Object.freeze({ now: 0, soon: 1 });

/** Only the fields the front end's tier rules read; the rest of ImInvestor is never touched by them. */
const holding = (units: number, kam: string | null): ImInvestor =>
  ({ units, kam, st: "allocated" } as Pick<ImInvestor, "units" | "kam" | "st"> as ImInvestor);

export interface Tier { readonly k: "A" | "B" | "C"; readonly t: string; readonly every: number; readonly pool: boolean }
/** The front end's tier for a holding of `units` issued units (tierOf). */
export function tierFor(units: number): Tier {
  const t = tierOf(holding(units, null))!;
  return Object.freeze({ k: t.k as Tier["k"], t: t.t, every: cadence(holding(units, null)), pool: !!t.pool });
}

/** Seats with no right beyond reading (the front end's readOnlySeat). */
export const READ_ONLY_CAPS: ReadonlySet<ImCan> = new Set(["view", "bank", "pii", "log"]);
export const isReadOnly = (can: (c: ImCan) => boolean): boolean =>
  !(Object.keys(CAN) as ImCan[]).filter((c) => !READ_ONLY_CAPS.has(c)).some(can);

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ---------------------------------------------- the care queue ---------------------------------------------- */

export interface CareAccount {
  readonly id: string;
  /** the ARL code (ARL-INV-0207) the investor and Finance quote */
  readonly code?: string | null;
  readonly name: string;
  readonly units: number;
  readonly kamUserId: string | null;
  readonly introducedAt: string | null;
  /** "YYYY-MM-DD" or a Zoho datetime: the manager was named (or the investor said yes) — the base with no conversation. */
  readonly since: string | null;
  /** Zoho datetime of the latest conversation (Touches.Occurred_At), or null. */
  readonly lastHeardAt: string | null;
}
export type CareKind = "nokam" | "intro" | "due";
export interface CareRow {
  readonly key: string;
  readonly kind: CareKind;
  readonly investor: { readonly id: string; readonly name: string; readonly code?: string | null };
  readonly tier: Tier["k"];
  readonly text: string;
  readonly urg: Urgency;
  /** days past the cadence (negative: days until), for "due" rows */
  readonly days: number | null;
  /** The one control, as the front end's QRow labels it; null = a tag, no button. */
  readonly action: "Assign manager" | "Record the introduction" | "Log a conversation" | null;
}

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const baseDay = (v: string | null): string | null => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? istDay(ms) : null;
};

/** Days past the cadence (negative: days until the next conversation is owed); null when there is no base date. */
export function overdueDays(a: CareAccount, now: number): number | null {
  const base = baseDay(a.lastHeardAt) ?? baseDay(a.since);
  if (!base) return null;
  return -daysLeft(addDays(base, tierFor(a.units).every), now);
}
export const goneQuiet = (a: CareAccount, now: number): boolean => { const o = overdueDays(a, now); return o !== null && o > 0; };

/**
 * careQueue: no manager on Tier A/B; handed over and never introduced; gone quiet or due inside 14 days.
 * `kamOnly` = the reader is a KAM (their own accounts only); `mayAssign` = the Head of AM (the button).
 */
export function careRows(accounts: readonly CareAccount[], now: number, o: { readonly kamOnly: string | null; readonly mayAssign: boolean }): CareRow[] {
  const out: CareRow[] = [];
  for (const a of accounts) {
    if (o.kamOnly !== null && a.kamUserId !== o.kamOnly) continue;
    const tier = tierFor(a.units);
    const base = { investor: Object.freeze({ id: a.id, name: a.name, ...(a.code ? { code: a.code } : {}) }), tier: tier.k };
    if (needsKam(holding(a.units, a.kamUserId))) {
      out.push(Object.freeze({ ...base, key: `nokam:${a.id}`, kind: "nokam", text: `${tier.t} and nobody is looking after them`, urg: "now",
        days: null, action: o.mayAssign ? "Assign manager" : null }));
    } else if (a.kamUserId && !a.introducedAt) {
      out.push(Object.freeze({ ...base, key: `intro:${a.id}`, kind: "intro", text: "Handed over and never introduced", urg: "now", days: null, action: "Record the introduction" }));
    } else {
      const d = overdueDays(a, now);
      if (d !== null && d > -14) {
        out.push(Object.freeze({ ...base, key: `due:${a.id}`, kind: "due", days: d, action: "Log a conversation",
          text: d > 0 ? `Gone quiet — ${plural(d, "day")} past the ${tier.t} cadence` : `Due a conversation in ${plural(-d, "day")}`,
          urg: d > 0 ? "now" : "soon" }));
      }
    }
  }
  return sortQueue(out);
}

/* ---------------------------------------------- Finance's queue ---------------------------------------------- */

export type MoneyKind = "claim" | "hold" | "verify" | "remind" | "kyc" | "fema" | "send";
export interface MoneyRow {
  readonly key: string;
  readonly kind: MoneyKind;
  /** a "send" row of an NDA asked for before any investor record exists names the lead (id = the Lead id) */
  readonly investor: { readonly id: string; readonly name: string | null };
  readonly text: string;
  readonly urg: Urgency;
  readonly days: number | null;
  readonly action: "Answer it" | "Verify it" | "Remind" | "Check it" | "Open the record" | "Send it";
  /** The record the control acts on: the claim (Receipts row), the allotment, or the paper. G1 "send" rows: `leadId` (the NDA
   *  goes on the Lead), `contactId` when the investor record exists (the supplementary goes on its allotment), `paper`. */
  readonly ref: { readonly claimId?: string; readonly allotmentId?: string; readonly paper?: string; readonly recordId?: string;
    readonly leadId?: string; readonly contactId?: string };
}

/** G1 (D136 proposed): "Send the NDA — requested by Rohit 2 days ago"; today: "requested by Rohit today". */
export function sendText(paper: "nda" | "supplementary", by: string | null, days: number | null): string {
  const what = paper === "nda" ? "Send the NDA" : "Send the supplementary agreement";
  const when = days === null ? "" : days <= 0 ? " today" : ` ${plural(days, "day")} ago`;
  return `${what} — requested by ${by ?? "an IR"}${when}`;
}
/** G1: what the queue says when the IRs' requests could not be read, or may be incomplete (no Finance sharing rule on Leads yet). */
export const REQUESTS_UNREAD_TEXT = "The IRs' requests to send an NDA or a supplementary could not be read — Zoho refused the Leads read for this seat. Until Digital Infrastructure adds the Finance sharing rule on Leads, requested papers do not show here.";
export const REQUESTS_NO_FIELDS_TEXT = "The IRs' requests to send an NDA or a supplementary could not be read — Zoho does not know the request fields yet (Leads.NDA_Requested_At / Supp_Requested_At). Digital Infrastructure creates them.";
export const REQUESTS_PARTIAL_TEXT = "Requests to send an NDA show only for leads Zoho shares with Finance. The Finance sharing rule on Leads is not confirmed yet, so a request on a lead not shared with you is not listed here.";

export const claimText = "An IR says the money has arrived — confirm it";
export function holdText(d: number): { text: string; urg: Urgency } {
  return {
    text: d < 0 ? `The hold ran out ${plural(-d, "day")} ago — release it or extend it` : `Balance due — hold ends in ${plural(d, "day")}`,
    urg: d <= 7 ? "now" : "soon",
  };
}
export const kycText = (kyc: "failed" | "pending"): string => (kyc === "failed" ? "KYC failed — documents do not match" : "KYC is not passed");
export const femaText = "FEMA declaration outstanding";
export const verifyText = (label: string): string => `Verify the signed ${label.toLowerCase()}`;
/** "<doc> · sent <n> days ago"; with no sent time from Zoho Sign, "<doc> · out for signature". */
export const remindText = (label: string, days: number | null): string =>
  days === null ? `${label} · out for signature` : `${label} · sent ${plural(days, "day")} ago`;
/** A paper out this many days or more is chased. */
export const REMIND_AFTER_DAYS = 3;

/** now before soon, otherwise in the order the rows were built (the front end's stable URG sort). */
export function sortQueue<T extends { readonly urg: Urgency }>(rows: T[]): T[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => URG[a.r.urg] - URG[b.r.urg] || a.i - b.i).map((x) => x.r);
}
