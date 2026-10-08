"use client";

/* ── features/events/drawer.tsx — the event door, p:event.edit ───────────────────────────────
   Registers the redesigned prototype's `DRAWERS["event.edit"]` (ir-console-redesigned.html
   ~12855–12876) as the panel `"p:event.edit"` — a panel IS a drawer (DrawerKind's own comment,
   `src/lib/store.tsx`): same registry, same frame, same docked/overlay behaviour, and its
   `canOpenDrawer` gate already answers `true` for any `p:` key (src/lib/selectors/access.ts), so
   this needs no change to the shell's `DrawerKind` union or its gate to exist. `saveEvent`/
   `dropEvent` (src/lib/store.tsx) are the actions both feet dispatch.

   Also registers `p:event.drop` — the confirm door `dropEvent` opens before it removes anything,
   this port's stand-in for the prototype's shared `askFirst`/DRAWERS.ask (see EventEditor.tsx).

   Importing this module is what registers both; `./index.ts` does that import so it runs before
   either events screen can open one. */

import type { ConsoleState } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { EventDropBody, EventDropFoot, EventEditorBody, EventEditorFoot } from "./EventEditor";
import { uiEVD } from "./eventDraft";

/* M14-S02-W1: the record is read from GET /api/events/[id] by the body itself (the route answers 404), so the
   registry no longer looks the id up in the book; the drawer names it from the draft it was opened with. */
const askOf = (state: ConsoleState, id: string | null) => { const a = (state.ui as { EVASK?: { id: string; eventName: string } }).EVASK; return a && a.id === id ? a : null; };

registerDrawer("p:event.edit", {
  w: 540,
  /* stale (and the drawer closes itself) once the id it opened for stops naming a record — an
     id of null ("Add event") is always fine. drwCheck's own rule, 03-app.js:6181. */
  ok: () => true,
  title: (_state, { id }) => (id ? "Edit event" : "Add event"),
  sub: (state, { id }) => (id ? uiEVD(state.ui).n : "Choose dates and who will work it"),
  Body: EventEditorBody,
  Foot: EventEditorFoot,
});

/* "Remove <name> from the diary" — DRAWERS.ask's one caller here, see EventEditor.tsx's own note.
   Always about a record: stale (and closed) the moment its event stops existing. */
registerDrawer("p:event.drop", {
  w: 440,
  ok: (state, id) => !!askOf(state, id),
  title: (state, { id }) => {
    const e = askOf(state, id);
    return e ? `Remove ${e.eventName} from the diary` : "Unavailable";
  },
  Body: EventDropBody,
  Foot: EventDropFoot,
});
