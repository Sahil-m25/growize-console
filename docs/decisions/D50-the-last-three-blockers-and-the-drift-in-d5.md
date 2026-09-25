# D50 — The last three blockers closed, and the drift they revealed: five business rules now live outside Zoho, and D5 no longer describes how this system enforces itself

_22 Sep 2026 · closes B-03, B-07, B-08 · amends D5 · adds T14 to the trial · does not reverse anything decided today_

## The three, as decided

**B-03 · Licence-free viewers read through a service token, scoped by our layer** — Jev 0.85,
confidence 0.77. D24's viewers stay licence-free as intended, D21's six-seat Leads org is untouched,
and Plane B logs which human made each read. Zoho's own sharing rules never see these reads, so the
scoping is exactly as good as our layer and no better.

**B-07 · The audit archive is outside the ban, not an exception to it** — Jev 0.70, confidence 0.55.
D45 bans a second persisted store of *record data that screens read from*. An append-only archive of
exported audit entries is neither: it holds audit entries, not records, and no screen reads a record
from it. The rule does not reach it, so nothing needs excepting. *Not archiving at all* scored
**0.00** — the only option across ten blocker choices to score zero. The reasoning belongs in D45
itself, so a future reader who finds a persisted store does not conclude the rule was quietly bent.

**B-08 · Approval is enforced in the console, not in Zoho** — Jev 0.69, confidence 0.54. A request
record, a decision, and the guard in the application layer, because approval processes are
Enterprise-only and the Leads org is Professional.

## What the three of them together revealed

Each is defensible alone. Together they are the third, fourth and fifth business rule to move out of
Zoho, and that is a different thing from any one of them (Jev 0.76).

| Rule | Why it is outside Zoho | Forced or chosen |
|---|---|---|
| The Lost guard — refuse Lost once confirmed money exists (B19) | The money fact is in the other org and no Zoho rule reads across orgs | **Forced** |
| The identity reveal — gate and log a read (D13, D22) | Zoho logs writes, never views. A read cannot be gated or audited by Zoho at all | **Forced** |
| D44 cover windows (B-01, today) | Chosen over a Zoho custom module | **Chosen** |
| Viewer scoping (B-03, today) | Chosen over giving viewers real Zoho identities | **Chosen** |
| Manager approval and extensions (B-08, today) | Chosen over Enterprise, or over approximating approval with a permission | **Chosen** |

**The forced/chosen split is the part that matters** (Jev 0.83). The first two are permanent facts of
the platform and would be true on any edition — accept them as architecture and stop revisiting them.
The last three share a single cause: **Professional lacks record-level sharing and approval
processes.** They were put as three separate questions today and answered three separate times, and
that is how a rule erodes without anyone deciding to erode it.

## D5 is amended, not abandoned

D5 says business rules are enforced in Zoho, and gives the reason: *a rule that exists only in
someone's browser is a rule that vanishes when that person leaves.* That reason still holds, and it
is why this matters rather than being bookkeeping. The amendment is factual, not a change of mind:

> **Amended 22 Sep 2026.** Five rules are enforced outside Zoho. Two are forced by the platform and
> cannot be otherwise on any edition. Three were chosen, all three because the Leads org is
> Professional. A rule enforced in the application layer is only as durable as that layer, is
> invisible to anyone who reaches Zoho directly, and is not covered by Zoho's own audit — which is
> precisely the failure mode D5 was written to prevent. Each such rule must therefore name itself
> here, and the count is the measure of how far the system has moved from the decision.

## The edition question, reopened as a measurement rather than an argument

The edition is not bought. The owner chose to settle it on a trial rather than from documentation.
Asked what should happen given today's three decisions, Jev put **0.82** on adding it to the trial as
an explicit question, 0.17 on moving to Enterprise now, and **0.01 on keeping Professional and
letting the three stand unexamined** — the lowest score anything received in this session.

So: nothing decided today is reversed, and **T14 is added to `trial-org-tests.md`** — measure what
the three chosen rules actually cost to build and to enforce, and decide the edition on that
evidence. Enterprise would close all three at once: record-level sharing carries the cover window and
the viewer scoping, approval processes carry the manager's approval. It also brings concurrency 20
and the sandbox the Leads org currently does not have at all.

## What this does not claim

That Professional is wrong. Three sound decisions were made today and they stand. The claim is only
that they were answered separately, they have one cause, and the cause is still purchasable — so the
question deserves to be asked once, with evidence, instead of five more times in fragments.

**23 Sep 2026 (D51):** Production is Enterprise. Manager approval returns to Zoho as an approval process and cover windows as record-level sharing. Viewer scoping does NOT return automatically — viewers have no identity to share records with — and is now B-11. The edition question this decision reopened (B-10, T14) is closed. Full record: `D51-one-enterprise-org-built-from-the-super-admin.md`.
