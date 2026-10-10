/**
 * GC-1524 — THE WHOLE STORY ON THE INVESTOR RECORD'S JOURNEY TAB (owner, 9 Oct: "the journey page is almost empty … the
 * journey is actually a better choice with a button to the leads page if needed").
 *
 * Read in place, on the signed-in person's own token (D53, rule 2) — no service token, nothing cached, nothing copied (D45):
 *   lead side      — the origin lead's rung stamps (journey RUNGS: first touch → said yes) by one GET /Leads/{id}. When Zoho
 *                    does not return that lead to this person (another IR's, or a seat without Leads), the Contact's own stamps
 *                    stand in: Said_Yes_At (and its Created_Time as "on the book").
 *   touches        — one COQL over Touches for that lead, only when the lead itself was returned: how many, by channel,
 *                    replies, first and last. Not read, or refused → null.
 *   investor side  — reserved / fully paid / allocated / onboarded from the lead's stamps when read, else from what the record
 *                    already holds for this seat: the allotments (live, Issued, Issued_On) and — only where Money shows — the
 *                    matched receipts; KAM assigned from the Contact's KAM / KAM_Since.
 * Every read here is one the caller's seat may already make; a refusal or failure narrows the story and never fails the record.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { AllotmentRow, ReceiptRow } from "../data/adapters";
import type { ContactRow } from "../data/contact-row";
import { TOUCH_CHANNEL } from "../leads/followup";
import { RUNGS } from "../leads/journey";

const LEADS = "Leads";
const RECORD_ID = /^\d{15,22}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export type StorySide = "lead" | "investor";
export type StorySource = "lead" | "contact" | "allotment" | "receipt";
export interface StoryStep {
  readonly k: string;
  readonly t: string;
  readonly side: StorySide;
  readonly done: boolean;
  /** Zoho's datetime or date as read, or null when done but not dated for this seat. */
  readonly at: string | null;
  /** Where the fact came from, so the screen can say "from the lead" / "from the record". */
  readonly src: StorySource | null;
  /** A Zoho user id the step names (the KAM), never a name. */
  readonly who?: string | null;
}
export interface StoryTouches {
  readonly total: number;
  readonly byChannel: Readonly<Record<string, number>>;
  readonly replies: number;
  readonly first: string | null;
  readonly last: string | null;
}
export interface InvestorStory {
  /** "lead": the origin lead's own stamps were read on this person's token; "contact": only the Contact's stamps. */
  readonly leadSide: "lead" | "contact";
  readonly steps: readonly StoryStep[];
  readonly touches: StoryTouches | null;
}

const LEAD_FIELDS = Object.freeze(["Created_Time", "Lost_At", ...RUNGS.map((r) => r.field)]);
const TOUCH_FIELDS = Object.freeze(["Lead", "Channel", "Occurred_At", "Is_Reply"]);
const CHANNEL_NAME: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.values(TOUCH_CHANNEL).map((v) => [v, v])));
const at = (r: ZohoRecord | null, f: string): string | null => {
  const v = r?.[f];
  return typeof v === "string" && ISO.test(v) ? v : null;
};
const earliest = (xs: readonly (string | null | undefined)[]): string | null => xs.filter((x): x is string => !!x).sort()[0] ?? null;
const latest = (xs: readonly (string | null | undefined)[]): string | null => xs.filter((x): x is string => !!x).sort().slice(-1)[0] ?? null;

/** The story from what was read. Pure: the record reader passes the reads in; tests pass synthetic rows. */
export function storyOf(input: {
  readonly contact: Pick<ContactRow, "saidYesAt" | "createdAt" | "kamId" | "kamSince">;
  readonly lead: ZohoRecord | null;
  readonly allotments: readonly Pick<AllotmentRow, "Allocation_Status" | "Issued_On">[];
  /** Matched receipts and the money totals — only for a seat whose record shows Money; null otherwise. */
  readonly money: { readonly receipts: readonly ReceiptRow[]; readonly paid: number; readonly due: number } | null;
  readonly touches: StoryTouches | null;
  /** D137 ruling 3: the earliest Converted_At stamp on the investor's Reserved allotments (converted in full), or null. */
  readonly convertedAt?: string | null;
}): InvestorStory {
  const { contact: c, lead: L, money } = input;
  const steps: StoryStep[] = [];
  const add = (s: StoryStep) => steps.push(Object.freeze(s));
  if (L) {
    add({ k: "captured", t: "Lead captured", side: "lead", done: true, at: at(L, "Created_Time"), src: "lead" });
    for (const r of RUNGS.filter((x) => x.n <= 5)) {
      const v = at(L, r.field);
      add({ k: r.field, t: r.t, side: "lead", done: !!v || (r.n === 5 && !!c.saidYesAt), at: v ?? (r.n === 5 ? c.saidYesAt : null), src: v ? "lead" : r.n === 5 && c.saidYesAt ? "contact" : null });
    }
  } else {
    add({ k: "Said_Yes_At", t: "Investor said yes", side: "lead", done: !!c.saidYesAt, at: c.saidYesAt, src: c.saidYesAt ? "contact" : null });
  }
  const live = input.allotments.filter((a) => a.Allocation_Status !== "Cancelled");
  const issued = live.filter((a) => a.Allocation_Status === "Issued");
  const matchedIn = (money?.receipts ?? []).filter((x) => x.matched && x.kind !== "Refund" && !x.reversalOf);
  const advanceOn = earliest(matchedIn.filter((x) => x.kind === "Advance").map((x) => x.on)) ?? earliest(matchedIn.map((x) => x.on));
  const stamp = (f: string) => at(L, f);
  const reservedAt = stamp("Reserved_At"), paidAt = stamp("Fully_Paid_At"), allocAt = stamp("Allocated_At"), onboardAt = stamp("Onboarded_At");
  add({ k: "Reserved_At", t: "Reserved — 10% in", side: "investor", done: !!reservedAt || live.length > 0 || matchedIn.length > 0,
    at: reservedAt ?? advanceOn, src: reservedAt ? "lead" : advanceOn ? "receipt" : live.length ? "allotment" : null });
  /* W8-FIN-1: "Fully paid" is the conversion (D137 ruling 3 / D138), never the money totals — a paid-up investor whose conversion the
     supplementary gate refused is still "not yet". Ticked by the lead's Fully_Paid_At stamp, the allotment's Converted_At, or an
     Issued allotment (issuance follows the full payment). */
  const conv = input.convertedAt ?? null;
  add({ k: "Fully_Paid_At", t: "Fully paid", side: "investor", done: !!paidAt || issued.length > 0 || !!conv,
    at: paidAt ?? conv, src: paidAt ? "lead" : issued.length || conv ? "allotment" : null });
  const issuedOn = earliest(issued.map((a) => a.Issued_On));
  add({ k: "Allocated_At", t: "Allocated", side: "investor", done: !!allocAt || issued.length > 0,
    at: allocAt ?? issuedOn, src: allocAt ? "lead" : issued.length ? "allotment" : null });
  add({ k: "KAM_Since", t: "Account manager assigned", side: "investor", done: !!c.kamId, at: c.kamId ? c.kamSince : null, src: c.kamId ? "contact" : null, who: c.kamId });
  add({ k: "Onboarded_At", t: "Onboarded", side: "investor", done: !!onboardAt, at: onboardAt, src: onboardAt ? "lead" : null });
  return Object.freeze({ leadSide: L ? "lead" as const : "contact" as const, steps: Object.freeze(steps), touches: input.touches });
}

/** The touches on one lead, summarised (a reply is its own count; Occurred_At orders first and last). */
export function touchSummary(rows: readonly ZohoRecord[]): StoryTouches {
  const byChannel: Record<string, number> = {};
  let total = 0, replies = 0;
  const when: string[] = [];
  for (const r of rows) {
    const o = at(r, "Occurred_At");
    if (r.Is_Reply === true) replies++;
    const ch = typeof r.Channel === "string" ? CHANNEL_NAME[r.Channel] : undefined;
    if (ch && r.Is_Reply !== true) { byChannel[ch] = (byChannel[ch] ?? 0) + 1; total++; }
    if (o) when.push(o);
  }
  return Object.freeze({ total, byChannel: Object.freeze(byChannel), replies, first: earliest(when), last: latest(when) });
}

/** Read the story's two lead-side reads on the person's own token; anything Zoho refuses or fails narrows the story. */
export async function readStory(
  crm: Pick<ZohoClient, "getRecord" | "coql">, cred: UserCredential,
  input: Omit<Parameters<typeof storyOf>[0], "lead" | "touches"> & { readonly leadId: string | null },
  signal?: AbortSignal,
): Promise<InvestorStory> {
  let lead: ZohoRecord | null = null, touches: StoryTouches | null = null;
  const id = input.leadId && RECORD_ID.test(input.leadId) ? input.leadId : null;
  if (id) {
    try {
      const g = await crm.getRecord(cred, LEADS, id, { fields: LEAD_FIELDS, signal });
      if (g.ok && g.value && g.value.id === id) lead = g.value;
    } catch { lead = null; }
    /* touches only for a lead this person reads: an empty answer about a lead they cannot see would read as "never touched" */
    if (lead) try {
      const t = await crm.coql(cred, `select ${TOUCH_FIELDS.join(", ")} from Touches where Lead = '${id}' order by Occurred_At desc limit 0, 200`, { signal });
      if (t.ok) touches = touchSummary(t.value.records);
    } catch { touches = null; }
  }
  return storyOf({ ...input, lead, touches });
}
