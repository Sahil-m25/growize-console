# D49 — Four blockers closed: two bounded cross-org identities, console state split by what it actually is, a dedicated touch object, and the fifteen-minute undo dropped

_22 Sep 2026 · the owner's calls, taken against a Jev distribution per option · closes B-01, B-02, B-04, B-05 in `CARRY-FORWARD.md` · corrects D46 further · changes a stated requirement in B20_

Each was put as a typed Choice to TypeSafe's Jev (`jev-1.13.0`), which returns a distribution across
the options rather than a verdict. The numbers below are that distribution. **Three of the four went
with it; one deliberately did not, and that one is the most interesting.**

## B-05 · Two bounded service identities — Jev 0.88, confidence 0.83

Twenty facts cross between the orgs: nine written into the Investor org from the Leads side, eleven
the other way. **One service identity per org**, each on a profile permitted to write only the named
fields and nothing else — not a general write, and not a read for browsing.

Attribution survives where it matters. The human's name sits in the org where they *acted*: Finance
confirming money is attributed in the Investor org, and the `money.confirmed` field written onto the
lead is a **projection** of that act, not a claim that a service account decided anything. One fact,
one writer holds: the two sides share a record and never a field.

This is the third correction to D46, which specified one credential, read-only, one direction.

## B-01 · Split the state by what each thing actually is — Jev 0.72, confidence 0.62

Cover windows and availability are **authority facts about people**, not record data, so they go to
D47's Plane C. Notification read-state is a per-viewer convenience and lives in browser storage. The
console's LOG is Plane A's archive. **Nothing new in Zoho, and no custom module spent.**

**The price, stated plainly because it is real.** A cover window enforced in Plane C is enforced by
our permission layer, not by Zoho. An IR holds a Zoho seat and a per-user token — they must, in order
to write — so an IR who opens Zoho directly is not bound by D44's cover window. On Professional there
is no record-level sharing and no data-sharing rules to fall back on; ownership and the role hierarchy
are the only Zoho-side scoping available. This is acceptable **only** because the console is the
sanctioned interface and staff are not expected to open Zoho. It is a policy boundary, not a
technical one, and D40's explicit-access rules do not reach across it. The runner-up option (0.24)
put cover windows in Zoho precisely to close this, and it remains the thing to revisit if anyone ever
works outside the console.

## B-02 · A dedicated touch object — Jev 0.67, confidence 0.50

Jev leaned here without conviction; the distribution was genuinely spread. A custom module written
**only by explicit human action**, so rule 6 holds by construction rather than by remembering to set
a flag at thirty write sites. Automated sends land in Zoho's own related lists and are simply never
counted, because they are not in this module at all.

Custom-module budget after this and B-01: events, touches, paper, payment claims, plan — **five**.
Professional's allowance is published as about 25 but Zoho's pages contradict each other, so T4 in
`trial-org-tests.md` still has to confirm it.

## B-04 · The fifteen-minute undo is dropped — Jev 0.50 on a different option, confidence 0.33

**The owner chose against Jev's plurality, and the reasoning holds.** Jev's distribution here was
flat — three options within 0.29 of each other at confidence 0.33 — which is not a recommendation,
it is a model saying it cannot call this.

The window is removed. The typed confirmation is the guard, and a mistake is corrected through the
**reversal path D19 already requires to exist**. No pending write is held anywhere, so nothing can be
lost by a refresh, and the durability problem the TypeSafe pass found in D41's in-memory queue simply
stops applying to this flow.

**This changes a stated requirement.** B20 in `ir-console-workflow-review.xlsx` reads *"a typed
confirmation, fifteen minutes to undo, then the investor record created once with its ARL code
written back"*. The fifteen minutes comes out; the typed confirmation and the exactly-once creation
stay, and exactly-once still rests on upsert's duplicate check rather than on our retry logic. The
workbook row and the acceptance path *Said yes handover* both need that line struck.

## What these four change elsewhere

- D46 is corrected a third time — two credentials, bounded writes, both directions.
- B20's requirement loses its undo window; the mapping workbook and the acceptance path follow.
- The custom-module count for the Leads org is now five, which T4 must confirm is inside the edition's allowance.
- D44's cover window becomes an application-layer gate with a named, accepted bypass for anyone who opens Zoho directly.
- `CARRY-FORWARD.md` B-01, B-02, B-04 and B-05 are struck, dated today.

## Still open

B-03 (D24's licence-free viewers), B-07 (whether Plane A's archive is an exception to zero copy or
outside it) and B-08 (approvals on Professional). Jev's picks on all three are stronger than the ones
resolved here, so they are confirmations rather than deliberations.

**23 Sep 2026 (D51):** B-05's two bounded service identities are conditional on T11 — not needed if one org holds. B-01's cover windows return to Zoho as record-level sharing now that production is Enterprise, which closes the bypass this decision accepted. Full record: `D51-one-enterprise-org-built-from-the-super-admin.md`.

**23 Sep 2026 (D52):** B-05's two bounded service identities are **dropped** — no other org to write into. B-01 stands for availability, read-state and the LOG; cover windows move to record-level sharing. Full record: `D52-one-enterprise-org-for-leads-and-investors.md`.
