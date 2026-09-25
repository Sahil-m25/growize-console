"use client";

/* THE LAST THREE WEEKS OF ONE CHECK, OFF ITS OWN RECORD — never a random walk.
   Ports `ref/03-app.js` 5259–5280 (`ckWhen`, `ckHist`, `ckDays`, `ckBar`).

   Be precise about what the strip is: it is not twenty-one observations — this console does not poll
   anything. It is the check's own record — the date its state began, the state before it, and any
   single day somebody had to step in — drawn day by day so a change of state has a position you can
   point at. Deterministic, never sampled and never random. */

import { CKDAYS } from "@/domain";
import type { Check, CheckState } from "@/domain";
import { dayOf, dAdd, dISOtoDisp, dOf, iso, isoDay, MON, when } from "@/lib/format";

export type CkDay = { d: Date; s: CheckState };

export const ckWhen = (c: Check, NOW: Date): Date | null =>
  isoDay.test(c.since || "") ? new Date(c.since + "T00:00:00") : when(c.since, NOW);

export function ckHist(c: Check, NOW: Date): CkDay[] {
  const from = ckWhen(c, NOW);
  const out: CkDay[] = [];
  for (let i = CKDAYS - 1; i >= 0; i--) {
    const d = dAdd(NOW, -i);
    const k = iso(d);
    out.push({
      d,
      s: (c.blip || []).indexOf(k) >= 0 ? "warn" : from && d >= from ? c.st : c.was || "ok",
    });
  }
  return out;
}

/* from the date on the record, not from the edge of the strip — a strip 21 days wide cannot say how
   long something has been broken, and 21 sitting next to "since 16 Jul" is just wrong */
export function ckDays(c: Check, NOW: Date): number | null {
  const w = ckWhen(c, NOW);
  if (!w) return null;
  /* a run of clean days ends at the last day that was not one — 88 days clean beside an amber bar
     four days ago is the kind of small lie a status page cannot afford */
  const blip = (c.blip || [])
    .map(dOf)
    .filter((x): x is Date => !!x)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const from = c.st === "ok" && blip && blip > w ? blip : w;
  const d = Math.round((dayOf(NOW).getTime() - from.getTime()) / 864e5);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}

/* WHERE THE NUMBER BESIDE A CHECK IS COUNTED FROM — ckFrom/ckFromT, redesigned prototype line
   ~10620. ckDays restarts a working check's run at its last amber day, so the date printed beside
   it has to be that same day, never the date the check was first recorded. */
export function ckFrom(c: Check, NOW: Date): Date | null {
  const w = ckWhen(c, NOW);
  const blip = (c.blip || [])
    .map(dOf)
    .filter((x): x is Date => !!x)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return c.st === "ok" && blip && w && blip > w ? blip : w;
}

export function ckFromT(c: Check, NOW: Date): string {
  const d = ckFrom(c, NOW);
  if (d) return String(d.getDate()).padStart(2, "0") + " " + MON[d.getMonth()];
  return isoDay.test(c.since || "") ? dISOtoDisp(c.since, NOW) : c.since || "—";
}
