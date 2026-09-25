# Stage 1 · Foundation · Week 1 · 07 – 13 Sep 2026

**22 Sep 2026 — do not run this sheet as written.** D45 (zero copy) abolished the Supabase mirror that much of this stage exists to build: 1.5's mapper and allow-list, 1.6's Zoho-to-mirror webhook and the poller behind it, the mirror half of 1.4's write path, the two Supabase projects of D-4, and the gate cases L0-04 and L0-06. **D46** states what each of those becomes and what replaces it — read it before this sheet. Rewriting this sheet against D46 is its own job and has not been done.

**23 Sep 2026 — and it is now one Enterprise org (D52).** Leads and investors live in one org, on Enterprise, production included (D51). So 1.10's one-org test no longer decides anything — D23 is decided, and T11 becomes the attack on the chosen wall, run before real investor data enters — and D-1b's licence decision, the edition test and every *both projects* and *each org* here are settled or gone. The handover as code, the cross-org seam and week 5's handover work no longer exist: at *said yes* a Contact is created by a same-org upsert and the Lead carries on to Onboarded (D11, D52), so 1.7's outbox has nothing to carry and is void with the mirror. Every human signs in to a full Enterprise seat on their own token (D53): 1.3's licence-free viewer, its backend refusal under the old CLAUDE.md rule 2 and 1.5's masked viewer reads are gone with D24, and the integration user does background work only, never a screen. The full rewrite of this sheet is tracked as **A-04** in `docs/CARRY-FORWARD.md` and has not been done; until it lands, read D52 and D53 alongside D45 and D46 before any task here.

Read `docs/stages/README.md` first. Then this. Then only what this names.

## What the stage delivers

One week. *Sign-in, the plumbing, and one decision proved.* From the plan: *one fact travels the
whole path and comes back complete — and the org question is answered with evidence rather than
opinion.* Everything the twelve console pages of stage 2 stand on exists by Friday; nothing that a
page would show does.

**Stage 1 is signed when:** the L0 cases are green on the tester's record, the one-org test has an
answer written as a decision, and the licence has been renewed on that answer. There is no separate
demonstration — the Friday demo line below is it.

**Decisions this stage stands on:** D01, D03, D04, D06, D13, D17, D19, D22, D23, D24.
**Build Book:** §1 (the one rule, the conventions), §2 (the lifecycle and the roles), §3 (systems and
topology), §11 (the event contracts), §17 phase 0 (*the first day's work*), §23 (the repository —
read before scaffolding), §24 (the diagnostic), §25 (how the agent works), Appendix C (*what an
agent builds, and through what* — the MCP calls and CLI steps for each layer).
**Test Book:** L0 — ten cases, fourteen unit tests. Two of them (L0-01, L0-04) are also in the
seventeen-case go-live smoke pack, so they are written to be re-run in week 13 unchanged.

| Case | Proves |
|---|---|
| L0-01 | An IR signs in with their own Zoho account and lands on their own day |
| L0-02 | A manager sees the team; an IR cannot see another IR's lead by guessing its address |
| L0-03 | Deactivating a person ends their access before their session would have expired |
| L0-04 | One fact travels portal → Zoho → mirror and comes back complete |
| L0-05 | A retried save does not create two records |
| L0-06 | The mirror never receives a field nobody allowed |
| L0-07 | The outbox retries, then dead-letters, and says so |
| L0-08 | Stopping the job runner pages somebody |
| L0-09 | An unsigned or replayed call to the inbox is refused |
| L0-10 | The console is usable on a phone |

**The three jobs this week, from the plan's sixteen:**

| Job | Way | Fires when | Writes | How we know it ran |
|---|---|---|---|---|
| Zoho Leads org → leads database | in | a record edited in Zoho's own screens | the lead mirror | the nightly reconcile compares both sides (week 6); until then, the poller behind it |
| The outbox worker | out | any fact this side must send | the other side's inbox | an **age and order alarm, every five minutes** |
| The heartbeat | job | every job, on completion | a monitor outside our systems | silence pages a phone — *the alarm that survives our own outage* |

*A webhook fires once and is never retried by the sender. So every inbound webhook has something
behind it that does not depend on it.* This week that something is a poller.

## The date that does not move

The plan's own line, under *what we need from outside*: **Zoho — this week — the licence renewed
and the seats bought — it lapses on Sunday 13 September — with the fifteen-minute edition test in
the same sitting.** The org record confirms it: one Enterprise seat, `paid_expiry
2026-09-13T05:30+05:30`.

READY-TO-BUILD says *wait for the week-one org test before buying seats*. The plan gives the org
test to the tester, and the tester works Saturday and Sunday. That leaves two honest orderings and
no third:

- **A.** The tester runs the org test **Saturday morning**, first thing, before L0. The decision is
  written Saturday. Sahil renews and buys seats Saturday afternoon on that decision, and runs the
  fifteen-minute edition test (§25's *Professional or Enterprise for the Leads org*) in the same
  sitting.
- **B.** Sahil runs the org test himself **by Friday**, the decision is written Friday, and the
  renewal, the seats and the edition test happen Friday. The tester re-runs the org test Saturday
  as a case, for the record.

Pick one on the first day you read this and write it in `SESSIONS.md`. Do not leave it to Friday.

## Before any code — the accounts and the answers

These are not code and the agent does not do them. They gate everything below. Fill the last column
in this file as each one lands; the verifier reads it on Friday.

| # | What | Who | Where it goes | Landed |
|---|---|---|---|---|
| D-1 | Zoho **trial** org(s) — the sandbox for the org test; not seats, not yet | Sahil | `zoho/README.md` notes the org ids | |
| D-1b | The licence decision — see above; made on the org-test result, before Sun 05:30 | Sahil | a decision file via `/decide` (closes D23; applies D20) | |
| D-2 | Zoho OAuth self-client per app per org — client id, secret, redirect URIs. **`accounts.zoho.in`**, not `.com`; the wrong datacentre is a half-day lost | builder | the vault, by the names in `.env.example` | |
| D-3 | The **integration user** — its own seat, its own refresh token; it never acts as a human (D17; §2 roles table, last row) | Sahil | vault | |
| D-4 | Two Supabase projects, **leads** and **investors** — same region as the users; service keys | builder | vault; project refs in `db-*/README.md` | |
| D-7 | An off-platform heartbeat monitor account — never inside either Supabase project (Q25) | builder | vault | |
| D-8 | Two test mailboxes and two test mobiles that can receive OTP — L0 needs these on day one | Sahil | vault; fixtures name them as TD personas, never by real number | |
| D-11 | The secrets vault (or GitHub Actions secrets) and who holds the master; `.env.example` lists every name, no value ever enters git | Sahil | — | |
| D-12 | This repo on GitHub, the tester added as a reader, branch protection on `main` | Sahil | — | |
| Q20 | The counsel meeting **booked** — *start now, needed week 13*; gates go-live, not the build | Sahil | `docs/OPEN-QUESTIONS.md` row Q20 | |
| eMudhra | Sales contact opened — *start now, needed week 5*; week 5 needs the sandbox only | Sahil | `docs/OPEN-QUESTIONS.md` row Q18 | |
| A | The eleven Class A defaults, one sitting, ~30 minutes: Q3, Q4, Q5, Q6, Q10, Q11, Q12, Q17, Q21, Q22, Q23 — *yes* to each, or a decision file | Sahil | `docs/OPEN-QUESTIONS.md`; `/decide` for any *no* | |
| A+ | The Finance seat: one shared login, or two named seats (D22: one seat per human inside Finance, so the audit log names a person) | Sahil | `/decide` if one; nothing if two | |

Weeks 1–3 do not stop for Class A if it is late. Week 4 does. Everything in D-* stops the week.

## The order

Dependencies, not days. Allocate days yourself; keep the order.

```
1.1 scaffold ──► 1.2 migrations ──► 1.4 write path ──► 1.6 Zoho→mirror webhook + poller ──► 1.7 outbox ──► 1.8 heartbeat
                       │                 ▲
                       │                 │
                       └──► 1.3 sign-in ─┘        1.9 field names ──► 1.5 read path + mapper
                                                   1.10 the one-org test (independent — Zoho sandbox only)
```

Every task is marked **build** or **evidence** (headroom on or off — README) and, where it is one,
**seam** (the adversary runs on it).

---

### 1.1 · Scaffold the workspace — build

**Owner:** builder alone. **Agents:** none. This is the ladder's first rung: nothing exists that a
week-1 task does not need.

**Read:** §23 — the layout is decided; you are not designing it. The directories already exist:
`console/`, `portal/`, `app/`, `db-leads/{migrations,functions,seeds}`, `db-investors/{…}`,
`contracts/`, `zoho/{leads,investor}`, `ops/`, `tools/`. Fill them; do not move them. Appendix C —
*functions, webhooks, jobs: `supabase functions deploy`; pg_cron with pg_net for the runner (never a
long job in a function — §22).*

**Do:**
- TypeScript throughout (decided). One package manager, one lockfile, one test runner for the whole
  repo. One `tsconfig` base that the packages extend.
- `console/` and `portal/` as the two portal apps; `db-leads/functions/` and
  `db-investors/functions/` as where the webhook receivers and jobs live (§23).
- Wire `.env.example` — every name it lists is read from the environment by name; nothing else is.
- The contract validator: one function that validates an event against its schema in `contracts/`
  by name and version, used at both ends (emit and receive). Thirty schemas already exist; the
  `_envelope.json` is the outer shape.
- CI: the existing `.github/workflows/checks.yml` runs the test runner and the contract validator
  over `contracts/`. Do not add a second workflow.

**Don't:** a UI kit, a state library, an ORM, a component library, a mono-repo tool with its own
opinions, a linter config that argues with the one already there. If you want one, ask the ladder
rung 4 first — what does the platform already do — and rung 6 — is it one line.

**Done when:**
- `git ls-files | wc -l` grows and every new file is under one of the directories above. `RAN`.
- The test runner runs with **zero tests and exits 0**. `RAN`.
- The contract validator rejects an event with an extra field and accepts every schema in
  `contracts/` against a minimal valid instance (write one fixture per schema; that is the first
  test). `RAN`.
- `graphify update tools/graphify` shows node count above 911 — the graph sees the new modules.
  `RAN`.

---

### 1.2 · The leads database — migrations — build

**Owner:** builder. **Agents:** **planner** ×1 before (it crosses the mirror seam and touches every
later task); **reviewer** in the day's batch.

**Read:** D03 (Supabase is the read model; two projects), D04 (write-through), D13 (encrypted
identity in Zoho behind field-level security), D24 (a seat to write, never to read), rule 7
(*identity is unreadable by opening a record*), Q26 (pg_cron with pg_net in batches), §3 (where each
fact lives and who writes it — the leads mirror's rows are in it). Appendix C — *Supabase schema and
policies: `supabase db diff / push`; MCP `apply_migration`, `execute_sql`, `get_advisors` for the
security and performance lints — and a person reads the advisor output before it ships.*

**Do:**
- Every table the twelve console pages stand on, from §3 and the console sections, as files in
  `db-leads/migrations/`. Numbered, forward-only, each one a single concern.
- **The allow-list.** The set of Zoho field names that may cross into the mirror, as a named artefact
  the mapper imports. Identity fields — PAN, bank account, Aadhaar, address, signature — are **not in
  it**, and there is no column for them to land in. (L0-06, L1-05.)
- RLS: reads open to portal identities by role (an IR sees their own, a manager their team's, a
  viewer the masked set — §2's roles table); writes closed to everyone except the write path's role
  (D04, D24). Not a hidden button — a policy.
- `pg_cron` and `pg_net` enabled; a `jobs` schema for the outbox and the poller to live in.
- The three reversal events (D19) have somewhere to land: whatever tables carry a gate carry its
  closed-by-reversal state.
- Seeds: the ten personas TD-01 to TD-10 and nothing that looks real.
- Run `get_advisors` on the project after the migrations apply; every security finding is fixed or
  written to the register before Friday.

**Don't:** a column "for later". A column named `pan`, `aadhaar`, `account_no` anywhere in the
leads project. A schema change made in the Supabase dashboard — every change is a migration file
(CLAUDE.md), and the verifier checks for columns no migration creates.

**Done when:**
- From an empty local database, the migrations apply in order with no error. `RAN`.
- `grep -riE "pan|aadhaar|account_no|ifsc|address" db-leads/migrations/` returns nothing but the
  allow-list's own definition, where those names appear only as *excluded*. `RAN`.
- The allow-list artefact exists and the mapper (1.5) imports it by name — no second list. `RAN`.
- RLS is on for every table; a viewer identity's `INSERT` on any table fails at the policy. `RAN`.
- `get_advisors` security lints: zero unaddressed. `RAN`, output shown.

---

### 1.3 · Sign in — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer** in the day's batch; **adversary**
×1 after SHIP.

**Read:** D06 (staff sign in with Zoho OAuth 2.0; per-user tokens), D24, D22 (the session must be
able to carry a step-up later — stage 3 adds the eight actions), the *Who signs in* table in the
plan and §2's roles: IRs and the manager on Zoho seats; Jhalak and the founder/tech/marketing/BU/ops
on **portal login only, no Zoho seat**. Appendix C — *Auth: configured, not built: providers,
custom SMTP, magic-link templates; the Zoho OAuth client per app per org.*

**Do:**
- Zoho OAuth 2.0 authorisation-code flow, **`accounts.zoho.in`**, for both `console/` and `portal/`.
  The person's own token, stored per user, refreshed per user — never the integration user's (D17).
- A session that carries: who, which org, which Zoho profile and role, seat or viewer.
- The menu each person sees derived from that profile and role — not from a config file that could
  drift from Zoho.
- The **viewer** identity: portal login with no CRM seat, per D24 and D06 — read D06 for the route;
  if it is silent on the mechanism, the default is the same OAuth against a Zoho account that holds
  no CRM licence, and you write that as a decision.
- **Every write endpoint refuses a viewer identity in the backend** (CLAUDE.md rule 2). The check is
  one function, used by every write route, tested once for all of them.
- **Deactivation ends access before the session would have expired** (L0-03): the session check
  reads the person's current state on every request; a token issued while they were active is not
  trusted after they are not. Zoho's notification (1.6) or the poller carries the deactivation into
  the mirror; the session check reads the mirror.
- **Usable on a phone** (L0-10): the sign-in and the shell of the console render on a phone; the
  desktop layout is the prototype's, untouched.

**Don't:** a local password. A shared login. A "remember me" that outlives the Zoho token. A role
check in the front end only. A session TTL as the deactivation mechanism.

**Done when:**
- L0-01: an IR signs in with their own Zoho account and lands on their own day. `RAN` on the test
  environment, persona named.
- Three personas — an IR, the manager, a viewer — see three menus. `RAN`.
- A viewer's `POST` to every write route on the sheet returns 403 from the backend, with the front
  end not involved (curl, not click). `RAN`.
- L0-03: deactivate TD-IR-2 in the sandbox → their next request is refused. `RAN`, with the time
  between the deactivation and the refusal (the poller's interval at worst).
- L0-10: the sign-in and shell on a phone viewport. `SAW`.
- The adversary's report: BROKEN `none`, or every BROKEN item fixed and re-reviewed. `SAW`.

---

### 1.4 · The write path — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer** in the day's batch; **adversary**
×1 after SHIP, shared with 1.5 (they are one seam: the mirror boundary).

**Read:** §1 *the one rule* — *Zoho is where a fact is written; Supabase is where it is read; the
portal writes Zoho as the signed-in person and writes the mirror from Zoho's answer in the same
request; the investor app never touches Zoho; nothing is written in two places by two hands.* D01,
D04, D17, rule 1, rule 9 (*every clock is computed in Asia/Kolkata from the event, by one
function*), §11.

**Do:**
- One request from the portal: write to Zoho **as the signed-in person** with their token → take
  Zoho's response → write the mirror **from that response**, through the mapper (1.5), never from the
  request body. The mirror never knows a fact Zoho does not.
- Idempotency on the request: a retry makes one record (L0-05). The key travels with the request;
  Zoho's own duplicate rules are rung 4 — use them before you write any.
- The clock: one function, `Asia/Kolkata`, from the event's own timestamp. Every `now()` in this path
  goes through it.
- If this path emits an event, it is a schema in `contracts/` first (declare before emit), and it
  goes through the outbox (1.7), never straight out.

**Don't:** write the mirror from the form. Write Zoho as the integration user because the person's
token was awkward. Compute a date anywhere but the one function.

**Done when:**
- L0-04: create a lead in the portal → the record is readable from Zoho's API **and** in the mirror
  **within the same request's response**. `RAN`, with the Zoho record id and the mirror row id in
  the output.
- L0-05: two identical requests → one Zoho record, one mirror row. `RAN` with the counts.
- `grep -rn "new Date()\|Date.now()\|now()" console portal db-leads/functions` returns only the one
  clock function. `RAN`.

---

### 1.5 · The read path and the mapper — build · **seam** (with 1.4)

**Owner:** builder. **Agents:** **reviewer** in the day's batch; **adversary** — the one from 1.4,
told this task is in scope, and told to try the export and report doors here in particular, and
L0-02's door: *guess another IR's lead by its address*.

**Read:** D03, D13, D24, rule 7, §2's roles (*reads*, *never* columns), and the allow-list you
defined in 1.2.

**Do:**
- Reads come from the mirror and nowhere else (D03, D24). No read route touches Zoho.
- The mapper Zoho → mirror is a pure function of (Zoho record, allow-list). A field not on the list
  does not cross; there is no "pass-through" branch. (L0-06.)
- Reads are **scoped by the session's identity in the policy**: an IR's read cannot return another
  IR's lead no matter what the page asks for; a manager's returns the team's; a viewer's the masked
  set. A lead outside scope is *not found*, not *forbidden* — the response does not reveal that the
  record exists. (L0-02.)
- Masked reads for the viewer identity: what §2 says a viewer sees, and nothing more.
- The first read routes the week-2 pages will need (My day, Leads, Profile) — the shape only, not the
  pages.

**Don't:** a read that falls back to Zoho when the mirror is behind. A mapper with a default case
that copies unknown fields. A masking rule in the front end. A `WHERE owner = ?` in the page's code
with the policy left open underneath.

**Done when:**
- The set of mirror columns equals the set of allow-list `mirror_column`s — a script diffs them and
  prints nothing. `RAN`.
- L0-06: a Zoho record fixture carrying a PAN and a bank account, passed through the mapper,
  produces a mirror row with neither, and the mapper does not throw — it drops. `RAN`.
- L0-02: as TD-IR-1, a read of a lead id owned by TD-IR-2 returns 404, not 403, not the record; as
  the manager, the same id returns the record. `RAN`.
- The adversary's export and report doors: no identity field reachable through any read route by any
  persona. `SAW` — its report.

---

### 1.6 · Zoho → leads mirror — the webhook, and the poller behind it — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 on the timing
door and on L0-09 after SHIP.

**Read:** D04, rule 8, D19, `ops/runbooks/webhook-stopped.md` — it exists; the design already knows
this webhook will stop. Appendix A segment **SE** (*the seam — outbox, webhooks, idempotency*, 12
modes) — read the modes before writing the receiver; each one is a test.

**Do:**
- A receiver in `db-leads/functions/` for Zoho's notification: records edited in Zoho's own screens
  land in the mirror, through the same mapper (1.5). Idempotent on Zoho record id + `Modified_Time`.
- **The inbox refuses an unsigned or replayed call** (L0-09): the notification's signature is
  verified; a replay (same id, same time, already applied) is acknowledged and applied nowhere.
- **The poller behind it:** on `Modified_Time` with a cursor, on `pg_cron` (Q26), that would catch
  every change the webhook missed if the webhook never fired again. It uses the same mapper. Its
  interval is written in the runbook.
- Both ping the heartbeat (1.8) on every run, including the runs that found nothing.

**Don't:** a receiver that writes the mirror from the notification payload without re-reading the
record (the payload is a hint, the record is the fact). A poller that shares state with the webhook
beyond the mirror itself. A receiver with no signature check "because the URL is secret".

**Done when:**
- Edit a record in Zoho's UI → the mirror row changes. `SAW`, with the two timestamps.
- Disable the webhook in Zoho → edit → the poller updates the mirror within its interval. `SAW`.
- Deliver the same notification twice → one change, one version. `RAN`.
- L0-09: an unsigned call → refused; a replayed call → acknowledged, nothing changes. `RAN`.
- The adversary's timing door: out-of-order and duplicate deliveries leave the mirror equal to Zoho.
  `SAW` — its report.

---

### 1.7 · The outbox worker — build · **seam**

**Owner:** builder. **Agents:** **planner** ×1 before; **reviewer**; **adversary** ×1 on the timing
door after SHIP.

**Read:** §11, rule 5 (*one consequence, one actor*), Q26, `ops/runbooks/outbox-stuck.md` — read the
runbook before writing the worker; it describes the failure the worker must make visible. Appendix A
segment SE.

**Do:**
- An `outbox` table in the `jobs` schema (1.2): every fact this side sends is a row first — event
  name, version, payload validated against `contracts/` **on insert**, ordering key, attempts,
  next-attempt-at, dead-lettered-at.
- A runner on `pg_cron` in batches (Q26): picks in order, delivers once, retries with backoff, and
  after the runbook's number of attempts marks the row dead-lettered and **stops retrying it** —
  visibly, not silently (L0-07: *the outbox retries, then dead-letters, and says so*).
- In order means in order per ordering key, not globally; the key is on the row.
- **The age and order alarm, every five minutes** (the plan's *how we know it ran*): a check that
  the oldest undelivered row is younger than the threshold and that no key has a delivered row newer
  than an undelivered one. It pings the heartbeat too.
- The runner pings the heartbeat every run.

**Don't:** deliver from the request that created the row. Retry forever. Dead-letter quietly. A
second runner.

**Done when:**
- Under a forced delivery failure, rows for one key are delivered in insertion order after the
  failure clears; rows for another key were not held up. `RAN` with the order printed.
- L0-07: a row whose delivery always fails is dead-lettered after N attempts, N from the runbook, and
  the dead-letter is visible (the query the runbook names returns it). `RAN`.
- An insert with a payload that fails its contract schema is refused at the table, not at the
  runner. `RAN`.
- The age-and-order check exists on `pg_cron` at five minutes and fires on a planted stale row.
  `RAN`.
- `graphify explain "outbox"` names the runner, the table, the validator and the alarm as one
  community. `RAN`.

---

### 1.8 · The heartbeat — build

**Owner:** builder. **Agents:** **reviewer** in the day's batch. No adversary; the test is a phone.

**Read:** rule 8, Q25, `ops/runbooks/heartbeat-silent.md`, D-7 above. D19 — *a heartbeat that lives
elsewhere*.

**Do:**
- Every job — the poller (1.6), the outbox runner and its alarm (1.7), and every job that follows in
  later weeks — pings the external monitor at the end of every run, success or not. One helper;
  every job calls it.
- The monitor's silence threshold is the job's interval plus a margin, from the runbook. Silence
  pages a phone — Sahil's, this week; week 6 wires two phones with a thirty-minute escalation.
- The *dead-man* property: nothing inside our systems is what raises the alarm. If both Supabase
  projects are down, the phone still rings.

**Don't:** a heartbeat that runs on a Supabase cron and checks the other jobs. A ping that fires
before the job's work is done.

**Done when:**
- L0-08: stop the outbox runner → the phone rings within threshold. `SAW` — the alert, with its time
  and the stop time; who saw it.
- Every job in `db-leads/functions/` calls the helper: `grep -rL heartbeat db-leads/functions/*`
  prints nothing. `RAN`.

---

### 1.9 · The Zoho field API names — evidence

**Owner:** builder. **Agents:** **scout** ×1 — *what fields does each trial org's Leads module carry,
by API name and type* — through the Zoho MCP (`getFields`, `getModules`, `getLayouts` — Appendix C),
not by reading screens.

**Read:** CLAUDE.md — *every Zoho change is an export committed under `zoho/`*; READY-TO-BUILD —
*the exact `Field_API_Name` strings are produced by the builder in week 1 and committed as
`zoho/leads/fields.json` and `zoho/investor/fields.json`.* Appendix C — *the whole org exported
through Setup → Data Administration → Export customisation and committed.*

**Do:** produce both files from the trial orgs' metadata. Every field §3 names must exist in the org
or be created **in the org** (`createFields` — a Zoho change), then exported. The allow-list (1.2)
references these names, and a script proves each one resolves.

**Don't:** hand-type a field name. Guess an API name from a label — `Bank_Account` and
`Bank_Account_1` are both real answers.

**Done when:** both files committed; `git log -- zoho/` shows them; the allow-list check script
prints nothing. `RAN`.

---

### 1.10 · The one-org test — evidence · **the tester's**

**Owner:** the **tester** runs it (the plan is explicit). The builder prepares the sandbox and the
plan. **Agents:** **adversary** ×1 — *not* against code: told to **write the four-door attack plan
as a checklist the tester can run by hand**, from D23, D13 and §25's edition table, with a *held /
broke* box per line.

**Read:** D23 (settled by this test), D13, D20, Q15 (does Professional carry field-level security —
*two of these Zoho contradicts itself on*, §25), Q16 (can a Team user carry a KAM's day — prove on a
trial seat, API access included), Q29. Appendix A segment **HO** (*handover and identity*, 11 modes)
— the doors are drawn from these.

**The test, from the plan:** build the identity wall inside a single Zoho org in the sandbox — field
permissions that hide a PAN and a bank account from a leads profile — and try to break it from every
door: the screen, the API, an export and a report. If it holds, leads and investors live in one org
and Zoho's own Lead-to-Contact conversion replaces the handover code in week 5. If it does not, we
stay on two orgs as designed.

**Do (builder, by Thursday):** the sandbox org(s) exist (D-1); a leads profile and an investor
profile with the field permissions set; two test PANs and two test bank accounts that are obviously
fake; the attack checklist printed. Run **Q15 and Q16 on the same sandbox, the same day** — and the
**fifteen-minute edition test** (§25: *create an encrypted field and a field-permission rule, and try
one approval process, in a Professional trial*) — four answers from one day.

**Do (tester, per the ordering chosen above):** every line of the checklist, every door, with a
screenshot or an API response per line.

**Do (Sahil, on the result):** `/decide` — D23 closes as *one org* or *two orgs*; Q15, Q16 get their
rows in OPEN-QUESTIONS filled; D20's edition per org is now a fact. Then the licence and the seats,
before Sunday 05:30.

**Don't:** let the builder run the doors and call it the test. Renew before the answer. Use a real
PAN in the sandbox because it is "just a sandbox".

**Done when:**
- The checklist exists, one line per door per field per profile, with the request or click spelled
  out. `SAW`.
- The sandbox is ready and the readiness is noted in `zoho/README.md` with the org id. `SAW`.
- The run is **scheduled** in `SESSIONS.md` (ordering A or B) — by Friday's gate. The **result** is
  a decision file — by the gate of whichever day the ordering names. `SAW`.

---

## Friday · the handover

In the README's order. For this week specifically:

- **test-writer** ×1: L0-01 to L0-10 → **fourteen** unit tests, named by case. The cases that are a
  person's to observe (L0-08 the phone; the org test) are NOT COVERED with that reason, and the
  count still reaches fourteen on the rest, or the test-writer says why not.
- Deploy `console/` and `portal/` sign-in and the ground to the test environment.
- The handover note. LOOK AT: the viewer's write refusal, the mirror after a duplicate webhook, and
  the dead-letter.
- `graphify update tools/graphify --no-cluster && graphify cluster-only tools/graphify`. `/save`.
- **verifier** ×1, alone.

What you show on Friday: *sign in with your own Zoho account and watch a record appear in Zoho and
in the database in the same second.*

## Saturday, Sunday · the tester

L0 — ten cases, above. Plus the one-org test, first thing Saturday if ordering A.

## The gate

Answered by the verifier, each line `RAN`, `SAW` or `NOT MET`.

1. Every D-* row in *Before any code* is landed, or the week is open. Q20 is booked; eMudhra is
   contacted. Class A is done or dated.
2. The ordering for the one-org test (A or B) is written in `SESSIONS.md`, and the licence renewal is
   dated before Sun 13 Sep 05:30 IST against it.
3. From an empty database the migrations apply clean, and `get_advisors` has no unaddressed
   security finding.
4. No identity column exists in the leads mirror; the allow-list is the only place those names
   appear, as exclusions. (L0-06)
5. L0-01: three personas sign in and see three menus; a viewer's POST to every write route is 403
   from the backend. L0-03: a deactivated person's next request is refused. L0-10: it works on a
   phone.
6. L0-04, L0-05: one request creates one Zoho record and one mirror row; two identical requests
   still make one.
7. L0-02: another IR's lead by address is *not found*; the manager's read of the same id succeeds.
8. A Zoho-side edit reaches the mirror by webhook; with the webhook off it reaches by poller; a
   duplicate delivery changes nothing. L0-09: unsigned refused, replay inert.
9. L0-07: the outbox delivers in order per key under failure, and dead-letters visibly after N; the
   five-minute age-and-order alarm exists and fires on a planted row.
10. L0-08: stopping the runner rang a phone — who saw it, when.
11. `zoho/leads/fields.json` and `zoho/investor/fields.json` are committed and every allow-list name
    resolves.
12. The one-org attack checklist exists and the sandbox is ready.
13. Fourteen unit tests named by L0 case are green, or NOT COVERED explains each short one.
14. The eleven standing checks in the verifier's definition.

## Stage 1 · signed when

- The tester's record shows L0-01 to L0-10 green on the clean seed (the org test counted as its own
  line).
- D23 is closed by a decision file, and Q15, Q16 have answers in OPEN-QUESTIONS.
- The licence is renewed and the seats bought at the edition the answer implies (D20), before
  Sunday 05:30, and `SESSIONS.md` says so.

## If it slips

Week 2 is *screens over the week-one plumbing* — it builds no plumbing. So nothing here can move
into week 2 without week 2 moving. What can give, in this order, and only this order:

1. **1.8's paging** — if the monitor account (D-7) is not there, the helper and the pings exist and
   the phone is wired on Monday of week 2, first thing, before fix-first. L0-08 runs then. Write it.
2. **1.9's investor file** — `zoho/investor/fields.json` can land in week 2; the leads file cannot.
3. **Nothing else.** 1.1 to 1.7 are the ground. If the ground is not there on Friday, Friday is not
   the end of the week; Saturday's tester run is partial and says so, and Monday's fix-first is a
   build day on this sheet, not on week 2's.

The one thing that does not slip under any ordering: the org test's answer, and the renewal on it,
before Sunday 05:30.
