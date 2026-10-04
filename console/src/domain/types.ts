/**
 * Every shape the console's data takes.
 *
 * Ported from `ref/03-app.js` — the shapes are derived from the actual fixture rows, so a field
 * that is missing from any prototype row is optional here and a field every row carries is
 * required. Nothing in this file is invented.
 */

/* ===== STAMPS AND DATES =====================================================================
   The prototype writes four different date-ish strings and parses them with its own helpers
   (`when`, `whenT`, `whenFwd`, `dISOtoDisp`), which the selectors own. They stay strings here;
   these aliases are documentation, not validation. ========================================== */

/** A printed moment: `"DD Mon HH:MM"` — e.g. `"23 Aug 18:04"`. Produced by the prototype's
 *  `stamp()`. The year is deliberately absent; `when()` resolves it. May be `""` on a record
 *  that has a slot for a stamp and has not been written yet (see {@link Forecast.at}). */
export type Stamp = string;

/** A printed day: `"DD Mon"` — e.g. `"29 Aug"`. This is `stamp().slice(0,6)`, and it is what a
 *  hold date, a cover end and a grant expiry are written as. */
export type DayStamp = string;

/** A machine day: `"YYYY-MM-DD"`. Where a record carries both, the ISO date wins over the
 *  printed one, "because a printed `31 Mar` has thrown its year away" (03-app.js:551-554). */
export type IsoDate = string;

/** An hour of the day: `"HH:MM"`, 24-hour. */
export type TimeOfDay = string;

/* ===== IDENTIFIERS ======================================================================== */

/** A key into {@link PEOPLE}. New members are minted at runtime, so this is a string. */
export type PersonKey = string;

/** A lead's id. `L1`…`L16`, `U1`/`U2` for unassigned; new ones are minted `N1`, `S04-01`, … */
export type LeadId = string;

/** An event's id — `"E-04"`. `addEvent()` mints `"E-0"+(EVENTS.length+1)`. */
export type EventId = string;

/** A temporary-access grant's id — `"T-01"`. */
export type TempId = string;

/* ===== SEATS, PAGES AND CAPABILITIES ====================================================== */

/** The eight seats. Role names are fixed; people may change (03-app.js:4). */
export type SeatKey = "ir" | "conv" | "cp" | "mkt" | "exec" | "fin" | "am" | "ops" | "bu" | "corp";

/** The fourteen pages in {@link NAV}, which is also every routable screen with a nav entry. */
export type NavKey =
  | "today" | "leads" | "updates" | "add" | "activity" | "people" | "goals"
  | "events" | "pay" | "docs" | "xfer" | "numbers" | "system" | "me"
  /** the Investors band (merge-glue.js MERGE): reached only through the Investors side */
  | "inv" | "farms" | "tkt" | "invupd";

/** The Investors band keys — pages drawn by the Investors side only. */
export type ImNavKey = "inv" | "farms" | "tkt" | "invupd";
/** Every lead-side page. */
export type LeadNavKey = Exclude<NavKey, ImNavKey>;

/** What a seat may *reach*. `teamscope` is not a page — it is the right to see other people's
 *  book — but the prototype keeps it in {@link SEATSCREENS} alongside the pages, and `seesTeam()`
 *  reads it from there. */
export type ScreenKey = NavKey | "teamscope";

/** What the prototype's router (`V`) can draw. Two of these have no nav entry of their own:
 *  a single lead and a single event are reached from their list. */
export type ViewKey = NavKey | "lead" | "event";

/** A capability. The list is exactly {@link CAPT}'s keys — "only capabilities that a handler
 *  actually reads are on this list" (03-app.js:198-200). */
export type Cap =
  | "view" | "edit" | "assign" | "target" | "others"
  | "seats" | "roster" | "load" | "edit_ev" | "record" | "send" | "capture";

/** One page's entry in {@link PAGECAPS}: its title and what it can be allowed to do. */
export interface PageCaps {
  t: string;
  caps: readonly Cap[];
  /** This capability group is not about a screen — `add`'s `capture` is a right one may hold
   *  wherever the form was opened from, not a place with a nav row (ir-console-redesigned.html
   *  2721-2800). Kept out of reach-counting and off the rail. */
  nopage?: boolean;
}

/** One nav entry. `scoped` marks the two screens the sidebar's mine/team switch applies to. */
export interface NavItem {
  k: NavKey;
  t: string;
  roles: readonly SeatKey[];
  /** added by the merge: a page this person holds only on the Investors side */
  im?: boolean;
  scoped?: boolean;
  /** Updates has no row of its own — the top bar's bell is its entry (ir-console-redesigned.html
   *  2568-2593). */
  bell?: boolean;
  /** Profile's row is the account menu, not a rail entry. */
  menu?: boolean;
}

/** Per-person capability overrides — `GRANT` in the prototype, `CAPS` in the store. */
export type CapGrid = Partial<Record<ScreenKey, Cap[]>>;

/* ===== PEOPLE ============================================================================= */

/** One of the eight validated categorical colour slots (03-app.js:5-9). */
export type ColourSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** A badge style: a colour slot and a shape. `sq` is the second channel — a square instead of a
 *  circle — so twelve people are told apart without spending a status colour on any of them. */
export interface BadgeStyle {
  c: ColourSlot;
  sq: boolean;
}

export interface Person {
  /** Full name. */
  n: string;
  /** Initials — the identifier on the badge. */
  i: string;
  seat: SeatKey;
  /** Who they are appointed under, which is the ceiling on what they can reach. `null` at the top. */
  mgr: PersonKey | null;
  /** Still with the org. `false` means they have left; their book stays reassignable. */
  on: boolean;
  c: ColourSlot;
  em: string;
  ph: string;
  /** Square badge instead of a circle — the second categorical channel. */
  sq?: boolean;
  /** Where this person actually works, when it is not this console. Its presence is what says
   *  they are a name here and never a login — see `PEOPLE.harsha`. */
  ext?: string;
  /** D115 ruling 2: the super administrator (a Digital Infrastructure seat; Sahil, D68). Their preset is
   *  SUPERCAPS — the Digital Infrastructure preset plus `events · load`. Meaningless on any other seat. */
  sup?: boolean;
}

/** Somebody is carrying somebody else's lead for a while. The owner of record does not change —
 *  that would be a reassignment, which is a different word (03-app.js:791-793). */
export interface Cover {
  by: PersonKey;
  /** Set when the cover was started against one lead; the per-person `COVER` map has no `from`. */
  from?: DayStamp;
  /** The day it ends, printed. */
  to: DayStamp;
  why: string;
}

/** Why somebody is not at their desk. */
export type OutWhy =
  | "On leave" | "Sick" | "Travelling" | "In training" | "Left the company";

/** One row of the roster. An absence carries the day they are back as a date rather than a
 *  phrase, so the note puts itself away (03-app.js:817-819). */
export interface Absence {
  why: OutWhy | string;
  /** ISO, or `"—"` on the synthetic record a departed person gets. */
  from: IsoDate | string;
  to: IsoDate | string;
  by: PersonKey | string;
  at: Stamp | string;
  /** Set only on the synthetic record for somebody who has left: permanently unavailable. */
  perm?: boolean;
}

/** The closed list §2 promises — nothing outside it is a reassignment (03-app.js:1316). */
export type Reason =
  | "Left the company" | "Long-term absence" | "Escalated by the lead"
  | "Territory correction" | "Load rebalancing" | "Duplicate merge";

/** How long a cover runs. `days: null` means "until they are back". */
export interface Duration {
  t: string;
  days: number | null;
}

/* ===== THE LADDER ========================================================================= */

/** Which of the three cash/paper gates a rung rests on. */
export type GateKey = "advance" | "balance" | "alloc";

/** One rung of the manual's eight-stage investor journey (Table 6). Commercial Close covers two
 *  money events, so it takes two rungs; every other rung is one stage. */
export interface LadderRung {
  t: string;
  stage: number;
  /** Who may change the record while the lead sits on this rung. */
  cust: string;
  /** The seat that ticks this particular rung. */
  who: string;
  /** The evidence the rung asks for. */
  ev: string;
  /** The first-touch channel this rung is satisfied by. */
  ch?: Channel;
  /** A named artefact the rung needs before it can be ticked. */
  needs?: string;
  /** This rung is not a mandatory gate — it can be skipped. */
  skip?: boolean;
  /** A fact only Finance can establish, which the IR cannot tick past. */
  gate?: GateKey;
  /** The service level the rung starts or sits inside. */
  sla?: string;
}

/** The manual contact channels. A channel is not one event: every touch is kept, and the first
 *  entry in a channel is what the service level reads (03-app.js:122-124). Three of these carry a
 *  first-touch service level; `visit` is manual contact with no mandatory first-touch deadline. */
export type Channel = "msg" | "email" | "call" | "visit";

/** The three channels that carry a first-touch service level, and that Finance's paperwork chase
 *  is recorded over. Visits are manual contact with no mandatory deadline, and are never how a
 *  chase for a signature is logged (03-app.js:5630-5636 of the redesign). */
export type SlaChannel = "msg" | "email" | "call";

/** One of the three first-touch service levels — SLAs inside stage 2, never stages of their own. */
export interface TouchSla {
  k: SlaChannel;
  t: string;
  due: string;
  days: number;
}

/** Every touch ever made, per channel, oldest first. */
export type Touch = Record<Channel, Stamp[]>;

/** Who still holds the record. `"Closed"` once every rung is done. */
export type Custodian = "IR" | "Closed";

/** Red / amber / green — the signal that says a lead should move. */
export type RagColour = "green" | "amber" | "red";

/* ===== A LEAD ============================================================================= */

/** Where a lead came from — the one field the whole funnel is sliced by, so it is a closed list
 *  chosen at capture and never free text (03-app.js:442-444). */
export type Source =
  | "Events" | "Founder network" | "Referral — investor" | "Channel partner"
  | "Website" | "LinkedIn" | "Walk-in or call-in" | "Other";

/** The second question a source carries, when it carries one. */
export type SourceNeed = "event" | "person";

/** The dated next action. It is a control, not a note — a closed list plus a date, and its
 *  absence is an exception (03-app.js:497-499). */
export interface NextStep {
  /** Usually one of `NEXTS`, but a lead may carry wording written before the list existed. */
  t: string;
  /** The printed due day. */
  by: DayStamp;
  /** The ISO due day. Where both exist this one wins. */
  d?: IsoDate;
  /** The agreed hour, when somebody agreed one. Absent means end of day. */
  tm?: TimeOfDay;
  who: PersonKey;
  at: Stamp;
  /** The channel this step is planned on — a touch channel when one applies, `"other"` for an
   *  internal task. Absent on records written before the redesign; `channelForAction(t)` fills
   *  the gap by reading the wording. */
  ch?: Channel | "other";
}

/** Forecast category (manual §3.1, Table 22). */
export type FcCat = "commit" | "probable" | "pipeline";

/** One forecast category's label, definition and tag colour. */
export interface FcCatDef {
  t: string;
  d: string;
  c: string;
}

/** What a lead is forecast to do. What it owes is a DATE; evidence is asked for, shown where it
 *  exists, and never required (03-app.js:614-618). Every string may be `""` on a bare forecast. */
export interface Forecast {
  c: FcCat;
  /** Expected full-payment date, printed. `""` until somebody sets one. */
  by: string;
  /** Investor-specific evidence. `""` when none was written. */
  ev: string;
  at: Stamp;
  who: PersonKey;
}

/** Why a lead ended. A reason is mandatory because the whole point of recording a loss is the
 *  pattern it makes afterwards (03-app.js:502-509). */
export type LostWhy =
  | "Price too high" | "Went cold — no reply" | "Lock-in too long" | "Timing — not now"
  | "Yield not convincing" | "KYC / FEMA blocked" | "Bought somewhere else"
  | "Never a real prospect";

/** A closed-as-lost record. */
export interface Lost {
  why: LostWhy;
  note: string;
  at: Stamp;
  by: PersonKey;
  /** The rung it was standing on when it was closed. */
  stage: number;
  /** The next step the close removed, kept so re-opening can put it back if it has not gone by. */
  nx?: NextStep | null;
}

/** A close that was later re-opened. The close is not deleted, it is closed — otherwise "the
 *  close stays in the history" was a lie the moment somebody re-opened (03-app.js:535-536). */
export interface ReopenedLost extends Lost {
  reopened: Stamp;
  reby: PersonKey;
}

export interface Lead {
  id: LeadId;
  /** Investor's name. */
  n: string;
  /** Mobile. The number is the identity: it is what a duplicate is checked against. */
  ph: string;
  em: string;
  city: string;
  /** The owner of record. `null` means unassigned and waiting for one. */
  own: PersonKey | null;
  /** The named secondary, who works the lead only when the primary cannot. */
  sec?: PersonKey | null;
  src: Source;
  /** Attribution is retained after reassignment; it never grants record access. */
  channelPartnerId?: PersonKey | null;
  /** The event it was captured at, when the source is Events. */
  ev: EventId | null;
  /** Steps completed — compare against {@link ST}, never a bare number. */
  done: number;
  /** When each completed step was ticked, one stamp per step. */
  at: Stamp[];
  touch: Touch;
  units: number;
  nx: NextStep | null;
  fc: Forecast | null;
  /** The typed-in lateness the fixtures were seeded with. `lateOf()` computes the real one off
   *  the record; this field is the seed, and it is absent on the three that ended. */
  late?: number;
  /** The blanket consent flag. A lead captured before per-channel consent existed carries it and
   *  is read as consented on every channel (03-app.js:141-143). */
  consent: boolean;
  /** Per-channel consent. Consent was asked for one channel at a time, so it is checked one
   *  channel at a time. Absent means the blanket flag decides. */
  con?: Partial<Record<Channel, boolean>>;
  /** When the investor last came back to us. `null` means they never have. */
  reply?: Stamp | null;
  /** Non-resident: Aadhaar e-sign will fail, so the paperwork needs a wet signature or a DSC. */
  nri?: boolean;
  /** Who captured it. */
  by?: PersonKey;
  /** Set when the lead was closed as lost; `null` once it is re-opened. */
  lost?: Lost | null;
  /** Every close this lead has had, kept across re-opens. */
  lostWas?: ReopenedLost[];
  /** A cover arranged against this one lead, rather than against its owner's whole book. */
  cov?: Cover | null;
  /** The engagement rung was skipped — it is not a mandatory gate. */
  skipped?: boolean;
  /** When a rung was last un-ticked, and which one. The correction window closes behind it: a
   *  correction after that is a new record, not an edit. */
  undoAt?: Stamp;
  undoWhat?: string;
  /** Who introduced the name, when it did not come in off a channel of its own — the capture
   *  form's own provenance (ir-console-redesigned.html:7891-7896). */
  introducedBy?: PersonKey | null;
  /** Consent's own provenance, alongside the blanket/per-channel flags above: which channel was
   *  asked, when, and by whom. */
  conHow?: string | null;
  conAt?: string | null;
  conBy?: PersonKey | null;
  /** False only when the capture form was told the investor's unit count is not yet known — never
   *  absent for an ordinary lead, so `knownUnitIntent` reads a lead with no opinion on the field as
   *  known (ir-console-redesigned.html:3136). */
  unitsKnown?: boolean;
  /** Zoho's Modified_Time as the page loaded the lead — a wired write (email, cover) sends it back as
   *  `expectedModifiedTime` (D44). Live: Leads.Modified_Time from the lead book's detail read (server/data/live leadOf);
   *  absent in the demo book, whose fixture writes do not read it. */
  mt?: string | null;
  /** Free-text contact instructions, the details drawer's own writer (ir-console-redesigned.html:
   *  11910,12020) — `fuPreference` reads this before falling back to its stock sentence. */
  contactPreference?: string;
  /** One entry per saved profile correction, newest first (ir-console-redesigned.html:11993-11994,
   *  12000). */
  profileHistory?: { who: PersonKey; at: string; changes: { field: string; from: string; to: string }[] }[];
  /** One entry per saved contact-permission write, newest first (ir-console-redesigned.html:11978). */
  permissionHistory?: { recordedAt: string; who: PersonKey; channels: Partial<Record<Channel, boolean>>; givenAt: string | null }[];
}

/* ===== EVENTS ============================================================================= */

export type EventType = "Society" | "Club" | "Partner";
export type EventChannel = "MyGate" | "Direct" | "Partner";
export type EventState = "done" | "planned";

export interface EventRec {
  id: EventId;
  n: string;
  type: EventType;
  ch: EventChannel;
  /** Printed span — `"23–24 Aug"`. Note the en dash. */
  date: string;
  city: string;
  cost: number;
  staff: PersonKey[];
  state: EventState;
  /** Captured off the sheet on the day — the count the event's own paper claims, which is not
   *  the same as how many leads carry its id. */
  off: number;
}

/** One row of manual contact history kept off-ladder: a failed call attempt, a failed visit, or
 *  anything else recorded through the redesign's follow-up drawer that is not one of the touch
 *  stamps in {@link Touch}. `INTERACTIONS[leadId]`, newest last (ir-console-redesigned.html:5985,
 *  6048-6057). */
export interface InteractionRec {
  channel: Channel | "other" | "reply";
  outcome: string;
  at: Stamp;
  who?: PersonKey;
  /** Objections or reasons heard and kept for next time. */
  obj?: string[];
  /** The record's own id — every hand-saved follow-up mints one; the CALLS fixture folded into
   *  this list at load carries `"fixture-call-"+leadId` (ir-console-redesigned.html:12916-12920). */
  id?: string;
  /** ISO date, alongside `at`'s printed stamp — set wherever the stamp parses to a real day. */
  date?: string;
  /** The last five characters of `at` — its `HH:MM`, printed on its own in a few places. */
  tm?: string;
  /** True only for the CALLS row folded in at load, never for a hand-saved follow-up. */
  fixture?: boolean;
  /** The free-text note typed alongside the outcome, when there was one (ir-console-redesigned.
   *  html:6106). */
  note?: string;
  /** Set when this contact closed out the scheduled task it answered (ir-console-redesigned.html:
   *  6132). */
  completedTask?: { t: string };
  /** The next step this contact left behind, or the one it kept unchanged (ir-console-redesigned.
   *  html:6130-6131). */
  next?: { t: string; by: string; tm?: string };
}

/* ===== THE ACTIVITY TRAIL ================================================================= */

/** What kind of thing happened — the keys of {@link KINDS}. */
export type ActKind =
  | "msg" | "call" | "email" | "visit" | "stage" | "mat" | "pack"
  | "money" | "doc" | "admin" | "roster" | "note";

/** Four families, told apart by the chip's border (03-app.js:1136-1139). */
export type ActFamily = "touch" | "move" | "money" | "admin";

/** One line of the audit trail. Every write lands here, for every user. */
export interface LogEntry {
  d: IsoDate;
  at: Stamp;
  who: PersonKey;
  what: string;
  lead: LeadId | null;
  note: string;
  kind: ActKind;
  /** "attempt N on this lead this week" — the week is the unit the manual reviews in. */
  touch?: number | null;
  /** The grant that was switched on when this was written. Everything written while a grant is
   *  on carries it, not only the writes that happen to be on the borrowed page (03-app.js:1223). */
  temp?: TempId | null;
  /** Explicit subjects on administrative audit entries; legacy entries may omit this. */
  about?: PersonKey[];
}

/* ===== PAPERWORK ========================================================================== */

export type RoundKey = "nda" | "supp";

/** One of the two rounds of paper. It happens twice: the NDA goes first and gates the material;
 *  the supplementary agreement comes after the investor has said yes (03-app.js:1641-1645). */
export interface PaperRoundDef {
  k: RoundKey;
  t: string;
  sub: string;
  /** The `DTPLS` template this round sends. */
  tpl: string;
  /** This round starts with an IR-written draft that has to be agreed first. */
  draft: boolean;
  /** The rung the round becomes reachable on. */
  from: number;
  /** The round that has to be back signed before this one may start. */
  needs?: RoundKey;
  why: string;
}

/** Which beat of a round is next. The beats are strictly in order — a signature nobody was told
 *  about is not a thing that happens (03-app.js:1670-1671). */
export type PaperBeat =
  | "none" | "wait" | "draft" | "agreed" | "sent" | "told" | "said" | "ok" | "done";

/** Whose move it is on a beat. */
export type PaperWho = "IR" | "Finance";

/** What `prNext()` answers. */
export interface PaperNext {
  k: PaperBeat;
  t?: string;
  who?: PaperWho | null;
}

/** Someone did something, at a time. */
export interface Beat {
  by: PersonKey;
  at: Stamp;
}

/** The IR wrote a draft and sent it over. `v` counts the redrafts. */
export interface DraftBeat extends Beat {
  link: string;
  v: number;
}

/** One chase, kept because "we have asked him four times" is a fact, not a memory. */
export interface ChaseBeat extends Beat {
  ch: Channel;
  /** Which half of the round is being chased: agreement on the draft, or the signature. */
  phase: "draft" | "sign";
}

/** One round's state on one lead. Shape from 03-app.js:1658-1659. */
export interface PaperRound {
  draft?: DraftBeat;
  agreed?: Beat & { link: string };
  /** Written in the Investor Management portal and received here. */
  sent?: Beat & { via: string };
  told?: Beat & { ch: Channel };
  chase?: ChaseBeat[];
  /** What the investor told the IR, which is not a signature. */
  said?: Beat;
  /** Finance verified the executed copy. */
  ok?: Beat;
  /** Finance looked and nothing had come back signed. */
  back?: Beat & { why: string };
}

/** Both rounds' state on one lead — the value side of `PAPER`. */
export type PaperRow = Partial<Record<RoundKey, PaperRound>>;

/* ===== DOCUMENTS ========================================================================== */

export type DocClass =
  | "Confidentiality" | "Commercial" | "Constitutional" | "Regulatory"
  | "Agreement" | "Financial";

export type DocState = "sent" | "awaiting" | "signed" | "blocked";

/** One template Finance can send from. */
export interface DocTemplate {
  t: string;
  cls: DocClass;
  /** This one cannot be e-signed. */
  wet?: boolean;
}

export interface DocRec {
  /** Optional source metadata; legacy `on` alone does not establish when a signed document was sent. */
  id?: string;
  sent?: Stamp | null;
  completedOn?: Stamp | null;
  verifiedBy?: PersonKey | null;
  expiresOn?: Stamp | null;
  reason?: string | null;
  lead: LeadId;
  t: string;
  cls: DocClass;
  state: DocState;
  /** `"DD Mon HH:MM"` on the fixture rows, `"DD Mon"` on rows a round writes. */
  on: Stamp | null;
  /** How it was signed — `"Aadhaar OTP"`, `"Zoho Sign"`, `"Wet signature"`. */
  how: string | null;
  /** The Growize account code it is filed under. */
  ref: string | null;
  /** Who recorded it, on rows written from inside the console. */
  by?: PersonKey;
}

/* ===== MONEY ============================================================================== */

export type PayState = "part" | "full";

/** What Finance has confirmed in the account. Finance only. */
export interface PayReceipt {
  id: string;
  amount: number;
  paidOn: Stamp;
  kind: string;
  mode: string;
  ref: string;
  confirmedBy: PersonKey;
  confirmedAt: Stamp;
  /** Set when Finance later reverses a confirmed receipt; a reversed one may never be matched
   *  against a payment report again (ir-console-redesigned.html:5445). */
  reversed?: boolean;
}

export interface PayRec {
  /** Individual source confirmations, when supplied; a total is not an individual receipt. */
  receipts?: PayReceipt[];
  state: PayState;
  got: number;
  mode: string;
  utr: string;
  on: DayStamp;
  /** The day the 30-day balance clock runs out. `null` once it is fully paid. */
  hold: DayStamp | null;
}

/** A claim's state. `"waiting"` is the only state in which the word "waiting" is honest. */
export type ClaimState = "waiting" | "confirmed" | "notfound";

/** What the payment was reported for — `CLAIMKINDS`' keys (ir-console-redesigned.html:5406). */
export type ClaimKind = "advance" | "balance" | "full" | "other";

/** One line of a report's history — reported, matched, could not be found, or asked again. */
export interface ClaimEvent {
  type: "reported" | "matched" | "notfound" | "reopened";
  by: PersonKey;
  at: Stamp;
  note: string;
}

/**
 * A PAYMENT REPORT: the IR says what the investor told them. It is not a payment any more than it
 * is a signature — Finance still has to find an individual, confirmed receipt that matches it
 * exactly before it becomes the record (ir-console-redesigned.html:5396-5459).
 */
export interface Claim {
  /** `"PR-"+leadId+"-"+seq"`. */
  id: string;
  by: PersonKey;
  at: Stamp;
  kind: ClaimKind;
  mode: string;
  ref: string;
  /** The amount the investor said they paid, in rupees. */
  amount: number;
  /** The day the investor said they paid it, ISO. */
  said_on: IsoDate;
  /** What was already confirmed in the account before this report, so a partial receipt is never
   *  read back as the whole of it. */
  heldBefore: number;
  note: string;
  state: ClaimState;
  history: ClaimEvent[];
  /** Who answered it. */
  did?: PersonKey;
  on?: Stamp;
  /** Why it could not be found. */
  why?: string;
  /** The exact receipt Finance matched it to, once confirmed. */
  receipt?: PayReceipt;
  /** Set when a later match attempt fails after confirmation was expected — surfaced next to the
   *  block rather than silently retried. */
  matchError?: string;
}

export type DecisionState = "waiting" | "approved" | "declined";

/** A reservation extension. Balance is due in 30 days; the BU Owner approves an extension, and a
 *  lapse forfeits ₹50,000 per unit (03-app.js:689-690). */
export interface ExtRec {
  by: PersonKey;
  asked: Stamp;
  days: number;
  why: string;
  state: DecisionState;
  did?: PersonKey;
  on?: Stamp;
}

/** An IR cannot move a lead off their own book, but they can ask (03-app.js:1271-1274). */
export interface MoveReq {
  by: PersonKey;
  at: Stamp;
  to: PersonKey;
  why: Reason;
  state: DecisionState;
  did?: PersonKey;
  on?: Stamp;
}

/** The Growize account. Minted the moment Finance confirms the first money, and everything about
 *  that person is filed under it from then on (03-app.js:1940-1955). */
export interface Account {
  code: string;
  at: Stamp;
  state: "open" | "lapsed";
  invite: { at: Stamp; ch: string; auto: boolean };
  /** Set when a reservation lapsed under it. */
  on?: Stamp;
  by2?: PersonKey;
}

/** A fully-paid lead becoming an investor record in the investor database. A done row carries the
 *  investor's own details, because a transferred lead leaves the leads book (03-app.js:794-795). */
export interface XferRow {
  lead: LeadId;
  /** Only ever `"done"`: nothing performs a transfer any more — the confirmed receipt does it. */
  state: "done";
  auto: boolean;
  /** The snapshot kept on the row itself, for a lead that has left the book. */
  n?: string;
  ir?: PersonKey;
  src?: Source;
  ev?: EventId | null;
  by?: PersonKey;
  asked?: Stamp;
  on?: Stamp;
  code?: string;
  units?: number;
  got?: number;
  mode?: string;
  utr?: string;
  /** Whether the investor org's own side has acknowledged this entry — ir-console-redesigned.html
   *  :6829's "Investor entry status" disclosure counts confirmed rows with `!ack` against the
   *  `"transfer"` Check's own owner (`CHECKS`, `@/domain/system`). Unset reads as not yet
   *  acknowledged, the same as every other demo row minted before this flag existed. */
  ack?: boolean;
}

/** Local reconciliation of a lead with an already linked investor account; never a Finance source write. */
export interface InvestorCopy {
  leadId: LeadId;
  accountId: string;
  sourceReceiptIds: string[];
  sourceDocumentIds: string[];
  mode: "automatic" | "manual";
  status: "copied";
  copiedAt: Stamp;
  copiedBy: PersonKey;
  snapshot: { id: LeadId; n: string; units: number; owner: PersonKey | null; source: Source; channelPartnerId: PersonKey | null };
}

/* ===== INVENTORY ========================================================================== */

/** Released is what the farm interface has confirmed as deliverable; everything else is computed
 *  (03-app.js:665-667). */
export interface Inventory {
  total: number;
  released: number;
  by: PersonKey;
  at: Stamp;
  src: string;
}

/* ===== THE PLAN =========================================================================== */

/** The funnel rates, as percentages. */
export interface Rates {
  lead2qual: number;
  qual2res: number;
  res2paid: number;
}

/** The service levels the plan commits to. */
export interface Sla {
  firstTouch: string;
  day3: number;
  packWeeks: number;
}

/** The planning baseline — one of the three figures the manual is explicit must never be merged. */
export interface Baseline {
  units: number;
  src: string;
  warn: boolean;
}

export type Grain = "week" | "fort" | "month" | "quarter";

/** A period is a DURATION, not a label — `from`/`to` are what every figure below is scoped by. */
export interface PlanPeriod {
  k: string;
  t: string;
  from: IsoDate;
  to: IsoDate;
  /** Units the BU Owner commits to. */
  target: number;
  /** Fully-paid units Finance has verified inside the window. */
  actual: number;
  /** ₹ Finance has actually banked in the window, which is never `target × ₹25L`, because a
   *  reservation banks 10% in one period and the balance in another. */
  coll: number;
  emph: string;
}

export interface Plan {
  masterUnits: number;
  acres: number;
  byWhen: string;
  baseline: Baseline;
  grain: Grain;
  periods: PlanPeriod[];
  rates: Rates;
  eventDays: number;
  eventLen: number;
  eventShare: number;
  sla: Sla;
}

/** What every derived plan figure is read through, so Goals is the only place any of them change. */
export interface Goals {
  units: number;
  months: number;
  perUnit: number;
  lead2qual: number;
  qual2res: number;
  res2paid: number;
  eventShare: number;
  eventDays: number;
  firstTouch: string;
  day3: number;
  packWeeks: number;
}

/** Where one editable plan scalar lives: `[group, key]`, with a `null` group meaning `PLAN` itself. */
export type PlanPath = readonly [null | "rates" | "sla", string];

/** The plan's editable scalars — rates, event days, service levels. Periods have their own
 *  two functions, so they are not on this list. */
export type PlanScalar =
  | "lead2qual" | "qual2res" | "res2paid" | "eventDays" | "eventShare" | "day3" | "packWeeks";

/* ===== TEMPORARY ACCESS =================================================================== */

/** As written on the grant. `"expired"` is derived from `until`, never stored. */
export type TempState = "live" | "revoked";

/** As read: the stored state, unless the window has closed — or, for a `"live"` grant, unless its
 *  window is malformed (`"invalid"`), has not opened yet (`"pending"`), or the grantee, the
 *  grantor or either one's own reach has since changed (`"unavailable"`) — never read back as
 *  `"live"` on a stale reading (ir-console-redesigned.html:2893-2903). */
export type TempStateRead = TempState | "expired" | "pending" | "invalid" | "unavailable";

/** A page lent to one named person, for a stated window, with a reason. The login is never lent —
 *  the access is (03-app.js:256-265). */
export interface TempGrant {
  id: TempId;
  to: PersonKey;
  by: PersonKey;
  page: ScreenKey;
  caps: Cap[];
  from: Stamp;
  until: DayStamp;
  why: string;
  state: TempState;
  /** How many writes were made while it was on. The list outlives the grant. */
  acts: number;
  /** Who revoked it. */
  by2?: PersonKey;
  /** When it was revoked. */
  on?: Stamp;
}

/* ===== NOTES AND CALLS ==================================================================== */

/** Nothing computes from a note, which is exactly why it is allowed to be free text — and why
 *  every one carries who wrote it, when, and against which lead (03-app.js:742-743). */
export interface Note {
  who: PersonKey;
  at: Stamp;
  d: IsoDate;
  t: string;
}

/** How the last call went. */
export type CallOutcome =
  | "Interested" | "Not now" | "Not interested" | "No answer" | "Wrong number" | "Call back";

/** What the investor pushed back on. */
export type Objection =
  | "Price" | "Lock-in" | "Yield" | "Site visit first" | "Timing" | "Spouse decides";

export interface CallRec {
  /** `null` once the outcome is cleared. */
  o?: CallOutcome | null;
  obj: Objection[];
  at?: Stamp;
  who?: PersonKey;
}

/** Material an IR may record as sent: sent or not, and when. No sending, no contents. */
export type Sendable = "Pitch deck" | "Farm profile" | "Yield note" | "Webinar invite";

/* ===== THE EVENT SHEET ==================================================================== */

/** One column the intake sheet is expected to carry. */
export interface SheetCol {
  k: string;
  t: string;
  /** A row missing a required column is one the loader refuses. */
  req: boolean;
  note: string;
}

/** One event's sheet, and what a load of it produced. */
export interface SheetRec {
  rows: number;
  ok: number;
  dupe: number;
  bad: number;
  at: Stamp;
  by: PersonKey;
  state: "ready" | "loaded";
  /* --- written by `loadSheet()` --- */
  loadedBy?: PersonKey;
  loadedAt?: Stamp;
  rule?: string;
  skipped?: number;
}

/* ===== NUMBERS AND THE PLAN VIEW ========================================================== */

/** One of the four phases of the manual's eight stages, mapped onto the nine rungs. */
export interface Band {
  t: string;
  /** The highest `done` this band covers. */
  to: number;
  /** A CSS custom-property reference from `console.css`. */
  c: string;
}

/** What may be written on an amber or red line. */
export type RecovAction =
  | "Coach the owner and re-run next week" | "Change the process step"
  | "Add the missing field to the console" | "Re-forecast the period"
  | "Escalate to the BU review" | "Reassign the work" | "Bring in Corporate Operations";

/** One recovery action: one owner, one action and one date. */
export interface RecovRec {
  who: PersonKey;
  act: RecovAction | string;
  by: DayStamp;
  at: Stamp;
  /** Who set it. */
  set: PersonKey;
}

/** One granularity the plan can be kept at. `days` for the fixed-length grains, `m` for the
 *  calendar ones. */
export interface GrainDef {
  t: string;
  days?: number;
  m?: number;
}

/** "Re-baseline only with recorded reason/approval" — manual Table 26. So it asks, from a closed
 *  list, exactly the way a reassignment does. */
export type BaseWhy =
  | "Finance verified the live figure" | "Units returned to the shelf"
  | "Correction of a data error" | "Approved re-baseline at the monthly review";

/* ===== SYSTEM ============================================================================= */

export type CheckState = "ok" | "warn" | "fail";

/** One thing the machine either does or does not do. Named, owned, and dated, because "it is
 *  fine" is not a status — and every finding carries what would fix it, and who owns it. */
export interface Check {
  k: string;
  t: string;
  st: CheckState;
  own: PersonKey;
  /** How often it runs, in words. */
  every: string;
  /** ISO or a printed day, depending on the row. */
  since: string;
  /** What it guarantees when it is working. */
  w: string;
  /** What breaks when it is not. */
  br: string;
  /** Single days it wobbled on, ISO. */
  blip?: string[];
  /** What it used to be, on a check that has changed state. */
  was?: CheckState;
  /** What would fix it. */
  fix?: string;
  note?: string;
}

/* ===== HELP =============================================================================== */

/** One screen's note in the help drawer. Some of these strings carry inline `<b>`/`<i>` markup. */
export interface HelpTopic {
  t: string;
  p: string;
  /** The two or three things that are true on this screen and nowhere else. */
  b?: string[];
}

/** One answered question. `a` may carry inline `<b>`/`<i>` markup. */
export interface FaqItem {
  q: string;
  a: string;
}

/* ===== SORTING ============================================================================ */

/**
 * How the leads book is ordered (03-app.js:1327-1338). Urgency is the right default because the
 * queue is the product, but a person working a backlog wants the oldest thing first and a person
 * preparing a review wants the biggest.
 *
 * The prototype's `SORTS` table itself is NOT in this module: four of its six comparators read
 * `nextUp()`, `lateOf()` and `whenT()`, so the table lives with the selectors —
 * `import { SORTS } from "@/lib/selectors"`. This is the key type the table is indexed by, and
 * what {@link UiState.LSORT} holds.
 */
export type SortKey = "urgent" | "oldest" | "newest" | "stage" | "units" | "name";

/** A leads comparator, as `Array.prototype.sort` wants it. */
export type LeadComparator = (a: Lead, b: Lead) => number;

/* ===== UI STATE =========================================================================== */

/** Which side of the mine/team switch a scoped screen is on. */
export type Scope = "mine" | "team";

/** Every drawer in `DRAWERS` (03-app.js:6217-6998). */
export type DrawerKey =
  | "next" | "forecast" | "touch" | "history" | "notes" | "acct" | "paper" | "material"
  | "pack" | "money" | "call" | "details" | "temp" | "lost" | "claim" | "owner"
  | "reassign" | "hold" | "recov" | "newp" | "person" | "presence" | "help" | "check"
  | "absence" | "leaver";

/** Which drawer is open, and which record it is about. */
export interface DrawerState {
  k: DrawerKey;
  id: string | null;
}

/** My day's horizon. */
export type Horizon = "today" | "week" | "month";

/** The draft next step, while its drawer is open. */
export interface NextDraft {
  t: string;
  d: IsoDate | "";
  tm: TimeOfDay | "";
}

/** The draft touch, while its drawer is open. */
export interface TouchDraft {
  k: Channel;
  d: IsoDate | "";
  tm: TimeOfDay | "";
}

/** The draft grant, while the Lend-a-page drawer is open. */
export interface TempDraft {
  to: PersonKey | null;
  page: ScreenKey | null;
  caps: Cap[];
  /** A key of `TDUR`. */
  dur: string;
  why: string;
}

/** The draft member, while the Add-a-member form is open. A draft outlives the drawer, so closing
 *  it to check a name on the list behind does not throw away what has been typed. */
export interface NewPerson {
  n: string;
  em: string;
  seat: SeatKey;
  mgr: PersonKey | null;
}

/**
 * The page-local form state the prototype kept as module globals. Names are the prototype's, so a
 * ported handler reads the same identifier it always did. Each feature slice owns its own fields;
 * they live in one bag because the prototype's `draw()` re-read all of them on every paint.
 */
export interface UiState {
  /* --- the record each single-record screen is looking at ------------------------------- */
  /** `LEAD` — the lead the lead page is on. */
  LEAD: LeadId;
  /** `EVID` — the event the event page is on. */
  EVID: EventId;

  /* --- Leads: the search, the rung, the owner, the sort, the filters -------------------- */
  LQ: string;
  LSTAGE: number | null;
  /** "at" = on this rung; "from" = this rung or past it — a modifier on LSTAGE. */
  LSTAGEMODE: "at" | "from";
  LOWN: PersonKey | null;
  /** Not contacted for at least this many days — a key of QUIET, or null for "Any time". */
  LQUIET: number | null;
  LSORT: SortKey;
  /** The hygiene exception being looked at — a key of `EXC`. */
  LFILT: string | null;
  /** One source, when you want to read the book by channel. */
  LSRC: Source | null;

  /* --- My day -------------------------------------------------------------------------- */
  HORIZON: Horizon;
  /** The day picked out of the month grid. */
  CALDAY: IsoDate | null;

  /* --- Updates ------------------------------------------------------------------------- */
  /** Which group is expanded — collapsed by default. */
  NOPEN: string | null;
  /** The day you last cleared Updates. */
  NSEEN: IsoDate | "";

  /* --- Activity ------------------------------------------------------------------------ */
  ACTTAB: string;
  ACTWHO: PersonKey | null;
  ACTDAY: IsoDate | null;
  /** The month the calendar is showing. */
  ACTM: Date;
  LOGWHO: PersonKey | null;
  TCHAN: Channel | null;

  /* --- People -------------------------------------------------------------------------- */
  PTAB: string;
  PSEL: PersonKey | null;
  NEWP: NewPerson | null;
  /** The draft absence, while the absence drawer is open. */
  ABWHY: OutWhy | null;
  ABFROM: IsoDate | null;
  ABTO: IsoDate | null;

  /* --- Add lead ------------------------------------------------------------------------ */
  ADDN: string;
  ADDPH: string;
  ADDEM: string;
  ADDCITY: string;
  ADDOWN: PersonKey | "";
  ADDNOTE: string;
  ADDSRC: Source | null;
  ADDEV: EventId | null;
  /** The introducer, or `"ext"` for somebody outside ARL. */
  ADDBY: PersonKey | "ext" | null;
  /** Units on the add form: a pick… */
  ADDU: string;
  /** …or a typed custom count. */
  ADDC: string;
  ADDCON: Record<Channel, boolean>;
  /** Which fold is open — one at a time. */
  ADDF: string | null;

  /* --- lead drawers -------------------------------------------------------------------- */
  NXD: NextDraft;
  TD: TouchDraft;
  /** The lead whose dated next step may now be stale. */
  NXASK: LeadId | null;
  /** The draft reason and note, while the close-as-lost drawer is open. */
  LOSTW: LostWhy | null;
  LOSTN: string;
  NDRAFT: string;
  /** The lead being asked "why?" and "how long?" */
  ASKW: LeadId | null;
  ASKD: LeadId | null;
  /** The person picked in the "change the owner" drawer. */
  ASTO: PersonKey | null;
  /** The lead being asked about, and who it is being asked for. */
  MVOPEN: LeadId | null;
  MVTO: PersonKey | null;
  /** Where the lead page was opened from, so Back goes there. */
  FROM: NavKey;

  /* --- paperwork ----------------------------------------------------------------------- */
  /** The draft link being typed, and which round wants it. */
  PLINK: string;
  PREDRAFT: string | null;

  /* --- money --------------------------------------------------------------------------- */
  /** Who the receipt is for, how it came, its reference. */
  PSEL2: LeadId | null;
  PMODE: string;
  PUTR: string;
  /** The claim being drafted. */
  CKIND: "advance" | "full";
  CMODE: string;
  CREF: string;
  CNOTE: string;

  /* --- documents ----------------------------------------------------------------------- */
  DSEL: LeadId | null;
  DTPL: string;
  DSIG: string;

  /* --- events: the sheet loader -------------------------------------------------------- */
  /** Which assignment rule the sheet loads under — a key of `ASSIGNRULE`. */
  AR: string;
  ARWHO: PersonKey | null;

  /* --- Numbers and Plan ---------------------------------------------------------------- */
  NTAB: string;
  /** The KPI a recovery action is being written against, and who it is going to. */
  RCACT: string | null;
  RCWHO: PersonKey | null;
  /** Re-baselining asks for a reason before it changes anything. */
  ASKB: boolean;
  BASED: number;

  /* --- lend a page --------------------------------------------------------------------- */
  TGT: TempDraft;

  /* --- help ---------------------------------------------------------------------------- */
  HQ: string;
}
