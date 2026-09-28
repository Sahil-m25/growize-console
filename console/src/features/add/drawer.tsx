"use client";

/* ── features/add/drawer.tsx — the capture door, p:add.quick ─────────────────────────────────
   Ports `ir-console-redesigned.html` 7946–7948 (`panel("add.quick", ...)`). The redesign has no
   Add page any more — "Capture stopped earning a row" (NAV comment, ~2574) — capture is only this
   panel, opened from #capb in the top bar, the Today "Add lead" door, and the Leads empty states.
   Importing this module is what registers "p:add.quick"; see crossOwnerRequests for who needs to
   import it so the registration exists before #capb (top bar, global) can open it. */

import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { AddPage } from "./AddPage";

function Body(_: DrawerProps) {
  return <AddPage bare />;
}

registerDrawer("p:add.quick", {
  w: 560,
  title: () => "Add lead",
  Body,
});
