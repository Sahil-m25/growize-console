"use client";

/* followupContext(l) — ir-console-redesigned.html 6057-6068 (followupContext/fuLatest). Reads the
   same `fuLatest`/`fuHeard`/`latestNote` the "p:followup" panel (`@/features/today/work`,
   `@/features/leads/followupDrawer`) reads for its own inline context block, so the lead page's
   "Investor context" card never drifts from what that drawer says happened last. */

import type { Lead } from "@/domain";
import { useConsole } from "@/lib/store";
import { FUCHANNELS, fuHeard, fuLatest, latestNote } from "@/features/today/work";

/* fuPreference(l) — ir-console-redesigned.html:6041-6046. This port's `Lead.contactPreference` is
   always a plain string (never the object form `{channel,time,note}` the prototype also accepts),
   so this is that function's string branch and its fallback sentence only. Exported so the two
   cross-owner call sites carrying the same hardcoded sentence — `features/leads/followupDrawer.tsx`
   and `features/today/TodayPage.tsx` — can import it instead of duplicating it (see
   crossOwnerRequests); until they do, only this card reads the real value. */
export function fuPreference(l: Lead): string {
  return l.contactPreference || "No preferred contact time recorded";
}

export function FollowupContext({ l }: { l: Lead }) {
  const { state } = useConsole();
  const last = fuLatest(state, l);
  const heard = fuHeard(state, l);
  const note = latestNote(state, l);
  return (
    <div className="fucontext">
      <div className="sm">
        <b>Last interaction</b>{" "}
        {last ? `${FUCHANNELS[last.channel] || last.channel} · ${last.outcome} · ${last.at}` : "No contact recorded"}
      </div>
      {heard ? (
        <div className="sm" style={{ marginTop: "7px" }}>
          <b>Previously raised</b> {heard.obj!.join(", ")} · {heard.at}
        </div>
      ) : null}
      <div className="sm" style={{ marginTop: "7px" }}>
        <b>Latest note</b> {note || "No conversation note yet"}
      </div>
      <div className="sm" style={{ marginTop: "7px" }}>
        <b>Contact preference</b> {fuPreference(l)}
      </div>
    </div>
  );
}
