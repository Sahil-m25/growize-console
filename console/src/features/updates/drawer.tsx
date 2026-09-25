"use client";

/* THE BELL — DRAWERS.updates, redesigned prototype 12053–12064 — plus its door-panel companion,
   PANELS["updates.feed"] (~8434-8435). Registered here so TopBar's #bell (`dispatch({type:
   "openDrawer", k:"updates"})`) and `UpdatesPage`'s own door tile both have something to open —
   see the note in `components/shell/drawers/index.ts` naming this feature as the owner of both.

   The drawer shows the same six groups the page does, read fresh off the store each time it opens,
   so it can never disagree with the number the page shows when you land on it.

   Each row's dot reads `gNew` (keyed `NSEEN["<who>|<group>"]`), the same per-person-per-group
   selector `UpdatesPage` uses — a row click here only navigates (`closeDrawer();go('updates')`,
   03-app.js:12061), it never marks the group read on its own; only opening a group on the page
   itself does that. */

import { useRouter } from "next/navigation";
import { gNew, unread, updates } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { pathOf } from "@/components/shell";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { Feed } from "./Feed";

function Body(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const g = updates(state);
  const go = () => { dispatch({ type: "closeDrawer" }); router.push(pathOf("updates")); };

  if (!g.length) {
    return (
      <div className="empty">
        Nothing new.<br />
        <span className="sm">
          Money confirmed, an owner changed, a lead that arrived without one — they land here.
        </span>
      </div>
    );
  }

  return (
    <>
      {g.slice(0, 6).map((x) => (
        <button type="button" className="mrow up" key={x.k} onClick={go}>
          <span className={`upi ${x.tone}`}>{x.icon}</span>
          <span className="sit">
            <b>{x.title}</b>
            <span className="sm">{x.rows.length} {x.unit || "lead"}{x.rows.length === 1 ? "" : "s"}</span>
          </span>
          {!!gNew(state, x) && <span className="dotn" />}
        </button>
      ))}
    </>
  );
}

function Foot(_: DrawerProps) {
  const { dispatch } = useConsole();
  const router = useRouter();
  return (
    <button type="button" className="act ghost"
      onClick={() => { dispatch({ type: "closeDrawer" }); router.push(pathOf("updates")); }}>
      See everything
    </button>
  );
}

registerDrawer("updates", {
  w: 440,
  title: () => "Updates",
  sub: (state) => { const n = unread(state); return n ? `${n} unread` : "nothing new"; },
  Body,
  Foot,
});

/* ── PANELS["updates.feed"] — the door onto the chronological feed. Its body is the same `Feed`
   the page used to render inline; the redesign only moved where it opens from. */
function FeedBody(_: DrawerProps) {
  return <Feed />;
}

registerDrawer("p:updates.feed", {
  w: 620,
  title: () => "Update history",
  sub: () => "everything on this book in the last seven days",
  Body: FeedBody,
});
