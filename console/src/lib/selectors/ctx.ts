/* ── ctx.ts — what a selector is allowed to read ────────────────────────────────────────────
   The prototype is a global mutable object graph: `rag(l)` reaches for PEOPLE, AVAIL, COVER, PAY
   and NOW without saying so, and `may(p,c)` reaches for WHO, ROLE, TEMP and TEMPON. None of that
   survives the port — a selector here is a pure function of its arguments.

   So every prototype global a selector read becomes a parameter. A selector that needs exactly one
   global takes that global (`roleOf(PEOPLE, k)`); a selector that needs more than one takes `Ctx`
   as its FIRST argument and keeps the prototype's own arguments, in the prototype's own order,
   after it (`rag(ctx, l)`, `capsFor(ctx, k, p)`).

   `Ctx` is deliberately structural: `ConsoleState` from `@/lib/store` should satisfy it as-is, so
   a component writes `rag(state, l)`. Every field carries its prototype name.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type {
  Absence, CallRec, Claim, Cover, DocRec, EventRec, InteractionRec, Inventory, Lead, LeadId, LogEntry,
  MoveReq, NavKey, Note, PaperRow, PayRec, Person, PersonKey, Plan, Scope, SeatKey, Sendable,
  TempGrant, XferRow, InvestorCopy,
} from "@/domain";
import type { FinanceMirror } from "@/lib/data/types";

/* ---- the context every non-trivial selector takes ------------------------------------------
   The REQUIRED half is exactly `ConsoleState` as PORT-GUIDE declares it, so a component can write
   `rag(state, l)` with no adapter. The OPTIONAL half is the rest of the prototype's record globals
   (`PAY`, `CLAIM`, `REQ`, `AVAIL`, `XFER`, `SENT`, `NOTES`, `CALLS`, `PACK`, `ACCT`, `NSEEN`),
   which PORT-GUIDE's `ConsoleState` sketch does not name. They are optional so that a state
   without them still satisfies `Ctx`; every selector that reads one treats a missing map as empty,
   which is what the prototype's `PAY[l.id]` on an unknown id did anyway. */
export type Ctx = {
  /* who is asking */
  WHO: PersonKey;                                        /* the signed-in person */
  ROLE: SeatKey;                                         /* roleOf(WHO) */
  /* the frozen clock — 28 Aug 2026. See lib/format.ts. */
  NOW: Date;
  TODAY: Date;
  /* the record */
  PEOPLE: Record<PersonKey, Person>;
  LEADS: Lead[];
  LOG: LogEntry[];
  EVENTS: EventRec[];
  DOCS: DocRec[];
  PLAN: Plan;
  INV: Inventory;
  /* access */
  CAPS: Record<PersonKey, Partial<Record<NavKey, string[]>>>;   /* the prototype's GRANT: per-person overrides */
  TEMP: TempGrant[];
  TEMPON: string | null;                                 /* the grant the signed-in person switched on */
  /* who is carrying whose book */
  COVER: Record<PersonKey, Cover>;
  /* paper: leadId -> {nda:{…}, supp:{…}} */
  PAPER: Record<LeadId, PaperRow>;
  /* the sidebar scope, per section */
  SC: { today: Scope; leads: Scope; activity: Scope };

  /* ---- optional: see the note above ---- */
  AVAIL?: Record<PersonKey, Absence>;       /* who is out. Absent from the map means available. */
  PAY?: Record<LeadId, PayRec>;             /* Finance's receipts, arriving over the link */
  /* the Investors side's records — the merged rail reads its reach (merge-glue.js) */
  IM?: import("@/lib/im").ImData;
  CLAIM?: Record<LeadId, Claim>;            /* "the investor says they have paid" */
  REQ?: Record<LeadId, MoveReq>;            /* reassignment asks waiting on a decision */
  XFER?: XferRow[];                         /* legacy demo projections */
  INVESTORCOPY?: Record<LeadId, InvestorCopy>;
  FINMIRROR?: FinanceMirror;             /* the Finance projection the lead side reads (Dataset.FINMIRROR) */
  SENT?: Record<LeadId, Partial<Record<Sendable, string>>>;   /* which material went out, and when */
  NOTES?: Record<LeadId, Note[]>;
  CALLS?: Record<LeadId, CallRec>;
  PACK?: Record<LeadId, number>;            /* weeks of the produce pack sent, of GOALS.packWeeks */
  /* payment reports Finance could not find, archived off the live CLAIM slot when a new report is
     started against a lead that already has a confirmed one (ir-console-redesigned.html:5478). */
  CLAIMARCHIVE?: Record<LeadId, Claim[]>;
  /* manual contact history kept off-ladder: failed call/visit attempts and other follow-up-drawer
     recordings (ir-console-redesigned.html:5985). */
  INTERACTIONS?: Record<LeadId, InteractionRec[]>;
  /* the Growize account minted when Finance confirms the first receipt. Typed by what a selector
     reads off it — its code — so both @/domain's `Account` and the store's `AcctRec` satisfy it. */
  ACCT?: Record<LeadId, { code: string }>;
  NSEEN?: Record<string, string>;           /* "<who>|<group>" -> the day that group was last read */
  /* which references are uncovered for this seat in this session — `showRef`/`hideRef`'s own
     record, keyed exactly as `refOf`'s `k` (ir-console-redesigned.html:11453). */
  REFSEEN?: Record<string, PersonKey>;
};

/* A capability is one of the strings on `PAGECAPS[page].caps` — re-exported so a selector and its
   caller name the same type without importing two modules. */
export type { Cap } from "@/domain";

/* the signed-in person. The prototype's `me()`. */
export const me = (ctx: Ctx): PersonKey => ctx.WHO;

/* a person, or a placeholder that will not throw when a name has gone from the record */
export const P = (PEOPLE: Record<PersonKey, Person>, k: PersonKey | null | undefined): Person =>
  (k != null && PEOPLE[k]) || ({ n: k || "—", i: "—", seat: null } as unknown as Person);
