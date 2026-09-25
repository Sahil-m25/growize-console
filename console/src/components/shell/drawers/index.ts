"use client";

/* The shell's own drawer bodies. Importing this module is what registers them; the Drawer frame
   imports it once, at the top of the tree, so they exist before anything can open one.

   Registered here: presence, help, absence, account — plus two cross-owner drawers that a
   top-bar control (global, every route) needs registered before it can ever be clicked:
   "p:add.quick" (#capb, TopBar.tsx) and "updates" (#bell, TopBar.tsx). Each used to register
   only once its own page's chunk had loaded (AddPage / UpdatesPage), which left the top-bar
   control opening nothing on every other route. Importing the two drawer modules here — for
   their registerDrawer() side effect only — is what fixes that; the page agents still own the
   files themselves.

   Not registered here — a page agent owns each of these and registers it from its own feature
   module with registerDrawer(): next, forecast, touch, followup, history, notes, acct, paper,
   material, pack, money, call, details, temp, lost, claim, owner, reassign, hold, recov, newp,
   person, check (see crossOwnerRequests — pages-b), and any other "p:<key>" panel a page opens
   from a door tile (see registry.ts's note on DrawerKind's `p:${string}`). */

import "./presence";
import "./help";
import "./absence";
import "./account";
import "@/features/add/drawer";
import "@/features/updates/drawer";

export { registerDrawer, drawerDef, registeredKinds } from "./registry";
export type { DrawerDef, DrawerProps } from "./registry";
