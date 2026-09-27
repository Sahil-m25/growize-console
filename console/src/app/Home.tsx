"use client";

/* "/" is not a screen. It is the question "where does this person start?", and landSafe() is the
   prototype's answer to it — the first screen the seat holds, with My day preferred when the seat
   has one. 03-app.js:7145. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConsole } from "@/lib/store";
import { landSafe } from "@/components/shell/nav";
import { pathOf } from "@/components/shell/routes";
import { TodayPage } from "@/features/today/TodayPage";
import { Sided } from "@/features/im/host";
import { LeadsPage } from "@/features/leads/LeadsPage";

export function Home() {
  const { state } = useConsole();
  const router = useRouter();
  const land = landSafe(state, null);

  useEffect(() => {
    router.replace(pathOf(land));
  }, [land, router]);

  /* the landing screen is drawn at once, not after the redirect's round trip: a person who has
     just signed in sees their day in the same frame (the prototype's go() is synchronous) */
  /* a granted-only seat (D60) whose first page is Leads lands there, drawn in the same frame too */
  if (!state.authed) return null;
  return land === "today" ? <Sided k="today" lead={<TodayPage />} /> : land === "leads" ? <LeadsPage /> : null;
}
