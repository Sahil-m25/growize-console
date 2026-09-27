/* THE STATE AND THE REDUCER — pure, no React. Split out of store.tsx so the server (fixture mode)
   can run the very same writes as a named person. store.tsx re-exports everything here. */

import { GOALS as GOALS0 } from "@/domain";
import type { Dataset } from "@/lib/data/types";
import { clockDay, kolkataNow, reviveClock } from "@/lib/data/clock";
import { emptyDataset } from "@/lib/data/empty";
import { signInAdmits } from "@/lib/data/admission";
import { SIGNOUTMSG, type SignOutWhy } from "@/domain";
import type { ImAction, ImData, ImUi } from "@/lib/im";
import { imReducer, initialImUi } from "@/lib/im";
import { IM2M } from "@/domain";
import type { DataPayload } from "@/lib/data/types";
import type { Session } from "@/lib/data/session";

/* The selectors are the prototype's pure functions under their prototype names, taking the read
   context as their first argument. That context is this state — the one adapter is useCtx() below,
   so if the two shapes ever drift there is exactly one line to change. */
import { accountAllowed, active, assignees, canAssign, canClaim, canOpenDrawer as canOpenDrawerBase, canOperateLeads, canPlan, canReach, canWork, claimOf, conFor, consoleAccount, fresh, hasNext, isIR, lost, may, myBook, navFor, openable, own, P, payOf, readMarks, refAllowed, refOf, scopeOf, scopedFinanceReader, seeMoney, seesTeam, tList, tempOn, visible } from "@/lib/selectors";
import type { Ctx as SelectorCtx } from "@/lib/selectors";
import { accessDay, agoStr, dISOtoDisp, dOf, iso, MON, maskRef, nowT, pinAccessDate, stamp, whenT } from "@/lib/format";
import { LADDER, ST, TOUCHCHANNELS } from "@/domain";
import { evDateText, evGaps, evNextId, uiEVD } from "@/features/events/eventDraft";

import type {
  CallRec,
  Channel,
  Cover,
  DocRec,
  EventId,
  EventRec,
  InteractionRec,
  Inventory,
  Lead,
  LeadId,
  LogEntry,
  NavKey,
  Note,
  PaperRow,
  Person,
  PersonKey,
  Plan,
  Scope,
  SeatKey,
  TempGrant,
} from "@/domain";

/* The four feature slices. Each owns the actions of its own pages and returns null for the rest,
   so the root reducer below delegates rather than growing a case per page. They import only types
   from this file, so the cycle is erased at compile time and there is no runtime edge. */
import { pagesAReducer } from "@/features/leads/reducer";
import { leadPageReducer, LEADPAGE_WRITES, type LeadPageAction } from "@/features/lead/reducer";
import { pagesBReducer } from "@/features/add/reducer";
import type { AddCon } from "@/features/add/state";
import { pagesCReducer } from "@/features/people/reducer";
import { pagesDReducer } from "@/features/pay/reducer";
import { projectInvestorCopies, recordInvestorCopy } from "./investor-copy";
import { createConsoleWriter } from "./console-save";
import type { SaveEntry, SaveResult } from "./save-queue";

/* ---- the shell's own types ------------------------------------------------------------------ */

/* Every drawer in the prototype's DRAWERS registry (03-app.js 6217–6998), by its own key. Naming
   all twenty-four here — not only the three the shell draws — is what lets a page agent write
   dispatch({type:"openDrawer", k:"forecast", id:l.id}) and have the compiler check the name. */
export type DrawerKind =
  | "next"
  | "forecast"
  | "touch"
  | "history"
  | "notes"
  | "acct"
  | "investorcopy"
  | "paper"
  | "material"
  | "pack"
  | "money"
  | "call"
  | "details"
  | "temp"
  | "lost"
  | "claim"
  | "owner"
  | "reassign"
  | "hold"
  | "recov"
  | "newp"
  | "person"
  | "presence"
  | "help"
  | "check"
  | "absence"
  /* the account menu — DRAWERS.account. Shell-owned: the only place Profile, Team availability
     and appearance are one click from every screen. */
  | "account"
  /* the bell — DRAWERS.updates. Registered by pages-b from its own Updates feature module, the
     same way every other page-owned drawer is; the shell only ever dispatches it. */
  | "updates"
  /* a panel — "a section that left a page and opens from a door tile" (redesigned 03-app.js
     ~2493). A panel IS a drawer: same registry, same frame, same docked/overlay behaviour. Its
     key carries the "p:" prefix the prototype's drawerDef() strips, so a page agent registers one
     with registerDrawer("p:add.quick" as DrawerKind, {...}) from its own feature module — nothing
     else about the contract changes. */
  | `p:${string}`;

/* {k, id} — which drawer, and which record it is about. 03-app.js:6157 */
export type DrawerState = { k: DrawerKind; id: string | null };

export type Theme = "light" | "dark";

/* TJUST — the prototype's one-click Undo offer (03-app.js:6421). Set by the three one-click
   writes it stands behind — tick() a rung, assign() an owner, saveTouch() a contact — and read by
   the top bar's Undo notice for as long as fresh() says the record is still inside the eight-hour
   edit window. Derived in the reducer below by diffing the write rather than asked of each writer,
   so the offer can never name a write that did not happen. */
export type TJust =
  | { w: "rung"; id: LeadId; r: number; at: string }
  | { w: "own"; id: LeadId; to: PersonKey; at: string }
  | { w: "touch"; id: LeadId; k: string; at: string };

/* FU — the follow-up drawer's combined outcome-and-next-step draft (03-app.js:6002-6008's
   `fuDraft`). Rides `ui.FU`, patched field by field with the store's existing generic `setUi`. */
export type FollowupDraft = {
  channel: Channel | "reply" | "other";
  outcome: string;
  obj?: string[];
  note?: string;
  /** The contact's own date and time — ISO day, `HH:MM`. */
  d: string;
  tm: string;
  /** Leave an existing scheduled task exactly as it is. */
  keep?: boolean;
  /** This contact completed the existing scheduled task. */
  complete?: boolean;
  /** Deliberately leave no next step — refused for an active, un-lost, not-yet-onboarded lead. */
  noNext?: boolean;
  /** The next step, when neither `keep` nor `noNext`. */
  t?: string;
  nd?: string;
  ntm?: string;
  nch?: Channel | "other";
};
const uiFU = (ui: UiState): FollowupDraft | null => (ui.FU as FollowupDraft | undefined) || null;

/* ---- the ui bag ------------------------------------------------------------------------------

   The prototype kept every half-typed form as a module-level `let`: NXD, TD, ADDN, LOSTW, HQ,
   ABWHY … Those are not domain state and they are not the shell's, so they live in one bag keyed
   by the prototype's own identifier. The shell's own drafts are declared; a feature slice adds its
   keys by module augmentation in its own file:

     declare module "@/lib/store" { interface UiState { LQ: string; NXD: NextDraft } }

   and the index signature keeps an un-augmented key readable as `unknown` in the meantime. */
export interface UiState {
  /* the theme the person chose, if they chose one — null means follow prefers-color-scheme. Saved
     to localStorage (try/catch) by the shell; see ui/Appearance.tsx. */
  THEME: Theme | null;
  /* railSync()'s RAILMIN, 03-app.js:7081 — the rail showing icons only. A visit-scoped furniture
     choice, not domain state; NOT reset by "go", same as the prototype's own global. */
  RAILMIN: boolean;
  /* help drawer: the answer search. 03-app.js:4843 */
  HQ: string;
  /* the presence/absence drawers' teammate search — AVQ, 03-app.js */
  AVQ: string;
  /* absence drawer: the leave being drafted. 03-app.js:6999 */
  ABWHY: string | null;
  ABFROM: string | null;
  ABTO: string | null;
  /* leads filters — cleared by setPerson, exactly as clearLeadFilters(true) does. 03-app.js:2737 */
  LQ: string;
  LFILT: string | null;
  LSRC: string | null;
  LSTAGE: number | null;
  /** "at" = on this rung; "from" = this rung or past it — a modifier on LSTAGE. */
  LSTAGEMODE: "at" | "from";
  LOWN: PersonKey | null;
  /** Not contacted for at least this many days — a key of QUIET, or null for "Any time". */
  LQUIET: number | null;
  /* say(msg) — 03-app.js:13258's one-shot live-region announcement, the ephemeral half of it: a
     screen reads this once and a fresh dispatch (or leaving it) clears it. Only `markRead()`'s own
     "Every update marked as read." uses it in this port so far; the shell's own aria-live region is
     a crossOwnerRequest. */
  NOTICE: string | null;
  [k: string]: unknown;
}

/* ---- the state ------------------------------------------------------------------------------ */

export type ConsoleState = {
  /* THE SESSION (M03-S01-T04). `authed` false = the sign-in screen is what renders, at every
     route. WHO is "" while nobody is signed in — the only default person there is. */
  authed: boolean;
  /* why they are looking at the sign-in screen, if not by choice — a key of SIGNOUTMSG */
  SIGNOUT: SignOutWhy | null;
  /* the data half has arrived from GET /api/data at least once */
  loaded: boolean;
  /* fixture mode (FIXTURE_MODE=local) — the demo sign-in list and the fixture poll */
  FIXTURES: boolean;
  /* the applied-fixture version this state was hydrated from */
  DATAVER: number;
  WHO: PersonKey; // the signed-in person
  ROLE: SeatKey; // roleOf(WHO), derived, kept for the prototype's reads
  VIEW: NavKey; // current page key — the router is the source of truth, mirrored here
  LEAD: LeadId; // the lead a /leads/[id] route is about
  EVID: string; // the event an /events/[id] route is about
  /* EVKEY — ir-console-redesigned.html:3778, `let EVKEY = EVENTS.length`. A monotonic counter for
     `evNextId`, never the live event count: removing an event must never let a later add reissue
     its id (see @/features/events/eventDraft's `evNextId`). Seeded once at load, incremented only
     by `saveEvent` adding a new record — a number once spent is never spent again. */
  EVKEY: number;
  NOW: Date; // the prototype's frozen clock — 28 Aug 2026
  TODAY: Date;
  LEADS: Lead[];
  PEOPLE: Record<PersonKey, Person>;
  PLAN: Plan;
  GOALS: typeof GOALS0;
  EVENTS: EventRec[];
  LOG: LogEntry[];
  PAPER: Record<LeadId, PaperRow>;
  DOCS: DocRec[];
  INV: Inventory;
  TEMP: TempGrant[];
  TEMPON: string | null;
  CAPS: Dataset["GRANT"]; // the prototype's GRANT — per-person capability overrides
  COVER: Record<PersonKey, Cover>;
  /* the rest of the prototype's record globals, so a feature slice has a typed home for the map
     it writes rather than a corner of `ui`. Each is seeded from @/domain and copied, never shared
     with the constant it came from. */
  AVAIL: Dataset["AVAIL"];
  PAY: Dataset["PAY"];
  ACCT: Dataset["ACCT"];
  CLAIM: Dataset["CLAIM"];
  /* CLAIMARCHIVE — 03-app.js:5406. startPaymentReport() archives a confirmed claim here before
     clearing CLAIM[id] for a fresh draft; claimArchiveBlock() (selectors: claimArchiveOf) reads it
     back. */
  CLAIMARCHIVE: Dataset["CLAIMARCHIVE"];
  REQ: Dataset["REQ"];
  EXT: Dataset["EXT"];
  XFER: Dataset["XFER"];
  INVESTORCOPY: Record<LeadId, import("@/domain").InvestorCopy>;
  SENT: Dataset["SENT"];
  NOTES: Dataset["NOTES"];
  CALLS: Dataset["CALLS"];
  PACK: Dataset["PACK"];
  PACKAT: Dataset["PACKAT"];
  RECOV: Dataset["RECOV"];
  SHEET: Dataset["SHEET"];
  /* manual contact history kept off-ladder: failed call/visit attempts, the CALLS fixture folded
     in at load, and every follow-up-drawer recording since (03-app.js:5985). */
  INTERACTIONS: Record<LeadId, InteractionRec[]>;
  /* "<who>|<group>" -> the day that group was last read. Keyed per person AND per group, so
     signing in as somebody else — or reading one group — never marks another person's or another
     group's news as seen (03-app.js:1344, 8408-8409). */
  NSEEN: Record<string, string>;
  /* which bank/claim references are uncovered for THIS seat in THIS session — `showRef`/`hideRef`'s
     own record, keyed exactly as `refOf`'s address (`"pay:L6"`, `"claim:L6"`, `"xfer:L6"`). Never
     persisted, never written to the record, and cleared on `setPerson` the same way the prototype's
     own module global is emptied by `endSession()` (03-app.js:11453). */
  REFSEEN: Record<string, PersonKey>;
  /* the System test toolbar's switch — the next business write fails once, then this clears
     itself, exactly as the prototype's own `FAILNEXT` (03-app.js:4613, 4731, 10641). */
  FAILNEXT: boolean;
  /* fixture mode only (NEXT_SAVE_REFUSED): every sign-in arms FAILNEXT, as the prototype's fixture
     wraps signIn() to set FAILNEXT after it */
  FXFAIL: boolean;
  SC: { today: Scope; leads: Scope; activity: Scope }; // "mine" | "team"
  SEC: Record<string, string>; // per-page section tab
  DRW: DrawerState | null;
  /* the top bar's Undo offer — null when there is nothing freshly one-click-written to take back */
  TJUST: TJust | null;
  /* who the sign-in screen may offer, in the record's order */
  SIGNINS: PersonKey[];
  /* the last ARL ID minted — 03-app.js:1938 */
  ARLSEQ: number;
  /* the event sheet's sample rows */
  SHEETNAMES: string[];
  SHEETNOTES: string[];
  /* the Finance projection the lead side reads (Investors pages → lead) */
  FINMIRROR: Dataset["FINMIRROR"];
  /* the Investors side's records — read by imHas/imReach/imTitle; its screens are a later story */
  IM: ImData;
  /* the Investors side's own screen state (imx.js section 8 globals) and, per two-sided page, the
     side the person chose (merge-glue.js MSIDE) */
  IMUI: ImUi;
  MSIDE: Record<string, "ir" | "im">;
  ui: UiState;
};

/* ---- the actions -----------------------------------------------------------------------------

   One case per prototype mutator, under the prototype's own name. The shell implements the ones
   the shell needs; every other case is present, typed, and marked TODO(pages-x) so the page agent
   that owns it can fill it in without inventing an action name or touching this union. An
   unimplemented case returns state unchanged — it never throws and never half-writes. */
export type Action =
  /* ---- the lead page's own composite writes (features/lead/reducer.ts) ---- */
  | LeadPageAction
  /* ---- shell: implemented here ---- */
  | { type: "go"; v: NavKey; id?: LeadId; ev?: string }
  /* the data half arrives (GET /api/data) or changes under an open page (a fixture): replace
     every record slice, keep who is signed in, the route, the open drawer and the drafts */
  | { type: "hydrate"; ds: Dataset; version: number; fixtures: boolean }
  /* signIn(k)/signOut(why) — ir-merged.js 11072-11075 */
  | { type: "signIn"; k: PersonKey }
  | { type: "signOut"; why?: SignOutWhy }
  /* the Investors side: every write goes through imReducer as the signed-in person */
  | { type: "im"; a: ImAction }
  /* setSide(k,s) — merge-glue.js:111 */
  | { type: "setSide"; k: string; s: "ir" | "im" }
  | { type: "setPerson"; k: PersonKey }
  | { type: "setRole"; seat: SeatKey }
  | { type: "setScope"; view: "today" | "leads" | "activity"; to: Scope }
  | { type: "setSec"; view: string; k: string }
  | { type: "openDrawer"; k: DrawerKind; id?: string | null; seed?: Partial<UiState> }
  | { type: "closeDrawer" }
  | { type: "useTemp"; id: string }
  | { type: "dropTemp" }
  | { type: "setTheme"; theme: Theme | null }
  | { type: "setUi"; patch: Partial<UiState> }
  /* log(what,lead,note,kind) — 03-app.js:1228. A page whose write is not modelled as its own
     action (the activity export, "Exported the activity log" — 03-app.js:11618) still needs one
     line in the record; this is that line, gated by nothing beyond "you may see the page you say
     you exported" so it can never be used to plant a line about a lead the caller may not open. */
  | { type: "log"; what: string; lead: LeadId | null; note: string; kind: LogEntry["kind"] }
  /* showRef(k,id,where)/hideRef(k) — 03-app.js:11501,11510. `k` is the record's address
     (`"pay:L6"`, `"claim:L6"`, `"xfer:L6"`), never the value; `id` is the caller's own defensive
     check that it is asking about the record it thinks it is. */
  | { type: "showRef"; k: string; id?: string | null; where?: string }
  | { type: "hideRef"; k: string }
  /* armFail(v) — 03-app.js:10641. The System test toolbar's one-shot failed-write switch. */
  | { type: "armFail"; v: boolean }
  /* a test fixture's client half (FIXTURE_MODE=local only, dispatched by the store from GET
     /api/data): "offline" is an effect the store performs (the browser reports it lost its
     connection); "failNextOnSignIn" arms FAILNEXT on every sign-in (NEXT_SAVE_REFUSED) */
  | { type: "fixture"; k: "offline" | "failNextOnSignIn" }
  /* ---- TODO(pages-a): leads, one lead, today ---- */
  | { type: "logTouch"; id: LeadId; k: string }
  | { type: "tick"; id: LeadId }
  | { type: "untick"; id: LeadId }
  | { type: "skipStage"; id: LeadId }
  | { type: "undoStage"; id: LeadId }
  | { type: "assign"; id: LeadId; to: PersonKey | null }
  /* dropAssign(id) — 03-app.js:5192. The Undo for a fresh assign(): put an unowned lead back to
     nobody. assign() only ever gives an owner to a lead that had none, so this is the whole of
     undoing it — no reason to collect, unlike an un-ticked rung. Shell-implemented: it reads and
     clears TJUST, the shell's own Undo-offer state, below. */
  | { type: "dropAssign"; id: LeadId }
  | { type: "setSecondary"; id: LeadId; to: PersonKey | null }
  | { type: "reassignTo"; id: LeadId; to: PersonKey; why: string }
  | { type: "askMove"; id: LeadId; to: PersonKey; why: string }
  | { type: "decideMove"; id: LeadId; ok: boolean }
  | { type: "setAsTo"; v: PersonKey | null }
  | { type: "handover"; id: LeadId; perm: boolean; why: string }
  | { type: "endCover"; id: LeadId }
  | { type: "endCoverFor"; k: PersonKey }
  | { type: "seedNext"; id: LeadId }
  /* setNXD(k,v) — 03-app.js:6379. `ch` is the next step's own channel — set directly here, or
     derived from `t` by `channelForAction` (pages-a's own write, `NXD.ch=channelForAction(v)`
     when it is not "other"). `NextDraft` (`src/features/leads/ui.ts`) needs the matching `ch`
     field — see crossOwnerRequests. */
  | { type: "setNXD"; k: "t" | "d" | "tm" | "ch"; v: string }
  | { type: "quickDate"; n: number }
  | { type: "saveNext"; id: LeadId }
  | { type: "clearNext"; id: LeadId }
  | { type: "keepNext"; id: LeadId }
  | { type: "pullIn"; id: LeadId }
  | { type: "moveNextTo"; id: LeadId; days: number }
  | { type: "askReschedule"; id: LeadId | null }
  | { type: "seedTouch"; id: LeadId }
  | { type: "setTD"; k: "k" | "d" | "tm"; v: string }
  | { type: "saveTouch"; id: LeadId }
  | { type: "dropTouch"; id: LeadId; k: string; at: string }
  /* saveFollowup(id)/discardFollowup(id) — ir-console-redesigned.html:6011,6097,6141 (grep
     openFollowup/saveFollowup/FUCHANNELS). The redesign's combined outcome-and-next-step save: one
     record of what happened (into `INTERACTIONS` and `LOG`), and, in the same write, either the
     next step it leaves behind or the fact that the one it had is now done. The draft itself rides
     `ui.FU` (patched with the existing generic `setUi`, same idiom as every other half-typed form —
     no dedicated `setFU` action is needed for that). */
  | { type: "saveFollowup"; id: LeadId }
  | { type: "discardFollowup"; id: LeadId }
  /* saveDetails(id,tab) — ir-console-redesigned.html:11958-11990 (detailsBody/saveDetails). Two
     distinct writes behind one drawer's two tabs: a profile correction (name/mobile/email/city/
     the investment-intent unit count while nothing is reserved yet) and a contact-permission
     record (which channels, how, and when it was given — clearing every channel records
     withdrawal). Both ride a component-local draft (`src/features/lead/drawers/call.tsx`,
     `DetailsBody`) rather than `ui`, since neither has a reader anywhere else that would need it
     seeded ahead of the drawer opening; only the validated result reaches the reducer. Also
     records the correction into `Lead.profileHistory` and logs it field-by-field, ir-console-
     redesigned.html:11973-11994. */
  | { type: "saveProfileDetails"; id: LeadId; patch: { n: string; ph: string; em: string; city: string; units: string; introducedBy: string; contactPreference: string } }
  | { type: "saveContactPermission"; id: LeadId; con: Record<Channel, boolean>; how: string; date: string; time: string }
  | { type: "setFc"; id: LeadId; c: string }
  | { type: "setFcBy"; id: LeadId; days: number }
  | { type: "setFcEv"; id: LeadId; t: string }
  /* setFcDate(id, v) — ir-console-redesigned.html:3446. A literal calendar date for the same
     field `setFcBy` sets by day-count; refuses silently on the same terms `setFcBy` already
     enforces (`canPlan`, qualified, not yet paid, a real future-or-today date). */
  | { type: "setFcDate"; id: LeadId; v: string }
  | { type: "closeLost"; id: LeadId; why: string; note: string }
  | { type: "reopenLost"; id: LeadId }
  | { type: "addNote"; id: LeadId }
  | { type: "setCall"; id: LeadId; o: string }
  | { type: "toggleObj"; id: LeadId; o: string }
  | { type: "mat"; id: LeadId; d: string }
  | { type: "pack"; id: LeadId; w: number }
  | { type: "setSort"; v: string }
  | { type: "setLQ"; v: string }
  | { type: "clearLeadFilters" }
  | { type: "toLeads"; set: string | null; scope?: Scope }
  /* ---- TODO(pages-a / pages-d): the paperwork rounds ---- */
  | { type: "prDraft"; id: LeadId; link: string }
  | { type: "prRedraft"; id: LeadId; link: string }
  | { type: "prAgreed"; id: LeadId; link: string }
  | { type: "prSend"; id: LeadId; rk: string }
  | { type: "prTold"; id: LeadId; rk: string; ch: string }
  | { type: "prChase"; id: LeadId; rk: string; ch: string; phase: string }
  | { type: "prSaid"; id: LeadId; rk: string }
  | { type: "prVerify"; id: LeadId; rk: string }
  | { type: "prBounce"; id: LeadId; rk: string; why: string }
  | { type: "prGate"; id: LeadId; rk: string; beat: string }
  /* ---- TODO(pages-b): add, events, updates, activity ---- */
  | { type: "addLead" }
  | { type: "setAddF"; k: string | null }
  | { type: "setCon"; k: keyof AddCon }
  | { type: "addEvent" }
  /* saveEvent()/dropEvent(id) — ir-console-redesigned.html:3835, 3881. The draft rides in
     `ui.EVD` (seeded by `openDrawer`'s `seed`, `@/features/events/eventDraft`'s `uiEVD`), so
     `saveEvent` itself carries no payload — same idiom as `saveNext`/`saveTouch`. */
  | { type: "saveEvent" }
  | { type: "dropEvent"; id: EventId }
  | { type: "loadSheet"; ev: string }
  /* markRead(k) — ir-console-redesigned.html:8427. `k` omitted reads as "every group". */
  | { type: "markRead"; k?: string }
  /* flagDupe/csvImport — features/add/reducer.ts implements both; only the union and dispatch
     typing blocked a clean call site (see crossOwnerRequests). */
  | { type: "flagDupe"; id: LeadId }
  | { type: "csvImport" }
  /* ---- TODO(pages-c): people, profile, plan, system ---- */
  | { type: "startPerson" }
  | { type: "editPerson"; k: string; v: string }
  | { type: "cancelPerson" }
  | { type: "addPerson" }
  | { type: "removePerson"; k: PersonKey }
  | { type: "setMgr"; k: PersonKey; m: PersonKey | null }
  /* setSeat(seat, who) — ir-console-redesigned.html:11063. `who` is the person whose seat changes;
     omitted, it falls back to the Members list's own `PSEL` (03-app.js:11064), which is
     `psel(state)` in this port. */
  | { type: "setSeat"; seat: SeatKey; who?: PersonKey }
  | { type: "toggleCap"; k: PersonKey; p: NavKey; c: string }
  | { type: "resetCaps"; k: PersonKey }
  | { type: "setMe"; f: string; v: string }
  | { type: "setMyStyle"; c: number; sq: boolean }
  | { type: "setAvail"; k: PersonKey; why?: string; from?: string | null; to?: string | null }
  | { type: "setOutWhy"; k: PersonKey; why: string }
  | { type: "setOutFrom"; k: PersonKey; from: string }
  | { type: "setOutTo"; k: PersonKey; to: string }
  | { type: "tSet"; f: string; v: string }
  | { type: "startTemp"; to: PersonKey }
  | { type: "grantTemp" }
  | { type: "revokeTemp"; id: string }
  | { type: "bump"; k: string; d: number; lo: number; hi: number }
  | { type: "setNum"; pk: number; f: string; v: string }
  | { type: "setTarget"; pk: number; d: number }
  | { type: "setActual"; pk: number; d: number }
  | { type: "setPeriodDate"; pk: number; f: string; v: string }
  | { type: "setGrain"; g: string }
  | { type: "addPeriod" }
  | { type: "dropPeriod"; pk: number }
  | { type: "setBaseline"; d: number; why: string }
  | { type: "setRecov"; k: string; act: string; who: PersonKey; days: number }
  | { type: "clearRecov"; k: string }
  /* ---- TODO(pages-d): payments, documents, transfers, inventory ---- */
  | { type: "record"; id: LeadId; kind: string }
  | { type: "setPay"; f: "who" | "mode" | "utr"; v: string }
  | { type: "claimPaid"; id: LeadId }
  | { type: "confirmClaim"; id: LeadId }
  | { type: "rejectClaim"; id: LeadId; why: string }
  | { type: "reopenClaim"; id: LeadId }
  /* startPaymentReport(id) — 03-app.js:5527. Archives the confirmed claim into CLAIMARCHIVE[id],
     clears CLAIM[id] and opens a fresh draft. */
  | { type: "startPaymentReport"; id: LeadId }
  /* setClaim — the payment-report draft's fields. "amount" and "said_on" are the redesign's own
     typed facts (payment-report-workflow-check.cjs: claimDraft carries kind/mode/amount/said_on/
     ref/note); declared here so pages-d has the compiler's check when it writes them. */
  | { type: "setClaim"; f: "kind" | "mode" | "amount" | "said_on" | "ref" | "note"; v: string }
  | { type: "askExt"; id: LeadId; days: number }
  | { type: "decideExt"; id: LeadId; ok: boolean }
  | { type: "lapse"; id: LeadId }
  | { type: "sendDoc" }
  | { type: "recordDoc"; id: LeadId; t: string }
  | { type: "setReleased"; d: number }
  | { type: "acctAuto"; id: LeadId }
  | { type: "acctLapsed"; id: LeadId }
  | { type: "xferAuto"; id: LeadId }
  | { type: "copyInvestor"; id: LeadId };

/* ---- initial state --------------------------------------------------------------------------- */

/* the prototype's `ROLE=roleOf(k)`: the seat is read off the person, never set beside them */
const seatOf = (people: Record<PersonKey, Person>, k: PersonKey): SeatKey =>
  people[k]?.seat as SeatKey;

/* the ui bag a fresh session starts with — every draft belongs to its author */
const freshUi = (THEME: Theme | null, RAILMIN: boolean): UiState => ({
  THEME,
  RAILMIN,
  HQ: "",
  AVQ: "",
  ABWHY: null,
  ABFROM: null,
  ABTO: null,
  LQ: "",
  LFILT: null,
  LSRC: null,
  LSTAGE: null,
  LSTAGEMODE: "at",
  LOWN: null,
  LQUIET: null,
  NOTICE: null,
});

/* THE RECORD SLICES OF A DATASET — every collection copied, the clock revived, and the dates the
   fixture wrote as "29 Aug" pinned to the book's own year (the cover and grant windows). Nothing
   else in the state comes from the dataset. */
export function dataSlices(ds: Dataset) {
  const NOW = reviveClock(ds.NOW), TODAY = reviveClock(ds.TODAY);
  const pinCover = (c: Cover): Cover => {
    const from = c.from ? pinAccessDate(c.from, NOW) : undefined;
    return { ...c, ...(from ? { from } : {}), to: pinAccessDate(c.to, accessDay(from, NOW) || NOW) };
  };
  const d = structuredClone(ds);
  return {
    NOW,
    TODAY,
    LEADS: d.LEADS.map(l => l.cov ? { ...l, cov: pinCover(l.cov) } : l) as Lead[],
    PEOPLE: d.PEOPLE,
    SIGNINS: d.SIGNINS,
    PLAN: d.PLAN as Plan,
    EVENTS: d.EVENTS as EventRec[],
    LOG: d.LOG as LogEntry[],
    PAPER: d.PAPER as Record<LeadId, PaperRow>,
    DOCS: d.DOCS as DocRec[],
    INV: d.INV as Inventory,
    TEMP: d.TEMP.map(g => {
      const from = pinAccessDate(g.from, NOW);
      return { ...g, from, until: pinAccessDate(g.until, accessDay(from, NOW) || NOW) };
    }) as TempGrant[],
    CAPS: d.GRANT,
    COVER: Object.fromEntries(Object.entries(d.COVER).map(([k, c]) => [k, pinCover(c)])) as Record<PersonKey, Cover>,
    AVAIL: d.AVAIL,
    PAY: d.PAY,
    ACCT: d.ACCT,
    CLAIM: d.CLAIM,
    CLAIMARCHIVE: d.CLAIMARCHIVE,
    REQ: d.REQ,
    EXT: d.EXT,
    XFER: d.XFER,
    ARLSEQ: d.ARLSEQ,
    SENT: d.SENT,
    NOTES: d.NOTES,
    CALLS: d.CALLS,
    PACK: d.PACK,
    PACKAT: d.PACKAT,
    RECOV: d.RECOV,
    SHEET: d.SHEET,
    SHEETNAMES: d.SHEETNAMES,
    SHEETNOTES: d.SHEETNOTES,
    INTERACTIONS: d.INTERACTIONS,
    FINMIRROR: d.FINMIRROR,
    IM: d.im,
  };
}

/* Nobody is signed in and nothing is loaded: the empty book on today's Kolkata date. The records
   arrive from GET /api/data (ConsoleProvider); the person arrives from the session. */
export function initialState(ds: Dataset = emptyDataset(clockDay(kolkataNow()))): ConsoleState {
  return projectInvestorCopies({
    authed: false,
    SIGNOUT: null,
    IMUI: initialImUi(),
    MSIDE: {},
    loaded: false,
    FIXTURES: false,
    DATAVER: 0,
    WHO: "" as PersonKey,
    ROLE: "" as SeatKey,
    VIEW: "today" as NavKey,
    LEAD: ds.LEAD as LeadId, // 03-app.js:936
    EVID: ds.EVID,
    EVKEY: ds.EVENTS.length,
    ...dataSlices(ds),
    GOALS: GOALS0,
    TEMPON: null,
    INVESTORCOPY: {},
    NSEEN: {},
    REFSEEN: {},
    FAILNEXT: false,
    FXFAIL: false,
    SC: { today: "mine", leads: "mine", activity: "mine" } as ConsoleState["SC"],
    SEC: {},
    DRW: null,
    TJUST: null,
    ui: freshUi(null, false),
  });
}

/* hydrate(ds) — the records change, the session does not. A person the new book no longer admits
   is signed out the way the prototype's revoked door does ("Your access has been turned off."). */
function hydrate(state: ConsoleState, a: { ds: Dataset; version: number; fixtures: boolean }): ConsoleState {
  const first = !state.loaded;
  const next = projectInvestorCopies({
    ...state,
    ...dataSlices(a.ds),
    loaded: true,
    FIXTURES: a.fixtures,
    DATAVER: a.version,
    LEAD: first ? (a.ds.LEAD as LeadId) : state.LEAD,
    EVID: first ? a.ds.EVID : state.EVID,
    EVKEY: Math.max(state.EVKEY, a.ds.EVENTS.length),
    INVESTORCOPY: {},
  });
  if (next.authed && !signInAdmits({ PEOPLE: next.PEOPLE, GRANT: next.CAPS, im: next.IM }, next.WHO)) return signOut(next, "revoked");
  return next.authed ? { ...next, ROLE: seatOf(next.PEOPLE, next.WHO) } : next;
}

/* endSession() — ir-merged.js:11016. Everything a seat could see or was part-way through writing
   is theirs and dies with them; the rail comes back open; nothing names a lead to whoever is next. */
function endSession(state: ConsoleState): ConsoleState {
  return {
    ...state,
    TEMPON: null,
    DRW: null,
    TJUST: null,
    SEC: {},
    NSEEN: {},
    REFSEEN: {},
    FAILNEXT: false,
    VIEW: "today" as NavKey,
    IMUI: initialImUi(),
    MSIDE: {},
    ui: freshUi(state.ui.THEME, false),
  };
}

/* IMX.close() — merge-glue.js: leaving a page or opening a lead-side drawer puts the Investors
   drawer away (its draft is stashed by the Investors reducer's own closeDrawer). */
function imClose(state: ConsoleState): ConsoleState {
  if (!state.IMUI.DRW) return state;
  return { ...state, IMUI: imReducer({ data: state.IM, ui: state.IMUI }, state.WHO, { type: "closeDrawer" }).ui };
}

/* signOut(why) — ir-merged.js:11074. A typo must not produce a silent sign-out: an unknown reason
   reads as the person's own choice. */
function signOut(state: ConsoleState, why?: SignOutWhy): ConsoleState {
  return {
    ...endSession(state),
    authed: false,
    WHO: "" as PersonKey,
    ROLE: "" as SeatKey,
    SIGNOUT: why && SIGNOUTMSG[why] ? why : "chose",
    LEAD: "" as LeadId,
    EVID: "",
    SC: { today: "mine", leads: "mine", activity: "mine" },
  };
}

/* ---- the reducer ------------------------------------------------------------------------------
   Every case copies. The prototype does `l.touch[k].push(...)` and `SC[v]=to` freely; none of that
   survives into React, where a mutated object is a render that never happens. */

export const LEAD_WRITES = new Set<string>([
  "logTouch", "tick", "untick", "skipStage", "undoStage", "assign", "dropAssign", "setSecondary",
  "reassignTo", "askMove", "decideMove", "handover", "endCover", "endCoverFor", "saveNext", "clearNext",
  "keepNext", "pullIn", "moveNextTo", "saveTouch", "dropTouch", "saveFollowup", "setFc", "setFcBy", "setFcEv", "setFcDate", "closeLost",
  "reopenLost", "addNote", "setCall", "toggleObj", "mat", "pack", "prDraft", "prRedraft", "prAgreed",
  "prSend", "prTold", "prChase", "prSaid", "prVerify", "prBounce", "prGate", "addLead", "loadSheet",
  "record", "claimPaid", "confirmClaim", "rejectClaim", "reopenClaim", "startPaymentReport", "askExt", "decideExt", "lapse",
  "sendDoc", "recordDoc", "acctAuto", "acctLapsed", "xferAuto",
  ...LEADPAGE_WRITES,
]);

/* log(what, lead, note, kind) — 03-app.js:1228, the shell's own copy (pages-d's is
   `features/pay/reducer.ts`'s `addLog`; both write the identical shape, so whichever a given
   action's owner calls, the line reads the same). Every write made while a grant is switched on
   carries it, not only the writes that happen to be on the borrowed page. */
function pushLog(
  s: ConsoleState, at: string, what: string, lead: LeadId | null, note: string, kind: LogEntry["kind"],
): ConsoleState {
  const g = tempOn(s);
  return {
    ...s,
    LOG: [{ d: iso(s.TODAY), at, who: s.WHO, what, lead, note: note || "", kind,
            temp: g ? g.id : null }, ...s.LOG],
    TEMP: g ? s.TEMP.map((x) => (x.id === g.id ? { ...x, acts: (x.acts || 0) + 1 } : x)) : s.TEMP,
  };
}

/* THE UNDO OFFER — TJUST, derived rather than declared by each writer (03-app.js:6421, 6468, 6499,
   5185, 5000). Applied once, after a write, by diffing the lead the action named: tick() and
   assign() and saveTouch() each SET the offer when their write actually landed; untick()/
   undoStage() and dropTouch() each CLEAR it when the very thing it pointed at is the thing they
   just took back — "the offer was taken". Diffing beats asking each writer to say so: an offer
   derived from the result can never name a write that did not happen, and pages-a never has to
   import shell state to keep it honest. */
function withTJust(prev: ConsoleState, next: ConsoleState, a: Action): ConsoleState {
  if (next === prev || !("id" in a)) return next;
  const id = a.id as LeadId;
  const ol = prev.LEADS.find((l) => l.id === id);
  const nl = next.LEADS.find((l) => l.id === id);
  if (!ol || !nl) return next;
  if (a.type === "tick" && nl.done === ol.done + 1) {
    return { ...next, TJUST: { w: "rung", id, r: nl.done, at: nl.at[nl.done - 1]! } };
  }
  if (a.type === "assign" && !ol.own && a.to && nl.own === a.to) {
    return { ...next, TJUST: { w: "own", id, to: a.to, at: next.LOG[0]?.at ?? stamp(nowT(next.NOW)) } };
  }
  if (a.type === "saveTouch") {
    for (const k of Object.keys(nl.touch) as (keyof typeof nl.touch)[]) {
      const before = ol.touch[k]?.length ?? 0, after = nl.touch[k]?.length ?? 0;
      if (after > before) return { ...next, TJUST: { w: "touch", id, k, at: nl.touch[k]![after - 1]! } };
    }
    return next;
  }
  if ((a.type === "untick" || a.type === "undoStage") && prev.TJUST?.w === "rung" && prev.TJUST.id === id) {
    return { ...next, TJUST: null };
  }
  if (a.type === "dropTouch" && prev.TJUST?.w === "touch" && prev.TJUST.id === id && prev.TJUST.k === a.k && prev.TJUST.at === a.at) {
    return { ...next, TJUST: null };
  }
  return next;
}

export function reducer(state: ConsoleState, a: Action): ConsoleState {
  if (a.type === "hydrate") return hydrate(state, a);
  if (a.type === "signOut") return signOut(state, a.why);
  /* signIn(k) — ir-merged.js:11072. Either side's admission lets them in; the lead side's own
     landing rules (setPerson) then run as them. An Investors-only seat has no lead book to land on. */
  if (a.type === "signIn") {
    if (!signInAdmits({ PEOPLE: state.PEOPLE, GRANT: state.CAPS, im: state.IM }, a.k)) return state;
    const opened: ConsoleState = {
      ...endSession(state), authed: true, SIGNOUT: null, WHO: a.k, ROLE: seatOf(state.PEOPLE, a.k), LEAD: state.LEAD,
    };
    const signed = consoleAccount(state.PEOPLE, a.k, state.CAPS) ? reducer(opened, { type: "setPerson", k: a.k }) : opened;
    return state.FXFAIL ? { ...signed, FAILNEXT: true } : signed;
  }
  if (a.type === "fixture") return a.k === "failNextOnSignIn" && state.FIXTURES ? { ...state, FXFAIL: true } : state;
  if (!state.authed && a.type !== "setTheme") return state;
  /* the Investors side (merge-glue.js IMHOOK): its writes run as the signed-in person; opening one of
     its drawers closes the lead side's (IMHOOK.closeIR); its go(v) lands on the console page that
     carries v, on the Investors side of it (IMHOOK.go) */
  if (a.type === "im") {
    const r = imReducer({ data: state.IM, ui: state.IMUI }, state.WHO, a.a);
    let next: ConsoleState = { ...state, IM: r.data, IMUI: r.ui };
    if (a.a.type === "openDrawer" && r.ui.DRW) next = { ...next, DRW: null };
    if (a.a.type === "go") {
      const k = IM2M[a.a.v] as NavKey | undefined;
      if (k) next = { ...next, VIEW: k, DRW: null, MSIDE: { ...next.MSIDE, [k]: "im" } };
    }
    return next;
  }
  if (a.type === "setSide") {
    return { ...imClose(state), DRW: null, MSIDE: { ...state.MSIDE, [a.k]: a.s } };
  }
  if (a.type === "go") state = { ...imClose(state), IMUI: { ...imClose(state).IMUI, NOTE: null } };
  if (a.type === "openDrawer") state = imClose(state);
  if (!accountAllowed(state) && !["setPerson", "setRole", "setTheme"].includes(a.type)) return state;
  if (LEAD_WRITES.has(a.type) && !canOperateLeads(state)) return state;
  if ((LEADPAGE_WRITES as readonly string[]).includes(a.type)) return leadPageReducer(state, a as LeadPageAction, reducer);
  if (a.type.startsWith("pr")) return state; // Paper's source mirror is written only in Investor Management.
  if (["acctAuto", "acctLapsed", "xferAuto"].includes(a.type)) return state;
  if (LEAD_WRITES.has(a.type) && "id" in a && state.LEADS.some(l => l.id === a.id)
    && !openable(state).some(l => l.id === a.id)) return state;
  switch (a.type) {
    case "copyInvestor": return recordInvestorCopy(state,a.id);
    /* go(v,id,ev) — 03-app.js:7113. The navigation itself is the Next router's; this is the state
       half of it: never let a half-finished thing follow you to the next screen. */
    case "go": {
      if (!canReach(state, a.v)) return state;
      if (a.id && !openable(state).some(l => l.id === a.id)) return state;
      return {
        ...state,
        VIEW: a.v,
        LEAD: a.id ?? state.LEAD,
        EVID: a.ev ?? state.EVID,
        DRW: null,
        TJUST: null,
        /* NAVSEQ/NAVLEAD: which go() this is, so the shell can draw its page before the route lands */
        ui: { ...state.ui, NXASK: null, ASKW: null, ASKD: null, NDRAFT: "", NAVSEQ: Number(state.ui.NAVSEQ || 0) + 1, NAVLEAD: a.id ?? null },
      };
    }

    /* setPerson(k) — 03-app.js:7124. ROLE is derived and never set directly, so a person and their
       seat can never disagree. The landing checks that follow it live in the shell (landSafe), which
       is where the router can actually act on them. */
    case "setPerson": {
      const p = state.PEOPLE[a.k];
      if (!p || !consoleAccount(state.PEOPLE, a.k, state.CAPS)) return state;

      /* The person changes first, because every rule below is read AS the new person — the
         prototype reassigns the WHO/ROLE globals and then calls seesTeam()/myBook()/visible(),
         so the answers are the incoming seat's, never the outgoing one's. 03-app.js:7124. */
      const next: ConsoleState = {
        ...state,
        WHO: a.k,
        ROLE: seatOf(state.PEOPLE, a.k),
        TEMPON: null,
        DRW: null,
        TJUST: null,
        SEC: {},
        /* endSession() — 03-app.js:13318-13355. What one seat has read, revealed or armed is not
           what the next signs in to: NSEEN, REFSEEN and FAILNEXT are session state, wiped whole on
           every door, never carried to whoever signs in next. */
        NSEEN: {},
        REFSEEN: {},
        FAILNEXT: false,
        /* Every draft belongs to its author. Optional feature fields fall back to their defaults. */
        ui: freshUi(state.ui.THEME, state.ui.RAILMIN),
      };

      /* A seat with no book of its own opens on the queue it actually works — decided per seat,
         not defaulted to "mine". Getting this wrong lands Digital Infrastructure, Corporate Ops
         and the BU Owner on an empty personal day and hides the queue they signed in to read.
         03-app.js:7133-7134. `activity` is not in the prototype's SC and follows `today`. */
      const team = seesTeam(next);
      const SC = {
        today: (team && !myBook(next).length ? "team" : "mine") as Scope,
        leads: (team && !visible(next).length ? "team" : "mine") as Scope,
        activity: (team && !myBook(next).length ? "team" : "mine") as Scope,
      };

      /* The screen you were on may not be one this seat holds. 03-app.js:7130-7132. */
      const ok = navFor(next).map((n) => n.k).concat(canReach(next, "me") ? ["me"] : []);
      let VIEW = next.VIEW;
      if (VIEW === "leads" && next.LEAD) {
        if (!ok.includes("leads")) VIEW = ok[0] ?? VIEW;
      } else if (!ok.includes(VIEW)) VIEW = ok[0] ?? VIEW;

      /* A seat with no book lands where its work actually is, not on an empty queue.
         03-app.js:7136-7137. */
      if (
        !myBook(next).length &&
        !team &&
        ok.includes("numbers") &&
        (["today", "updates", "leads"] as readonly string[]).includes(VIEW)
      ) {
        VIEW = "numbers";
      }

      /* And the lead you had open may not be one this seat may open. 03-app.js:7138. */
      const LEAD =
        VIEW === "leads" && !openable(next).some((l) => l.id === next.LEAD)
          ? openable(next)[0]?.id ?? ("" as LeadId)
          : next.LEAD;

      return { ...next, SC, VIEW, LEAD };
    }

    /* setRole(seat) — 03-app.js:7153. The harness and any old call site still say "be this seat";
       give them the first person in it. */
    case "setRole": {
      const k = Object.keys(state.PEOPLE).find(
        (x) => state.PEOPLE[x as PersonKey] && state.PEOPLE[x as PersonKey].on && seatOf(state.PEOPLE, x as PersonKey) === a.seat,
      );
      return k ? reducer(state, { type: "setPerson", k: k as PersonKey }) : state;
    }

    /* setScope(v,to) — 03-app.js:1346. A seat that cannot see a team cannot switch to one; that
       guard is seesTeam() and it is applied at the call site, which is the rail. */
    case "setScope":
      if (a.to === "team" && !seesTeam(state)) return state;
      if (state.SC[a.view] === a.to) return state;
      return { ...state, SC: { ...state.SC, [a.view]: a.to } };

    /* setSec(v,k) — 03-app.js:4063. Changing section closes the drawer, because the drawer was
       about something on the section you just left. */
    case "setSec":
      return { ...state, SEC: { ...state.SEC, [a.view]: a.k }, DRW: null };

    /* openDrawer(k,id,seed) — 03-app.js:6161. The door is a toggle: opening the drawer that is
       already open on the same record closes it. `seed` primes the draft the body will read. */
    case "openDrawer": {
      const id = a.id ?? null;
      if (!canOpenDrawerBase(state, a.k, id)) return state;
      if (state.DRW && state.DRW.k === a.k && state.DRW.id === id) {
        return { ...state, DRW: null };
      }
      const drafted = a.k === "next" && id
        ? pagesAReducer(state, { type: "seedNext", id: id as LeadId }) ?? state
        : a.k === "touch" && id ? pagesAReducer(state, { type: "seedTouch", id: id as LeadId }) ?? state : state;
      return {
        ...state,
        DRW: { k: a.k, id },
        ui: {
          ...drafted.ui,
          /* Text for one investor must never be offered as a draft for another investor. */
          ...(a.k === "notes" ? { NDRAFT: "" } : {}),
          ...(a.k === "lost" ? { LOSTW: null, LOSTN: "" } : {}),
          ...(a.k === "claim" ? { CKIND: "advance", CREF: "", CNOTE: "" } : {}),
          ...(a.k === "owner" || a.k === "reassign" ? { ASTO: null, MVTO: null, ASKW: null, ASKD: null } : {}),
          ...a.seed,
        },
      };
    }

    /* closeDrawer() — 03-app.js:6170 */
    case "closeDrawer":
      return state.DRW ? { ...state, DRW: null } : state;

    /* useTemp(id) / dropTemp() — 03-app.js:5621, 5627. Borrowed access is never quiet: switching it
       on puts it on the top bar of every screen until it is switched off. */
    case "useTemp": {
      const g = state.TEMP.find((x) => x.id === a.id);
      if (!g || !tempOn({ ...state, TEMPON: a.id })) return state;
      return { ...state, TEMPON: a.id, DRW: null };
    }
    case "dropTemp":
      return state.TEMPON === null ? state : { ...state, TEMPON: null, DRW: null };

    case "setTheme":
      return { ...state, ui: { ...state.ui, THEME: a.theme } };

    case "setUi":
      return { ...state, ui: { ...state.ui, ...a.patch } };

    /* log(what,lead,note,kind) — 03-app.js:1228. */
    case "log": {
      if (a.lead && !openable(state).some((l) => l.id === a.lead)) return state;
      return pushLog(state, stamp(nowT(state.NOW)), a.what, a.lead, a.note, a.kind);
    }

    /* ---------------------------------------------------------------------------------------------
       Everything below is declared so a page agent has a compile-time-known action name to dispatch
       and a single place to implement it. Until then each returns state unchanged.
       TODO(pages-a): logTouch tick untick skipStage undoStage assign setSecondary reassignTo askMove
         decideMove setAsTo handover endCover endCoverFor seedNext setNXD quickDate saveNext
         clearNext keepNext pullIn moveNextTo askReschedule seedTouch setTD saveTouch dropTouch
         setFc setFcBy setFcEv closeLost reopenLost addNote setCall toggleObj mat pack setSort
         setLQ clearLeadFilters toLeads prDraft prRedraft prAgreed prSend prTold prChase prSaid
         prVerify prBounce prGate
       TODO(pages-b): addLead setAddF setCon addEvent loadSheet markRead
       TODO(pages-c): startPerson editPerson cancelPerson addPerson removePerson setMgr setSeat
         toggleCap resetCaps setMe setMyStyle setAvail setOutWhy setOutFrom setOutTo tSet startTemp
         grantTemp revokeTemp bump setNum setTarget setActual setPeriodDate setGrain addPeriod
         dropPeriod setBaseline setRecov clearRecov
       TODO(pages-d): record setPay claimPaid confirmClaim rejectClaim reopenClaim setClaim
         startPaymentReport askExt decideExt lapse sendDoc recordDoc setReleased acctAuto
         acctLapsed xferAuto

       Those TODOs are now met by the four feature reducers composed below. Each owns its own
       actions and returns null for anything it does not handle, so the four never contend for a
       case: one action, one writer — the rule the system is built on, applied to its own code.
       ------------------------------------------------------------------------------------------ */
    /* dropAssign(id) — 03-app.js:5192, the inverse of assign() above. Implemented here, beside
       TJUST, rather than in pages-a's reducer: the whole of the write is "put an unowned lead back
       to nobody", and the one fact it reads to decide whether it still may is TJUST itself. */
    case "dropAssign": {
      const t = state.TJUST;
      const l = state.LEADS.find((x) => x.id === a.id);
      if (!l || !t || t.w !== "own" || t.id !== a.id || l.own !== t.to || !fresh(t.at, state.NOW)) return state;
      if (!canAssign(state) && !(isIR(state.ROLE) && t.to === state.WHO)) return state;
      const at = stamp(nowT(state.NOW));
      const grant = tempOn(state);
      return {
        ...state,
        LEADS: state.LEADS.map((x) => (x.id === a.id ? { ...x, own: null } : x)),
        LOG: [
          {
            d: iso(state.TODAY),
            at,
            who: state.WHO,
            what: "Removed the owner",
            lead: a.id,
            note: `${P(state.PEOPLE, t.to).n} — picked up ${agoStr(t.at, state.NOW)}`,
            kind: "admin",
            temp: grant ? grant.id : null,
          },
          ...state.LOG,
        ],
        TEMP: grant ? state.TEMP.map((x) => (x.id === grant.id ? { ...x, acts: (x.acts || 0) + 1 } : x)) : state.TEMP,
        TJUST: null,
      };
    }

    /* startPaymentReport(id) — 03-app.js:5527. Archives the confirmed claim into CLAIMARCHIVE[id],
       clears CLAIM[id] and opens a fresh draft — a lead may owe more than one payment, and starting
       a second report must never overwrite the first Finance already matched. */
    case "startPaymentReport": {
      const l = state.LEADS.find((x) => x.id === a.id);
      const c = claimOf(state, a.id);
      if (!l || !c || c.state !== "confirmed" || !canClaim(state, l)) return state;
      const CLAIM = { ...state.CLAIM };
      delete CLAIM[a.id];
      return {
        ...state,
        CLAIMARCHIVE: { ...state.CLAIMARCHIVE, [a.id]: [...(state.CLAIMARCHIVE[a.id] || []), c] },
        CLAIM,
        DRW: { k: "claim", id: a.id },
      };
    }

    /* saveEvent()/dropEvent(id) — ir-console-redesigned.html:3835,3881. The draft is `ui.EVD`
       (@/features/events/eventDraft's uiEVD); saving names what moved, exactly as the prototype's
       own diff does, so "Changed the event" never reads as a bare, unverifiable line. */
    case "saveEvent": {
      if (!may(state, "events", "edit")) return state;
      const d = uiEVD(state.ui);
      const existing = d.id ? state.EVENTS.find((x) => x.id === d.id) ?? null : null;
      if (d.id && !existing) return state;
      const eligible = (k: PersonKey) => assignees(state).includes(k);
      if (evGaps(d, existing, eligible).length) return state;
      const n = d.n.trim(), city = d.city.trim(), date = evDateText(d.from, d.to);
      const at = stamp(nowT(state.NOW));
      if (!existing) {
        const EVKEY = state.EVKEY + 1;
        const id = evNextId(EVKEY);
        const irs = d.staff.filter(eligible);
        const ev: EventRec = {
          id, n, type: d.type, ch: d.ch, date, city, cost: d.cost, staff: [...d.staff],
          state: d.state, off: d.state === "done" ? d.off : 0,
        };
        return pushLog(
          { ...state, EVENTS: [ev, ...state.EVENTS], EVID: id, EVKEY, DRW: null },
          at, "Added event", null,
          n + " · " + date + " · " + city + " · "
            + (irs.length ? irs.map((k) => P(state.PEOPLE, k).n.split(" ")[0]).join(", ") + " working it"
              : "nobody named to work it"),
          "admin",
        );
      }
      const tag = state.LEADS.filter((x) => x.ev === existing.id).length;
      const moved: string[] = [];
      if (existing.n !== n) moved.push("name: " + existing.n + " → " + n);
      if (existing.type !== d.type) moved.push("kind: " + existing.type + " → " + d.type);
      if (existing.ch !== d.ch) moved.push("channel: " + existing.ch + " → " + d.ch);
      if (existing.date !== date) moved.push("dates: " + existing.date + " → " + date);
      if (existing.city !== city) moved.push("city: " + existing.city + " → " + city);
      if (existing.cost !== d.cost)
        moved.push("cost: ₹" + existing.cost.toLocaleString("en-IN") + " → ₹" + d.cost.toLocaleString("en-IN"));
      if (existing.staff.join() !== d.staff.join())
        moved.push("working it: " + (d.staff.length ? d.staff.map((k) => P(state.PEOPLE, k).n.split(" ")[0]).join(", ") : "nobody"));
      let nextState = existing.state;
      if (existing.state === "planned" && d.state === "done") { nextState = "done"; moved.push("it has run"); }
      let off = existing.off;
      if (nextState === "done") {
        const wantOff = Math.max(d.off, tag);
        if ((existing.off || 0) !== wantOff) moved.push("names taken on the night: " + (existing.off || 0) + " → " + wantOff);
        off = wantOff;
      }
      const updated: EventRec = {
        ...existing, n, type: d.type, ch: d.ch, date, city, cost: d.cost, staff: [...d.staff], state: nextState, off,
      };
      return pushLog(
        { ...state, EVENTS: state.EVENTS.map((x) => (x.id === existing.id ? updated : x)), DRW: null },
        at, "Changed the event", null,
        updated.n + " — " + (moved.length ? moved.join(" · ") : "nothing moved")
          + (tag ? " · " + tag + " lead" + (tag === 1 ? "" : "s") + " stay tagged to it" : ""),
        "admin",
      );
    }
    case "dropEvent": {
      if (!may(state, "events", "edit")) return state;
      const e = state.EVENTS.find((x) => x.id === a.id);
      if (!e) return state;
      const n = state.LEADS.filter((l) => l.ev === a.id).length;
      const at = stamp(nowT(state.NOW));
      const EVENTS = state.EVENTS.filter((x) => x.id !== a.id);
      /* delete SHEET[id] — ir-console-redesigned.html:3906. A sheet belongs to its event and
         outlives nothing. */
      const SHEET = { ...state.SHEET };
      delete SHEET[a.id];
      /* if(EVD&&EVD.id===id) EVD=null — :3909. The draft this drawer was editing named the very
         record the write just removed; leaving it would let a stale "Save event" resurrect it. */
      const evd = state.ui.EVD as { id?: string | null } | undefined;
      const ui = evd && evd.id === a.id ? { ...state.ui, EVD: undefined } : state.ui;
      return pushLog(
        {
          ...state,
          EVENTS,
          SHEET,
          LEADS: state.LEADS.map((l) => (l.ev === a.id ? { ...l, ev: null } : l)),
          EVID: state.EVID === a.id ? (EVENTS[0]?.id ?? ("" as EventId)) : state.EVID,
          DRW: null,
          ui,
        },
        at, "Removed event", null,
        e.n + " · " + e.date + " — " + (n ? n + " lead" + (n === 1 ? "" : "s") + " left with no event named"
          : "nothing was tagged to it"),
        "admin",
      );
    }

    /* showRef(k,id,where)/hideRef(k) — 03-app.js:11501-11510. Rule 7: a reveal is logged against a
       name at a minute, never quietly carried past this session (`REFSEEN`, cleared whole by
       `setPerson`, above). A scoped Finance reader (D42: IR/Convener) never reaches this — `may`'s
       own gate. */
    case "showRef": {
      const i = a.k.indexOf(":"), recordId = i < 0 ? a.k : a.k.slice(i + 1);
      if (scopedFinanceReader(state) || !seeMoney(state) || !refAllowed(state, a.k) || (a.id && a.id !== recordId)) return state;
      const v = refOf(state, a.k);
      if (!v) return state;
      const at = stamp(nowT(state.NOW));
      return pushLog(
        { ...state, REFSEEN: { ...state.REFSEEN, [a.k]: state.WHO } },
        at, "Revealed a bank reference",
        state.LEADS.some((l) => l.id === recordId) ? (recordId as LeadId) : null,
        (a.where || "Payments") + " · " + maskRef(v) + " · shown to " + P(state.PEOPLE, state.WHO).n + " at " + at,
        "money",
      );
    }
    case "hideRef": {
      if (!(a.k in state.REFSEEN)) return state;
      const REFSEEN = { ...state.REFSEEN };
      delete REFSEEN[a.k];
      return { ...state, REFSEEN };
    }

    /* armFail(v) — 03-app.js:10641. Only who may edit System may arm it. */
    case "armFail":
      return own(state, "system", "edit") ? { ...state, FAILNEXT: a.v } : state;

    /* setFcDate(id,v) — ir-console-redesigned.html:3446. A literal calendar date for the field
       `setFcBy` (pages-a's) sets by day-count instead; both write the same `l.fc.by/at/who`. */
    case "setFcDate": {
      const l = state.LEADS.find((x) => x.id === a.id);
      if (!l || lost(l) || !canPlan(state, l) || !l.fc || l.done < ST.QUALIFIED) return state;
      if (l.done >= ST.PAID || payOf(state, a.id)?.state === "full") return state;
      const date = dOf(a.v);
      if (!date || iso(date) < iso(state.TODAY)) return state;
      const by = String(date.getDate()).padStart(2, "0") + " " + MON[date.getMonth()] + " " + date.getFullYear();
      const at = stamp(nowT(state.NOW));
      return pushLog(
        { ...state, LEADS: state.LEADS.map((x) => (x.id === a.id ? { ...x, fc: { ...x.fc!, by, at, who: state.WHO } } : x)) },
        at, "Set the expected full-payment date", a.id, by, "stage",
      );
    }

    /* saveFollowup(id) — ir-console-redesigned.html:6097-6141. One record of what happened, into
       `INTERACTIONS` and `LOG`, and — in the same write — either the next step it leaves behind or
       the fact that the one it had is now done. ponytail: this covers the observable record every
       caller needs (the interaction, the touch/ladder tick, the reply and CALLS mirrors, the note,
       the next step, the log line); the prototype's own staleness re-check ("the scheduled task
       changed while this form was open") and its full next-step-channel cross-validation are left
       to the drawer that collects `ui.FU`, once one exists — see crossOwnerRequests. */
    case "saveFollowup": {
      const l = state.LEADS.find((x) => x.id === a.id);
      const d = uiFU(state.ui);
      if (!l || !d || !canWork(state, l) || !canPlan(state, l)) return state;
      const channelOk = d.channel === "reply" || d.channel === "other" || conFor(l, d.channel as Channel);
      if (!channelOk || !d.outcome) return state;
      const dt = new Date(d.d + "T" + (d.tm || "00:00") + ":00");
      if (isNaN(dt.getTime()) || iso(dt) !== d.d || dt > nowT(state.NOW)) return state;
      if (d.keep && !hasNext(l)) return state;
      if (!d.keep && !d.noNext) {
        const nd = dOf(d.nd || "");
        if (!d.t || !d.t.trim() || !nd) return state;
        if ((d.nch as string) && (TOUCHCHANNELS as readonly string[]).includes(d.nch as string) && !conFor(l, d.nch as Channel)) return state;
      } else if (d.noNext && active(l) && !lost(l) && l.done < ST.ONBOARDED) return state;

      const at = dISOtoDisp(d.d, state.NOW) + " " + d.tm;
      const inbound = d.channel === "reply" || d.outcome === "Reply received";
      const isConnected = d.channel === "call" && !["No answer", "Wrong number"].includes(d.outcome);
      const isVisited = d.channel === "visit" && d.outcome !== "Investor unavailable";
      const note = (d.note || "").trim();
      const event: InteractionRec = {
        id: "FU-" + stamp(nowT(state.NOW)).replace(/\W/g, "") + "-" + Math.random().toString(36).slice(2, 7),
        channel: d.channel, outcome: d.outcome, obj: (d.obj || []).slice(), at, who: state.WHO,
        note: note || undefined,
      };

      let l2: Lead = { ...l };
      if (inbound) l2.reply = at;
      if (!inbound && (d.channel === "msg" || d.channel === "email" || isConnected || isVisited)) {
        const k = d.channel as Channel;
        const list = [...tList(l, k), at].sort(
          (x, y) => (whenT(x, state.NOW)?.getTime() || 0) - (whenT(y, state.NOW)?.getTime() || 0),
        );
        l2.touch = { ...l2.touch, [k]: list };
        if (l2.done < ST.TOUCH) {
          const captured = whenT(l.at[0], state.NOW), contact = whenT(at, state.NOW);
          l2.at = [...l.at, captured && contact && contact < captured ? l.at[0]! : at];
          l2.done = ST.TOUCH;
          l2.late = 0;
        }
      }
      let nextText = "";
      if (d.complete) {
        if (l.nx) event.completedTask = { t: l.nx.t };
        l2.nx = null;
      }
      if (!d.keep && !d.noNext) {
        l2.nx = { t: d.t!.trim(), d: d.nd, by: dISOtoDisp(d.nd!, state.NOW), tm: d.ntm || "", ch: d.nch, who: state.WHO, at: stamp(nowT(state.NOW)) };
        nextText = " · next: " + l2.nx.t + " on " + l2.nx.by + (l2.nx.tm ? " " + l2.nx.tm : "");
        event.next = { t: l2.nx.t, by: l2.nx.by, tm: l2.nx.tm || undefined };
      } else if (d.keep) {
        nextText = " · appointment kept";
        if (l.nx) event.next = { t: l.nx.t, by: l.nx.by, tm: l.nx.tm || undefined };
      }

      const LEADS = state.LEADS.map((x) => (x.id === a.id ? l2 : x));
      const CALLS: typeof state.CALLS = d.channel === "call"
        ? { ...state.CALLS, [a.id]: { o: d.outcome, obj: (d.obj || []).slice(), at, who: state.WHO } as CallRec }
        : state.CALLS;
      const NOTES: typeof state.NOTES = note
        ? { ...state.NOTES, [a.id]: [{ who: state.WHO, at, d: d.d, t: note } as Note, ...(state.NOTES[a.id] || [])] }
        : state.NOTES;
      const INTERACTIONS = { ...state.INTERACTIONS, [a.id]: [...(state.INTERACTIONS[a.id] || []), event] };
      const label = inbound ? "Inbound reply recorded"
        : d.channel === "call" ? (isConnected ? "Call connected" : "Call attempted")
        : d.channel === "visit" ? (isVisited ? "Visit completed" : "Visit attempted")
        : d.channel === "other" ? "Task completed"
        : (d.channel === "msg" ? "WhatsApp" : d.channel === "email" ? "Email" : d.channel) + " contact recorded";
      const detail = d.outcome + (d.complete ? " · completed: " + (l.nx?.t ?? "") : "") + nextText;
      const at0v = stamp(nowT(state.NOW));
      return pushLog(
        { ...state, LEADS, CALLS, NOTES, INTERACTIONS, DRW: null, ui: { ...state.ui, FU: null } },
        at0v, label, a.id, detail,
        !inbound && (TOUCHCHANNELS as readonly string[]).includes(d.channel) ? (d.channel as LogEntry["kind"]) : "stage",
      );
    }
    case "discardFollowup":
      return state.ui.FU ? { ...state, ui: { ...state.ui, FU: null }, DRW: null } : state;

    /* saveProfileDetails(id,patch) — ir-console-redesigned.html:11973-11986,12000's profile branch.
       The drawer already disables Save until its own copy of `detailsWhy` clears; this re-checks
       the two facts a stale draft or a race could still violate (a name and a mobile number that
       is not already on somebody else's record) before writing anything. Every field that actually
       changed — including `introducedBy`/`contactPreference`, once a raw select/textarea value —
       is collected into one `profileHistory` entry and one log line, the way `saveDetails`'s own
       `corrections` array is; a save that changes nothing writes nothing (`say("No details
       changed.")` there has no reader here, so it is simply a no-op). */
    case "saveProfileDetails": {
      const l = state.LEADS.find((x) => x.id === a.id);
      if (!l || !canWork(state, l)) return state;
      const n = a.patch.n.trim(), ph = a.patch.ph.trim(), em = a.patch.em.trim(), city = a.patch.city.trim();
      const introducedBy = a.patch.introducedBy.trim(), contactPreference = a.patch.contactPreference.trim();
      if (n.length < 2 || !ph) return state;
      const phoneKey = (t: string) => { const d = t.replace(/\D/g, ""); return d.length === 12 && d.startsWith("91") || d.length === 11 && d.startsWith("0") ? d.slice(-10) : d; };
      if (state.LEADS.some((x) => x.id !== l.id && phoneKey(x.ph) === phoneKey(ph))) return state;
      const fields: { field: string; from: string; to: string }[] = [];
      const compare = (field: string, from: string, to: string) => { if (from !== to) fields.push({ field, from, to }); };
      compare("n", l.n || "", n);
      compare("ph", l.ph || "", ph);
      compare("em", l.em || "", em);
      compare("city", l.city || "", city);
      compare("introducedBy", l.introducedBy || "", introducedBy);
      compare("contactPreference", l.contactPreference || "", contactPreference);
      let l2: Lead = { ...l, n, ph, em, city, introducedBy: (introducedBy || null) as PersonKey | null, contactPreference };
      if (l.done < ST.RESERVED) {
        const raw = a.patch.units.trim();
        const units = raw === "" ? 0 : Number(raw);
        if (raw !== "" && (!Number.isInteger(units) || units < 1)) return state;
        compare("units", String(l.units || 0), String(units));
        l2 = { ...l2, units, unitsKnown: units > 0 };
      }
      if (!fields.length) return state;
      const at = stamp(nowT(state.NOW));
      l2 = { ...l2, profileHistory: [{ who: state.WHO, at, changes: fields }, ...(l.profileHistory || [])] };
      const LEADS = state.LEADS.map((x) => (x.id === a.id ? l2 : x));
      const titles: Record<string, string> = {
        n: "Name", ph: "Mobile", em: "Email", city: "City",
        introducedBy: "Introducer", contactPreference: "Contact preference", units: "Investment intent",
      };
      const detail = fields.map((x) => `${titles[x.field] || x.field}: ${x.from || "not known"} → ${x.to || "not known"}`).join(" · ");
      return pushLog({ ...state, LEADS }, at, "Corrected investor details", a.id, detail, "admin");
    }

    /* saveContactPermission(id,con,how,date,time) — ir-console-redesigned.html:11973,11987-11990's
       permission branch. Clearing every channel is itself the withdrawal the prototype describes;
       it needs no "how"/"when" of its own, since nothing is being granted. Every save also pushes a
       `permissionHistory` entry, newest first (11978). */
    case "saveContactPermission": {
      const l = state.LEADS.find((x) => x.id === a.id);
      if (!l || !canWork(state, l)) return state;
      const enabled = (Object.keys(a.con) as Channel[]).filter((k) => a.con[k]);
      if (enabled.length) {
        if (!a.how || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) return state;
        const at = new Date(a.date + "T" + a.time + ":00");
        if (isNaN(at.getTime()) || iso(at) !== a.date || at > nowT(state.NOW)) return state;
        if (a.con.email && !l.em) return state;
      }
      const conAt = enabled.length ? dISOtoDisp(a.date, state.NOW) + " " + a.time : null;
      const recordedAt = stamp(nowT(state.NOW));
      const permissionHistory = [{ recordedAt, who: state.WHO, channels: { ...a.con }, givenAt: conAt }, ...(l.permissionHistory || [])];
      const l2: Lead = { ...l, con: { ...a.con }, consent: !!enabled.length, conHow: enabled.length ? a.how : null, conAt, conBy: state.WHO, permissionHistory };
      const LEADS = state.LEADS.map((x) => (x.id === a.id ? l2 : x));
      const detail = enabled.length ? enabled.map((k) => k).join(", ") + " · given " + conAt : "All outbound channels blocked";
      return pushLog({ ...state, LEADS }, recordedAt, enabled.length ? "Recorded contact permission" : "Removed contact permission", a.id, detail, "admin");
    }

    /* markRead(k) — 03-app.js:8427-8431. `k` omitted marks every group and says so; naming one
       (opening it) marks only that one and says nothing — the same asymmetry the prototype's own
       `if(!k){...say(...)}` reads. Implemented here, not in pages-b's reducer, because it is the
       one write that touches `NSEEN`'s new per-person-per-group shape end to end. */
    case "markRead": {
      const marks = readMarks(state, a.k);
      if (!Object.keys(marks).length && a.k) return state;
      return {
        ...state,
        NSEEN: { ...state.NSEEN, ...marks },
        ui: {
          ...state.ui,
          ...(a.k ? {} : { NOPEN: null, NOTICE: "Every update marked as read." }),
        },
      };
    }

    default:
      return withTJust(state, pageReducer(state, a), a);
  }
}

/* The feature slices, in the order the pages were built. A slice returns null when the action is
   not its own; the first non-null answer wins, and an action no slice claims leaves state alone. */
const SLICES: Array<(s: ConsoleState, a: Action) => ConsoleState | null> = [
  pagesAReducer,
  pagesBReducer,
  pagesCReducer,
  pagesDReducer,
];

function pageReducer(state: ConsoleState, a: Action): ConsoleState {
  for (const slice of SLICES) {
    const next = slice(state, a);
    if (next !== null) return next;
  }
  return state;
}

/* ---- the context ------------------------------------------------------------------------------ */

