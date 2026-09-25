"use client";

/* The redesign has no Add page — capture is only the p:add.quick panel (see
   src/features/add/drawer.tsx). A stray link or bookmark to /add lands here, which opens that
   panel and sends the person to /today, same as the prototype's NAV having no "add" entry at all.

   THIS PAGE CANNOT MOUNT YET. `add` is in `PATHS` (routes.ts) so `/add` resolves to a real `view`,
   but `add` carries `PAGECAPS.add.nopage:true` (domain/nav.ts) — it was deliberately dropped from
   `NAV` so nothing treats it as a reachable screen. Shell.tsx's own `blocked` gate does not know
   about `nopage` yet, so it reads "add" as an unreachable view and redirects before this
   component's effect ever runs (verified: with the `router.replace` call here commented out, the
   browser still lands on /today — Shell's redirect fires first). `src/features/me/reach.ts` and
   `src/features/people/helpers.ts` already carry the same `!PAGECAPS[p]?.nopage` check for exactly
   this reason. See crossOwnerRequests: `mayReach`/`blocked` in `src/components/shell/nav.ts` /
   `Shell.tsx` need the same one-line guard. Everything below is what should run once that lands. */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConsole } from "@/lib/store";
import "@/features/add"; /* registers p:add.quick before it is opened below */

export default function Page() {
  const { dispatch } = useConsole();
  const router = useRouter();
  /* openDrawer toggles: dispatching it twice for the same key closes what the first call just
     opened. Strict Mode (dev only) double-invokes this effect, so without a guard the panel opens
     and immediately closes before the redirect is even seen. */
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      dispatch({ type: "openDrawer", k: "p:add.quick" });
    }
    router.replace("/today");
  }, [dispatch, router]);
  return null;
}
