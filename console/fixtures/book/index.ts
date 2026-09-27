/* THE DEMO BOOK — the merged prototype's records, assembled into one `Dataset`. Loaded only by
   `fixtureSource` (FIXTURE_MODE=local); nothing in `src/` imports it statically. Lead side on
   Fri 28 Aug 2026, Investors side on 2 Sep 2026, exactly as the prototype. */

import type { Dataset } from "@/lib/data/types";
import { imAlign } from "@/lib/im";
import { imDemoData } from "../im/demo";
import { TEMP } from "./access";
import { LOG } from "./activity";
import { DEMO_NOW } from "./clock";
import { LEADMAIL } from "./emails";
import { EVENTS, SHEET, SHEETNAMES, SHEETNOTES } from "./events";
import FINMIRROR from "./finance-mirror.json";
import { INV } from "./inventory";
import { LEADS } from "./leads";
import { CALLS, INTERACTIONS, NOTES, PACK, PACKAT, SENT } from "./notes";
import { RECOV } from "./numbers";
import { CLAIM, CLAIMARCHIVE, EXT, PAY, REQ } from "./payments";
import { AVAIL, COVER, PEOPLE, SIGNINS } from "./people";
import { PLAN } from "./plan";
import { seedBook } from "./seed";

export function demoBook(): Dataset {
  /* the paper, accounts, transfers and document references the ladder implies (03-app.js:2009) */
  const BOOK = seedBook();
  return structuredClone({
    NOW: DEMO_NOW, TODAY: DEMO_NOW,
    LEADS, PEOPLE, SIGNINS, PLAN, EVENTS, LOG, DOCS: BOOK.DOCS, INV, TEMP, GRANT: {}, COVER, AVAIL,
    PAY, CLAIM, CLAIMARCHIVE, REQ, EXT, XFER: BOOK.XFER, ACCT: BOOK.ACCT, ARLSEQ: 207, PAPER: BOOK.PAPER,
    SENT, NOTES, CALLS, PACK, PACKAT, RECOV, SHEET, INTERACTIONS,
    SHEETNAMES: [...SHEETNAMES], SHEETNOTES: [...SHEETNOTES],
    FINMIRROR,
    LEADMAIL,   /* a lead's emails (M12-S09) — ./emails.ts */
    LEAD: "L3", EVID: "E-04", // 03-app.js:936
    /* IMX.align(PEOPLE) — merge-glue.js: name the lead side's people so a raw key never reaches a sentence */
    im: imAlign(imDemoData(), PEOPLE),
  }) as Dataset;
}
