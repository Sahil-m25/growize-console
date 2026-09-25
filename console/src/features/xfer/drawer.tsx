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
      <p>Finance-verified signed agreements and at least the confirmed 10% payment trigger the
        investor copy. The original lead remains with its IR. Authorized integration administrators
        can recover missing local copy tracking using the same account link.</p>
      <p className="sm">This demo has no live investor intake or portal acknowledgement. Existing
        portal accounts are reused, never created twice. Ongoing investor maintenance after lead
        closure belongs in the Investor Management portal.</p>
    </>
  );
}

registerDrawer("p:xfer.how", {
  w: 540,
  title: () => "How investor copies work",
  Body,
});
