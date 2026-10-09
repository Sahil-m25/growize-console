"use client";

/* ── panel('xfer.how', …) — DRAWERS["p:xfer.how"], redesigned prototype line 9218 ───────────
   "What used to be three paragraphs at the top of the page. It is correct and it is reference: the
   register and the unacknowledged writes are the work, this is the explanation of them." Opened
   from the "How copying works" chip on Investor copies (`onclick="openDrawer('p:xfer.how')"`,
   line 9222). Importing this module from XferPage.tsx registers the panel before that chip can
   open it — the same pattern as `features/add/drawer.tsx` for "p:add.quick". */

import { may } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";

function Body(_: DrawerProps) {
  const { state } = useConsole();
  if (!may(state, "xfer", "view")) return null;
  return (
    <>
      <p>The investor record is created only when Finance confirms the 10% — Finance-matched money
        (part payments counted together) reaching 10% of what the investor commits. Finance creates it
        on their own sign-in; nobody copies a lead by hand (D137, GC-1527). The original lead remains
        with its IR and links to the investor.</p>
      <p className="sm">Transfers is the read-only log of the leads that became investors this way. An
        investor who already exists is reused, never created twice.</p>
    </>
  );
}

registerDrawer("p:xfer.how", {
  w: 540,
  title: () => "How investor copies work",
  Body,
});
