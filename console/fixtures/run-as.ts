/* runAs(ds, who, actions) — a fixture that, in the prototype, signs a person in and makes a write
   (`signIn('rohit'); loadSheet('E-04'); endSession()`) runs the console's own reducer here, as that
   person, and copies the records the write changed back into the dataset. No business rule is
   written twice: a write the reducer refuses throws, so a fixture can never silently not apply. */

import type { Dataset } from "@/lib/data/types";
import { clockPin, pinClock } from "@/lib/format";
import { initialState, reducer, type Action, type ConsoleState } from "@/lib/state";
import type { PersonKey } from "@/domain";

/** state slice → dataset key, for every record the reducer can write */
const SLICES: [keyof ConsoleState, keyof Dataset][] = [
  ["LEADS", "LEADS"], ["PEOPLE", "PEOPLE"], ["SIGNINS", "SIGNINS"], ["PLAN", "PLAN"], ["EVENTS", "EVENTS"],
  ["LOG", "LOG"], ["PAPER", "PAPER"], ["DOCS", "DOCS"], ["INV", "INV"], ["TEMP", "TEMP"], ["CAPS", "GRANT"],
  ["COVER", "COVER"], ["AVAIL", "AVAIL"], ["PAY", "PAY"], ["ACCT", "ACCT"], ["CLAIM", "CLAIM"],
  ["CLAIMARCHIVE", "CLAIMARCHIVE"], ["REQ", "REQ"], ["EXT", "EXT"], ["XFER", "XFER"], ["ARLSEQ", "ARLSEQ"],
  ["SENT", "SENT"], ["NOTES", "NOTES"], ["CALLS", "CALLS"], ["PACK", "PACK"], ["PACKAT", "PACKAT"],
  ["RECOV", "RECOV"], ["SHEET", "SHEET"], ["SHEETNAMES", "SHEETNAMES"], ["SHEETNOTES", "SHEETNOTES"],
  ["INTERACTIONS", "INTERACTIONS"], ["FINMIRROR", "FINMIRROR"], ["IM", "im"],
];

const json = (v: unknown) => JSON.stringify(v);

export function runAs(ds: Dataset, who: PersonKey, actions: Action[]): void {
  const was = clockPin();
  pinClock(ds.CLOCKPIN);   // a clock fixture applied earlier stamps these writes at its hour
  try {
    let s = reducer(initialState(ds), { type: "signIn", k: who });
    if (!s.authed || s.WHO !== who) throw new Error(`fixture: ${who} cannot sign in`);
    const before = s;
    for (const a of actions) {
      const next = reducer(s, a);
      if (next === s) throw new Error(`fixture: ${a.type} as ${who} changed nothing`);
      s = next;
    }
    /* copy back only what the writes changed, so nothing the state revives on load (the pinned
       cover and grant dates) is written back over the book's own text */
    const out = ds as unknown as Record<string, unknown>;
    for (const [k, d] of SLICES) if (json(s[k]) !== json(before[k])) out[d] = structuredClone(s[k]);
  } finally {
    pinClock(was);
  }
}
