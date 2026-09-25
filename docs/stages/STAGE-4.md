# Stage 4 · The investor app, and the seam proved under failure · Week 12 · 23 – 29 Nov 2026

**22 Sep 2026.** This sheet predates D45 (zero copy). Its premise — the app's five pages re-pointed at the investors mirror, *D03's second project* — is void: the investor apps went to Zoho CRM Portals in the same 22 Sep call. A-01 and A-03 survive in spirit as D45's own rule, that a cached figure says when it was true and a failed fetch says so rather than showing a stale number. **D46** states the rest.

**23 Sep 2026 — and it is now one Enterprise org (D52).** The handover as code, the cross-org seam and week 5's handover work no longer exist, so *the seam proved under failure* has no second org on its other side, and S-03's thirteen cross-org invariants are same-org invariants over one org's records. *One investor can never see another* stands, and is now D52's last leak guard: the investor portal is scoped by the portal, not by field-level security, and tested that investor A cannot reach investor B. The full rewrite of this sheet is tracked as **A-04** in `docs/CARRY-FORWARD.md` and has not been done; until it lands, read D52 and D53 alongside D45 and D46 before any task here.

Read `docs/stages/README.md` first. Then this. Then only what this names.

## What the stage delivers

One week. *Five app pages re-pointed at the new read model, and the seam proved under failure. This
week also carries anything week 11 could not finish.* From the plan: *one investor can never see
another, and one side going down loses nothing.*

The app exists — the investor portal at growizefarm.com, a single-file dashboard on Supabase
magic-link OTP, serving CCD, equity and preference holders. This week is a **re-pointing, not a
rewrite**: its five pages read the investors mirror (D03's second project) and nothing else; its
documents come on demand through a portal-side function that fetches from Zoho (D08 — *the investor
app never touches Zoho*, §1's one rule); its requests go in through week 10's receiver; its figures
say when they were true. The five pages are the wireframes drawn in week 10 (READY-TO-BUILD: *no
wireframes for the investor app's five pages* existed before then).

**Stage 4 is signed when:** A-01 to A-03 and S-01 to S-04 are green on the tester's record on the
clean seed; the four failure runs of the seam are recorded with what the system did under each;
and week 11's carried list is empty. Then the Friday demo: *an investor's own screen, with a figure
that says when it was true — and the system carrying on with half of it switched off.*

**Decisions this stage stands on:** D03, D08, D10 (what *tentative* withholds — Q4), D15, D19, D24;
rules 1, 7, 8, 9.
**Build Book:** §1 (the one rule — the app clause); §3 (the app's reads); §22 (how it breaks — the
seam's script); §11; Appendix A **SE** (12 modes), **MI** (15), **ML** (push), **OA** (the app's
sessions); `docs/where-it-breaks.html` (the 145 modes — the seam runs are drawn from them);
`ops/runbooks/*` (what a person does under each; the runs prove the runbooks, too).
**Test Book:** A-01 to A-03, S-01 to S-04. Two (A-01, S-01) are in the go-live smoke pack.

| Case | Proves |
|---|---|
| A-01 | A stale mirror never shows a number |
| A-02 | One investor can never see another |
| A-03 | An old app build cannot show new money |
| S-01 | One side down does not lose a fact |
| S-02 | A replayed or forged event changes nothing |
| S-03 | The thirteen cross-org invariants each name the offending record |
| S-04 | A loop cannot burn the credit budget overnight |

**The job this week:** *the seam, proved in both directions: replay, forgery, ordering and a full
working day with one side paused.* Not new code — the proof of every job built since week 1.

## Monday first

Stage 3 signed — 42 green, the matrix signed, a refund gone from every figure, Demo two done. **Week
11's carried list first**, before any app page: it is the only scope this week gains, and it is
finished before the app is touched (*eleven pages, finished and signed before the app is touched*).
Then fix-first.

**Class D item 10** — the FCM project — exists (READY-TO-BUILD dated it week 10). If not, 12.3's
push waits on it and the sheet says so.

## What exists by Friday evening

- **App · home and statement** — every money figure with the time it was true — and *being
  updated* instead of a number when the mirror is stale.
- **App · holdings and documents** — units, payouts and the papers, fetched on demand.
- **App · farm updates** — what the KAM and the farm team publish.
- **App · requests** — questions, bank change and exit — showing *received* only when the case
  really exists.
- **App · profile and consent** — details, nominee, and consent by purpose with withdrawal that
  takes effect the same day.
- **The seam** — both directions under failure: one side paused for a working day, a replayed event,
  a forged event, and the thirteen cross-system checks run against a deliberately corrupted set.

## The order

```
12.0 week 11's carried list
12.1 the app's read model + session (seam: one investor never sees another)
   ──► 12.2 home & statement, holdings & documents (seam: stale means no number)
   ──► 12.3 farm updates, requests, profile & consent
12.4 the seam under failure (evidence — the stage's proof; Wednesday to Friday)
```

### 12.1 · The app's read model, and its session — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**; **adversary** ×1 — *as one investor,
query another's holdings, statement, documents, farm, requests, by id, by ARL, by URL, by a
tampered token; as a signed-out session, anything; as a tentative account, a statement; with an old
app build's schema, new money.*

**Read:** D03, D24 (an investor reads the mirror; writes nothing directly — requests go through the
receiver), rule 7, Q4/D10, §3 (the app's reads), A-02, A-03; the existing app's magic-link OTP
(keep it — configured, not built; Appendix C).

**Do:**
- **One connection, one project**: the investors mirror. The app's configuration names the
  investors project and nothing else — no leads project, no Zoho. RLS on every view the app reads,
  scoped to the signed-in investor's ARL in the policy (A-02). Anything outside is *not found*.
- The session: the existing magic-link OTP, with the investor's ARL on it; nothing else needed.
- **Tentative withholds** (D10, Q4): statements, the payout mandate, bank change and exit requests
  are refused for a tentative account in the policy; farm updates and documents are served from day
  one.
- **An old build cannot show new money** (A-03): every money figure carries the schema version it
  was computed under; the app declares the version it understands; a mismatch shows *being updated*,
  never a number. This is the same mechanism as A-01 — one rule, two triggers.

**Don't:** a service key in the app. A read that joins to the leads project. A tentative check on
the client. A version check that logs a warning and renders anyway.

**Done when:**
- A-02: as TD-INV-1, every read for TD-INV-2's ARL → 404, on every page's route. `RAN`.
- The app's environment names one project; `grep` for the leads project ref and for any Zoho host
  in `app/` prints nothing. `RAN`.
- A tentative account's request for a statement → refused; for a farm update → served. `RAN`.
- A-03: with the app's declared version behind the mirror's, a money figure renders as *being
  updated*. `RAN`.
- The adversary's report: BROKEN `none`. `SAW`.

### 12.2 · Home and statement; holdings and documents — build · **seam**

**Owner:** builder. **Agents:** **reviewer**; **adversary** ×1 — *make a stale mirror show a number;
fetch a document with Zoho unreachable and see what the app says; fetch another investor's document
through the on-demand function.*

**Read:** A-01, D08, rule 9 (*the time it was true* is by the one clock), the plan: *"being
updated" instead of a number when the mirror is stale.*

**Do:**
- **Every money figure with the time it was true**: the mirror row's last-reconciled time (11.5's
  reconcile stamps it) shown beside the figure; if that time is older than the runbook's freshness
  line, the figure is **not shown** — *being updated* is shown, and nothing else (A-01). The rule is
  in the read, not the page: a stale row's money columns are nulled by the view.
- Holdings: units, the hold and its deadline (9.4 — *its deadline shown to the investor*), payouts.
- **Documents on demand** (D08): the app asks a portal-side function (`db-investors/functions/`)
  for a document by id; the function checks the ARL, fetches the file from Zoho as the integration
  user (its job — §2's last row: what arrives from outside includes the app's requests), streams
  it, stores nothing. Zoho unreachable → *not available right now*, honestly, never a cached copy.

**Don't:** a figure with no time. A freshness check on the client. A document cached "for speed".

**Done when:**
- A-01: age the seed's reconcile stamp past the line → every money figure on home and statement
  reads *being updated*; refresh the stamp → the numbers return. `RAN`.
- A document fetch for the investor's own → served, nothing stored; for another's → 404; with Zoho
  unreachable → the honest message. `RAN`, three.
- The adversary's report: BROKEN `none`. `SAW`.

### 12.3 · Farm updates; requests; profile and consent — build

**Owner:** builder. **Agents:** **reviewer**.

**Read:** 10.4 (Updates, the farm category), 10.3 (the requests receiver — *idempotent on the app's
own id; the app shows "received" only from the real case*), 11.4 (consent withdrawal — *the same
day, every send*), Q10 (the nominee), `contracts/push.delivered.json`, D-10 (FCM).

**Do:**
- **Farm updates**: the farm category of Updates for the investor's farm(s), from the mirror, with
  the time published; push (`push.delivered`, through FCM) for a new one — a system touch, and off
  for a withdrawn consent.
- **Requests**: questions, bank change, exit — sent to 10.3's receiver with the **app's own id**;
  the app shows **received only when the case really exists** — it waits for the case id back and
  shows nothing certain before it. Exit and bank change refused for a tentative account (Q4).
- **Profile and consent**: details (the mirror's, masked identity — the investor sees their own
  masked PAN, never the full one from the app: D13's reveal is a staff act); the nominee (a request
  of Compliance's kind, Q10); **consent by purpose** with **withdrawal that takes effect the same
  day** — the same function 11.4 wrote, and every send path in both portals reads it.

**Don't:** *received* shown from the send. A push to a withdrawn consent. A full PAN on the profile.

**Done when:** the same request id twice → one case, one *received*; a withdrawal at 10:00 stops a
statement mail at 10:01 (M6-02 re-run from the app's side); a farm update pushes once and not to a
withdrawn consent. `RAN`.

### 12.4 · The seam under failure — evidence · **the stage's proof**

**Owner:** builder, with the tester; Wednesday to Friday. **Agents:** **planner** ×1 — the run
script, from §22 and `where-it-breaks.html`, one line per mode tried; **adversary** ×1 — it *is* the
forger and the replayer; **verifier** on Friday reads the runs' record.

**Read:** S-01 to S-04, rule 8, D19, §22, Appendix A **SE** and **MI** in full, every runbook in
`ops/runbooks/` (each run proves one), §25's API-limits table (S-04: Zoho's credits per day).

**The four runs, from the plan:**

1. **One side paused for a working day** (S-01): stop the outbox runner on the console side at
   09:00 IST; work the day — captures, touches, claims, a said-yes — on the console; at 18:00
   restart it. Every fact reaches the investor side, in order, once. Then the other direction:
   pause the investor-side receiver; Finance confirms money, verifies paper, allots; restart —
   every gate on the console opens, once, in order. Nothing lost, nothing doubled; the heartbeat
   paged at the right times and the runbook was followed.
2. **A replayed event** (S-02): replay a day's worth of delivered events, both directions — nothing
   changes; the invariants are clean.
3. **A forged event** (S-02): an unsigned, then a wrongly-signed, then a well-formed-but-impossible
   (`money.confirmed` for a receipt that does not exist) event, both directions — refused at the
   inbox, or refused by the contract, or refused by the invariant; never applied.
4. **The thirteen checks against a deliberately corrupted set** (S-03): corrupt the test projects
   thirteen ways, one per invariant — a second Contact for a lead, a gate with no fact, a permanent
   mark with due above zero, an identity column value in a mirror, a shelf that does not sum, an
   investor with no owner, a confirmed receipt with no line, a live document on a Withdrawn Contact,
   a send to a withdrawn consent, an allotment short a fact, an out-of-order outbox, a gap in the
   event archive, a stale farm — and run the 02:30 job: **each names the offending record**, never a
   count.

And **S-04**: a loop — an event that triggers its own re-emission — planted on the test
environment overnight; the outbox's age-and-order alarm, the runner's batch cap and the API-credit
canary stop it before the day's credits are gone. The morning's diagnostic explains it.

**Done when:** four runs, each recorded — what was done, at what time, what the system did, what
paged, which runbook was walked, by whom — and the record is in `ops/drills/`. `SAW`, four. S-04's
morning: credits remaining above the runbook's floor. `RAN`.

## Friday · the handover

- **test-writer** ×1: A and S at the Test Book's count.
- Deploy the app against the test mirror. Handover note LOOK AT: the stale figure; another
  investor's document through the function; the day-paused run's event order.
- Graph. `/save`. **verifier**.

What you show on Friday: *an investor's own screen, with a figure that says when it was true — and
the system carrying on with half of it switched off* — pause one side live, work it, resume it.

## Saturday, Sunday · the tester

A-01 to A-03, S-01 to S-04 on the clean seed — the seam runs re-done by the tester from the record
in `ops/drills/`, not from the builder's memory.

## The gate

1. Stage 3 signed. Week 11's carried list empty.
2. A-02: one investor never sees another, on every route. A-01, A-03: a stale or unknown-version
   figure is never a number.
3. The app reads one project and never Zoho; documents on demand through the function, stored
   nowhere.
4. Tentative withholds exactly Q4's four and serves the two.
5. *Received* only from the real case; consent withdrawal stops every send the same day; push
   respects it.
6. S-01 to S-04: the four runs recorded in `ops/drills/`, each with what paged and which runbook was
   walked; the loop stopped short of the credit floor.
7. Two adversary reports (12.1, 12.2) and the forger's: BROKEN `none`, or fixed.
8. A and S unit tests green.
9. The eleven standing checks.

## Stage 4 · signed when

- A-01 to A-03, S-01 to S-04 green on the tester's record, clean seed.
- The four seam runs in `ops/drills/`, with the runbooks they proved marked *walked*.
- Week 11's carried list empty.

## If it slips

Nothing carries into week 13 — it builds no pages. The plan's order inside this week:

1. **12.3's push** — if the FCM project is late, updates show in-app and push lands in week 13's
   Monday before the migration starts; nothing else in 12.3 waits.
2. **Nothing in 12.1, 12.2, 12.4.** *One investor can never see another, and one side going down
   loses nothing* is what go-live stands on; the seventeen-case smoke pack includes A-01 and S-01.
