# Stage 3 · The Investor Management portal · Weeks 7 – 11 · 19 Oct – 22 Nov 2026

**22 Sep 2026.** This sheet predates D45 (zero copy) and names the mirror in places. **D46** states the rule those references are read under; this sheet has not been worked through against it. Read D45 and D46 alongside it.

**23 Sep 2026 — and it is now one Enterprise org (D52).** The portal works in the same org as the console: *the Investor org* throughout this sheet — its access matrix (M8-01), 7.2's second OAuth, 7.1's second receiver — is the one org's Finance profiles and roles. The handover as code, the cross-org seam and week 5's handover work no longer exist, so the integration user's *handover and gate write-backs* are gone; the twenty crossing facts become same-org field writes, and one fact one writer holds because the IR and Finance share records, never fields. The identity wall 7.3 builds is field-level security plus D52's application-side guards, and every staff member reads on their own full seat (D53). The full rewrite of this sheet is tracked as **A-04** in `docs/CARRY-FORWARD.md` and has not been done; until it lands, read D52 and D53 alongside D45 and D46 before any task here.

Read `docs/stages/README.md` first. Then this stage head. Then the week you are in — and only that
week.

## What the stage delivers

*Eleven pages, finished and signed before the app is touched.* By week 11 Finance works from queues
of facts; every rupee in the bank statement is against a receipt or on a list with a name; a PAN or
a bank account cannot be read by any staff seat by any route, and the eight actions that matter
each demand a fresh code from the person who holds that authority; KYC is a switch a person sets
with the documents behind it; a document that is unapproved cannot be sent and a signed one cannot
exist without its file; an investor is allotted only on all four facts and the signed supplement,
gets an app account that opens tentative and locks by itself, and is cared for by a named KAM — and a
refund removes them from every number.

The pages, by week, as the plan orders them: **Dashboard, Investors, the investor record, Team**
(7) · the record's **KYC, residency and FEMA, freeze** (8) · **Transactions** (9) · **Documents,
Farms, Updates, Insights** (10) · the record's **allotment** and **care**, **Tickets, Activity log,
System** (11). Step-up authentication (7) is a lock on actions, not a page; it is on every page.

**Stage 3 is signed when** (the plan's sentence, as lines): eleven pages exist on the test
environment; every one of the 42 portal cases (M0–M8) passes on a clean seed, run by the tester;
the Investor org's access matrix (M8-01) is walked and **signed**; and **a refund removes an
investor from every figure** — Numbers, Insights, the shelf, the Dashboard's queues. Then **Demo two
— the money and the paper**: *paid, signed, allotted, cared for; then refunded, and gone from every
number.*

**Decisions this stage stands on:** D02, D07, D08, D10, D12, D13, D14, D17, D19, D20, D21, D22, D24;
Q4 (what *tentative* withholds), Q9 (no feed, no virtual accounts), Q11 (the NRI shortfall), Q27
(the statement's format), Q6 (the BU Owner).
**Build Book:** §2 rungs 4–8 and the roles table (reproduced below); §3; §11; §20 (the twelve
templates, the six approvals); §21; §22; Appendix A segments **MO** (money, 19 modes), **DO**
(documents, 13), **KY** (KYC, FEMA and life events, 8), **CA** (care, requests and seats, 7),
**OA** (sessions, tokens and administrators, 13), **MI**, **SE**, **ML** (mail and push, 4).
**Test Book:** M0–M8 — 42 cases, listed by week below. Six of them (M0-01, M2-01, M2-02, M2-05,
M3-02, M4-01, M5-03) are in the go-live smoke pack.
**Design:** `portal/prototype/investor-management.html`. Same density rule as the console.

**This is the portal that holds identity.** Rule 7 governs every page: *identity is unreadable by
opening a record — encrypted, field-level-secured, revealed only through a logged request behind
step-up authentication.* PAN, bank account, Aadhaar reference, address, signature: in Zoho behind
field permission and encryption (D13), in the investors mirror **never** (the allow-list, as in
stage 1), in a fixture **never**, on a screen only through a reveal that logs its reason before it
shows the value. The Aadhaar number itself is nowhere in any system (M1-05).

## The roles that sign in to the portal, from §2

| Role | Seat | Writes | Reads | Never |
|---|---|---|---|---|
| Finance Operations | Investor · full | receipts (record), documents (send, verify, block), holds, tickets of its kind | investors, ledger, paper, bank fields | match its own receipts; reveal a PAN (Compliance's right) |
| Head of Finance | Investor · full | match receipts, allot, lapse, refund, extend a hold, seats within Finance | everything in the Investor org | promote itself; delete a ledger row |
| Compliance & KYC | Investor · full | KYC pass/fail, FEMA, erasure, KYC re-submission | identity fields | money |
| Key Account Manager (KAM) | Investor · **Team user** | care log, cadence, tickets of its kind, updates (farm, care), details of its own book, hand a bank change to Finance | its own book; masked identity only | PAN, Aadhaar reference, bank account; another manager's book |
| Head of Account Management | Investor · full | name and move KAMs, the pool, seats within AM | the whole book | money, paper, identity |
| BU Owner (Q6) | Investor · full | extend a hold, approve a refund | holds, refunds | identity |
| Administrator | both · full | add users, assign seats up to administrator, see logs | logs | seat anyone as Super administrator; investor data |
| Super administrator | both · full | everything administrative; system page; seat changes above administrator | everything administrative | write investor facts as a person |
| Integration (system user) | each org · full | only what arrives from outside: bank credits, eMudhra events, mailer events, app requests, the handover and gate write-backs | — | act for a human |

Finance is two people: the Head and Operations, **one seat per human** (D22) — so *who matched this
receipt* is always a name. The IR has no login here. The KAM is on a Team seat: it cannot send
email, import, export or run reports in an org module, so the care work lives on team modules —
M5-01 proves *a whole day's work on a real Team seat*.

**The eight authoritative actions (D22)** — each demands a fresh code on the account of the person
who holds that authority, logged whether it succeeds or fails: revealing an identity; revealing a
bank account; executing a refund; forfeiting a hold; approving a bank change; reversing anything
after the lock; an erasure; any export. Three wrong codes lock the action and alert. A code proves
the account, not the browser.

## The stage's jobs, from the plan's sixteen

| Job | Way | Fires when | Writes | Week | How we know it ran |
|---|---|---|---|---|---|
| Zoho Investor org → investors database | in | a record edited in Zoho's own screens | the investor mirror | 7 | nightly reconcile |
| Statement match | job | Finance uploads the week's bank statement | every line matched to a receipt, or listed with an owner | 9 | **this is the check on the money** — the only record of a credit is what a person typed, and this is what proves they typed it all |
| eMudhra · investors | in | the supplementary or letter is signed | the document state, file and hash | 10 | poller first, again |
| Mail events | in | delivered, bounced, complained | the record and the sender's reputation | 10 | bounce-rate alarm |
| App → portal requests | in | an investor raises a question or a change | a case in the queue | 10 | idempotent on the app's id; the app shows *received* only from the real case |
| Farm system → updates | in | the farm team publishes | what investors see | 11 | freshness alarm |
| Nightly reconcile + invariants | job | 02:30 | thirteen cross-system checks | 11 | each one names the records, never a count |

## Outside threads that land in this stage

| Who | When | What | If it slips |
|---|---|---|---|
| **Net banking** — Finance | before week 9 | statement download access — the file they already have every month; no agreement, no integration | week 9's match job is written against a guessed format and rewritten later — *cheap to avoid* |
| **eMudhra** — production credentials, per-signature pricing, DSC for NRIs, e-stamp | before week 10 | Q18 in full | week 10's signing runs on the sandbox; nothing signed reaches a real investor |
| **Counsel** — Q20 | started in week 1; needed week 13 | the securities-law opinion | gates go-live, not this stage |
| **Q28** — HR / Sahil | before seats are bought at go-live | payroll headcount; whether the company adopts the Zoho suite | decides Zoho One vs per-org editions (§25) |

## Cases by week

| Week | Level | Cases | Tester's weekend |
|---|---|---|---|
| 7 | M0, the step-up cases, the access matrix | M0-01 … M0-05 | *no staff seat can read a PAN or a bank account by any route, and the eight actions each need a fresh code from the person who holds that authority* |
| 8 | M1, adapted to the manual switch (D21) | M1-01 … M1-05 | *an investor reaches KYC-passed only through Compliance, with the documents on file behind the switch — and a frozen investor is refused before money leaves* |
| 9 | M2, adapted | M2-01 … M2-09 | *every rupee in the bank statement is either against a receipt or on a list with somebody's name on it, and no one person can record and confirm the same receipt* |
| 10 | M3 | M3-01 … M3-05 | *nothing unapproved can be sent, nothing signed exists without its file, and no machine opens a money gate* |
| 11 | M4–M8, then **all 42** | M4-01 … M8-03, then M0–M8 on a clean seed | *stage three signed* |

---

# Week 7 · 19 – 25 Oct · Dashboard, Investors, the investor record — and the locks

**Decisions:** D02, D03, D06, D13, D22, D24; rule 7.
**Build Book:** §2's roles; §3 (the Investor org's tables and the investors mirror); §20 (the six
approvals — M0-03, M0-04 come from them); Appendix A **OA** (13 modes — sessions, tokens,
administrators; this week's seam), **HO**.
**Test Book:** M0-01 to M0-05, plus the step-up cases and the access matrix the plan names.

| Case | Proves |
|---|---|
| M0-01 | No staff seat can read a PAN or a bank account by opening a record |
| M0-02 | A reveal is logged before the value appears |
| M0-03 | No approval process accepts its own submitter |
| M0-04 | The alternate approver can act on the first day of leave |
| M0-05 | Nobody but the integration profile can export |

**The job this week:** Zoho Investor org → investors database — the stage-1 receiver and poller
again, for the second org and the second project, through the investors allow-list.

## Monday first

Stage 2 signed — 48 green, the matrix signed, the restore timed, Demo one done. If not, this week
has not started. Then fix-first.

## What exists by Friday evening

- **Dashboard** — the queues Finance actually works from: money waiting, paper waiting, KYC waiting,
  requests open, and what is ageing.
- **Investors** — the book: search, filters, the tier, the state, the KAM, and what each seat is
  allowed to see of it.
- **Investor page · the record** — the person, their units, their history — with PAN and bank
  account encrypted, hidden by field permission, and shown only through a reveal that logs the reason
  before it shows the value.
- **Step-up authentication** — a second lock on the actions that matter (the eight, above).
- **Team** — seats, roles and temporary grants: who may reach what, until when, granted by whom —
  changed by the tech lead and nobody else.

What you show on Friday: *the same investor record opened by three people, showing three different
amounts of truth — and a refund button that asks who you are before it will move.*

## The order

```
7.1 the investors mirror + its receiver/poller (seam) ──► 7.2 sign-in for the portal's roles + step-up (seam)
                                                        ──► 7.3 the investor record + the reveal (seam)
                                                        ──► 7.4 Investors ──► 7.5 Dashboard
                                                        ──► 7.6 Team (seam)
```

### 7.1 · The investors mirror, and the second receiver — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 — *make an identity
field cross into the investors mirror through the receiver, the poller, or a migration.*

**Read:** D03 (the second project), D13, rule 7, stage 1's 1.2 and 1.6 (this is the same shape,
second org), `zoho/investor/fields.json` (stage 1's 1.9).

**Do:** the investors project's migrations, its allow-list (no PAN, no bank account, no Aadhaar
reference, no address, no signature — and no column for them), RLS by §2's roles, the receiver
and the poller for the Investor org through the same helpers stage 1 wrote — one mapper function,
two allow-lists. The KAM's *masked identity only* is a policy, not a view.

**Done when:** the migrations apply clean; `get_advisors` is clean; the allow-list diff prints
nothing; a Zoho Contact fixture with a PAN through the mapper → a row with none. `RAN`, each. The
adversary's report: BROKEN `none`. `SAW`.

### 7.2 · Sign-in for the portal's roles, and step-up — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 — *do each of the
eight actions with no code, with a stale code, with a code from another account, from a second
browser with a valid session; enter three wrong codes; act as Finance Operations on a Head-of-
Finance action; act as the KAM on anything with money in it.*

**Read:** D06, D22 (the whole decision), D24, §2's roles, Appendix A **OA**; the plan's step-up
paragraph verbatim: *…each demand a fresh code before the button does anything — on the account of
the person who holds that authority, and logged whether it succeeds or fails.*

**Do:**
- Stage 1's OAuth, for the Investor org, for every role in §2's table. The session carries the
  role; the menu derives from it; every write endpoint checks it in the backend.
- **Step-up**: one function, wrapped around each of the eight actions and nothing else. It demands a
  **fresh code** (the book's mechanism — read D22; the default is a time-based code on the account
  that holds the authority), refuses a stale one, locks the action after three wrong codes and
  alerts, and logs every attempt — success or failure — with actor, action, target, time. A code
  proves the *account*: a valid session in another browser does not carry the step-up.
- The lock is on the **authority's** account: Finance Operations cannot step up into a Head-of-
  Finance action by having a code of their own.

**Don't:** step-up on the session instead of the action. A code that lasts the session. A lock that
resets on a new session. Step-up on anything outside the eight (it is a lock, not a habit).

**Done when:**
- Each of the eight actions: no code → refused; stale → refused; other account's → refused; valid →
  proceeds; every attempt logged. `RAN` — a table, eight rows, five columns.
- Three wrong codes → the action locked, an alert fired (through the canaries, 6.5's channel).
  `SAW`.
- The adversary's report: BROKEN `none`. `SAW`.

### 7.3 · The investor record, and the reveal — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 — *read a PAN or a
bank account through the screen, the API, an export, a report, the mirror, the activity log's
before/after, a search result, a notification, an error message; reveal without a reason; reveal as
the KAM.*

**Read:** D13, rule 7, M0-01, M0-02, M0-05; §2 (*Compliance's right* to reveal a PAN; Finance's
*bank fields*).

**Do:**
- The record: the person, their units, their history — from the mirror; identity fields **absent**
  from it (7.1). The tier, the state, the KAM, the ARL.
- **The reveal**: a request for one identity field on one record, with a **reason typed**, behind
  step-up (7.2), by a role §2 allows — Compliance for PAN, Finance for the bank account. The reason
  and the request are **logged before** the value is fetched from Zoho (M0-02); the value is fetched
  from Zoho, as the person, shown once, never written to the mirror, never cached, never in a URL.
- **Export**: nobody but the integration profile can export (M0-05) — the export permission is off
  for every human profile in Zoho, and the portal has no export route for identity.
- Every reveal is a row on the Activity log (week 11) with its reason.

**Don't:** a reveal that returns more than one field. A masked value that is the real one with
characters replaced client-side. A "reveal all" for administrators. An identity field in any
before/after diff.

**Done when:**
- M0-01: every staff profile, every door (screen, API, export, report) → no PAN, no bank account.
  `RAN` — the matrix for these two fields, every cell.
- M0-02: a reveal's log row exists with the reason **before** the value's fetch, by timestamp.
  `RAN`.
- M0-05: an export attempt by every human profile → refused; by the integration profile → allowed.
  `RAN`.
- The adversary's report: BROKEN `none`. `SAW`.

### 7.4 · Investors — build

**Owner:** builder. **Agents:** **reviewer**.

**Do:** the book, to the prototype: search, filters, the tier (by holding — 4+ units, 2–3, 1), the
state (tentative, permanent, frozen, lapsed, withdrawn), the KAM, and **what each seat is allowed to
see of it** — the KAM their own book, masked; the Head of AM the whole book; Finance the ledger's
view of it; the BU Owner holds and refunds. Scoped in the policy, as always.

**Done when:** the page renders for each role with the counts §2 implies on the seed; the KAM's
search cannot find an investor outside their book. `RAN`.

### 7.5 · Dashboard — build

**Owner:** builder. **Agents:** **reviewer**.

**Read:** D09 (the claim → confirmation loop), stage 2's 5.2 (claims arrive here), the decisions:
*Finance gets a notification and a to-do for today with a confirm button.*

**Do:** *the queues Finance actually works from*: money waiting (claims from the console, unmatched
receipts), paper waiting (documents to send, signatures to verify), KYC waiting (Compliance's),
requests open (tickets — week 11 fills it), and **what is ageing** — each item with its age by the
one clock, oldest first. Each queue is a list you can open; each item links to the record. Scoped
by role — Finance sees money and paper; Compliance sees KYC; the Head sees all.

**Don't:** a chart. A count without a list. A queue item that can be actioned from the Dashboard
without opening the record (the action lives on the record, behind its lock).

**Done when:** each queue shows the seed's planted items with their ages; a claim raised on the
console appears in *money waiting* within the poller's interval. `RAN`.

### 7.6 · Team — build · **seam**

**Owner:** builder. **Agents:** **reviewer**; **adversary** ×1 — *grant a seat as anyone but the
tech lead; extend a temporary grant past its expiry by keeping the session; promote yourself.*

**Read:** D22 (one seat per human), D24, §2 (Administrator: *never seat anyone as Super
administrator*; Head of Finance: *never promote itself*), the decisions: *no sharing of logins;
instead temporary access to something specific, with every action recorded and noted until it is
revoked*; M0-03, M0-04 (the approvals in §20 — the alternate).

**Do:** seats, roles and **temporary grants** — who may reach what, **until when**, granted by whom;
every grant and revocation logged; a grant expires by the one clock and the next request after
expiry is refused. **Changed by the tech lead and nobody else** — a role check by name. The six
approvals of §20 are configured in Zoho with a **named alternate** for each approver (M0-04), and
no approval accepts its own submitter (M0-03).

**Done when:** a grant by anyone but Sahil → refused; a grant expires and the next request is
refused; M0-03 and M0-04 on the seed's approvals. `RAN`. The adversary's report: BROKEN `none`.
`SAW`.

## Friday · the handover

- **test-writer** ×1: M0 and the step-up cases.
- Deploy the four pages and the locks. Handover note LOOK AT: the reveal's log order; the three-
  wrong-codes lock; the KAM's search. SEED: personas for every §2 role — the ten may need extending
  (the book's TD list is the limit; add none).
- Graph. `/save`. **verifier**.

## The gate

1. Stage 2 signed.
2. The investors mirror has no identity column; the receiver and poller carry Contact edits through
   the allow-list.
3. M0-01: no staff seat reads a PAN or bank account by any door. M0-02: the reveal logs first.
   M0-05: only the integration profile exports.
4. The eight actions each demand a fresh code on the authority's account; three wrong codes lock and
   alert; a code proves the account, not the browser.
5. M0-03, M0-04: approvals refuse their submitter and accept the alternate on day one of leave.
6. Team: grants by the tech lead only, expiring by the clock, logged.
7. The Investor-org access matrix for identity fields: walked by the adversary, every cell held —
   the full matrix is M8-01, week 11.
8. Four adversary reports (7.1, 7.2, 7.3, 7.6): BROKEN `none`, or fixed.
9. M0's unit tests green.
10. The eleven standing checks.

## If it slips

1. **7.5 Dashboard's ageing** — the queues can ship without ages until Monday of week 8; the queues
   cannot.
2. **7.6's temporary grants** — permanent seats and roles ship; *until when* lands with week 11's
   Team work if it must; *changed by the tech lead only* ships regardless.
3. **Nothing in 7.1, 7.2, 7.3.** Identity and the locks are the stage. If they are not proved on
   Friday, nothing built on them next week is worth building.

---

# Week 8 · 26 Oct – 01 Nov · KYC, residency and the freeze

**Decisions:** D13, D21 (*KYC is a switch a person sets*), Q11 (the NRI's FEMA declaration —
sixty days, then a refund case with the forfeit waived), Q24 (no KYC provider); rule 7.
**Build Book:** §2 rung 7's condition (*KYC passed ∧ FEMA if NRI*); Appendix A **KY** (8 modes).
**Test Book:** M1-01 to M1-05, *adapted to the manual switch.*

| Case | Proves |
|---|---|
| M1-01 | KYC has an owner, a step and a link that works without the app |
| M1-02 | An unknown answer is not a pass and not a failure — adapted: a document state that is neither *passed* nor *failed* stays *pending*, and nothing downstream reads it as either |
| M1-03 | Residency is confirmed from documents, and a change opens a Compliance item |
| M1-04 | A frozen investor is refused by everything downstream |
| M1-05 | The Aadhaar number is nowhere |

No new jobs — *KYC is a switch a person sets, not an integration.*

## Monday first

Week 7's tester results and the diagnostic. Fix-first.

## What exists by Friday evening

- **Investor page · KYC** — documents collected and uploaded — PAN, address, photograph — then
  **Compliance sets the KYC switch by hand**: passed, failed or frozen. Who set it, when, and against
  which documents is recorded on the record.
- **Investor page · residency and FEMA** — residency confirmed from the documents rather than typed
  at capture; a change opens a Compliance item; the FEMA record and its thirty-day clock start at
  the receipt.
- **Investor page · freeze** — one switch that every downstream action reads — payout, bank change
  and allotment all refuse a frozen investor.

What you show on Friday: *an investor's documents uploaded, checked and passed in two minutes, with
the whole trail visible.*

## The order

```
8.1 the KYC switch and its documents (seam) ──► 8.2 residency and FEMA ──► 8.3 the freeze (seam)
```

### 8.1 · KYC — the documents, and the switch — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 — *set the switch as
Finance, as the KAM, as an administrator; set it with no documents behind it; upload a document
that carries an Aadhaar number; read a document as the KAM.*

**Read:** D21, D13, D08 (*documents live only in Zoho; the app fetches on demand*), §2's Compliance
row, M1-01, M1-02, M1-05.

**Do:**
- **Documents**: PAN, address proof, photograph — uploaded from the portal **straight into Zoho**
  (week 10's M3-04 proves the same for the supplementary), attached to the record, never stored in
  Supabase or the portal. Each upload logged: who, when, which kind.
- **The switch**: passed / failed / frozen / pending — set **by Compliance only**, by hand, behind
  step-up if the book says so (read D22's list: KYC is not one of the eight; a plain role check),
  and **only with documents behind it** — the switch refuses without at least the book's required
  set attached. Who set it, when, against which documents: on the record, and a row on the Activity
  log.
- *Pending* is the state until a person moves it. An ambiguous document — unreadable, expired,
  mismatched name — leaves it pending (M1-02 adapted); nothing downstream treats pending as passed
  or as failed.
- **KYC has an owner, a step and a link that works without the app** (M1-01): the investor can be
  sent a link (mail as the person, D17) to upload what is missing, and the link works with no app
  account — the app opens later, at the first money (D10).
- **The Aadhaar number is nowhere** (M1-05): no field for it in either org, the mirror, a fixture, a
  log, a document's metadata; the upload path rejects a file whose name or extracted text carries
  a twelve-digit number in Aadhaar's shape — refuse, do not store.

**Don't:** an OCR that stores what it read. A switch a script can set. A document in Supabase
Storage "temporarily". An Aadhaar reference field "for later".

**Done when:**
- M1-01: an investor with no app account receives a link, uploads, and the record shows the
  document with owner and step. `RAN`.
- The switch by Finance, KAM, administrator → refused; by Compliance with no documents → refused;
  with documents → set and logged with the documents' ids. `RAN`.
- M1-02: with an ambiguous document the state is *pending* and the allotment condition (rung 7)
  reads it as unmet. `RAN`.
- M1-05: `grep -rniE "aadhaar|aadhar" db-* contracts zoho console portal app` finds only refusals;
  an upload named `aadhaar.pdf` or containing a twelve-digit number is refused. `RAN`.
- The adversary's report: BROKEN `none`. `SAW`.

### 8.2 · Residency and FEMA — build

**Owner:** builder. **Agents:** **reviewer**.

**Read:** Q11, §2 rung 7 (*FEMA if NRI*), M1-03, M6-01 (week 11 proves the allotment side: *an NRI
cannot be allotted without a FEMA record, and the clock is visible*), Appendix A **KY**, **LT**
(legal and timing).

**Do:**
- Residency is **confirmed from the documents**, by Compliance, on the record — not carried from the
  lead's capture (stage 2 captured it as the IR's statement; this is the fact). A change of
  residency opens a Compliance item (a ticket of Compliance's kind, week 11's queue; this week a
  row on the Dashboard's KYC queue).
- **The FEMA record** for an NRI: created at the first receipt (`money.received`), with its
  **thirty-day clock** started at the receipt's date by the one function, visible on the record with
  days remaining. Q11's sixty-day path — the declaration never arrives → a refund case with the
  forfeit waived — is a state the record can carry; week 11's refund job acts on it.

**Don't:** a residency typed here. A clock computed from *now*. A FEMA record with no receipt.

**Done when:** M1-03 on the seed — residency from documents, a change opens the item; a seed NRI's
FEMA clock shows the right days by the pinned clock. `RAN`.

### 8.3 · The freeze — build · **seam**

**Owner:** builder. **Agents:** **reviewer**; **adversary** ×1 — *pay out, change a bank, allot,
lapse, refund a frozen investor through every route; unfreeze as the KAM.*

**Read:** M1-04; §2's Compliance row (*KYC pass/fail* includes frozen); rule 4 in its mirror image
(*a switch every downstream action reads*).

**Do:** **one switch** on the record — frozen — set by Compliance, logged; and **one function** that
every money-out and allotment path calls before it does anything: payout, bank change, allotment,
lapse, refund. A frozen investor is refused by all of them, with the refusal logged. Weeks 9 and 11
build those paths; they call this function or they are defects.

**Don't:** a freeze flag copied onto each downstream table. A freeze the Dashboard hides but the API
honours differently.

**Done when:** M1-04: freeze the seed's investor → each downstream action on the sheet refused, each
refusal logged; the function is called from every such path (`graphify affected "isFrozen"` names
them all). `RAN`. The adversary's report: BROKEN `none`. `SAW`.

## Friday · the handover

- **test-writer** ×1: M1, adapted.
- Deploy the record's three sections. Handover note LOOK AT: the switch with no documents; an
  upload that carries an Aadhaar-shaped number; the freeze from the API.
- Graph. `/save`. **verifier**.

## The gate

1. Week 7's gate closed.
2. M1-01, M1-02: documents into Zoho only, logged; the switch Compliance's only and only with
   documents; pending is neither.
3. M1-03: residency from documents; a change opens a Compliance item; the FEMA clock is visible and
   right.
4. M1-04: a frozen investor is refused by every downstream path, and the paths that do not exist yet
   are on week 9's and 11's sheets to call the one function.
5. M1-05: the Aadhaar number is nowhere.
6. Two adversary reports (8.1, 8.3): BROKEN `none`, or fixed.
7. M1's unit tests green.
8. The eleven standing checks.

## If it slips

1. **8.2's FEMA clock display** — the record can carry the date; the countdown lands with week 9's
   Transactions, which shows deadlines anyway (M2-09).
2. **Nothing in 8.1 or 8.3.** A KYC switch a script can set, or a freeze one path ignores, is money
   leaving to the wrong person.

---

# Week 9 · 02 – 08 Nov · **heaviest week** · Transactions — the money page

**Decisions:** D10 (tentative → permanent at due zero; the seven-day lock), D19, D21 (*money is
typed and checked against the bank statement weekly*), D22 (*the bank statement is the second hand
for ordinary receipts; an administrator is the second hand for money leaving*), Q9, Q27; rules 3,
4, 5, 8, 9.
**Build Book:** §2 rungs 5–6; §3 (the ledger's tables and their one writer); §11 (`money.*`,
`hold.changed`); Appendix A **MO** (19 modes — read them all; each is a case or a fixture);
`ops/runbooks/money-mismatch.md`.
**Test Book:** M2-01 to M2-09, *adapted*. **Every task this week is evidence** — plain sessions,
no headroom, all week.

| Case | Proves |
|---|---|
| M2-01 | Money paid before verification is still recorded |
| M2-02 | A hundred per cent paid in one credit works end to end |
| M2-03 | One person cannot both record and match the same receipt |
| M2-04 | Matching survives one of the two Finance people being away |
| M2-05 | Every credit in the statement is either matched or in suspense with an owner |
| M2-06 | An NRI's shortfall does not become a manual exception every time |
| M2-07 | Changing the units after handover recomputes what is owed |
| M2-08 | A hold cannot be opened twice and cannot lapse on a paid investor |
| M2-09 | Deadlines land on the right day in Indian time |

**The job this week:** the statement match — *runs on upload: every line matched, or listed with a
named owner.* **Net banking access must be in hand** — a real (anonymised) statement export, in
the bank's own format, before the job is written.

## Monday first

Week 8's tester results and the diagnostic. Fix-first. Then: the statement file, in the vault's
fixtures directory, anonymised — the format the job is written against. If it is not there, the
job is written against a guess and the sheet says so; it is rewritten the week the file arrives.
This is a heaviest week: **the adversary on 9.2 runs Wednesday.**

## What exists by Friday evening

- **Transactions · record a receipt** — Finance types what arrived: date, amount, mode (NEFT, RTGS,
  IMPS, UPI, cheque), the bank's UTR or reference, which investor, and what it is for. **Recording
  is never blocked** — money that has arrived is always visible.
- **Transactions · match** — matching is what the rules gate: the supplementary must be verified.
  **The second hand for ordinary receipts is the bank statement**, not a colleague — Finance types
  it, the statement proves it. **For money leaving** — refunds, forfeits, bank changes, post-lock
  reversals — the Finance head executes behind a step-up code, and the tech lead or Pradeep
  approves.
- **Transactions · kinds and due** — advance, balance, full, excess, and an approved write-off for a
  foreign shortfall; due recomputed when units change; due at zero makes the account permanent.
- **Transactions · holds** — one hold per investor per programme, its deadline shown to the
  investor, and a lapse refused while due is zero or a receipt is unconfirmed.
- **Transactions · statement upload** — Finance uploads the week's bank statement; the portal
  compares every line to the receipts and reports two lists — money in the bank with no receipt,
  and receipts with no money behind them.

What you show on Friday: *a week's statement uploaded, and the one credit nobody had recorded found
in four seconds.*

## The order

```
9.1 record (seam) ──► 9.2 match + money leaving (seam) ──► 9.3 kinds and due ──► 9.4 holds (seam)
9.5 statement upload + the match job (evidence — the check on the money)
```

### 9.1 · Record a receipt — evidence · **seam**

**Owner:** builder. **Agents:** **planner** ×1 (the ledger's shape is the whole stage's); **reviewer**;
**adversary** ×1 — *record as the KAM; record with prose in the amount; record the same UTR twice;
record for a frozen investor (allowed — recording is never blocked; check it is visible and flagged,
not refused); delete a ledger row as the Head.*

**Read:** rule 3 (*recording money is always allowed; matching is what the rules gate*), D21, §2
(Finance Operations *writes receipts (record)*; Head of Finance *never deletes a ledger row*),
M2-01, Appendix A **MO**.

**Do:**
- The ledger: append-only. A receipt is a row: date, amount, mode (the five), the bank's UTR or
  reference, the investor (or *unknown* — a credit from a third-party remitter is still recorded,
  M2's adapted case), what it is for (the kind, 9.3), recorded by whom, when. `money.received`
  through the outbox.
- **Recording is never blocked**: not by KYC pending, not by the freeze, not by a missing
  supplementary. Those gate *matching*. A receipt for a frozen investor is recorded and flagged.
- The same UTR twice is recorded and flagged as a possible duplicate — typed twice is a real thing
  (M2's *a duplicate entry typed twice*); the statement (9.5) is what settles it.
- **Nobody deletes a ledger row.** A correction is a new row that reverses (`money.reversed`, behind
  step-up — it is *money leaving* in effect).

**Don't:** a receipt that can be edited. A record path that checks KYC. A delete.

**Done when:** M2-01: a receipt for an investor whose supplementary is unverified is recorded and
visible. The KAM's record → refused. A delete by the Head → refused (no route exists; the table's
policy refuses). `RAN`. The adversary's report: BROKEN `none`. `SAW`.

### 9.2 · Match — and money leaving — evidence · **seam — the money seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 on **Wednesday** —
*match your own receipt; match with the supplementary unverified; match without the statement's
line; match to the wrong investor; match twice; execute a refund as Operations; execute one as the
Head with no approver; approve your own refund; reverse after the lock without step-up; do all of it
with one Finance person deactivated.*

**Read:** D22 in full, D21, rules 3, 4, 5; §2 (Operations *never matches its own receipts*; the
Head *matches, allots, lapses, refunds, extends a hold*; the BU Owner *approves a refund*); M2-03,
M2-04; stage 2's 5.3 (the confirmation is the gate's fact — `money.confirmed`).

**Do:**
- **Matching** turns a recorded receipt into a confirmed fact (`money.confirmed`, which opens the
  gate on the console). It is gated: the supplementary is verified (`paper.verified` exists);
  **the statement line is the second hand** — a receipt is matched against the statement line the
  match job (9.5) paired it with; **the matcher is not the recorder** (M2-03: one seat per human
  makes this a name check, not a role check).
- **Money leaving** — refund, forfeit, bank change, post-lock reversal: **the Head executes behind
  step-up (7.2); the tech lead or Pradeep approves** — the second hand is an administrator (D22),
  through one of §20's approval processes with its named alternate (M0-04). No approver approves
  their own submission (M0-03).
- **Survives one Finance person away** (M2-04): with Operations deactivated, the Head can record
  *and* a second seat (the alternate the book names) can match; with the Head away, the alternate
  approver stands in. Nothing in the flow needs two specific people to be present at once.
- Every match and every money-out is a row on the Activity log with both names.

**Don't:** a match without a statement line "because the UTR is obvious". A refund with one
signature. An approval that is a checkbox. A role check where the book wants a name check.

**Done when:**
- M2-03: the recorder's own match → refused; another Finance seat's → allowed. `RAN`.
- A match with the supplementary unverified → refused; with no statement line → refused. `RAN`.
- A refund as Operations → refused; as the Head without approval → held; approved by the tech lead
  → executed, `money.reversed` emitted, gate closed on the console (L6-03's path). `RAN`.
- M2-04: with Operations deactivated, the week's receipts still get recorded and matched by two
  named hands. `RAN`.
- The adversary's report: BROKEN `none`, or fixed by Thursday. `SAW`.

### 9.3 · Kinds and due — evidence

**Owner:** builder. **Agents:** **reviewer**.

**Read:** D10, Q11 (the NRI shortfall), M2-02, M2-06, M2-07; §2 rungs 5–6.

**Do:**
- Kinds: advance, balance, full, excess, and an **approved write-off for a foreign shortfall** (an
  NRI's remittance that arrives short by bank charges — approved once per programme by the Head,
  so it is *not a manual exception every time*, M2-06).
- **Due**: units × price − confirmed money, recomputed whenever units change after handover (M2-07)
  or a receipt is confirmed or reversed. **Due at zero makes the account permanent** (D10, rung 6):
  the mark flips by itself on the event, never by a click; seven days later it locks (M4-03, week
  11 proves the lock).
- **A hundred per cent in one credit** (M2-02): one receipt of the full amount, matched, takes the
  investor from tentative through permanent in one step, with the advance gate and the balance gate
  both opened by the one fact.

**Don't:** a due typed by hand. A permanent mark set by a person. A write-off per receipt.

**Done when:** M2-02, M2-06, M2-07 on the seed; due recomputes on a units change; the mark flips on
due zero and the flip is an event. `RAN`.

### 9.4 · Holds — evidence · **seam**

**Owner:** builder. **Agents:** **reviewer**; **adversary** ×1 — *open a second hold; lapse a hold
with due at zero; lapse with an unconfirmed receipt pending; extend as the KAM; forfeit without
step-up.*

**Read:** §2 rung 5 (*hold of 30 days set; units reserved on the shelf*), §11 `hold.changed`,
M2-08, M2-09, D22 (forfeiting a hold is one of the eight).

**Do:** **one hold per investor per programme**, opened at the advance's confirmation for thirty
days by the one clock, its **deadline shown to the investor** (the app, week 12, reads it; the
record shows it now); extended by the Head or the BU Owner (§2); **lapse refused while due is zero
or a receipt is unconfirmed** (M2-08); forfeit behind step-up. `hold.changed` for every change.
Units reserved on the shelf (week 10's Farms is the shelf; this week the reservation is a fact on
the record that the shelf will read).

**Done when:** M2-08: a second hold → refused; lapse with due zero → refused; lapse with an
unconfirmed receipt → refused. M2-09: a hold opened at 23:30 IST on day D has its deadline on
D+30 in IST, not D+29 in UTC. `RAN`. The adversary's report: BROKEN `none`. `SAW`.

### 9.5 · The statement upload, and the match job — evidence · **the check on the money**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; and the tester's M2-05.

**Read:** D21, D22, Q27 (*weekly CSV from net banking, reconciled per line, until an API exists;
debits included*), rule 8 (*the bank statement* is what stands behind money's webhook — there is
no webhook; the statement is the fact), M2-05, `ops/runbooks/money-mismatch.md`, the plan's line:
*this is the check on the money — the only record of a credit is what a person typed, and this is
what proves they typed it all.*

**Do:**
- Finance uploads the week's statement — the bank's own format, from the anonymised file. The job
  runs **on upload**: every line — credits **and debits** — is matched to a receipt (or to a
  money-out) by amount, date window and reference, or **listed with a named owner**: two lists —
  money in the bank with no receipt (suspense, owner: Finance Operations, to record it), and
  receipts with no money behind them (owner: the recorder, to explain). A third-party remitter is a
  suspense line with the investor unknown until a person says.
- The match pairs a receipt with its line and that pairing is what 9.2's *match* checks.
- Nothing is auto-confirmed. The job pairs; a person matches.
- The report is a page on Transactions and a row on the Dashboard's money queue; a non-empty
  suspense list older than the runbook's threshold is a canary.

**Don't:** a match on amount alone. Auto-confirmation. A statement stored anywhere but as the
upload's audit copy in Zoho.

**Done when:**
- M2-05: the seed's statement — a credit nobody recorded, a receipt with a wrong UTR, a third-party
  remitter, a duplicate typed twice — every line is paired or on a list with a name. `RAN` — the two
  lists.
- The unrecorded credit is found and named within seconds of upload (the Friday demo). `RAN` — the
  time.
- A debit line pairs with a money-out or is listed. `RAN`.

## Friday · the handover

- **test-writer** ×1: M2-01 to M2-09.
- Deploy Transactions. Handover note LOOK AT: the recorder matching their own receipt; the statement
  with the four planted faults; the refund with one Finance person deactivated. SEED: a second
  anonymised statement the tester has not seen.
- Graph. `/save`. **verifier**.

## The gate

1. Week 8's gate closed. The statement's real format is in the fixtures, or the guess is written.
2. M2-01: recording is never blocked; no ledger row can be deleted.
3. M2-03, M2-04: no one records and matches the same receipt; matching survives one person away.
4. Money leaving: the Head behind step-up, an administrator's approval, never self-approved.
5. M2-02, M2-06, M2-07: full payment in one credit; the NRI shortfall by approved write-off; due
   recomputes; permanent at due zero by event.
6. M2-08, M2-09: one hold; no lapse on a paid investor; deadlines in IST.
7. M2-05: every statement line paired or owned; the unrecorded credit found in seconds.
8. Three adversary reports (9.1, 9.2, 9.4): BROKEN `none`, or fixed.
9. M2's unit tests green.
10. The eleven standing checks.

## If it slips

1. **9.3's write-off** — a foreign shortfall can be a suspense line with an owner until Monday of
   week 10; the kind lands then.
2. **9.5 against the guessed format** — if the real statement is late, the job ships against the
   guess and the sheet says so; it is rewritten the day the file arrives, and M2-05 re-runs.
3. **Nothing in 9.1, 9.2, 9.4.** *No one person can record and confirm the same receipt* and *money
   leaving needs two names* are the stage's money promise.

---

# Week 10 · 09 – 15 Nov · **heaviest week** · Documents, Farms, Updates and Insights

**Decisions:** D07 (eMudhra), D08 (*documents live only in Zoho*), D15 (the FMS is separate — the
shelf is this side's), D17 (mail as the person), D18; rules 5, 6, 8.
**Build Book:** §20 (the twelve templates, versions, the six approvals with alternates); §11
(`paper.*` for the supplementary and the allocation letter, `mail.delivered`, `request.raised`,
`case.replied`); Appendix A **DO** (13), **ML** (4), **SE**.
**Test Book:** M3-01 to M3-05.

| Case | Proves |
|---|---|
| M3-01 | A template edited after approval cannot be sent |
| M3-02 | Automation verifies the signature; a person verifies the instrument |
| M3-03 | An e-stamp is single-use and bound to the document it was bought for |
| M3-04 | Uploading a document from the portal puts it in Zoho, not in a mailbox |
| M3-05 | A blocked document closes whatever it had opened |

**The three jobs this week:**

| Job | Way | Fires when | Writes | How we know it ran |
|---|---|---|---|---|
| eMudhra · investors | in | the supplementary or letter is signed | the document state, file and hash | **poller first, again** |
| Mail events | in | delivered, bounced, complained | the record and the sender's reputation | bounce-rate alarm |
| App → portal requests | in | an investor raises a question or a change | a case in the queue | idempotent on the app's id; the app shows *received* only from the real case |

## Monday first

Week 9's tester results and the diagnostic. Fix-first. **Q18 in full** — eMudhra production
credentials, pricing, DSC for NRIs, the e-stamp integration — in the vault, or this week runs on the
sandbox and says so. A heaviest week: **the adversary on 10.1 runs Wednesday.**

## What exists by Friday evening

- **Documents** — the template library with versions that cannot be edited after approval; the
  supervisor's approval with a named alternate; upload straight into Zoho; the e-stamp bound to the
  document's hash and usable once; send for signature; verify; block.
- **Farms** — the shelf: units sold, reserved and free by programme and phase — the number every
  reservation checks against.
- **Updates** — what investors are told, by category, published by the seat that owns that category.
- **Insights** — the portal's own analytics: money by week, paper ageing, KYC throughput, care
  coverage.

What you show on Friday: *a supplementary drafted, approved, stamped, signed and verified — and a
tampered one refused at every step.*

## The order

```
10.1 Documents: poller first, receiver, then the library, approval, stamp, send, verify, block (seam)
10.2 Farms — the shelf (seam)     10.3 the three inbound jobs (seam)     10.4 Updates     10.5 Insights
```

### 10.1 · Documents — evidence · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 on **Wednesday** —
*edit an approved template and send it; approve your own template; reuse an e-stamp; stamp one
document and attach the stamp to another; sign with the wrong units and see whether the money gate
moves; verify as automation; block a document and check the gate it opened is closed; upload from
the portal and find the file anywhere but Zoho.*

**Read:** D07, D08, §20 in full, D22 (*any export* — the evidence pack, M6-04, is next week), M3-01
to M3-05, stage 2's 5.1 (the same shape, the second round), Appendix A **DO**.

**Do, in this order:**
1. **The poller first**, then **the receiver**, for the investor-side signatures — the supplementary
   and the allocation letter — exactly as 5.1, through the same handler, idempotent on the
   provider's id; the signed file and its hash into Zoho on completion.
2. **The template library**: the twelve of §20, each with an owner, a version, and a state
   (draft, approved). **A version cannot be edited after approval** — an edit makes a new draft
   version; the approved one is immutable (M3-01). **The supervisor's approval with a named
   alternate** — one of §20's six approvals, in Zoho (D05), with M0-03/M0-04's properties.
3. **Upload straight into Zoho** (M3-04): the portal streams the file to Zoho's attachment on the
   record; no copy in Supabase, no copy in a mailbox, no copy on the portal's disk.
4. **The e-stamp**: bought for a document, **bound to the document's hash**, **usable once**
   (M3-03) — a stamp record with the hash and a used-at; a second use, or a use on a different hash,
   is refused.
5. **Send for signature**: only an approved template version, only a stamped document, as the
   person (D17), through eMudhra; `paper.sent`.
6. **Verify**: **automation verifies the signature** — the provider's completion, the hash matching
   the sent file, the signer matching the record; **a person verifies the instrument** — Finance
   reads the signed document and confirms the units and the amount are the ones agreed (M3-02).
   Only the person's verification is `paper.verified` and opens the gate (rung 4's fact). *No
   machine opens a money gate.*
7. **Block** (`paper.blocked`): closes whatever the document had opened — the gate steps back
   (L6-03's path), the reservation it justified is released (M3-05).

**Don't:** an approved template that is a file someone can overwrite. A stamp without a hash. A
verify button that automation can press. A file that exists in two places.

**Done when:**
- M3-01: an approved template edited → the edit is a new draft; sending the edited one → refused.
  `RAN`.
- M3-02: the provider's completion sets *signed*; nothing sets *verified* but Finance's act; the
  gate opens only on *verified*. `RAN`.
- M3-03: a stamp used twice → refused; on a different hash → refused. `RAN`.
- M3-04: after an upload, the file's only location is the Zoho attachment. `RAN` — a search of
  Supabase Storage and the portal's filesystem prints nothing.
- M3-05: block a verified supplementary → gate closed, reservation released. `RAN`.
- The poller completes a signature with the callback off, on the investor side. `SAW`.
- The adversary's report: BROKEN `none`, or fixed by Thursday. `SAW`.

### 10.2 · Farms — the shelf — build · **seam**

**Owner:** builder. **Agents:** **reviewer**; **adversary** ×1 — *reserve more units than are free;
reserve the same unit twice; change the shelf as the KAM; let a lapse fail to release.*

**Read:** D15 (*the FMS stays a separate vertical; farm progress arrives* — the shelf is **this**
side's fact, not the FMS's); §2 rung 5 (*units reserved on the shelf*); §3 (the shelf's one writer).

**Do:** the shelf — units sold, reserved and free **by programme and phase** — *the number every
reservation checks against.* One writer: the reservation (9.4's hold), the lapse (week 11), the
allotment (week 11), the refund (week 11), each an event that moves units between the three states.
Sold + reserved + free = the programme's total, always; an invariant the nightly check (week 11)
names when broken.

**Don't:** a shelf edited by hand. A count computed on the page from records. A reservation that
does not check *free*.

**Done when:** a reservation beyond *free* → refused; the same unit twice → refused; the sum
invariant holds on the seed after each event kind. `RAN`. The adversary's report: BROKEN `none`.
`SAW`.

### 10.3 · The three inbound jobs — mail events, app requests, and the investor-side signatures — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 — *replay a mail
event; forge an app request; send the same app request twice with the same id and with a new id;
raise a request for another investor.*

**Read:** rule 8, D17, §21, `contracts/mail.delivered.json`, `request.raised.json`,
`case.replied.json`, Appendix A **ML**, **SE**; the plan's *how we know it ran* for each.

**Do:**
- **Mail events**: delivered, bounced, complained — from the mailer, signed, replay-inert — onto
  the record (as system touches, rule 6) and onto the sender's reputation; a **bounce-rate alarm**
  (a canary) when the rate crosses the runbook's line. A complaint withdraws that address from every
  send (M6-02 next week extends this to consent).
- **App → portal requests**: an investor's question or change request arrives as a case in the
  queue (week 11's Tickets), **idempotent on the app's own id** — the same id twice is one case; the
  app is told the case's id and shows *received* only from that (the app is week 12; this week the
  receiver and the case are proved with a synthetic sender).
- The signatures' receiver and poller are 10.1's step 1, listed here because the plan counts them
  as one of the three.

**Don't:** a mail event applied twice. A request accepted without a signature. A case created with
no id to answer.

**Done when:** a replayed mail event changes nothing; a forged request is refused; the same request
id twice makes one case; a bounce over the line pages. `RAN`. The adversary's report: BROKEN
`none`. `SAW`.

### 10.4 · Updates — build

**Owner:** builder. **Agents:** **reviewer**.

**Read:** §2 (KAM *writes updates (farm, care)*; Finance publishes statements and compliance — Q12's
default), rule 6, D17.

**Do:** what investors are told, **by category**, **published by the seat that owns that category**
(Q12: statements and compliance — Finance; farm and care — the KAM); each update a record with its
category, its author, its time, and the investors it reaches (all, a programme, one); a system touch
on each record it reaches. Week 12's app reads them; week 11's farm-updates job writes the farm
category from the FMS.

**Don't:** an update a seat outside the category can publish. Push or mail from here — week 12's
app does push (`push.delivered`); mail is as a person.

**Done when:** an update in each category by the owning seat succeeds and by another is refused;
it reaches exactly the investors it names. `RAN`.

### 10.5 · Insights — build (reads are evidence)

**Owner:** builder. **Agents:** **reviewer**.

**Read:** stage 2's 6.2 (the same rule: from facts, net of reversals, derivation beside each figure).

**Do:** the portal's own analytics — money by week (from confirmed receipts net of reversals),
paper ageing (from `paper.*` timestamps), KYC throughput (from the switch's log), care coverage
(from the care log, week 11). Each figure with its derivation one click away. Scoped by role.

**Done when:** each figure reproduces by hand on the seed (the tester's, as L7-01 was); a
`money.reversed` moves money-by-week down. `RAN`.

## Friday · the handover

- **test-writer** ×1: M3-01 to M3-05.
- Deploy the four pages and the three receivers. Handover note LOOK AT: the edited approved
  template; the reused stamp; the file's only location. SEED: a tampered supplementary for the demo.
- Graph. `/save`. **verifier**.

## The gate

1. Week 9's gate closed. Q18 is in hand or the sandbox is declared.
2. M3-01 to M3-05, each.
3. The investor-side poller completes a signature with the callback off.
4. The shelf's sum invariant holds after every event kind; nothing over-reserves.
5. Mail events, app requests: replay-inert, forgery-refused, idempotent on the app's id; the
   bounce-rate canary pages.
6. Updates by owning seat only. Insights' figures reproduce by hand.
7. Three adversary reports (10.1, 10.2, 10.3): BROKEN `none`, or fixed.
8. M3's unit tests green.
9. The eleven standing checks.

## If it slips

1. **10.5 Insights** — can land Monday of week 11; it reads facts that exist regardless.
2. **10.4's reach rules** — *all* and *one* ship; *a programme* lands with the shelf's programme
   list if it must.
3. **Nothing in 10.1, 10.2, 10.3.** *Nothing unapproved can be sent, nothing signed exists without
   its file, and no machine opens a money gate* is the stage's paper promise, and week 11 allots on
   it.

---

# Week 11 · 16 – 22 Nov · **heaviest week** · Allotment, Tickets, Activity log, System — and proving the portal

**Decisions:** D10, D12 (*account management sits in the investor org; KAMs are…*), D14, D19 (the
eleven canaries; the reversal events), D22; Q4, Q10 (exit, secondary sale, nominee, death), Q11,
Q5 (the one-week lock and what a reversal after it is); rules 4, 5, 8.
**Build Book:** §2 rungs 7–8 and the KAM / Head of AM rows; §15 as amended; §22; §24; Appendix A
**CA** (7), **KY**, **MI**, **PL**; `ops/drills/`, `ops/runbooks/*`.
**Test Book:** M4-01 to M8-03 — eighteen cases — then **all 42 portal cases** on a clean seed.

| Case | Proves |
|---|---|
| M4-01 | No allotment without all four facts and the signed supplement |
| M4-02 | The app account opens tentative and turns permanent by itself |
| M4-03 | The permanent mark cannot be undone after seven days |
| M5-01 | A KAM on a real Team seat can do a whole day's work |
| M5-02 | Every investor has an owner, including the one-unit ones |
| M5-03 | A request never lands on nobody |
| M5-04 | A bank change is verified, cooled off, notified — and only then usable |
| M5-05 | A weekend does not breach an SLA, and escalation does not loop |
| M6-01 | An NRI cannot be allotted without a FEMA record, and the clock is visible |
| M6-02 | Withdrawing consent stops every send, not just marketing |
| M6-03 | An erasure leaves nothing, and the request proves it |
| M6-04 | The evidence pack for a signed document can be produced in a minute |
| M7-01 | A refund matches a real debit and goes to the right account |
| M7-02 | A lapsed investor keeps a login and loses the wrong powers |
| M7-03 | Death or an estate pauses the clocks instead of forfeiting |
| M8-01 | The access matrix for the Investor org is walked and signed |
| M8-02 | Approvals and matching both survive two people being away |
| M8-03 | The investors project restores and the event archive replays |

**The three jobs this week:**

| Job | Way | Fires when | Writes | How we know it ran |
|---|---|---|---|---|
| Farm management system → farm updates | in | the farm team publishes | what investors see | freshness alarm |
| Nightly reconcile + invariants | job | 02:30 | **thirteen cross-system checks** | each one names the records, never a count |
| Lapse, refund and reversal events | both | a hold lapses, a refund executes, anything reverses | each undoing what it should | the invariants |

## Monday first

Week 10's tester results and the diagnostic. Fix-first. A heaviest week and a stage end: **the
adversaries on 11.1 and 11.4 run Wednesday; the portal-wide adversary runs after the regression.**

## What exists by Friday evening

- **Investor page · allotment** — all four facts and the signed LLP supplement, or it does not
  happen; the app account opens tentative at the first money, turns permanent by itself and locks
  after seven days; the KAM is named.
- **Tickets** — requests and cases from the app: routed to a role queue that can never resolve to
  nobody, business-hours SLAs, and the bank change the KAM hands on without ever seeing an account
  number.
- **Investor page · care** — the KAM's cadence by tier, the care log, the pool as a named owner so
  single-unit investors are in somebody's list.
- **Activity log** — the audit trail across both orgs and every reveal, with its reason.
- **System** — the eleven canaries, mirror freshness, the outbox and its dead letters, last night's
  backup, the last restore drill.

Then the regression, the signing, and **Demo two**.

## The order

```
11.1 allotment + the account's lifecycle (seam) ──► 11.2 care ──► 11.3 Tickets (seam)
11.4 lapse, refund, reversal, erasure, consent (seam — the undo seam)
11.5 the nightly reconcile + thirteen invariants; the eleven canaries; farm updates (evidence)
11.6 Activity log ──► 11.7 System
11.8 the proofs: M8 (evidence — the tester's, with the portal-wide adversary)
```

### 11.1 · Allotment, and the account's lifecycle — evidence · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 on **Wednesday** —
*allot with three facts; allot with the supplement signed but not verified; allot an NRI with no
FEMA record; set permanent by hand; undo permanent on day eight; allot a frozen investor.*

**Read:** §2 rung 7 (*allocation letter verified ∧ balance zero ∧ KYC passed ∧ FEMA if NRI;
partner admitted — LLP supplement, Form 4; a KAM is named; care begins*) and rung 8 (*close copy*);
D10; Q3, Q4, Q5; §11 `allotment.done`, `allotment.reversed`, `account.opened`,
`welcome.delivered`, `lead.closed`; M4-01 to M4-03, M6-01; stage 2's 5.3 (rung 7 is ticked by the
console on `allotment.done`).

**Do:**
- **Allotment happens on all four facts and the signed supplement, or it does not happen**
  (M4-01): the allocation letter verified (10.1's *person verifies*), balance zero (9.3's due),
  KYC passed (8.1), FEMA if NRI (8.2, M6-01) — and the LLP supplement signed (10.1). One function
  reads all five and emits `allotment.done`; the Head executes it (§2). The console ticks rung 7 on
  the event. The KAM is named at allotment (11.2). The **close copy** (rung 8): the remaining lead
  details copied into the Contact's placeholders; `lead.closed`; the lead read-only for life.
- **The account's lifecycle** (D10): `account.opened` at the first confirmed money — **tentative**;
  `welcome.delivered`; what tentative withholds is Q4's default (statements, the payout mandate,
  bank change and exit requests; farm updates and documents from day one). **Permanent by itself**
  at due zero (9.3) — M4-02. **Locks after seven days** — the tentative/permanent toggle can be
  undone by a person for seven days and then cannot (M4-03, Q5); after the lock, a reversal is a
  refund case with two approvers (11.4).
- `allotment.reversed` un-allots: units back to the shelf, the console's rung stepped back
  (L6-03's path), the KAM unnamed.

**Don't:** an allotment with a fact read from the mirror instead of the event. A permanent flag a
person sets. A lock that is a warning.

**Done when:**
- M4-01: each of the five preconditions missing in turn → refused; all present → `allotment.done`,
  rung 7 ticked on the console, `lead.closed`, the lead read-only. `RAN` — six runs.
- M4-02: the account opens tentative at the first `money.confirmed` and turns permanent at due zero
  with no click. `RAN`.
- M4-03: undo on day six → allowed; day eight → refused. `RAN`, clock pinned.
- M6-01: an NRI with no FEMA record → refused; the clock visible on the record. `RAN`.
- The adversary's report: BROKEN `none`, or fixed by Thursday. `SAW`.

### 11.2 · Care — build

**Owner:** builder. **Agents:** **reviewer**; M5-01 is the tester's — *a whole KAM day on a real
Team seat* — the builder writes the day's script from §2's KAM row.

**Read:** D12 (*a key account manager is named at allotment and tiered by holding size — 4+ units a
named manager monthly, 2–3 quarterly, 1 unit in a shared pool half-yearly; the KAM measure is
service only — cadence kept, tickets answered, how the call ended*), §2's KAM and Head of AM rows,
Q16 (the Team seat's limits — *cannot send email, import, export or run reports in an org module;
the care email moves onto the team module*), M5-01, M5-02.

**Do:** the KAM's cadence by tier, on a team module (Q16); the care log — each contact, its kind,
how it ended; **the pool as a named owner** so that every one-unit investor is in somebody's list
(M5-02); the Head of AM names and moves KAMs and owns the pool. The care email on the team module,
as the person. Care coverage feeds Insights (10.5).

**Done when:** M5-02: every investor on the seed has an owner — a KAM or the pool's named owner —
by query. `RAN`. M5-01: the tester's day on a Team seat, every step of the script done without an
org-module permission. `SAW`.

### 11.3 · Tickets — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 — *raise a request
that resolves to no queue; read the account number in a bank-change ticket as the KAM; use a bank
change before the cooling-off; make the escalation loop on a Saturday.*

**Read:** the decisions: *a bank-change request is received by the KAM and executed by Finance —
the manager takes the request and hands it over with one button, never seeing the account*; §2
(KAM *hands a bank change to Finance*; Finance Operations *tickets of its kind*); D22 (*approving a
bank change* is one of the eight); 10.3's inbound requests; M5-03, M5-04, M5-05; Appendix A **CA**.

**Do:** requests and cases from the app (10.3's receiver) **routed to a role queue that can never
resolve to nobody** (M5-03: every kind has a queue, every queue an owner, the pool as the fallback,
and an unroutable kind is refused at the contract, not lost); **business-hours SLAs** by the one
clock — a weekend does not breach, an escalation goes up once and stops (M5-05); **the bank change**:
the KAM receives it and hands it to Finance with one action, the account number never rendered to
the KAM (masked identity, §2); Finance verifies, the change **cools off** for the book's period,
the investor is notified, and **only then** is the new account usable for a payout (M5-04); the
approval behind step-up.

**Don't:** a queue with a null owner. An SLA clock in UTC. A bank change usable on approval. An
account number in the ticket's text.

**Done when:** M5-03, M5-04, M5-05 on the seed, each. `RAN`. The KAM's view of a bank-change ticket
carries no account number by grep of the response. `RAN`. The adversary's report: BROKEN `none`.
`SAW`.

### 11.4 · Lapse, refund, reversal, erasure, consent — evidence · **seam — the undo seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 on **Wednesday** —
*refund to an account that is not the investor's; refund without a matching debit; lapse a paid
investor; lapse a login; erase and then find anything; withdraw consent and receive a statement
mail; reverse after the lock with one approver.*

**Read:** D19 (*reversal events, one actor per consequence, delegation everywhere*), D22, Q5, Q10,
Q11, §2 (the Head *lapses, refunds*; the BU Owner *approves a refund*; Compliance *erasure*); §11
`money.reversed`, `hold.changed`, `allotment.reversed`; M6-02, M6-03, M6-04, M7-01, M7-02, M7-03;
Appendix A **MO**, **KY**, **LT**; N-02 (the DPDP evidence pack, week 13, reads what this task
writes).

**Do:**
- **Lapse**: a hold past its deadline with due above zero (9.4's rule) → `hold.changed` (lapsed),
  units back to the shelf; **the investor keeps a login and loses the wrong powers** (M7-02): the
  app account stays, the reserved units and the payout mandate go, farm updates stay.
- **Refund**: money leaving — the Head behind step-up, an administrator approves (9.2); it **matches
  a real debit** in the statement (9.5) and goes to the **investor's verified account** (M7-01) —
  never to an account from a ticket that has not cooled off; `money.reversed`; the console's gate
  closes; **the investor leaves every figure** — Numbers, Insights, the shelf, the queues (the
  stage's signing line).
- **Reversal after the lock** (Q5): a refund case with **two approvers**, which un-allots
  (`allotment.reversed`).
- **Death or an estate pauses the clocks instead of forfeiting** (M7-03, Q10): a state on the
  record that stops the hold's and FEMA's clocks; nothing lapses while it is set; Compliance sets
  it; Finance settles against the shelf and the ledger; a nominee is verified by Compliance;
  nothing moves without an event.
- **Consent withdrawal stops every send** (M6-02): consent by purpose (captured in stage 2's 4.1;
  managed in the app, week 12); withdrawal takes effect the same day and stops statements, updates,
  care mail — *not just marketing*; one function every send path calls.
- **Erasure leaves nothing, and the request proves it** (M6-03): behind step-up, Compliance's act;
  every identity field in Zoho cleared, every document deleted, the mirror row reduced to the ARL
  and the ledger's non-identity facts (money is a fact that stays; identity is not); the erasure
  request itself records what was removed, where, when — that record is the proof.
- **The evidence pack for a signed document in a minute** (M6-04): one action, behind step-up (it
  is *an export*), that produces the signed file, its hash, the stamp record, the provider's
  completion, the verifier's name and time, the template version — as one bundle.

**Don't:** a refund to an unverified account. A lapse that deletes the login. An erasure that leaves
a document. A consent flag only the marketing path reads. A post-lock reversal with one signature.

**Done when:** M6-02, M6-03, M6-04, M7-01, M7-02, M7-03 on the seed, each. `RAN`. A refund on the
seed's allotted investor → the investor is absent from every figure on Numbers, Insights, the shelf
and the Dashboard within the reconcile's run. `RAN` — five queries, zero. The adversary's report:
BROKEN `none`, or fixed by Thursday. `SAW`.

### 11.5 · The nightly reconcile and the thirteen invariants; the eleven canaries; farm updates — evidence

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; L8-03's counterpart for the remaining
canaries is the tester's.

**Read:** stage 2's 6.4 and 6.5 (the same shape, the second side and the cross-org checks); D19;
D15 (`farm.progress`); §22; Appendix A **MI**, **PL**; the plan: *each one names the records, never
a count.*

**Do:**
- **02:30**: the investors-side reconcile (Zoho ↔ mirror through the allow-list) and **the thirteen
  cross-system invariants** the book names (§22 / D19 — read the list; among them: one Lead one
  Contact; no gate without its fact; no rung above its facts; sold + reserved + free = total; every
  investor has an owner; no receipt confirmed without a statement line; no allotment without its
  five; no permanent mark with due above zero; no live document on a Withdrawn Contact; no send to
  a withdrawn consent; no identity field in either mirror; the outbox's age and order; the event
  archive's continuity). **Each violation names the records.** The report is the alarm (6.4).
- **The eleven canaries** (D19): the leads-side six from week 6 plus the investors-side five (mirror
  freshness, the reconcile's report, the bounce rate, suspense ageing, farm-updates freshness), each
  with a runbook, each fired once on purpose by the tester, two phones, thirty minutes.
- **Farm system → farm updates**: the FMS publishes (`farm.progress`, D15) → the farm category of
  Updates (10.4), for the investors on that farm; a **freshness alarm** when a farm's last update
  is older than the runbook's line.

**Done when:** each of the thirteen invariants, planted broken on the test projects, is named in
the next report with its records. `RAN` — thirteen. Each canary fired once, times recorded. `SAW`.
A `farm.progress` reaches the right investors' Updates; staleness pages. `RAN`.

### 11.6 · Activity log — build (reads are evidence)

**Owner:** builder. **Agents:** **reviewer**.

**Do:** *the audit trail across both orgs and every reveal, with its reason* — one page, the
Head, Compliance, administrators and above: every event from both orgs' histories (stage 2's 3.5
and this stage's), every reveal with its reason (7.3), every step-up attempt (7.2), every money-out
with both names (9.2), every grant (7.6), in order, by the one clock. No identity field in any
before/after. Reading it is evidence.

**Done when:** the seed's actions from this stage each produce one row; a reveal's reason is on
its row; `grep` for identity field names in the log's columns and render: nothing. `RAN`.

### 11.7 · System — build

**Owner:** builder. **Agents:** **reviewer**.

**Do:** the portal's System page — *the eleven canaries, mirror freshness, the outbox and its dead
letters, last night's backup, the last restore drill* — the same shape as the console's (6.3), for
both sides, administrators and above; the super administrator sees *the two apps in coordination*.

**Done when:** it shows the planted conditions from 11.5 and the restore from 11.8; an IR or a KAM
cannot reach it. `RAN`.

### 11.8 · The proofs — M8 — evidence · **the tester's, with the portal-wide adversary**

**Owner:** the tester, the adversary, Sahil. **Agents:** **adversary** ×1 — the **portal-wide** one,
after the regression is green: every §2 role, every door, every page; **scout** ×1 for the matrix's
blank from `zoho/investor/fields.json`.

**Read:** M8-01, M8-02, M8-03; D14; `ops/drills/`.

**Do:**
- **The Investor org's access matrix** (M8-01): every profile × every field, four doors — the
  adversary by machine, the tester by hand for the lines it could not reach — **signed by Sahil**.
- **Approvals and matching survive two people away** (M8-02): with the Head and Operations both
  deactivated, the alternates the book names still record, match and approve — nothing is stranded.
- **The investors project restores and the event archive replays** (M8-03): a point-in-time restore
  into a clean project, timed; then the event archive (the outbox's delivered rows, kept) replayed
  over it and the result compared to the live mirror — equal.

**Done when:** the signed matrix. `SAW`. M8-02's run. `RAN`. The restore's time and the replay's
diff, empty. `SAW`.

## Friday · the handover, then the regression

- **test-writer** ×1: M4 to M8.
- Deploy the five pages and the jobs. Handover note LOOK AT: the allotment with four facts; the
  refund's disappearance from every figure; the KAM's bank-change ticket. SEED: the **clean seed**
  for the regression.
- Graph. `/save`. **verifier** — on the week's gate.
- **Then the stage end.**

## The week's gate

1. Week 10's gate closed.
2. M4-01 to M4-03; M6-01. M5-01 to M5-05. M6-02 to M6-04. M7-01 to M7-03. M8-01 to M8-03. Each.
3. The thirteen invariants each name a planted breach; the eleven canaries each fired once.
4. A refund removes the investor from every figure.
5. Three adversary reports (11.1, 11.3, 11.4) and the portal-wide one: BROKEN `none`, or fixed.
6. M4–M8 unit tests green.
7. The eleven standing checks.

## Stage 3 · the end

1. **Clean seed.** `RAN`.
2. **All 42 cases, M0 to M8**, by the **tester**, on the clean seed; the builder on fix-first, one
   case at a time; a seam fix sends the adversary back.
3. **The signing list**:
   - Eleven pages on the test environment, each reachable by the roles §2 allows and no other.
     `RAN`.
   - 42 of 42 green on the tester's record. `SAW`.
   - The Investor org's access matrix walked and **signed by Sahil**. `SAW`.
   - **A refund removes an investor from every figure** — run on the clean seed, five queries, zero.
     `RAN`.
   - Nothing open from weeks 7–11 — *week 12 also carries anything week 11 could not finish*: the
     carried list, by page, with case IDs, is written here, and it is the **only** scope week 12
     gains. `SAW`.
4. **Demo two — the money and the paper**: *paid, signed, allotted, cared for; then refunded, and
   gone from every number* — to the founder, from the clean seed, live. The asks go to the register.
   One line in `SESSIONS.md`.
5. **Nothing else carries.** Stage 4 is one week; it cannot absorb a stage.

## If the stage slips

The plan's own allowance is the carried list into week 12, and nothing more. Beyond that, a delay,
in `SESSIONS.md`, and the cut order in `docs/where-it-breaks.html` is Sahil's to invoke.
