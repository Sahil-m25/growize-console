/* The empty book: what the product holds before anything is recorded. `npm run dev` and every
   production build start here — no people, no leads, no events, no investors. */

import type { Plan } from "@/domain";
import { emptyImData } from "@/lib/im";
import { clockDay } from "./clock";
import type { Dataset, FinanceMirror } from "./types";

export const EMPTY_PLAN: Plan = {
  masterUnits: 0, acres: 0, byWhen: "",
  baseline: { units: 0, src: "", warn: false },
  grain: "month",
  periods: [],
  rates: { lead2qual: 0, qual2res: 0, res2paid: 0 },
  eventDays: 0, eventLen: 0, eventShare: 0,
  sla: { firstTouch: "", day3: 0, packWeeks: 0 },
};

export const EMPTY_FINMIRROR: FinanceMirror = { source: "Investors pages", mode: "empty", accounts: [] };

/** Every collection empty; the clock is the one given (the lead side's and the Investors side's). */
export function emptyDataset(now: string, imNow: string = now): Dataset {
  return {
    NOW: now, TODAY: clockDay(now),
    LEADS: [], PEOPLE: {}, SIGNINS: [], PLAN: structuredClone(EMPTY_PLAN), EVENTS: [], LOG: [], DOCS: [],
    INV: { total: 0, released: 0, by: "", at: "", src: "" },
    TEMP: [], GRANT: {}, COVER: {}, AVAIL: {}, PAY: {}, CLAIM: {}, CLAIMARCHIVE: {}, REQ: {}, EXT: {},
    XFER: [], ACCT: {}, ARLSEQ: 0, PAPER: {}, SENT: {}, NOTES: {}, CALLS: {}, PACK: {}, PACKAT: {},
    RECOV: {}, SHEET: {}, INTERACTIONS: {}, SHEETNAMES: [], SHEETNOTES: [],
    FINMIRROR: structuredClone(EMPTY_FINMIRROR), CHECKS: [],
    LEAD: "", EVID: "",
    im: emptyImData(imNow),
  };
}

/** How many records a dataset holds, collection by collection — zero everywhere for the empty book. */
export function recordCount(ds: Dataset): number {
  const n = (v: unknown): number => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);
  const lead = [ds.LEADS, ds.PEOPLE, ds.SIGNINS, ds.PLAN.periods, ds.EVENTS, ds.LOG, ds.DOCS, ds.TEMP, ds.GRANT, ds.COVER,
    ds.AVAIL, ds.PAY, ds.CLAIM, ds.CLAIMARCHIVE, ds.REQ, ds.EXT, ds.XFER, ds.ACCT, ds.PAPER, ds.SENT, ds.NOTES, ds.CALLS,
    ds.PACK, ds.PACKAT, ds.RECOV, ds.SHEET, ds.INTERACTIONS, ds.SHEETNAMES, ds.SHEETNOTES, ds.FINMIRROR.accounts, ds.CHECKS ?? []]
    .reduce((a, v) => a + n(v), 0) + ds.INV.total;
  const im = ds.im;
  const inv = [im.P, im.SIGNINS, im.IRN, im.FARMS, im.INV, im.CONTACT, im.TXN, im.DOCS, im.INBOX, im.ANS, im.OUTBOX,
    im.TKT, im.FIELD, im.UPD, im.LOG, im.APP].reduce((a, v) => a + n(v), 0);
  return lead + inv;
}
