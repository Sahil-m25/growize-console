/* ── the two doors off Numbers · Funnel — `numStageSteps`/`numSlowest`/`numAgeBands`/`numAged`,
   redesigned `ir-console-redesigned.html` 9516–9566. Shared between the door row (`NumbersLive`,
   which only needs the one fact on each door's face) and the panel bodies (`drawers.tsx`, which
   draw the full table) so the two can never drift from the same arithmetic. ─────────────────── */

import { BANDS, LADDER } from "@/domain";
import type { Lead } from "@/domain";
import { dayGap, whenT } from "@/lib/format";
import { active, bandOf, median, numBook, quietDays } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";

export type StageStep = {
  from: string; to: string; n: number; med: number | null; lo: number | null; hi: number | null;
  sitting: { l: Lead; d: number }[]; wait: number | null;
};

export function numStageSteps(state: ConsoleState): StageStep[] {
  const NOW = state.NOW, B = numBook(state);
  return LADDER.slice(0, -1).map((s, k) => {
    const made = B.filter(l => l.done >= k + 2 && l.at[k] && l.at[k + 1]);
    const ds = made.map(l => dayGap(whenT(l.at[k], NOW), whenT(l.at[k + 1], NOW)))
      .filter((x): x is number => x != null && x >= 0);
    const sitting = B.filter(l => l.done === k + 1 && active(l) && l.at[k])
      .map(l => ({ l, d: dayGap(whenT(l.at[k], NOW), NOW) ?? 0 }))
      .sort((a, b) => b.d - a.d);
    return { from: s.t, to: LADDER[k + 1].t, n: ds.length, med: median(ds),
      lo: ds.length ? Math.min(...ds) : null, hi: ds.length ? Math.max(...ds) : null,
      sitting, wait: median(sitting.map(x => x.d)) };
  });
}

/* the step people wait longest on — the one fact the "Time in stage" door is pressed for */
export const numSlowest = (state: ConsoleState): StageStep | null =>
  numStageSteps(state).filter(t => t.n && t.med != null)
    .sort((a, b) => (b.med as number) - (a.med as number))[0] ?? null;

export type AgeRow = (string | number)[];

export function numAgeBands(state: ConsoleState): AgeRow[] {
  const live = numBook(state).filter(active);
  /* Primitive B's Numbers caller — this used to bucket `l.at[0]`, the capture date, which reads a
     lead that has been touched every week since capture as just as "aged" as one nobody has
     called back. `quietDays` is how long since the book last did anything with the name, so the
     column now measures that instead; see the header text change in `./drawers.tsx`. */
  const age = (l: Lead): number | null => quietDays(state, l);
  const buckets: [string, number, number][] =
    [["0–7 d", 0, 7], ["8–14 d", 8, 14], ["15–30 d", 15, 30], ["31 d +", 31, 1e9]];
  return buckets.map(([t, lo, hi]) => {
    const L = live.filter(l => { const a = age(l); return a != null && Math.floor(a) >= lo && Math.floor(a) <= hi; });
    return [t, ...BANDS.slice(0, 3).map(b => L.filter(l => bandOf(Math.max(1, l.done)).t === b.t).length), L.length];
  });
}

/* how much of the active book has been sitting there over a month — the fact the "Age" door is for */
export const numAged = (state: ConsoleState): number => {
  const r = numAgeBands(state).find(x => x[0] === "31 d +");
  return r ? (r[r.length - 1] as number) : 0;
};
