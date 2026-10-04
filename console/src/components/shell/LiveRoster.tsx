"use client";

/* M08-S05-NOTE-6 — THE ROSTER, LIVE. Every screen that asks "who is out" reads state.AVAIL through the selectors (outFor, avail,
   availabilityStatus, rag). In fixture mode the demo book holds it; live it is GET /api/availability (D49, Plane C), read here
   once for the whole console and put on the book as ids and days. A live write re-reads it (bumpLive), and a re-hydrate that
   empties AVAIL is filled again on the next render. Renders nothing; a failed read leaves AVAIL as it was (nobody marked out). */

import { useEffect } from "react";
import { useApiMode, useApiRead } from "@/lib/data/api";
import { availFromWindows, availabilityRead } from "@/lib/data/endpoints/availability";
import { useConsole } from "@/lib/store";

const same = (a: Record<string, { from: string; to: string }>, b: Record<string, { from: string; to: string }>) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] && b[k]!.from === a[k]!.from && b[k]!.to === a[k]!.to);
};

export function LiveRoster() {
  const { state, dispatch } = useConsole();
  const mode = useApiMode();
  const r = useApiRead(availabilityRead, state, undefined);
  const live = mode === "live" && state.authed && r.state === "ok" ? availFromWindows(r.data.windows) : null;
  useEffect(() => {
    if (live && !same(live, state.AVAIL)) dispatch({ type: "availLive", AVAIL: live });
  }, [live, state.AVAIL, dispatch]);
  return null;
}
