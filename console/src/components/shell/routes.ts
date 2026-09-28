/* =================================================================================================
   ROUTES — the prototype's go(k, id) expressed as Next paths.

   The prototype had one <div id="pane"> and a `V[VIEW]()` lookup; here the URL is the source of
   truth and VIEW is mirrored into the store from it. The table is PORT-GUIDE's, verbatim. Two of
   the fourteen nav keys have a record route under them: a lead under Leads, an event under Events.
   ============================================================================================== */

import type { NavKey } from "@/domain";

/* every VIEW the prototype's V map knows, including the two record screens (03-app.js:7002) */
export type View = NavKey | "lead" | "event";

export const PATHS: Record<NavKey, string> = {
  today: "/today",
  leads: "/leads",
  updates: "/updates",
  add: "/add",
  activity: "/activity",
  people: "/people",
  goals: "/goals",
  events: "/events",
  pay: "/pay",
  docs: "/docs",
  xfer: "/xfer",
  numbers: "/numbers",
  system: "/system",
  me: "/me",
  inv: "/inv",
  farms: "/farms",
  tkt: "/tkt",
  invupd: "/invupd",
} as Record<NavKey, string>;

/* a record screen is reachable when its list is — the rule landSafe and go both use */
export const PARENT: Record<string, NavKey> = {
  lead: "leads" as NavKey,
  event: "events" as NavKey,
};

/* the nav key a view sits under: `lead` is under Leads, `event` under Events, everything else
   is its own parent. 03-app.js:7115 */
export function parentOf(v: View): NavKey {
  return (PARENT[v] ?? v) as NavKey;
}

/* go(v, id) — where it points */
export function pathOf(v: View, id?: string): string {
  if (v === "lead") return id ? `/leads/${encodeURIComponent(id)}` : PATHS.leads as string;
  if (v === "event") return id ? `/events/${encodeURIComponent(id)}` : PATHS.events as string;
  return PATHS[v as NavKey] ?? "/";
}

/* the inverse: which VIEW a URL is, and which record it is about. `/` has no view — it redirects
   to landSafe() before anything is drawn. */
export function viewOf(pathname: string): { view: View | null; id: string | null } {
  const parts = pathname.split("/").filter(Boolean);
  const head = parts[0];
  if (!head) return { view: null, id: null };
  const id = parts[1] ? decodeURIComponent(parts[1]) : null;
  if (head === "leads") return { view: id ? "lead" : ("leads" as View), id };
  if (head === "events") return { view: id ? "event" : ("events" as View), id };
  const known = Object.prototype.hasOwnProperty.call(PATHS, head);
  return { view: known ? (head as View) : null, id: null };
}

/* A navigation the shell should draw at once, before its route lands (Shell.tsx pendingView). A
   rail <Link> press is seen by the shell's own click listener; anything else that pushes a route —
   a "try them" chip that signs in as somebody and opens a page — says so here. Needed because the
   store's go() refuses an Investors-only seat (no lead-side account), so VIEW cannot say it. */
export const NAV_EVT = "gz:nav";
export function announceNav(to: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string>(NAV_EVT, { detail: to }));
}
