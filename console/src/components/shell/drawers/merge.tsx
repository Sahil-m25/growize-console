"use client";

/* HOW THE MERGE WORKS — merge-glue.js panel("merge.notes"). Prototype documentation about the demo
   people (sign-in-as chips), so its body lives with the demo book in console/fixtures/merge-notes.tsx
   and is fetched only when the panel is opened — which is only in fixture mode (state.FIXTURES):
   the rail's foot link and this drawer both exist only beside the demo book. */

import { lazy, Suspense } from "react";
import { registerDrawer } from "./registry";

const MergeNotes = lazy(() => import("@fixtures/merge-notes"));

function Body() {
  return (
    <Suspense fallback={null}>
      <MergeNotes />
    </Suspense>
  );
}

registerDrawer("p:merge.notes", { w: 640, ok: (state) => state.FIXTURES, title: () => "How the merge works", Body });
