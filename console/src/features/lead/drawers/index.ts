"use client";

/* The thirteen drawer bodies the lead page opens. Importing this module is what registers them —
   `src/features/lead/LeadPage.tsx` pulls it in for the side effect, so every kind exists before
   anything can open one. A kind that is not registered opens nothing and closes itself, which is
   exactly what the prototype's `if(!DRAWERS[k]) return;` does.

   Registered here: next, forecast, history, notes, material, pack, call, details, lost, owner,
   reassign, hold.

   `./touch.tsx` and `./followup.tsx` are NOT imported below any more — nothing in the running app
   dispatches `openDrawer({k:"touch",...})` or `k:"followup"` (the lead page consolidated onto
   `@/features/leads/followupDrawer`'s `"p:followup"`, the key Today/WorkAction/LeadsPage already
   use), so importing them for their `registerDrawer` side effect only kept a second, unreachable
   copy of the follow-up drawer live to register itself over a future `open()`'s shoulder. Left on
   disk rather than deleted — a file delete/rename is what broke Turbopack's live cache mid-round
   the one time this got tried against a dev server that must not restart (see LeadPage.tsx's own
   note); dropping the import is the same fix without touching the filesystem. */

import "./next";
import "./forecast";
import "./history";
import "./material";
import "./call";
import "./lost";
import "./owner";
import "./hold";
import "./finance";
import "./investor-copy";
import "./lpdrawers";   /* last: wraps history/owner/material/money as the Investor file's tabs */

