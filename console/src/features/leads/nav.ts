"use client";

/* ── go(), for the three screens that open a record ─────────────────────────────────────────
   The prototype's `go(v, id)` did four things at once: it set FROM so Back knows where it came
   from, cleared the drawer and the half-written drafts, changed VIEW, and repainted. Here the URL
   is the router, `{type:"go"}` is the state half, and this is the one call site that pairs them —
   so a `.qc` on My day, a row in Leads and a name in the gap card all navigate identically.
   03-app.js:7113.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { LeadId, NavKey, Scope } from "@/domain";
import { useConsole } from "@/lib/store";
import type { DrawerKind } from "@/lib/store";

/* open one lead, remembering the screen it was opened from — `FROM`, 03-app.js:1318 */
export function useGoLead(from: NavKey) {
  const router = useRouter();
  const { dispatch } = useConsole();
  return useCallback(
    (id: LeadId, drawer?: DrawerKind) => {
      dispatch({ type: "go", v: "leads", id });
      dispatch({ type: "setUi", patch: { FROM: from } });
      router.push(`/leads/${encodeURIComponent(id)}`);
      if (drawer) {
        /* The lead route's own drawer bodies (owner, details, next, claim, …) register
           themselves as an import side effect of `src/features/lead/drawers` — a chunk
           `router.push` only starts fetching here, on a page that has never mounted before
           (from Today or the book, before the lead route has registered anything). Dispatching
           `openDrawer` in this same tick sets `DRW` to a kind the registry does not know yet;
           `DRAWERS` is plain module state, not React state, so nothing re-renders the shell once
           the chunk does finish loading and the kind becomes known — the drawer never opens.
           Importing the same module ourselves and opening only once it resolves is the real
           signal to wait on (already-loaded resolves on the next microtask); a timeout would be
           guessing how long the chunk takes. */
        import("@/features/lead/drawers").then(() => {
          dispatch({ type: "openDrawer", k: drawer, id });
        });
      }
    },
    [dispatch, router, from],
  );
}

/* toLeads(set, scope) — land on Leads with exactly one filter set. 03-app.js:2757 */
export function useToLeads() {
  const router = useRouter();
  const { dispatch } = useConsole();
  return useCallback(
    (set: string | null, scope?: Scope) => {
      dispatch({ type: "toLeads", set, scope });
      dispatch({ type: "go", v: "leads" });
      router.push("/leads");
    },
    [dispatch, router],
  );
}

/* a plain destination — the two "Events ›" / "The plan ›" jumps in the gap card */
export function useGoView() {
  const router = useRouter();
  const { dispatch } = useConsole();
  return useCallback(
    (v: NavKey) => {
      dispatch({ type: "go", v });
      router.push(`/${v}`);
    },
    [dispatch, router],
  );
}
