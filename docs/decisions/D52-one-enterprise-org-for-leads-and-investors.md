# D52 — One Enterprise org for leads and investors; the identity wall is field-level security; the lead carries all seven rungs and the Contact is linked at "said yes"

_23 Sep 2026 · the owner's call, after he leaned two orgs and asked which was right · supersedes D02 · decides D23 and closes Q29 · drops the cross-org machinery of D46 and D49 · every judgment below put to Jev (`jev-1.13.0`) first_

## What was decided, and why the repo already argued for it

**One Zoho CRM org, on Enterprise, holds both leads and investors.** Jev 0.98 at confidence 0.97 —
but the argument is the repo's own, made on 7 September and left unfinished. D23 costed two orgs at
roughly ₹5,000 a month in duplicate seats, two sandboxes, two exports, and the handover as code — the
function carrying **five of the near-certain failure modes** in the failure analysis (HO1, HO2, HO3,
HO6, HO11) and the whole of week 5. The Build Book says it in one line: *"If the second org exists only
to keep investor PII away from the lead team, one org with profiles and field-level security does the
same for one licence."* `READY-TO-BUILD.md` put the monthly totals at ₹23,400 for two orgs against
₹23,200 for one — not a money question. Re-run those against today's seat plan before buying; the
shape will not change.

D02's reasons survive inside one org. The lead population is still analysable whole, because it is
one module. Leads still never hold identity, because D11 puts identity on the Contact. What two orgs
uniquely bought was blast radius — no single misconfigured permission can expose everything — and
that is precisely what T11 now attacks.

## Staff seats are Enterprise — Professional is not available inside this org

An edition belongs to the org. An Enterprise org cannot contain Professional users, so the owner's
preference to keep staff on Professional to save cost cannot be met by mixing — only by a second org,
which the totals above show saves nothing. The cheaper seat types inside Enterprise do not fit an IR:
Zoho's own FAQ lists what a Lite user *can* do — view records in up to ten modules, add notes, attach
documents — and creating or editing records, sending email and logging calls are not on it; Lite
users also require "CRM for Everyone" to be enabled. **IRs, the manager and Finance hold full
Enterprise seats.** Lite users are the natural seat for D24's read-only viewers — see B-11.

## The lead carries all seven rungs; the Contact is linked at "said yes" — Jev 1.00

Zoho's textbook pattern is to convert a Lead into a Contact and a Deal, and move the later stages onto
the Deal. That scored **zero**. It splits the funnel across two modules and breaks the model the
prototype, the Next.js port (174 files, sixty named writes) and both mapping workbooks are built on.

Instead, exactly as D11 already says: at "said yes" a Contact is created by a same-org upsert and
linked to the Lead by a lookup, because Finance's paperwork needs it from then. **The Lead continues**
through gates 4 to 7 and closes at Onboarded. "Converted leads go somewhere else" is still true — the
person's identity lives on the Contact, a different module with different visibility — but nobody's
funnel is torn in half to get there.

## The identity wall

| Layer | Mechanism | Jev |
|---|---|---|
| Identity fields (PAN, bank) | **Field-level security** — hidden entirely from IR profiles; per-user tokens cannot return them | 0.83 that it suffices inside Zoho |
| Which records an IR sees | **Private default sharing plus the role hierarchy** — own records and subordinates', no record-level sharing needed | — |
| D44 cover windows | **Record-level sharing**, for this one case only. Already included in Enterprise, enforced by Zoho, and avoids routing a peer's lead through a service token — which is itself a leak path | 0.86 |

The owner's bar was that field-level security is enough *"unless it leaks out in the app, or there is a
possibility of leaking out by any means."* Jev put **0.85** on where those leaks actually live: not in
Zoho, but in what the application does around it. So the wall has a second half, and it is ours:

| Leak path | Guard |
|---|---|
| Reads through a service token | Every service profile has identity fields hidden too. No service token can return what an IR cannot |
| The shared server cache | Aggregates and counts only — never a per-record payload |
| Plane B logs | IDs and status codes, never request or response bodies |
| Notification callbacks | Treated as "record X changed" only; the record is re-fetched with the right token and the payload is never logged |
| Exports | Built from the requesting user's own token, so field-level security applies; D22 step-up in front |
| The "reveal" | Identity fields are absent from the default fetch. A second call, after the reason is captured, is the only route. Hiding them in the browser is a curtain |
| Fields added later | Every new Contact field is created hidden from IR profiles; opening it is a deliberate act |
| Administrators | Field-level security cannot bind them — accepted in D23. **No administrator token is ever used by the application** |
| The investor portal | Scoped by the portal, not by field-level security — tested that investor A cannot reach investor B |

## What this removes

- **D46's cross-org credential and D49's two bounded service identities** — there is no other org.
- **The handover as code**, with its five near-certain failure modes, and week 5 with it.
- **The twenty crossing facts** in `contracts/` stop crossing. Nine written from the lead side and eleven from the Investor side become ordinary same-org field writes — the payloads are still the field contracts, and one fact one writer still holds, because the IR and Finance share records but never fields.
- **The Lost guard can return to Zoho.** `money.confirmed` is a gate column on the Lead; a blueprint condition or validation rule on the Lead can refuse Lost when it is set. It was forced outside only because the money fact lived in another org.

**D5's count** goes from five rules outside Zoho to **two**: the identity reveal, which can never move
because Zoho does not see reads, and viewer scoping until B-11 is decided. With Lite users for viewers,
**one**.

## What T11 is now

Not the decider — the owner has decided. T11 becomes the **attack**: the wall inside this org, from
four doors, before real investor data enters it. If it breaks, this decision is revisited with the
evidence in hand. Add to it the application-side guards above, since that is where the owner's bar
says the risk lives.

## What this makes wrong, and must be fixed

The stage sheets (A-04) now describe two orgs as well as the mirror. Both mapping workbooks carry
cross-org reads and second-credential rows that no longer apply. `ops-audit-console.md` and D47 assume
two audit logs; there is now one. These are recorded in `CARRY-FORWARD.md` rather than edited
silently.

_23 Sep 2026 — **held against the real org by D54.** The org had been converting Leads natively (5 of 5); D54 stops it and keeps the five as legacy. The existing LLP modules are adopted as the shelf and Allotments rather than rebuilt._
