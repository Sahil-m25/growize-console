"use client";

/* M12-S13-W1 — has this lead's NDA come back signed? The gate on the deck follow-up, the webinar invite, the material ticks
   and the "send the deck" next steps (D60). It is the Paperwork row's own read (GET /api/leads/[id]/paperwork, the NDA round's
   `verified`), not a look into the book. While it is being read, or if it cannot be, the gate stays shut. */

import type { Lead } from "@/domain";
import { useApiRead } from "@/lib/data/api";
import { ndaSigned, paperworkRow } from "@/lib/data/endpoints/paperwork";
import { useConsole } from "@/lib/store";

export function useNda(l: Lead | null | undefined): boolean {
  const { state } = useConsole();
  const r = useApiRead(paperworkRow, state, l ? l.id : null);
  return r.state === "ok" && ndaSigned(r.data);
}
