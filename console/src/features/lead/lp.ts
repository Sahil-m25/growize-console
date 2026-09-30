/* ── 3. ONE INVESTOR — D56–D58, the lead page's pure rules. ir-merged.js 4988–5330 (lp*),
   10453–10474 (EMTPL/EMMAT/emTplOK/emTplFor), 2894 (UNDOWHY), 2600 (NEEDS), 228–237 (LADDER.ask).
   Everything here is a function of the lead and the clock; the page and the reducer both ask it,
   so the button and the write can never disagree. ─────────────────────────────────────────── */

import { LADDER, ST } from "@/domain";
import type { Lead } from "@/domain";
import type { FollowupDraft } from "@/lib/store";

export const LP_SHORT = ["Captured", "First touch", "Qualified", "Engaged", "Said yes", "10% in", "Paid", "Allocated", "Onboarded"] as const;

/* lpNextChoices(l) — D60: nothing goes out before the NDA is back signed, so the sends are not
   offered until then */
export function lpNextChoices(l: Lead, nda: boolean): string[] {
  const g = (a: string[]) => a.filter((t) => nda || !["Send the deck", "Send the yield note"].includes(t));
  if (l.done < ST.QUALIFIED) return g(["Call back", "Send the deck", "Nurture — check back"]);
  if (l.done < ST.CONVERTED) return g(["Book a webinar", "Book a farm visit", "Send the yield note", "Call back"]);
  if (l.done < ST.RESERVED) return ["Chase the paperwork", "Call back", "Office meeting"];
  if (l.done < ST.PAID) return ["Chase the balance", "Chase the paperwork", "Call back"];
  return ["Onboarding call", "Call back"];
}

export const LP_WHEN: readonly (readonly [string, number])[] = [["Today", 0], ["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7]];

/* D58 — what each next step becomes in Zoho CRM */
export type ZK = "call" | "meeting" | "task";
const ZKIND: Record<string, ZK> = { "Call back": "call", "Onboarding call": "call", "Farm visit": "meeting", "Office meeting": "meeting" };
export const zKind = (t: string | null | undefined): ZK => ZKIND[t || ""] || "task";
export const ZLABEL: Record<ZK, string> = { call: "Scheduled call", meeting: "Meeting", task: "Task" };
export const LP_SLOTS: readonly (readonly [string, string])[] = [["Morning", "10:00"], ["Afternoon", "15:00"], ["Evening", "18:00"]];

/* lpPrefSlot(l) — a preference said in words: the preference field first, then the latest note */
export function lpPrefSlot(l: Lead, latestNote: string | null | undefined): { slot: string; src: "preference" | "note" } | null {
  const p = (l as Lead & { contactPreference?: unknown }).contactPreference;
  const pref = typeof p === "string" ? p
    : p && typeof p === "object" ? [(p as Record<string, string>).time, (p as Record<string, string>).window, (p as Record<string, string>).note].filter(Boolean).join(" ") : "";
  for (const [src, txt] of [["preference", pref], ["note", latestNote || ""]] as const) {
    const s = String(txt).toLowerCase();
    if (/evening|after\s*(5|6|7)\s*(pm)?|not .*before\s*(5|6)/.test(s)) return { slot: "18:00", src };
    if (/afternoon|after\s*(2|3)\s*(pm)?|post.?lunch/.test(s)) return { slot: "15:00", src };
    if (/morning|before\s*(11|12)|early/.test(s)) return { slot: "10:00", src };
  }
  return null;
}

export const HESITANT: readonly string[] = ["Not now"];
export const DEAD: readonly string[] = ["Not interested", "Wrong number"];

/* the logging flow's state, per person and lead — LPFLOW/LPFROM/LPOBJ/LPEARLY/LPLOSE/LPDAY and
   the lead's fuDraft, held in `ui.LP` so the one flow open at a time survives every repaint */
export type LpDraft = FollowupDraft & { error?: string; task?: { t: string; by: string; tm?: string } | null };
export type LpFlow = {
  who: string;
  id: string;
  flow: "log" | "email";
  from?: string | null;       /* LPFROM — the channel the flow was opened from, so it is never asked */
  obj?: boolean;              /* LPOBJ — "what held them back" answered (or skipped) */
  early?: boolean;            /* LPEARLY — the time picker is open */
  lose?: false | "keep";      /* LPLOSE */
  day?: boolean;              /* LPDAY — the date is picked and the time question is open */
  d: LpDraft;
};

/* lpPickStep(l,d,t) */
export function lpPickStep(d: LpDraft, t: string, channelFor: (t: string) => string, allowed: (k: string) => boolean): LpDraft {
  const m = channelFor(t);
  return { ...d, t, nch: (["msg", "email", "call", "visit"].includes(m) && allowed(m) ? m : "other") as LpDraft["nch"], keep: false, noNext: false };
}

/* Saving with the scheduled step kept must not fall back to a default "Call back" (lpPickStep resets keep). */
export const lpNeedsStep = (d: LpDraft): boolean => !d.t && !d.keep;
/* fuValidate: a next step dated today needs a time still ahead — the flow says so and saves nothing. */
export const lpStepPast = (nd: string | undefined, tm: string, now: Date): boolean =>
  !!tm && !!nd && new Date(nd + "T" + tm + ":00") < now;

/* ---- the email composer — EMTPL, EMMAT, emTplOK, emTplFor ---- */
export const EMTPL: Record<string, { t: string; s: string; b: string }> = {
  intro: { t: "Introduction", s: "Growize — managed aeroponic farm units", b: "Dear {first},\n\nThank you for your time. As discussed, Growize offers managed, tray-based aeroponic farm units with ARL handling operations end to end.\n\nI'd be glad to walk you through the numbers on a short call this week. What time suits you?\n\nRegards,\n{me}" },
  deck: { t: "Deck follow-up", s: "The Growize deck, as promised", b: "Dear {first},\n\nPlease find the Growize overview we discussed. Happy to answer any questions or set up a farm visit.\n\nRegards,\n{me}" },
  webinar: { t: "Webinar invite", s: "Invitation: Growize investor webinar", b: "Dear {first},\n\nWe're hosting a short investor webinar with the farm team. Would you like me to reserve a place for you?\n\nRegards,\n{me}" },
  paper: { t: "Paperwork reminder", s: "Your Growize documents", b: "Dear {first},\n\nA gentle reminder that your documents are waiting for your signature. Do let me know if anything needs clarifying.\n\nRegards,\n{me}" },
  balance: { t: "Balance reminder", s: "Completing your Growize allocation", b: "Dear {first},\n\nThank you for your reservation. A reminder that the balance completes your allocation. I'm happy to help with anything you need.\n\nRegards,\n{me}" },
};
export const EMMAT: Record<string, { item: string; say: string }> = {
  deck: { item: "Pitch deck", say: "the deck" }, webinar: { item: "Webinar invite", say: "the webinar invite" },
};
export const emTplOK = (k: string, nda: boolean): boolean => !!EMTPL[k] && (!EMMAT[k] || nda);
export const emTpls = (nda: boolean): [string, { t: string; s: string; b: string }][] => Object.entries(EMTPL).filter(([k]) => emTplOK(k, nda));
export function emTplFor(l: Lead, nda: boolean, sent: Record<string, string> | undefined): string {
  const k = l.done < ST.QUALIFIED ? "intro" : l.done < ST.CONVERTED ? "deck" : l.done < ST.RESERVED ? "paper" : "balance";
  return !emTplOK(k, nda) || (EMMAT[k] && (sent || {})[EMMAT[k].item]) ? "intro" : k;
}
export type EmDraft = { tpl: string; s: string; b: string; err: string; head?: boolean; body?: boolean };
export function emUse(l: Lead, k: string, meName: string, prev?: EmDraft): EmDraft {
  const T = EMTPL[k];
  const f = (s: string) => s.replace(/\{first\}/g, l.n.split(" ")[0]).replace(/\{me\}/g, meName);
  return { head: prev?.head, body: prev?.body, tpl: k, s: f(T.s), b: f(T.b), err: "" };
}

/* the un-tick's closed list of reasons — UNDOWHY */
export const UNDOWHY = ["Ticked on the wrong lead", "Ticked the wrong rung", "It did not actually happen",
  "The investor went back on it", "Recorded before the evidence was in"] as const;

/* NEEDS.scorecard — what the Qualified rung says it needs */
export const NEEDS = {
  scorecard: {
    t: "a qualification scorecard",
    heldT: "A dated next step is on the lead",
    heldNo: "No next action and no date",
    fix: "Set the next step",
    say: "The scorecard is filled in — budget, timeline and who signs",
    foot: "scorecard done",
    note: "scorecard confirmed by the IR, not held in this console",
  },
} as const;
export const needOf = (l: Lead | null | undefined) =>
  l && l.done < LADDER.length && LADDER[l.done].needs === "scorecard" ? NEEDS.scorecard : null;

/* LADDER[i].ask — the three rungs that cannot be taken back (ir-merged.js 228–237). Keyed by the
   rung's title so @/domain's LADDER does not have to grow a field only this page reads. */
export const RUNGASK: Record<string, string> = {
  "Reserved — 10% in": "the balance clock starts, and from then on a payment stands against the lead — which is itself what stops the un-tick",
  "Fully paid": "allocation and the transfer to the investor database both wait on this one rung, and the receipt underneath it cannot be un-ticked",
  "Onboarded": "the record closes: every rung is done, nobody is custodian, and this console accepts no further write on the lead — including taking this one back",
};

/* the Investor file: one drawer, four tabs */
export const FILETABS: readonly (readonly [string, string])[] = [["history", "History"], ["owner", "People & details"], ["material", "Paperwork & material"], ["money", "Payments"]];

export const LPPCH: Record<string, string> = { call: "call", msg: "WhatsApp", email: "email" };
export const lpPaperName = (rk: string): string => (rk === "nda" ? "NDA" : "Supplementary agreement");
