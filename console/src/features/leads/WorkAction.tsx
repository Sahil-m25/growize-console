"use client";

/* ── workAction(l,u) — the quiet one-button call to action on a leads-table row ─────────────────
   ir-console-redesigned.html:6765-6774:
     if(!l.own&&u.rec&&u.rec.kind==="assign") ... "Assign to me"
     if(!l.own&&canAssign()) ... "Assign owner"
     if(u.rec&&u.rec.kind==="consent"&&canWork(l)) ... "Record permission"
     if(u.rec&&u.rec.kind==="paper") ... isFin()?u.act:"Review paperwork"
     if(u.rec&&u.rec.kind==="claim") ... "View payment status"
     if(noNext(l)&&canPlan(l)) ... "Set next step"
     if(u.kind==="stage"&&canWork(l)&&stepOwner(l.done,l)&&gateMet(l)) ... "Confirm <stage>"
     if(canWork(l)) ... "Record follow-up"
     else ... "View investor"

   `nextUp`'s `kind`/`rec.kind` taxonomy (src/lib/selectors/leads.ts) now carries the redesigned
   prototype's full set — `NextUp.kind` and `NextRec`'s "claim"/"plan"/"followup" all exist — so
   every branch above reads straight off `u`. "Record follow-up" now opens the registered
   `"p:followup"` drawer (`./followupDrawer.tsx`) with a seeded `FollowupDraft`, matching the
   prototype's `openFollowup(id,chanOf(l))`. One thing still can't be exact:
     - "Record permission" opens the existing `details` drawer (no navigation, matching the
       prototype's `openDetails` staying on the same screen) — that drawer is read-only today, no
       consent tab to seed; a cross-owner gap in `src/features/lead/drawers`, not this file's to
       close. See crossOwnerRequests.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { LADDER } from "@/domain";
import { useApiMode } from "@/lib/data/api";
import { useJourneyWrites } from "@/lib/data/endpoints/journey";
import { useAssignToMe } from "@/lib/data/endpoints/ownership";
import type { Lead } from "@/domain";
import { canAssign, canPlan, canWork, chanOf, gateMet, isFin, noNext, stepOwner } from "@/lib/selectors";
import type { NextUp } from "@/lib/selectors";
import type { DrawerKind } from "@/lib/store";
import { useConsole } from "@/lib/store";
import { useGoLead } from "./nav";
import { buildFollowupDraft } from "./followupDrawer";

export function WorkAction({ l, u }: { l: Lead; u: NextUp }) {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("leads");
  /* the wired presses (ir-write-map.md C2 tick, C3 assign): fixture the reducer; live the route, then reloadData();
     a live refusal is said beside the button, in the route's words */
  const live = useApiMode() === "live";
  const { assign } = useAssignToMe();
  const jw = useJourneyWrites();
  const [err, setErr] = useState<string | null>(null);
  const said = (r: { ok: true } | { ok: false; error: string }) => { if (live) setErr(r.ok ? null : r.error); };
  const refusal = err ? <span className="tag late" role="alert">{err}</span> : null;

  if (!l.own && u.rec?.kind === "assign")
    return (
      <>
        <button type="button" className="act" onClick={() => void assign(l.id).then(said)}>
          Assign to me
        </button>
        {refusal}
      </>
    );
  if (!l.own && canAssign(state))
    return (
      <button type="button" className="act" onClick={() => goLead(l.id, "owner")}>
        Assign owner
      </button>
    );
  if (u.rec?.kind === "consent" && canWork(state, l))
    return (
      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id, seed: { DTAB: "permission" } })}>
        Record permission
      </button>
    );
  if (u.rec?.kind === "paper")
    return (
      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "paper", id: l.id })}>
        {isFin(state.ROLE) ? u.act || "Review paperwork" : "Review paperwork"}
      </button>
    );
  if (u.rec?.kind === "claim")
    return (
      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "claim", id: l.id })}>
        View payment status
      </button>
    );
  if (noNext(l) && canPlan(state, l))
    return (
      <button
        type="button"
        className="act"
        onClick={() => {
          dispatch({ type: "seedNext", id: l.id });
          dispatch({ type: "openDrawer", k: "next", id: l.id });
        }}
      >
        Set next step
      </button>
    );
  if (u.kind === "stage" && canWork(state, l) && stepOwner(state, l.done, l) && gateMet(state, l))
    return (
      <>
        <button type="button" className="act" onClick={() => void jw.tick(l).then(said)}>
          Confirm {LADDER[l.done]?.t || "stage"}
        </button>
        {refusal}
      </>
    );
  if (canWork(state, l))
    return (
      <button
        type="button"
        className="act"
        onClick={() =>
          dispatch({
            type: "openDrawer",
            k: "p:followup" as DrawerKind,
            id: l.id,
            seed: { FU: buildFollowupDraft(state, l, chanOf(state, l)) },
          })
        }
      >
        Record follow-up
      </button>
    );
  return (
    <button type="button" className="btn" onClick={() => goLead(l.id)}>
      View investor
    </button>
  );
}
