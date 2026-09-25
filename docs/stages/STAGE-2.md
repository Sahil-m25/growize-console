# Stage 2 · The lead console · Weeks 2 – 6 · 14 Sep – 18 Oct 2026

**22 Sep 2026.** This sheet predates D45 (zero copy). Where it names the leads mirror, the session-scoped views on it, L1-05, or the 02:00 nightly reconcile against it, there is no mirror to name — **D46** states what each becomes. Read D45 and D46 alongside this sheet; its decision list below still cites D03 and D04, both superseded.

**23 Sep 2026 — and it is now one Enterprise org (D52).** The handover as code, the cross-org seam and week 5's handover work no longer exist. At *said yes* a Contact is created by a same-org upsert and linked to the Lead, which carries all seven rungs to Onboarded (D11, D52) — not Zoho's Lead-to-Contact conversion, which week 5's own *if one org* branch assumes and which scored zero. The gate write-back becomes a same-org field write; the Lost guard returns to Zoho as a condition on the Lead's gate column (A-16); the integration user's *cross-org handover and gate write-backs* row goes. Viewers are no longer licence-free readers of a masked mirror — every human holds a full Enterprise seat and reads on their own token (D53), and the cache behind Numbers and Plan is keyed by visibility scope, not shared across the team. The full rewrite of this sheet is tracked as **A-04** in `docs/CARRY-FORWARD.md` and has not been done; until it lands, read D52 and D53 alongside D45 and D46 before any task here.

Read `docs/stages/README.md` first. Then this stage head. Then the week you are in — and only that
week.

## What the stage delivers

*Twelve pages, finished and signed before the portal starts.* By week 6 an IR can capture a lead
from either door, work it from a first call to *said yes* with an honest count of conversations,
send the NDA under Finance's template and see it verified, raise a typed claim, watch every gate open
on a Finance fact and close on its reversal, hand the lead over into an investor record exactly
once — and the manager and the three named seats can see the funnel, the plan and the health of the
system, with every number derivable by hand.

The twelve pages, by week: **My day, Leads, Profile** (2) · **Lead page** and **Activity** (3, the
page's first half) · **Add lead, Events, People, Updates** (4) · the Lead page's second half —
**paper, claims, gates, handover** (5) · **Plan, Numbers, System** (6).

**Stage 2 is signed when** (the plan's sentence, as lines): twelve pages exist on the test
environment; every one of the 48 console cases (L0–L8) passes on a clean seed, run by the tester;
the access matrix (L8-01) is walked profile by profile, field by field, and **signed** by Sahil;
the leads database is restored from a point in time and the restore is **timed** (L8-04). Then
**Demo one — the whole IR journey**, and *a funnel whose every number can be derived in front of
you.*

**Decisions this stage stands on:** D01, D03, D04, D05, D09, D11, D13, D16, D17, D18, D19, D22,
D23 (as closed), D24.
**Build Book:** §1 (the one rule), §2 (the lifecycle and the roles — the spine of this stage; the
table is reproduced below), §3, §11, §18 (why each decision), §20 (templates and the six
approvals), §21 (automation — the NDA send), §22 (how it breaks), Appendix A segments **HO**,
**GA**, **SE**, **AU**, **OA** — the failure modes this stage's code must not walk into; each is a
test.
**Test Book:** L1–L8, plus L0 re-run at the regression — 48 cases, all listed by week below.
**Design:** `console/prototype/ir-console.html` and `docs/design-spec.html`. Pages are built to
match them, not re-designed. Dense; no empty regions; desktop exactly as the prototype, mobile added,
never the other way round.

## The spine · the lifecycle, from §2

*One person writes and owns the lead. Finance and Account Management log their specific, limited
actions. The lead does not move until the IR moves it, and the IR cannot move it past a gate until
Finance has confirmed the fact behind the gate.*

| # | Rung | Who moves it | Gate — Finance fact required | What else happens |
|---|---|---|---|---|
| 1 | Captured | IR | — | source, consent, residency (NRI) recorded at capture; event sheets bulk-load with the same fields |
| 2 | First touch · Qualified | IR | — | touches counted by hand, per channel; the NDA is sent by the system under Finance's template before any material goes out, and eMudhra's completion verifies it |
| 3 | Said yes · draft agreed | IR | — | **Handover:** the Investor-org Contact is created from the lead; the ARL code is minted there; the lead continues in the Leads org |
| 4 | Supplementary signed | IR ticks | supplementary sent and verified — *Finance* | the IR tells and chases (hints); eMudhra's event drives "signed"; Finance verifies the copy |
| 5 | Reserved | IR ticks | advance (10 %) confirmed — *Finance* | hold of 30 days set; units reserved on the shelf; **the app account opens, tentative**; welcome sent |
| 6 | Fully paid | IR ticks | balance confirmed — *Finance* | the mark becomes permanent; seven days later it locks |
| 7 | Allotted | the console ticks it on the event (open Q3) | allocation letter verified ∧ balance zero ∧ KYC passed ∧ FEMA if NRI — *Finance* | partner admitted (LLP supplement, Form 4); a KAM is named; care begins |
| 8 | Onboarded · closed | IR | — | **Close copy:** the remaining lead details are copied into the Contact's placeholders; the lead is read-only for life |

Weeks 3 and 5 build rungs 1–3 and 4–7 respectively. Rung 8 is stage 3's, at allotment.

**The roles that sign in to the console** (§2, the *writes / reads / never* columns are the access
matrix L8-01 walks):

| Role | Seat | Writes | Reads | Never |
|---|---|---|---|---|
| Investor Relations (IR) | Leads · full | own leads: capture, touches, forecast, rung ticks, claims, paper requests, lost with reason; ask to reassign | own leads for life; gate facts from the Investor org as read-only columns | money, paper, identity; another IR's leads |
| Team manager | Leads · full | reassign within the team, cover windows, availability, approve reassignment asks | the team's leads and numbers | anything above their own access |
| Viewer (Jhalak; founder, tech, marketing, BU owner, ops) | portal login · **no seat** | nothing | the masked mirror — the numbers, the funnel, the sources and events | leads are never tagged to them |
| Administrator | both · full | add users, assign seats up to administrator, see logs | logs | seat anyone as Super administrator; investor data |
| Super administrator | both · full | everything administrative; system page | everything administrative | write investor facts as a person |
| Integration (system user) | each org · full | only what arrives from outside: eMudhra events, the cross-org handover and gate write-backs | — | act for a human |

*Reassign* is the manager's word — within the team, on an IR's ask or on a leaver. *Transfer* means
only the move of investor data to the investor side (L2-03: *the word means what the book says*).
The IR owns the lead for life; a gate gives Finance authority over the fact without giving them the
lead.

## The stage's jobs, from the plan's sixteen

| Job | Way | Fires when | Writes | Week | How we know it ran |
|---|---|---|---|---|---|
| eMudhra · leads (NDA) | in | a signature completed | the lead's paper state | 5 | **a poller runs anyway, every ten minutes** |
| Handover · console → Investor org | out | the IR presses *Said yes* | the investor record and its ARL | 5 | nightly check: one lead, one investor record |
| Gate write-back · Investor org → console | in | Finance confirms money or paper | the lead's gate column | 5 | nightly check: no gate without its fact |
| Reversal events | both | money reversed, paper blocked, allotment reversed | the gate closes and the rung steps back | 5 | nightly check: no rung above its facts |
| Nightly reconcile · leads | job | 02:00 | differences between Zoho and the mirror | 6 | **the report is the alarm** |

Weeks 2, 3 and 4 build no jobs — *screens over the week-one plumbing.* If you find yourself writing
a job in those weeks, stop: it belongs to week 5 or 6, or to the register.

## Outside threads that land in this stage

| Who | When | What | If it slips |
|---|---|---|---|
| **Class A** — Sahil | by the end of week 3 | the eleven defaults and the Finance-seat answer | *blocks weeks 4–9 if left past week 3* — week 4 does not start |
| **eMudhra** | sandbox by week 5; production credentials and per-signature pricing *start now* | Q18: callback or poll, pricing, DSC for NRIs, e-stamp | signing slips to week 5's Monday; `paper.signed` is already a contract, nothing else moves |
| **Q21 template copy** | week 4, *before signing goes in* | the words of the twelve templates — the list and owners exist | the NDA goes out in week 5 under a placeholder template on the sandbox only; nothing goes to a real investor |

## Cases by week

| Week | Level | Cases | Tester's weekend |
|---|---|---|---|
| 2 | L2 (with L0-02, L0-03 re-run) | L2-01 … L2-05 | *three roles see three different consoles, and none can reach another's work by guessing an address* |
| 3 | L3 | L3-01 … L3-04 | *a lead can be worked from a first call to "said yes", and the count of conversations is honest* |
| 4 | L1, L2 | L1-01 … L1-06, L2-01 … L2-05 | *three thousand leads a year can be captured from both doors, and no duplicate survives either* |
| 5 | L4, L5, L6 | L4-01 … L4-05, L5-01 … L5-05, L6-01 … L6-06 | *a hundred handovers make a hundred investor records under forced retries, and every gate opens and closes on a fact* |
| 6 | L7, L8, then **all 48** | L7-01 … L7-03, L8-01 … L8-04, then L0–L8 on a clean seed | *stage two signed* |

Where the plan's one-line summary of a weekend and a case differ, the case wins (README). Week 2 is
the one place they do: the plan's line for that weekend describes L0-02, L0-03 and L2-01; L2-02 to
L2-04 need the People page (week 4) for their full form and run again then.

---

# Week 2 · 14 – 20 Sep · My day, Leads and Profile

**Decisions:** D03, D06, D09, D24 — and it *writes* two (2.6).
**Test Book:** L2-01 to L2-05; L0-02 and L0-03 re-run over the new pages.

| Case | Proves |
|---|---|
| L2-01 | My day and My leads are personal for everyone, including managers |
| L2-02 | A secondary owner can work the lead only while the primary is unavailable |
| L2-03 | A transfer needs the manager, and the word means what the book says |
| L2-04 | Deactivating a person moves everything they were holding |
| L2-05 | Attendance and availability are recorded by the right people and logged |

## Monday first

Stage 1's signing list is met — L0 green on the tester's record, D23 closed, the licence renewed.
If any is not true, this week has not started. Week 1's *If it slips* may have moved the heartbeat's
paging here — if so it is the first thing on Monday, before fix-first, and L0-08 runs the same day.
Then fix-first.

## What exists by Friday evening

- **My day** — today's follow-ups, what has gone quiet, what is waiting on Finance, and the
  personal-or-team switch in the sidebar.
- **Leads** — the list with filters, search by name, phone or last four digits, sort
  oldest-to-newest and back, and the personal-or-team switch.
- **Profile** — the person's own page: their seat, what they may reach, their availability, their
  own numbers.

What you show on Friday: *an IR's morning: what to do today, on one screen.*

## The order

```
2.1 the read model for three pages (seam) ──► 2.2 My day ──► 2.3 Leads ──► 2.4 Profile
2.6 two decisions written (independent, Monday)
```

### 2.1 · The read model — three pages' worth of reads, and who may read them — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 after 2.4
ships — the visibility seam, one adversary for the three pages together.

**Read:** D03, D24, D09 (*waiting on Finance* is a gate state, not a flag), §2's roles table above,
week 1's 1.5 (the scoped reads exist; this week extends them to the three pages' shapes).

**Do:**
- The queries the three pages need, as views or functions on the mirror, **scoped by the session's
  identity in the policy** — built on 1.5's scoping, never beside it. The personal-or-team switch
  changes the query the manager runs; it does not exist for an IR (L2-01: *personal for everyone,
  including managers*).
- *Today's follow-ups*: follow-ups whose day, in Asia/Kolkata by the one clock function, is today.
- *Gone quiet*: the signal the Build Book defines — days since the last **human** touch (rule 6)
  past the book's threshold. Read it; do not invent the threshold.
- *Waiting on Finance*: leads whose next rung is gated on a Finance fact that has not arrived (D09).
  Derived from the gate state, not stored as a flag.
- The not-found rule (L0-02) holds on every new read.

**Don't:** a `WHERE owner = ?` in the page's code with the policy left open underneath. A team query
an IR can reach by changing a parameter. A gone-quiet counter that counts robot emails.

**Done when:**
- As TD-IR-1, every read for the three pages returns only leads TD-IR-1 owns or is secondary on.
  `RAN` with the counts against the seed.
- As the manager, the team switch returns the team's; the personal switch returns theirs alone.
  `RAN`.
- L0-02 re-run over the new reads: another IR's lead by id → 404. `RAN`.

### 2.2 · My day — build

**Owner:** builder. **Agents:** **reviewer**. **Scout** ×1 if the prototype's layout for this page
is not obvious from the graph.

**Do:** the page, to the prototype: today's follow-ups, gone quiet, waiting on Finance, the
personal-or-team switch **in the left sidebar under the section** — not a tab, not a toggle on the
page. Dense; no empty regions; desktop exactly as the prototype; mobile added (L0-10).

**Don't:** a dashboard. A chart. A count that is not backed by a list you can open. Anything on this
page that is not one of the three lists and the switch.

**Done when:**
- The page renders the three lists from 2.1's reads with the seed's known counts. `SAW`.
- The switch is absent for an IR and present for the manager, and changes 2.1's query, not a filter
  on the client. `RAN` — the request differs.
- A follow-up set for today at 23:30 IST yesterday appears; one set for tomorrow does not. `RAN`.

### 2.3 · Leads — build · **seam** (with 2.1)

**Owner:** builder. **Agents:** **reviewer**; the adversary from 2.1 covers this page's search and
its direct links.

**Do:**
- The list, to the prototype. Filters as the prototype has them. Search by **name, phone, or the last
  four digits** of the phone (L1-06 — built here, proved again in week 4). Sort oldest-to-newest and
  back. The personal-or-team switch, same sidebar rule as 2.2.
- Search runs through 2.1's scoped reads — a search for a phone that belongs to someone else's lead
  finds nothing, and says nothing.
- A lead's row links to its page (week 3 builds the page; this week the link goes to a stub that
  answers with the not-found rule).

**Don't:** a search that hits Zoho. A search that returns a partial row for a lead outside scope. A
sort implemented on the client over a page of results.

**Done when:**
- Search by last four digits returns the seed's lead and no other. `RAN`.
- Search by a phone on TD-IR-2's lead, as TD-IR-1, returns empty. `RAN`.
- Sort both ways produces the seed's order and its reverse, from the server. `RAN`.

### 2.4 · Profile — build

**Owner:** builder. **Agents:** **reviewer**; then the adversary for 2.1–2.4 runs.

**Read:** D06, D24, §2 (the manager's *availability* and *cover windows*), L2-05.

**Do:**
- The person's own page: their seat (or *viewer*), what they may reach (derived from the session's
  role — the same source as the menu in week 1, never a second list), their availability, their own
  numbers (their leads by rung — from 2.1's reads).
- Availability: shown here; **set** by the manager (or founder or admin) on the People page (week 4).
  Every change is a row in the activity log with the actor (L2-05). If the book lets a person set
  their own, it says so — read it.

**Don't:** an editable role. A profile that reads Zoho. A numbers block that is not the same query
the Leads page counts with — one fact, one writer applies to counts too.

**Done when:** the page renders for all three personas, and *what they may reach* matches the menu
exactly (a test compares the two). `RAN`.

**The adversary, after this ships**, is told: 2.1 to 2.4 are one seam — *can any persona reach
another's work by guessing an address, a phone, a search term, a lead id, or by keeping a session
after they were removed (L0-03)?* Its report is on the Friday gate.

### 2.6 · Two decisions written — evidence · Monday

**Owner:** Sahil, with the builder's evidence. **Agents:** none.

READY-TO-BUILD puts two Class B trials in week 2. Week 1 built on their defaults; this week writes
down what was built, as decisions, so that no later session re-derives them from the code.

- **Q19** — Zoho backup cadence on the chosen edition, and whether Bulk Read covers attachments.
  Default: Bulk Read for records; attachments hashed nightly and fetched in the quarterly drill (D14
  owns the backup target). Run the Bulk Read once against the sandbox; note whether attachments
  came. `/decide`.
- **Q25 / Q26** — which host carries the dead-man heartbeat, and whether the nightly work runs on
  pg_cron or a worker. Week 1 chose; write which, and the rule for changing it: *a worker the day a
  job exceeds five minutes.* `/decide`.

**Done when:** two decision files exist, and OPEN-QUESTIONS rows Q19, Q25 and Q26 say *closed* with
the date. `SAW`.

## Friday · the handover

- **test-writer** ×1: L2-01 to L2-05 at the Test Book's count; L0-02, L0-03 re-run.
- Deploy the three pages. Handover note LOOK AT: the not-found rule from a direct link; search by
  last four as the wrong IR; the deactivated session.
- `graphify update tools/graphify --no-cluster && graphify cluster-only tools/graphify`. `/save`.
  **verifier**.

## The gate

1. Stage 1 signed.
2. For each of the three personas, every read on the three pages returns only what §2 allows —
   counts against the seed. (L2-01)
3. L0-02: a direct request for another person's lead answers 404. L0-03: a deactivated person's next
   request is refused.
4. Search by name, phone and last four works inside scope and returns nothing outside it. Sort both
   ways is the server's.
5. The manager's switch is in the sidebar, absent for an IR, and changes the request.
6. *What they may reach* on Profile equals the menu, by test; availability changes are logged with
   the actor. (L2-05)
7. The adversary's report on the visibility seam: BROKEN `none`, or fixed and re-reviewed.
8. Q19, Q25, Q26 are decision files.
9. L2's unit tests green at the Test Book's count.
10. The eleven standing checks.

## If it slips

1. **Profile's numbers block** — can be the same query as Leads with no separate view, shipped as a
   link to Leads filtered to *mine*, until week 3 Monday.
2. **Filters on Leads** beyond search and sort — the prototype's full filter set can land with week
   3's Activity page, which needs the same filter component.
3. **Nothing in 2.1.** The visibility seam is what the weekend tests. If it is not done, the tester
   has nothing to break, and the week did not happen.

---

# Week 3 · 21 – 27 Sep · The lead page, part one — the work itself

**Decisions:** D05, D09, D11, D19; rules 4, 6, 9.
**Build Book:** §2 rungs 1–3; the lead page section; the touches and gone-quiet definitions; §11
(`lead.lost`, `lead.reassigned`).
**Test Book:** L3-01 to L3-04.

| Case | Proves |
|---|---|
| L3-01 | A touch is counted only when a person made it |
| L3-02 | A follow-up dated for later comes back on its date, in IST |
| L3-03 | A lead cannot skip a rung, and Lost always carries a reason |
| L3-04 | Gone quiet appears by itself and clears on a real touch |

## Monday first

Week 2's tester results and the diagnostic. Fix-first. **Class A must be closed by Friday** — it
blocks week 4; if it is not closed on Monday, say so in `SESSIONS.md` and keep saying it.

## What exists by Friday evening

- **Lead page · header and ownership** — who owns it, who is secondary, the rung ladder, the source,
  the residency, and the whole history.
- **Lead page · touches** — call, email, WhatsApp and visit, each logged by hand and counted — a
  robot email is visible and never counted.
- **Lead page · notes and follow-ups** — notes with who wrote them and when; a follow-up dated
  forward that comes back on its day in Indian time.
- **Lead page · rungs 1–3 and Lost** — captured, touched, qualified, said yes — one rung at a time,
  and Lost only with a reason.
- **Activity** — every action on the leads a person can see, in order, with names against it.

What you show on Friday: *a lead worked over a fortnight, with the real chase history behind it.*

## The order

```
3.1 the lead's write model: rungs, Lost, ownership (seam) ──► 3.2 header & ownership
                                                             ──► 3.3 touches (seam)
                                                             ──► 3.4 notes & follow-ups
                                                             ──► 3.5 Activity
```

3.1 first, and reviewed, before any page. The pages are thin over it; if the model is wrong every
page is wrong.

### 3.1 · The lead's write model — rungs, Lost, ownership — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 after SHIP —
*can a rung be skipped, can Lost be set without a reason, can ownership be changed by someone who
may not, through the API rather than the page?*

**Read:** §2 rungs 1–3 and the IR/manager rows; D09; D05 (*business rules are enforced in Zoho
blueprints and validation rules* — **the rung ladder is a Zoho blueprint first**; the portal's job
is to call the transition, not to re-implement the rule); D11 (the handover at *said yes* is week
5's — this week stops at the rung); D19; rule 4. Appendix C — *blueprints, validation rules,
workflows, approvals: built in the sandbox, exported, committed, promoted; transitions fetched by
name at runtime.*

**Do:**
- The rungs this week: captured → first touch/qualified → said yes, **one at a time** (§2's
  numbering: 1, 2, 3; the plan's *captured, touched, qualified, said yes* are the same three rungs
  with rung 2's two names). The transition lives in Zoho's blueprint (D05); the portal calls it
  through week 1's write path, as the person. If Zoho refuses a skip, the portal shows the refusal;
  it does not check first and then also check.
- **Lost only with a reason.** The reason is a field with the book's values; the write is refused
  without it, in Zoho's validation rule (D05); the event is `contracts/lead.lost.json`.
- **Ownership:** a primary and a secondary. The lead stays with the IR for life. **Reassignment** is
  the manager's — within the team, on the IR's ask or on a leaver — and is `lead.reassigned`. The
  secondary works the lead only while the primary is unavailable (L2-02). *Transfer* is not a word
  this page uses.
- **The source** and **the residency** — captured at rung 1, required (week 4's Add lead is where
  they are entered; this week's model refuses a lead without them). Changed only with an event.
- **The whole history** — every rung change, every ownership change, every Lost, as rows the
  Activity page reads. Written by the same write that made the change, in the same transaction.

**Don't:** a rung enum in the portal that the portal advances. A Lost that deletes. An ownership
change that is not an event. A "transfer" button.

**Done when:**
- L3-03: advancing two rungs in one request is refused, and the refusal comes from Zoho's blueprint
  (the response says so). `RAN`.
- L3-03: Lost without a reason is refused; Lost with a reason emits `lead.lost` through the outbox.
  `RAN` — the outbox row.
- A reassignment by an IR is refused in the backend; by the manager it emits `lead.reassigned`.
  `RAN`.
- Every change above has a history row with actor, time (IST, the one clock), before and after.
  `RAN`.
- The adversary's report: BROKEN `none`, or fixed. `SAW`.

### 3.2 · Lead page · header and ownership — build

**Owner:** builder. **Agents:** **reviewer**. **Scout** ×1 for the prototype's lead-page layout if
the graph does not answer.

**Do:** the header to the prototype: owner, secondary, the rung ladder as it stands (advanced in
3.1's control), source, residency, the history. The manager sees the reassignment controls; an IR
sees ownership as text and an *ask to reassign* action.

**Wording (from the decisions):** controls that *record something that happened* are past tense or
passive (*agreement sent*); controls that *do something* name their object (*assign to self*, never
*assign*). Every button on this page passes that test.

**Done when:** the page renders for TD leads at each rung with the correct ladder state; the
manager and an IR see different controls; every control's label passes the wording test (a list in
the review). `SAW`.

### 3.3 · Lead page · touches — build · **seam**

**Owner:** builder. **Agents:** **reviewer**; **adversary** ×1 after SHIP — *can a system touch be
made to count as a human one, and can a human touch be recorded on a lead the person may not work?*

**Read:** rule 6 (*a system touch is never a human touch. Automated mail never counts as a
conversation*), the book's definition of a touch and of gone-quiet, and the decisions: touches are
logged **by hand, not automatically**, and repeated — a call or a WhatsApp or an email may happen
two, three, four times — because *the count is how they judge whether the investor wants it.*
Appendix A segment **AU** (*automation honesty*, 8 modes).

**Do:**
- Four kinds: call, email, WhatsApp, visit. Each is logged by the person, with a time and an optional
  note. Each logged touch increments the count for that kind.
- **A robot email is visible and never counted.** Mail sent from the portal as the person (D17) or by
  any automation appears in the list, marked as a system touch, and does not move the count, does
  not clear gone-quiet.
- Gone-quiet appears by itself and clears on a real touch — a human one — and on nothing else
  (L3-04).
- Only the primary, or the secondary while the primary is marked unavailable, may log a touch.

**Don't:** count an email because the person clicked *send*. A touch logged by the write path itself.
A gone-quiet reset on a rung change or a note.

**Done when:**
- L3-01: a system email appears in the list and the count is unchanged; a logged call moves it.
  `RAN`.
- L3-04: gone-quiet appears at the threshold and clears on a real touch, not on a system one. `RAN`.
- The secondary can log a touch only while the primary is unavailable; otherwise refused. `RAN`.
- The adversary's report: BROKEN `none`, or fixed. `SAW`.

### 3.4 · Lead page · notes and follow-ups — build

**Owner:** builder. **Agents:** **reviewer**.

**Read:** rule 9; the decisions: notes carry who recorded them, when, and what; a follow-up dated
for later **resurfaces** on its day rather than going stale.

**Do:**
- Notes: text, author, time (IST, the one clock). Append-only; an edit is a new note that says it
  amends.
- Follow-ups: a date forward. It appears on My day (2.1's read) on that day in Asia/Kolkata. L3-02's
  boundary: **a follow-up set at 23:30 for "tomorrow" does not appear tonight.** The day is computed
  by the one function from the event's time, never by the browser.
- A follow-up that is acted on is marked; one that is not stays on My day until it is.

**Don't:** a `Date` in the page's code. A follow-up stored as a UTC midnight. A note that can be
edited in place.

**Done when:**
- L3-02: set at 23:30 IST on day D for *tomorrow* → absent from My day on D, present on D+1. `RAN`
  with the clock pinned.
- Notes carry author and time by the one function (`grep` as in week 1's 1.4). `RAN`.

### 3.5 · Activity — build (reads are evidence)

**Owner:** builder. **Agents:** **reviewer**.

**Read:** the book's activity section; 3.1's history rows; rule 7.

**Do:** every action on the leads a person can see (2.1's scope), in order, with the actor's name
against it. Rung changes, reassignments, Lost, touches, notes, follow-ups, availability changes.
The **before/after** shown never includes an identity field — the history row does not carry one.

Building this page is *build*. **Reading this page to verify anything is evidence** — a plain
session, no headroom.

**Don't:** an activity feed assembled from several tables on the client. A filter that hides the
actor. Pagination that loses order.

**Done when:**
- Every action in 3.1, 3.3, 3.4 and 2.4 produces exactly one activity row, in order, with the actor.
  `RAN` — do the seven kinds of action as TD-IR-1 and count seven rows in order.
- As TD-IR-1 the page shows no row for TD-IR-2's leads. `RAN`.
- `grep` the activity table's columns and the page's rendering for any identity field name: nothing.
  `RAN`.

## Friday · the handover

- **test-writer** ×1: L3-01 to L3-04.
- Deploy the lead page and Activity. Handover note LOOK AT: the 23:30 follow-up; a system email in
  the touches list with the count unmoved; a skipped rung through the API.
- Graph. `/save`. **verifier**.

## The gate

1. Week 2's gate closed. **Class A is closed** or the slip is written.
2. L3-03: rung advance is one at a time and the refusal is Zoho's; Lost requires a reason and emits
   `lead.lost` through the outbox.
3. Reassignment is the manager's only, as `lead.reassigned`; there is no *transfer* control.
4. Every change writes a history row; Activity shows them in order with actors, in scope, with no
   identity field.
5. L3-01, L3-04: the touch count moves only for a human; system mail is visible and uncounted;
   gone-quiet appears by itself and clears only on a human touch.
6. L3-02: the 23:30 boundary holds by the one clock.
7. Every control's label passes the wording test.
8. Both adversary reports (3.1, 3.3): BROKEN `none`, or fixed.
9. L3's unit tests green at the Test Book's count.
10. The eleven standing checks.

## If it slips

1. **3.5 Activity's page** — the rows are written by 3.1 regardless; the page can land Monday of
   week 4 first thing. The rows cannot slip.
2. **Notes' amendment rule** (3.4) — plain append-only notes ship; *amends* lands with week 4.
3. **Nothing in 3.1 or 3.3.** The ladder and the honesty of the count are what L3 tests and what the
   Friday demo shows.

---

# Week 4 · 28 Sep – 04 Oct · Add lead, Events, People and Updates

**Decisions:** D09, D17, D18, D24; rules 1, 6; and **Class A, closed** — this is the week it blocks.
**Build Book:** §2 rung 1 (*source, consent, residency recorded at capture; event sheets bulk-load
with the same fields*); the manager row; §21 (automation — what a notification may and may not
do); §11 (`lead.reassigned`).
**Test Book:** L1-01 to L1-06 and L2-01 to L2-05.

| Case | Proves |
|---|---|
| L1-01 | A lead cannot be saved without a source, a residency and a consent |
| L1-02 | The same person entered twice is caught, in every phone format |
| L1-03 | The event sheet imports in one pass and names every row it refused |
| L1-04 | A sheet with no consent column is refused before anything is written |
| L1-05 | The leads mirror holds no identity |
| L1-06 | Search finds a lead by name, phone or the last four digits |
| L2-01 … L2-05 | as week 2, now in full form with the People page present |

## Monday first

Week 3's tester results and the diagnostic. Fix-first. **Class A** — the eleven rows in
OPEN-QUESTIONS say *closed* or point at a decision file, and the Finance seat is decided. Not
closed = this week does not start; the sheet stops here and says so in `SESSIONS.md`.

**Q21** — someone writes the twelve templates' words this week, before signing goes in (week 5).
That is Sahil and the administrators, not the builder; the builder's task is only to make the
template library hold them (week 10 builds the library proper; this week a template is a file under
`zoho/` with an owner and a version).

## What exists by Friday evening

- **Add lead** — source, residency and consent all required; the duplicate check runs before the
  save; assign to self or to someone else.
- **Events** — the event sheet uploaded in one pass, every rejected row named with its reason, and
  the batch assigned in one action.
- **People** — the team, the tick-grid of which pages and which functions each person may reach,
  availability, reassignment requests and the manager's approval, and the one action that moves
  everything a leaver held.
- **Updates** — notifications: generic by default, specific where it matters, and never a
  substitute for the queue.

What you show on Friday: *an event's fifty leads imported and assigned in under a minute.*

## The order

```
4.1 Add lead (seam: the capture rules) ──► 4.2 Events (seam: the same rules, fifty at once)
4.3 People (seam: who may reach what)  ──► 4.4 Updates
```

4.1 before 4.2 — the sheet import is fifty Add-leads, and it must refuse exactly what the form
refuses, for the same reasons, by the same function.

### 4.1 · Add lead — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 after SHIP —
*save without consent, without a source, without a residency, through the API; enter the same
person as `+91 98765 43210`, `9876543210` and `0098765 43210`; assign to someone outside the team.*

**Read:** §2 rung 1; D24 (only a seat may write); L1-01, L1-02; Appendix A segment **HO** for the
*one person becomes two records* modes. Rung 4 of the ladder: **Zoho's own duplicate check** — a
unique field on the normalised phone — before you write one.

**Do:**
- The form, to the prototype. **Source, residency and consent are required** — refused without them
  by Zoho's validation rule (D05) and shown as the refusal, not pre-checked on the client and also
  checked. Consent is a recorded fact with a time and a purpose (N-02, the DPDP evidence pack, reads
  it in week 13 — write it so that it can).
- **The duplicate check runs before the save**: the phone is normalised to one canonical form by one
  function (the same function search uses — L1-06), and the check is Zoho's unique-field rule on
  that form. A duplicate is refused with the existing lead named — to the owner if the person may
  see it, as *a lead with this phone exists* if they may not (the not-found rule applies to
  duplicates too).
- **Assign to self or to someone else** — to a person on the team; the manager may assign anywhere in
  the team. The assignment is the ownership write of 3.1.
- The saved lead goes through week 1's write path: Zoho as the person, the mirror from Zoho's answer,
  one request.

**Don't:** a client-side required-field check as the only check. A duplicate check that compares
raw strings. A phone stored in more than one format. A consent checkbox that stores a boolean with
no time.

**Done when:**
- L1-01: a save without any one of source, residency, consent is refused by Zoho, and the refusal
  reaches the screen. `RAN`, three times.
- L1-02: the same person in three phone formats → one lead, two refusals naming it. `RAN`.
- Assign to a person outside the team is refused in the backend. `RAN`.
- L1-05 re-run: the mirror row for the new lead carries no identity field. `RAN`.
- The adversary's report: BROKEN `none`, or fixed. `SAW`.

### 4.2 · Events — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 after SHIP —
*a sheet with one bad row in the middle; a sheet whose row 30 duplicates row 3; a sheet with the
consent column present but empty; a sheet uploaded twice; a sheet of five thousand rows.*

**Read:** §2 rung 1 (*event sheets bulk-load with the same fields*); the decisions: *one sheet where
leads are added, then a script dumps them all into the database at once, with options like assign
to self or assign to them*; L1-03, L1-04.

**Do:**
- Upload the event's sheet (the format the book names — read it; if it names none, CSV with a
  header row, and write that as a decision). **In one pass**: every row is validated by 4.1's
  function before any row is written; the rows that pass are written; **every rejected row is named
  with its reason** — row number, field, the rule it failed.
- **A sheet with no consent column is refused before anything is written** (L1-04) — the header
  check comes first, and a missing required column stops the whole file.
- **The batch assigned in one action** — assign to self, or to a named person, for every row that
  passed; the same ownership write as 4.1, once per lead, through the outbox if it emits.
- Idempotent on the file's hash: the same sheet uploaded twice creates nothing the second time and
  says so.
- Fifty rows in under a minute (the Friday demo). If it is slower, the batching is wrong, not the
  rows.

**Don't:** write rows as you validate them. A partial import that leaves the sheet half in. A second
validation function for sheets. A "skip duplicates silently" option.

**Done when:**
- L1-03: a fifty-row sheet with five deliberate faults imports forty-five and names five, with
  reasons, in one pass. `RAN` — the report, the count in the mirror.
- L1-04: a sheet with no consent column is refused with zero rows written. `RAN` — the count before
  and after.
- The same sheet twice → no new rows, a message that says why. `RAN`.
- Fifty rows, upload to assigned, under sixty seconds on the test environment. `RAN` — the time.
- The adversary's report: BROKEN `none`, or fixed. `SAW`.

### 4.3 · People — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 after SHIP —
*as an IR, reach the People page's writes; as the manager, grant a page above your own access; as
anyone, act on a lead after it was reassigned away from you; as the leaver, keep working.*

**Read:** §2's manager and administrator rows (*reassign within the team, cover windows,
availability, approve reassignment asks* — and *never anything above their own access*); D24; the
decisions: *adding a teammate should take name, email and position, then a tick/toggle grid of
which pages they can access and which functions on each page*; *managers and above may add or
remove team members and assign roles, but never anything above their own access*; *attendance and
availability marked on a regular basis by the team manager, founder or admin, and each toggle
logged*; L2-02 to L2-05.

**Do:**
- **The team** — the people, their seats (Zoho or viewer), their roles, from Zoho and the mirror,
  never a third list.
- **The tick-grid** — pages × functions per person. What a tick grants is what the session's menu
  and the write endpoints read (week 1's one function); the grid is the single place it is set, and a
  person can never grant a tick they do not hold themselves.
- **Availability** — set here by the manager (or founder or admin), each toggle logged with the actor
  and time (L2-05); Profile (2.4) shows it; the secondary's right to work the lead reads it (L2-02).
- **Reassignment requests and the manager's approval** — an IR asks; the manager approves or refuses;
  approval is the `lead.reassigned` write of 3.1, within the team only (L2-03).
- **The one action that moves everything a leaver held** — deactivate a person: every lead they own
  is reassigned (to a named person or to the manager), every open follow-up with it, in one action
  that is one transaction, and their access ends before their session would have (L0-03, L2-04).

**Don't:** a role a manager can grant that they do not hold. A tick stored in the page's state and
not in the one place. A deactivation that leaves a lead ownerless. A grid on the viewer.

**Done when:**
- L2-03: a reassignment by an IR is refused; by the manager, within the team, it succeeds and emits
  `lead.reassigned`; outside the team it is refused. `RAN`.
- L2-04: deactivate TD-IR-2 → every lead they held now has a named owner, every follow-up with it,
  and TD-IR-2's next request is refused. `RAN` — counts before and after; zero ownerless.
- L2-05: an availability toggle by the manager is logged with actor and time; the same toggle by an
  IR is refused. `RAN`.
- L2-02: with TD-IR-1 marked unavailable, TD-IR-1's secondary can log a touch; marked available,
  refused. `RAN`.
- The grid cannot grant above the grantor: the manager's attempt to tick an administrator function
  is refused in the backend. `RAN`.
- The adversary's report: BROKEN `none`, or fixed. `SAW`.

### 4.4 · Updates — build

**Owner:** builder. **Agents:** **reviewer**.

**Read:** §21 (automation, and its six honesty rules — D18); rule 6; the decisions: *a notification
section so people know what is happening with their leads — generic by default, specific only when
needed*; the plan: *never a substitute for the queue.*

**Do:**
- A notifications list per person: what changed on the leads they may see — a gate opened, a
  reassignment, a follow-up due, a paper verified — **generic by default** (*a lead of yours moved*),
  **specific where it matters** (*the advance on ARL-0042 was confirmed*), per the book's list.
- Every notification is a system touch (rule 6): it is visible on the lead's touches list as such
  and counts for nothing.
- **Never a substitute for the queue**: My day is the queue. A notification links to the item on My
  day; it does not carry an action of its own. Nothing can be done from a notification that cannot
  be done from the page it points at.

**Don't:** a notification with a button. A notification that reveals a lead outside the reader's
scope. Email for every notification (D17: mail is sent as a person, on purpose).

**Done when:**
- Each of the book's notification kinds fires once on the seed's actions and lands with the right
  person and no one else. `RAN`.
- A notification's target is a My day item, and the item exists. `RAN`.
- A notification appears on the touches list as a system touch with the count unmoved (L3-01
  re-run). `RAN`.

## Friday · the handover

- **test-writer** ×1: L1-01 to L1-06 and L2-01 to L2-05.
- Deploy the four pages. Handover note LOOK AT: the fifty-row sheet with five faults; the same person
  in three phone formats; the leaver's leads after deactivation. SEED: a second event sheet the
  tester has not seen.
- Graph. `/save`. **verifier**.

## The gate

1. Week 3's gate closed. Class A closed. Q21's words exist under `zoho/` with owners.
2. L1-01, L1-02: source, residency, consent required by Zoho; the same person in three formats is one
   lead.
3. L1-03, L1-04: the sheet imports in one pass and names every refusal; a sheet with no consent
   column writes nothing.
4. L1-05, L1-06: the mirror holds no identity after both doors; search by name, phone, last four.
5. L2-01 to L2-05 in full form: personal pages for all; the secondary only while the primary is
   away; reassignment the manager's and within the team; a leaver's everything moved in one action;
   availability logged.
6. The tick-grid cannot grant above the grantor.
7. Notifications carry no action, reveal nothing outside scope, and count as system touches.
8. Three adversary reports (4.1, 4.2, 4.3): BROKEN `none`, or fixed.
9. Fifty rows, upload to assigned, under sixty seconds.
10. L1 and L2 unit tests green at the Test Book's count.
11. The eleven standing checks.

## If it slips

1. **4.4 Updates** — the list can land Monday of week 5; the system-touch marking cannot, because
   week 5's NDA send is a system touch and must be visible as one.
2. **4.3's tick-grid granularity** — pages first, functions-per-page with week 6's System page if it
   must; the *cannot grant above yourself* rule ships regardless.
3. **Nothing in 4.1 or 4.2.** *Three thousand leads a year from both doors, and no duplicate
   survives either* is the stage's capture promise; week 5 hands over what these two captured.

---

# Week 5 · 05 – 11 Oct · **heaviest week** · The lead page, part two — paper, claims, gates and the handover

**Decisions:** D05, D07, D09, D11, D17, D18, D19, D22, D23 (as closed); rules 3, 4, 5, 7, 8.
**Build Book:** §2 rungs 3–7 (the gate column, *who moves it*, *what else happens*); §11 (all the
`paper.*`, `money.claimed`, `money.confirmed`, `money.not_found`, `lead.handover`, and the three
reversal events); §20 (the templates the NDA goes out under); §21 (the NDA send is automation);
Appendix A segments **HO** (11 modes — read HO1, HO2, HO3 before writing a line of the handover:
they are its three ways to fail), **GA** (gates and rungs, 12), **DO** (documents, signing and
approvals, 13), **SE** (12).
**Test Book:** L4-01 to L4-05, L5-01 to L5-05, L6-01 to L6-06 — sixteen cases. Three of them
(L4-02, L5-01, L6-01, L6-03) are in the go-live smoke pack.

| Case | Proves |
|---|---|
| L4-01 | The NDA goes out without an IR clicking send on each one |
| L4-02 | The signature completes even with the callback switched off |
| L4-03 | A re-issue cancels the first request |
| L4-04 | A signature by the wrong person goes to review, never to verified |
| L4-05 | Told and chased are the IR's own measures, not preconditions |
| L5-01 | Said yes creates exactly one Contact, one ARL and one link |
| L5-02 | The handover survives a failure at each of its four steps |
| L5-03 | A returning investor does not become a second investor |
| L5-04 | Said yes can be undone within the window and not after |
| L5-05 | Marking a handed-over lead Lost withdraws the Contact |
| L6-01 | A gate opens only when Finance's fact exists |
| L6-02 | No human can write a gate column, including an administrator |
| L6-03 | A reversal closes the gate and steps the ladder back |
| L6-04 | Lost is refused once money exists |
| L6-05 | A fully paid investor who was never allotted appears in a queue |
| L6-06 | A claim is typed, not prose |

**The four jobs this week** — the plan builds them *beside the pages that need them*:

| Job | Way | Fires when | Writes | How we know it ran |
|---|---|---|---|---|
| eMudhra · leads (NDA) | in | a signature completed | the lead's paper state | **a poller runs anyway, every ten minutes** |
| Handover · console → Investor org | out | the IR presses *Said yes* | the investor record and its ARL | nightly check: one lead, one investor record |
| Gate write-back · Investor org → console | in | Finance confirms money or paper | the lead's gate column | nightly check: no gate without its fact |
| Reversal events | both | money reversed, paper blocked, allotment reversed | the gate closes and the rung steps back | nightly check: no rung above its facts |

(The nightly checks themselves are week 6's job. This week each of the four is proved by its cases.)

## Monday first

Week 4's tester results and the diagnostic. Fix-first. Then, before any code:

- **D23's answer decides the shape of 5.4.** If *one org*: Zoho's Lead-to-Contact conversion is the
  handover and no handover function exists in this repo; the gate write-back becomes a within-org
  workflow. If *two orgs*: the plan's design — *one function per side, each holding one org's key.*
  Read the decision file and write which shape this week builds at the top of `SESSIONS.md`'s line.
- **eMudhra sandbox** — credentials and template ids (Class D item 6) in the vault, or 5.1 cannot be
  proved this week. Q18's *callback or poll* answer decides nothing: the poller is built first
  either way.
- This is a heaviest week: **adversaries run Wednesday**, not Friday, on 5.3 and 5.4.

## What exists by Friday evening

- **Lead page · paper** — the NDA requested, sent by the system under Finance's template, chased and
  counted, signed at the provider, verified — with the signer's name checked against the lead.
- **Lead page · claims** — *the investor says he has paid* raised as a typed record — kind, mode,
  reference, amount, date — and answered by Finance against the same id.
- **Lead page · gates** — rungs 4 to 7, each opened by a Finance fact and closed again by its
  reversal; Lost refused once money exists.
- **Lead page · handover** — Said yes: a typed confirmation, fifteen minutes to undo, then the
  investor record created once with its ARL code written back.

What you show on Friday: *two leads become two investor records — and a returning investor attaches
to the record he already had.*

## The order

```
5.4 handover (seam of the system) ──► 5.3 gates + write-back + reversals (seam) ──► 5.2 claims
5.1 paper: eMudhra poller first, then the receiver, then the page (seam)
```

5.4 first — everything in stage 3 hangs off an investor record existing exactly once. 5.1 is
independent of 5.4 and can run in parallel *by the same builder on alternate days*, never by a
second session.

### 5.4 · The handover — build · **seam — the seam of the whole system**

**Owner:** builder. **Agents:** **planner** ×1 before — and its plan is checked against HO1–HO3
before it is accepted; **reviewer**; **adversary** ×1 on Wednesday — told, verbatim: *make the
Contact exist twice; make it exist without the lead reaching said-yes; make the ARL collide; make a
leads-side identity field cross; undo said-yes at minute fourteen and at minute sixteen; re-open a
Lost lead and reach said-yes again (HO2); kill the process after each of the four writes and retry
(HO3).*

**Read:** D11 (*the handover creates the Contact at said-yes; the lead continues*); D23's decision
file; §2 rung 3; §11 `lead.handover.json`, `lead.lost.json`; rule 1 (the handover is the one place a
fact crosses sides, and it still has one writer); rule 7; Appendix A **HO1** (*Lost after Said yes
has no Investor-org effect* — fix: `lead.lost` → Contact Withdrawn, live Documents blocked, a timed
erasure, a Contacts-whose-Lead-is-Lost invariant), **HO2** (*the handover fires twice* — fix:
short-circuit when `investor_contact_id` is set; find-or-create on `lead_uuid`), **HO3** (*a partial
handover duplicates on retry* — fix: `lead_uuid` unique on Contacts with upsert; Lead write-back
before the NDA copy; a nightly one-Lead-per-Contact assertion). The plan's sixteen-job table: *one
function per side, each holding one org's key.*

**Do:**
- **Said yes is a typed confirmation** — the IR types what was agreed (the book's fields), not a
  click. It starts a **fifteen-minute window** during which it can be undone (L5-04); the handover
  runs at the end of the window, not at the click.
- **The handover, two orgs:** one function on the console side that emits `lead.handover` through
  the outbox; one function on the investor side (`db-investors/functions/`) that receives it and
  performs the four writes — create the Contact (**upsert on `lead_uuid`, unique**), write the Lead
  back with `investor_contact_id` and the ARL (**before** the NDA copy — HO3), copy the NDA, invite.
  Each function holds **only its own org's key**. The integration user is the writer on the investor
  side — that is its job (§2's last row: *the cross-org handover*), and the only kind of job it has.
- **The handover, one org:** Zoho's Lead-to-Contact conversion, called through the write path as the
  person, with the ARL minted by the conversion's mapping; no function in this repo does the four
  writes. The tests are the same.
- **Exactly once** (L5-01): short-circuit when `investor_contact_id` is already set (HO2);
  find-or-create on `lead_uuid` so a retry after any step lands on the same Contact (L5-02, HO3).
- **A returning investor attaches** (L5-03): the find is on the person, not only the lead — the
  book's identity key (read it; likely the normalised phone and the PAN hash on the investor side,
  never the PAN itself). A match attaches the lead to the Contact that exists and mints no second
  ARL.
- **Lost after handover withdraws the Contact** (L5-05, HO1): `lead.lost` on a handed-over lead
  drives the Contact to Withdrawn, blocks its live Documents, and starts the timed erasure.
- The lead continues in the Leads org after handover; nothing is deleted; the gate columns (5.3)
  now have somewhere to be written.

**Don't:** run the handover from the click. Four writes with no idempotency key. A Contact created
without a `lead_uuid`. A person's token doing the investor-side write. A PAN in `lead.handover`'s
payload (the contract does not carry one; the validator refuses it).

**Done when:**
- L5-01: one said-yes → one Contact, one ARL, one link, on both sides. `RAN` — the ids.
- L5-02: kill after write 1, 2, 3, 4 and retry → still one Contact, one ARL; the nightly
  one-Lead-per-Contact assertion (written now, scheduled in week 6) passes. `RAN`, four times.
- L5-03: a lead whose person matches an existing Contact attaches; Contact count unchanged. `RAN`.
- L5-04: undo at minute 14 → no handover; at minute 16 → refused, handover ran. `RAN`, clock pinned.
- L5-05: Lost on a handed-over lead → Contact Withdrawn, Documents blocked, erasure scheduled.
  `RAN`.
- A hundred said-yes under forced retries → a hundred Contacts, a hundred ARLs, no duplicates (the
  plan's outcome line). `RAN` — the counts.
- `contracts/lead.handover.json` validation refuses a payload with an identity field. `RAN`.
- The adversary's report: BROKEN `none`, or fixed and re-reviewed. `SAW`.

### 5.3 · Gates — rungs 4 to 7, the write-back, and the reversals — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 on Wednesday —
*write a gate column as an IR, as the manager, as an administrator, as the super administrator,
through the screen and the API; open a gate with a claim instead of a confirmation; step past a gate
whose fact was reversed; mark Lost after money exists.*

**Read:** §2 rungs 4–7 and their gate column; D09; D19 (three reversal events); D05 (the blueprint
holds the ladder; the gate is a blueprint transition whose condition is the gate column); rule 3
(*recording money is always allowed; matching is what the rules gate*), rule 4, rule 5; §11
`money.confirmed`, `money.not_found`, `money.reversed`, `paper.verified`, `paper.blocked`,
`allotment.done`, `allotment.reversed`; Appendix A **GA** (12 modes).

**Do:**
- **The gate columns** on the lead — supplementary verified, advance confirmed, balance confirmed,
  allotted — are written by **exactly one writer: the gate write-back**, an inbound function that
  receives Finance's facts from the investor side (`paper.verified`, `money.confirmed`,
  `allotment.done`) and writes the column. No profile, including administrator, has write on those
  fields in Zoho (field-level security, D13's mechanism turned to this purpose) — L6-02.
- **The IR ticks rungs 4, 5, 6** (§2: *IR ticks*), and the blueprint transition is conditioned on
  the gate column — so the tick is refused until the fact is there (L6-01). Rung 7 is ticked by the
  console on `allotment.done` (Q3's default) — *the console ticks it on the event.*
- **Reversals** (L6-03, D19): `money.reversed` clears the money gate and steps the ladder back to the
  rung below it; `paper.blocked` clears the paper gate; `allotment.reversed` un-allots. Each is an
  inbound event through the same write-back, each closes only what its forward event opened, and
  each is a row in the history. Three, not four, not two.
- **Lost is refused once money exists** (L6-04) — a validation rule in Zoho on the Lost transition:
  no Lost while any money gate is open; the path once money exists is a refund case, stage 3's.
- **A fully paid investor who was never allotted appears in a queue** (L6-05) — a hint on My day and
  on the manager's team view: balance confirmed, allotted empty, older than the book's threshold.
- Every gate change is a notification (4.4) — specific, because it matters.

**Don't:** a gate column a screen can edit. A gate opened by `money.claimed`. A reversal that
deletes the forward event. A fourth reversal event. A Lost that bypasses the money check "for
cleanup".

**Done when:**
- L6-01: with no fact, the IR's tick of rung 4 is refused by the blueprint; after `paper.verified`
  arrives through the write-back, it succeeds. `RAN`, both.
- L6-02: a write to a gate column as each of IR, manager, administrator, super administrator,
  through screen and API → refused, every time. `RAN` — eight refusals.
- L6-03: `money.reversed` after rung 5 → gate closed, ladder at rung 4, history row. `RAN`.
- L6-04: Lost with an open money gate → refused by Zoho. `RAN`.
- L6-05: the seed's fully-paid-never-allotted lead is in the queue. `RAN`.
- The adversary's report: BROKEN `none`, or fixed. `SAW`.

### 5.2 · Claims — build

**Owner:** builder. **Agents:** **reviewer**.

**Read:** rule 3; D09 (*the IR raises a request; Finance confirms in the investor console; the IR
cannot go to the next stage until Finance confirms*); §11 `money.claimed`, `money.confirmed`,
`money.not_found`; L6-06.

**Do:**
- *The investor says he has paid* is a **typed record**: kind (advance, balance, full — the book's
  list), mode (NEFT, RTGS, IMPS, UPI, cheque), the reference the investor gave, amount, date. Not a
  note. Refused without its fields (Zoho validation, D05).
- It emits `money.claimed` through the outbox, carrying its own id. Finance answers **against the
  same id**: `money.confirmed` opens the gate (5.3) or `money.not_found` closes the claim with a
  reason the IR sees.
- A claim is a hint: it orders Finance's day (stage 3's Dashboard) and moves no state. Only the
  confirmation moves state.
- On the lead page: the claims, their state, Finance's answer, and the time each took — because
  *waiting on Finance* (2.1) is the difference between the claim and the answer.

**Don't:** a free-text "paid" note. A claim that opens a gate. A claim without an id Finance can
answer against.

**Done when:**
- L6-06: a claim without an amount, or with prose in the amount, is refused. `RAN`.
- A claim emits `money.claimed` with its id; a synthetic `money.confirmed` against that id opens the
  gate; against a different id, nothing. `RAN`.
- A claim alone moves no rung. `RAN`.

### 5.1 · Paper — the NDA round — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 after SHIP —
*send an NDA without Finance's template; verify a signature whose signer's name is not the lead's;
mark paper verified as the IR; replay a completion callback; complete a signature with the callback
switched off and the poller stopped.*

**Read:** §2 rung 2 (*the NDA is sent by the system under Finance's template before any material
goes out, and eMudhra's completion verifies it*); D07 (eMudhra is the permanent signature
authority); D17; D18 and §21 (the NDA send is catalogued automation — it is honest because it is
under Finance's template and visible as a system touch); §20 (the template); §11 `paper.requested`,
`paper.sent`, `paper.told`, `paper.chased`, `paper.said_signed`, `paper.signed`, `paper.verified`,
`paper.blocked`; L4-01 to L4-05; Appendix A **DO**, **SE**; `ops/runbooks/webhook-stopped.md`.

**Do, in this order:**
1. **The poller first** (L4-02, the plan: *with a poller built first so a lost callback cannot strand
   a document*): every ten minutes, ask eMudhra for the state of every outstanding request; a
   completed one is applied exactly as a callback would be. Same handler, same idempotency on the
   provider's request id. Pings the heartbeat.
2. **The receiver**: eMudhra's completion callback, signature verified, replay inert (as 1.6).
3. **The send**: the IR requests (`paper.requested`); **the system sends** under Finance's template
   (`paper.sent`) — *without an IR clicking send on each one* (L4-01); the send is a system touch,
   visible, uncounted (rule 6). A re-issue cancels the first request at the provider before it sends
   the second (L4-03).
4. **Told and chased** (`paper.told`, `paper.chased`): the IR's own records of having told the
   investor and chased them — counted, like touches; **not preconditions** of anything (L4-05). The
   signature does not wait for them.
5. **Signed** (`paper.signed`): from the provider, through the receiver or the poller, never from
   the IR (`paper.said_signed` is the IR's hint that the investor says so — it moves nothing).
6. **Verified** (`paper.verified`): Finance's act (stage 3's portal; this week a synthetic event
   proves the path) — **with the signer's name checked against the lead**: a mismatch goes to
   review, never to verified (L4-04). `paper.blocked` is its reversal.
7. On the lead page: the round's state, each event with its time, the count of chases.

**Don't:** send from the IR's mail. Send under any template but Finance's. Let `said_signed` do
anything. Wait for `told` before sending. A callback handler without the poller behind it. A
verified state the IR can set.

**Done when:**
- L4-01: a request → an NDA sent under Finance's template with no further click; the send is a
  system touch. `RAN`.
- L4-02: callback disabled at eMudhra's sandbox → the poller applies the completion within ten
  minutes. `SAW` — the two timestamps.
- L4-03: a re-issue → the first request cancelled at the provider, one live request. `RAN`.
- L4-04: a completion whose signer's name differs from the lead's → review, not verified. `RAN`.
- L4-05: a signature completes with zero `told` and zero `chased`. `RAN`.
- A replayed callback changes nothing. `RAN`.
- The adversary's report: BROKEN `none`, or fixed. `SAW`.

## Friday · the handover

- **test-writer** ×1: sixteen cases, at the Test Book's count.
- Deploy the lead page's second half. Handover note LOOK AT: the handover killed after each write;
  a gate column through the admin's API; the callback switched off. SEED: two leads for the demo
  and one returning person.
- Graph. `/save` — and the line says which handover shape was built and why (D23).
- **verifier**.

## The gate

1. Week 4's gate closed. D23's shape is written. eMudhra sandbox credentials are in the vault.
2. L5-01 to L5-05: exactly one Contact, one ARL, one link; survives four kill points; a returning
   investor attaches; the fifteen-minute window holds both ways; Lost after handover withdraws.
3. A hundred handovers under forced retries → a hundred records.
4. L6-01 to L6-06: gates open only on the write-back's fact; no human writes a gate column; each
   reversal closes what it opened; Lost is refused once money exists; the never-allotted queue;
   claims are typed.
5. L4-01 to L4-05: the NDA goes out by the system under Finance's template; the poller completes it
   with the callback off; re-issue cancels; wrong signer → review; told and chased gate nothing.
6. Three adversary reports (5.4, 5.3, 5.1): BROKEN `none`, or fixed and re-reviewed.
7. Every event this week has its schema in `contracts/` and went through the outbox — the
   verifier's standing check 5, and this week it matters most.
8. Sixteen cases' unit tests green at the Test Book's count.
9. The eleven standing checks.

## If it slips

The plan's own order, for the heaviest week of the stage:

1. **5.1's send under the real template** — the NDA can go out under a placeholder template on the
   sandbox until Q21's words land; the *mechanism* (system send, poller, receiver, verify) cannot
   slip.
2. **5.2's page** — the claim can be raised from a minimal form; the lead page's claims section
   lands Monday of week 6.
3. **Nothing in 5.4 or 5.3.** An investor record that can exist twice, or a gate a human can write,
   is a stage-3 disaster with a week-5 cause. If 5.4 is not proved on Friday, week 6 starts with it
   and week 6's own scope moves — in `SESSIONS.md`, in the open.

---

# Week 6 · 12 – 18 Oct · Plan, Numbers, System — and proving the console

**Decisions:** D14, D16, D19 (eleven canaries), D22, D24; rule 8.
**Build Book:** §3; §15 (the alerts) as amended by D19 (the canaries); §22; §24 (the diagnostic
reads what this week builds); Appendix A **MI** (*the mirror and the reconcile*, 15 modes), **PL**
(*platform, keys and backups*, 15), **CL** (*close and analytics*, 3); `ops/drills/`,
`ops/backup/`, `ops/runbooks/money-mismatch.md` (the reconcile's failure), `ops/diagnose/`.
**Test Book:** L7-01 to L7-03, L8-01 to L8-04 — then **all 48 console cases** on a clean seed.

| Case | Proves |
|---|---|
| L7-01 | Every number on the numbers page can be reproduced by hand |
| L7-02 | Goals are editable by exactly three people |
| L7-03 | The month ahead is visible and plannable |
| L8-01 | The access matrix is walked, profile by profile, field by field |
| L8-02 | Twenty-five people work at once without exhausting anything |
| L8-03 | Each canary is fired on purpose, once |
| L8-04 | The leads project is restored and the restore is timed |

**The two jobs this week:**

| Job | Way | Fires when | Writes | How we know it ran |
|---|---|---|---|---|
| Nightly reconcile · leads, and the invariants | job | 02:00 | differences between Zoho and the mirror; the week-5 checks (one lead one record; no gate without its fact; no rung above its facts) | **the report is the alarm** |
| The canaries | job | each on its own schedule | two phones, thirty-minute escalation | each fired once on purpose (L8-03) |

## Monday first

Week 5's tester results and the diagnostic. Fix-first — and this Monday it is the week's largest
task: week 5 was the heaviest, and its findings are the ones that would poison the regression.
Nothing on this sheet starts while a week-5 case is red.

## What exists by Friday evening

- **Plan** — targets by duration, set by the three named seats and by nobody else, with every change
  logged.
- **Numbers** — the funnel from receipts and documents rather than from ticks, conversion time by
  source and event, touches per conversion, lost reasons, forecast against actual — net of refunds
  and reversals.
- **System (console side)** — how fresh the mirror is, what is in the outbox, which alerts fired, and
  when the last backup and restore were.

Then the regression, the signing, and **Demo one**.

## The order

```
6.4 nightly reconcile + invariants (evidence) ──► 6.2 Numbers (evidence) ──► 6.1 Plan
6.5 canaries (evidence)                        ──► 6.3 System
6.6 the proofs: access matrix, load, restore (evidence, the tester's and the adversary's)
```

Evidence tasks in plain sessions — this is the week the README's headroom rule matters most.

### 6.4 · The nightly reconcile and the leads-side invariants — evidence

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**.

**Read:** rule 8; D19; Appendix A **MI**; `ops/runbooks/money-mismatch.md`; week 5's three nightly
checks; the plan: *the report is the alarm.*

**Do:**
- At 02:00 IST (the one clock), on `pg_cron`: compare every lead in Zoho with its mirror row through
  the allow-list — a difference is a row in the report, named (record id, field, both values),
  **never a count**. Then the invariants: one lead ↔ one Contact (HO3); no gate column without its
  fact event; no rung above its facts. Each violation named.
- The report is a file in `ops/diagnose/reports/` (gitignored for `*.json` — already), and the
  diagnostic (§24, `/diagnose`) reads it. **The report is the alarm**: a non-empty report pages
  (6.5). An empty report also pings the heartbeat — a reconcile that did not run looks like a clean
  night otherwise, and that is Appendix A's silent class.
- It repairs nothing. It explains. A person decides (§24).

**Don't:** a reconcile that fixes the mirror. A count. A report that goes to a log nobody reads.

**Done when:**
- A planted difference (edit the mirror directly, once, on the test project) is named in the next
  report, with both values. `RAN`.
- A planted invariant breach (a gate column set with no fact) is named. `RAN`.
- An empty report pings the heartbeat; a missed run pages. `SAW`.

### 6.2 · Numbers — evidence

**Owner:** builder. **Agents:** **reviewer**; and L7-01 is the tester's — *every figure reproduced
by hand from the ledger* — the builder writes the derivation beside each figure so that it can be.

**Read:** the decisions: *the funnel, the sources and events, from the mirror*; *what would stop him
dead is a console that measures selling without helping anybody sell*; Appendix A **CL**; L7-01.

**Do:**
- The funnel **from facts, not ticks**: captured (rung 1 events), first touch, said yes (handovers),
  supplementary verified, advance confirmed, balance confirmed, allotted — each count from its
  event, **net of its reversal**. A tick that has no fact behind it is not in the funnel.
- Conversion time by source and by event (rung 1 → each later fact, in days, by the one clock).
  Touches per conversion (human touches only — rule 6). Lost reasons, counted. Forecast against
  actual — the IR's forecast (a hint) against confirmed money (a fact), net of refunds and reversals.
- **Beside every figure, its derivation**: the query, or the event set and the arithmetic, one
  click away — so that L7-01 can be walked by a tester with the ledger open and no help.
- Scoped: an IR's own, the manager's team, the viewer's whole funnel, masked (D24).

**Don't:** a number from a tick. A chart with no table under it. A figure with no derivation. A
number the Leads page would count differently (one fact, one writer applies to counts).

**Done when:**
- L7-01: for each figure on the page, the tester (not the builder) reproduces it by hand from the
  ledger on the seed and gets the same number. `SAW` — the tester's record, figure by figure.
- A `money.reversed` on the seed moves the funnel's advance count down by one. `RAN`.
- The viewer sees the funnel with no lead-level detail. `RAN`.

### 6.1 · Plan — build · **seam** (a small one)

**Owner:** builder. **Agents:** **reviewer**; **adversary** ×1, short — *set a target as anyone but
the three; change one without it being logged.*

**Read:** the decisions: *goals live on a dedicated page, editable only by Jhalak, Sahil or Pradeep*;
*the ability to set sales numbers and targets by duration*; *people see the next week and the whole
month ahead, so they can plan leave and know what has to be done early*; L7-02, L7-03.

**Do:**
- Targets by duration — week, month, quarter, year — by IR and by team, set by **the three named
  seats and nobody else** (a role check by name in the one function; not a grid tick — the grid
  cannot grant it), every change logged with actor, time, before, after.
- The month ahead: what is due (follow-ups, holds expiring, gates ageing) laid on a calendar the IR
  can plan against; leave marked on it from availability (4.3).
- Numbers (6.2) reads the targets for forecast-against-actual; Plan does not compute anything Numbers
  computes.

**Don't:** a target editable by the manager. A calendar that is a second source of follow-ups.

**Done when:**
- L7-02: a target set by each of the three succeeds and is logged; by the manager and by an IR, refused
  in the backend. `RAN` — five attempts.
- L7-03: the month ahead shows the seed's follow-ups, holds and leave on their days, by the one clock.
  `SAW`.
- The adversary's report: BROKEN `none`. `SAW`.

### 6.5 · The canaries — evidence

**Owner:** builder. **Agents:** **reviewer**; L8-03 is the tester's to observe.

**Read:** D19 (*eleven canaries in place of the six alerts*); §15 as amended; `ops/runbooks/*` —
each canary has a runbook that says what a person does when it fires; the plan: *the canaries wired
to two phones with a thirty-minute escalation.*

**Do:**
- The leads-side subset of the eleven (the book names which — stage 3 wires the rest): the
  heartbeat's silence (week 1), the outbox age-and-order (week 1), the reconcile's non-empty report
  and its missed run (6.4), mirror freshness past threshold, the eMudhra poller's silence, the
  one-Lead-per-Contact breach. Each is a check that pages — **two phones, thirty minutes apart** —
  through the external monitor (rule 8), never through our own mail.
- **Each fired once on purpose** (L8-03): a switch per canary that plants its condition on the test
  environment; the tester throws each, sees the page, sees the escalation at thirty minutes, writes
  the times down.
- The System page (6.3) shows which fired and when.

**Don't:** a canary that alerts inside the system it watches. A canary with no runbook. An
escalation that loops (M5-05 tests this in stage 3; build it right now).

**Done when:**
- L8-03: every leads-side canary fired once, on purpose, first phone then second at thirty minutes,
  times recorded by the tester. `SAW`.
- `grep -rL heartbeat db-leads/functions/*` still prints nothing. `RAN`.

### 6.3 · System (console side) — build

**Owner:** builder. **Agents:** **reviewer**.

**Read:** §24; the decisions: *the super admin sees logs, the system, and anything useful for running
the two apps*; D24 (who may see it — administrators).

**Do:** one page, administrators and above: mirror freshness (the reconcile's last run and its
report's size), the outbox (undelivered by age, dead letters), which canaries fired and when, the
last backup and the last restore drill with their times. Every figure links to the thing it counts.

**Don't:** a page that can act. A number without a link.

**Done when:** the page shows the seed's planted conditions from 6.4 and 6.5 correctly, and an IR
cannot reach it (404). `RAN`.

### 6.6 · The proofs — the access matrix, the load, the restore — evidence · **the tester's, with the adversary**

**Owner:** the tester, the adversary, Sahil. The builder prepares and fixes. **Agents:** **adversary**
×1 — the **console-wide** one: every persona, every door, every page, after the regression is
green; **scout** ×1 to produce the matrix's blank — every profile × every field — from `zoho/leads/
fields.json` and §2's table.

**Read:** L8-01, L8-02, L8-04; D14; `ops/drills/`, `ops/backup/`; Appendix A **PL**, **OA**.

**Do:**
- **The access matrix** (L8-01): every profile against every field, through the screen, the API, an
  export and a report — walked by the tester, line by line, *held / broke*; **signed by Sahil**. The
  console-wide adversary runs the same matrix by machine first and hands the tester the lines it
  could not reach.
- **Twenty-five at once** (L8-02): a load run — twenty-five sessions working the seed's leads for an
  hour on the test environment; nothing exhausted (Zoho's API credits, Supabase connections, the
  outbox's runner). The numbers, recorded.
- **The restore** (L8-04): the leads project restored from a point in time into a clean project,
  **timed**, and the mirror's row counts and a sample of rows compared; the first backup drill in
  `ops/drills/` is this. The System page (6.3) shows it.

**Done when:**
- L8-01: the matrix, every cell *held*, signed. `SAW` — the signed sheet.
- L8-02: the load run's figures, nothing exhausted. `SAW`.
- L8-04: the restore's elapsed time and the comparison. `SAW`.

## Friday · the handover, then the regression

- **test-writer** ×1: L7 and L8 at the Test Book's count.
- Deploy the three pages. Handover note LOOK AT: a figure on Numbers whose derivation you doubt; the
  canary switches; the restore. SEED: the **clean seed** for the regression — reset, ten personas,
  generated volume.
- Graph. `/save`. **verifier** — on the week's gate.
- **Then the stage end.**

## The week's gate

1. Week 5's gate closed and every week-5 case green on Monday.
2. L7-01: every figure reproduced by hand by the tester. L7-02, L7-03.
3. L8-01 signed; L8-02 recorded; L8-03 every canary fired once; L8-04 timed.
4. The reconcile names a planted difference and a planted breach; a missed run pages.
5. Two adversary reports (6.1, console-wide): BROKEN `none`, or fixed.
6. L7 and L8 unit tests green.
7. The eleven standing checks.

## Stage 2 · the end

From the plan: *every case in the stage is run again on a clean seed, and the stage is demonstrated
before the next one starts.*

1. **Clean seed.** The test projects reset; the ten personas and generated volume only. `RAN`.
2. **All 48 cases, L0 to L8**, run by the **tester** — not the builder — on the clean seed, and
   recorded where both see it. The builder's job during the regression is fix-first on what it
   finds, one case at a time, never a batch; a fix that touches a seam sends the adversary back to
   that seam.
3. **The signing list** — the verifier answers each:
   - Twelve pages on the test environment, each reachable by the personas §2 allows and by no other.
     `RAN`.
   - 48 of 48 green on the tester's record. `SAW`.
   - The access matrix walked and **signed by Sahil**. `SAW`.
   - The leads database restored from a point in time, and the restore **timed**. `SAW`.
   - Nothing open from weeks 2–6. `SAW` — the five gates.
4. **Demo one — the whole IR journey**, to the founder, on the test environment, from the clean
   seed: capture from both doors; a lead worked to said yes with an honest count; the NDA out and
   verified; a claim, a confirmation, a gate opening; the handover; the funnel — *a funnel whose
   every number can be derived in front of you* — derive two of them live. What is asked for and is
   not on a sheet goes to the register (D16). One line in `SESSIONS.md`: what was shown, what was
   asked.
5. **Nothing carries.** Stage 3 starts with no debt from stage 2. If the regression is not green by
   Sunday, stage 3 is delayed, not started thin: the new date goes in `SESSIONS.md` and every later
   week moves.

## If the stage slips

Nothing is cut inside the stage; a stage end has no slip, it has a delay. The plan's cut order for
the whole build lives in `docs/where-it-breaks.html` and only Sahil invokes it.
