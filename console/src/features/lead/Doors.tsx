"use client";

/* ── THE DOORS — leadDoors. 03-app.js 2963–2992 ─────────────────────────────────────────────
   The lead page shows the two things it is opened for and makes everything else a labelled door;
   the count is on the door, so you can see whether it is worth opening without opening it, and
   opening it does not move the page.

   `leadDoors(ctx, l, packWeeks)` in @/lib/selectors answers the DATA — which doors, what each one
   says, and the class its value carries. This is the row of buttons.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { GOALS } from "@/domain";
import type { Lead } from "@/domain";
import { leadDoors } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { DrawerKind } from "@/lib/store";

/* leadDoors() (selectors/leads.ts) still returns history/notes/paper/details/call as doors — the
   redesign moved those four into the lead page's own work-details-links row (History → Timeline,
   Notes, Paperwork → Documents, Details → Edit/View details) and dropped "Last call" entirely, so
   this filters them out here rather than opening two ways to the same place. See
   crossOwnerRequests for folding the filter and the redesign's label/value text into leadDoors()
   itself, which still speaks the pre-redesign copy ("Money"/"Said to be paid"/etc). */
const HIDDEN: readonly string[] = ["history", "notes", "paper", "details", "call"];

/* ic('d-'+k) — ir-console-redesigned.html 2471-2483. `Icon` (components/ui, shell-owned) only
   carries the top-bar set; its own header invites a page that wants the rest of the prototype's
   set to add its own keys the same way rather than editing that file, so the door glyphs live here
   as a local, page-owned copy of just the entries leadDoors() can produce. */
const DOOR_PATHS: Record<string, string> = {
  investorcopy: "M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16",
  material: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  acct: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  pack: "M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12",
  money: "M6 3h12M6 8h12M6 13l8.5 8M6 13h3c6.667 0 6.667-10 0-10",
  hold: "M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  owner: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  claim: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3",
  lost: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7",
};

function DoorIcon({ k }: { k: string }) {
  const d = DOOR_PATHS[k];
  if (!d) return null;
  return (
    <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function Doors({ l }: { l: Lead }) {
  const { state, dispatch } = useConsole();
  /* GOALS is the one reader every derived plan figure goes through, so Goals is the only place any
     of them change — the produce pack is `GOALS(PLAN).packWeeks`, never a literal 4 */
  const D = leadDoors(state, l, GOALS(state.PLAN).packWeeks).filter((x) => !HIDDEN.includes(x.k));
  const open = (k: string) => !!(state.DRW && state.DRW.k === k && state.DRW.id === l.id);
  return (
    <div className="doors">
      {D.map((x) => (
        <button
          type="button"
          key={x.k}
          className={`door ${open(x.k) ? "on" : ""}`}
          id={`door-${x.k}`}
          onClick={() => dispatch({ type: "openDrawer", k: x.k as DrawerKind, id: l.id })}
          aria-haspopup="dialog"
          aria-expanded={open(x.k) ? "true" : "false"}
          title="Opens below"
        >
          <span className="dt"><DoorIcon k={x.k} />{x.t}</span>
          <span className={`dv ${x.cls}`}>{String(x.v)}</span>
        </button>
      ))}
    </div>
  );
}
