"use client";

/* ── features/leads/drawer.tsx — the panel door, p:leads.more ────────────────────────────────
   Ports `ir-console-redesigned.html` 7452-7455 (`panel("leads.more", ...)`): forecast, source and
   owner cuts of the book, opened from the door on `<BookRail part="main">` rather than always
   shown beside the table. `canOpenDrawer` (src/lib/selectors/access.ts:376) already lets any
   "p:"-prefixed kind through, and `DrawerKind` (src/lib/store.tsx) already carries the
   `` `p:${string}` `` member — no cross-owner change needed, just registering here the same way
   `src/features/add/drawer.tsx` registers "p:add.quick".
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { bookFor, scopeOf } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { BookRail } from "./BookRail";

function Body(_: DrawerProps) {
  const { state } = useConsole();
  const team = scopeOf(state, "leads") === "team";
  return <BookRail all={bookFor(state, "leads")} team={team} part="more" />;
}

registerDrawer("p:leads.more", {
  w: 420,
  title: () => "Other ways to cut the book",
  sub: () => "forecast, source and owner — the same book, cut three more ways",
  Body,
});
