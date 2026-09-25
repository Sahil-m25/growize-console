# D51 — One Enterprise org, production included, built outward from the super admin — and if D23's identity wall holds, the cross-org machinery goes away

_23 Sep 2026 · the owner's call · closes B-10 and supersedes T14 · amends D02, D20, D23, D46, D49, D50 and D5's count · every judgment below was put to Jev (`jev-1.13.0`) first_

## What was decided

Development runs on **one Zoho CRM org, on Enterprise**, starting from the super admin account alone,
with further users added as the build reaches them. **Production is Enterprise too.** And **one org is
the intended answer**, not a development convenience — conditional on D23's identity-wall test.

## Production must be Enterprise, or development must pretend it isn't — Jev 0.99

The most confident result of any judgment put to Jev on this build. Code that relies on approval
processes, custom functions, record-level sharing, a sandbox or concurrency 20 either fails or silently
does nothing on Professional. Developing on Enterprise and shipping on Professional would be T1's trap
run in reverse, discovered in production. Production is Enterprise, so the trap is closed. **B-10 is
closed and T14 is superseded** — the edition question it existed to measure is answered.

## The super admin is where the build starts, not what it tests against

Two guardrails, both put to Jev:

**A restricted test user exists before any permission-sensitive code is written** (Jev 0.93). The
Administrator profile is not constrained by field-level security, profile restrictions or role
scoping. Every permission-dependent defect — a PAN withheld by D13, a lead hidden by a D44 cover window,
a bounded profile that cannot write what the code expects — stays invisible to an administrator and
surfaces the first time a real IR signs in. One user on an IR profile, created before the first line
that reads an identity field or scopes a book, catches all of it. The two test mailboxes already on
Class D's list are for exactly this.

**The super admin never doubles as a service identity or as D17's integration user** (Jev 0.87).
Otherwise the bounded write profiles are never exercised, and every action in the audit trail carries
the owner's name — which is D22's shared-login objection arriving by a different door.

## One org is the answer, if the wall holds — Jev 0.89

D02 split Leads and Investor into two orgs for one reason: to keep IRs away from investor identity data.
D23 said that question is settled by a test, not an argument — the wall attacked from four doors inside
a single org. That test is **T11**, and it is now the most consequential test in the trial, ahead of
everything but T1.

**If T11 holds**, D46's cross-org credential and D49's two bounded service identities are **not
needed at all**. There is no second org to reach. The twenty facts the contracts describe as crossing —
nine one way, eleven the other — become ordinary writes inside one org, and "who writes into the other
org" stops being a question. That removes the hardest part of the architecture this build has.

**If T11 fails**, the split goes ahead exactly as D46 and D49 describe, and the reason is written down.

## What moves back into Zoho — and one correction

D50 recorded five business rules living outside Zoho: two forced by the platform, three chosen because
Professional lacked record-level sharing and approval processes. With production on Enterprise
(Jev 0.81 that they should return):

| Rule | Under Enterprise |
|---|---|
| Manager approval, extensions (B-08) | **Returns to Zoho** as an approval process |
| D44 cover windows (B-01) | **Returns to Zoho** as record-level sharing — IRs hold identities, so Zoho can scope them. The share is added when a cover window opens and removed when it closes, which needs automation at the window boundaries; custom functions, Enterprise-only, can carry it. The Share Records API is added to T11 to confirm |
| Viewer scoping (B-03) | **Does not return automatically.** See the correction below |
| The Lost guard | Stays outside — forced. The money fact is in another org, or, if T11 holds, in the same org and then it *can* become a validation rule |
| The identity reveal | Stays outside — forced on every edition. Zoho logs writes, never views |

**The correction.** When this was put to the owner, viewer scoping was listed alongside cover windows
as something record-level sharing would carry. That was wrong. Record-level sharing scopes *users who
have identities*, and D24's viewers deliberately have none — B-03 chose to keep them licence-free and
read through a service token. Viewer scoping can move into Zoho **only if the viewers get seats**, and
Enterprise does carry the cheap one: **Lite Users**, Enterprise and Ultimate only. That would reverse
B-03, cost a licence per viewer, and give Zoho native scoping and native attribution of every read.
It is recorded as B-11, the owner's call, not assumed.

**D5's count, therefore:** from five rules outside Zoho to three — the two forced ones, and viewer
scoping until B-11 is decided. And if T11 holds, the Lost guard can become a Zoho validation rule,
because the money fact would then live in the same org as the lead: **two**, or with Lite Users, **one**.
The one that can never move is the identity reveal, because Zoho does not see reads.

## What this does not settle

T11 has not been run. Until it has, D46 and D49 stand as the design, conditional. The trial's order is
now: **T1** (confirm the org really is Enterprise), **T11** (the identity wall — decides one org or
two), **T2** (whether COQL is gated — less likely on Enterprise, still worth one call), **T6** (field-
level security, which D13 rests on), then the rest.

**23 Sep 2026 (D52):** T11 is no longer the decider — the owner chose one org. It remains the attack on the design before real data. Staff seats are Enterprise; Professional seats cannot exist inside an Enterprise org. Full record: `D52-one-enterprise-org-for-leads-and-investors.md`.
