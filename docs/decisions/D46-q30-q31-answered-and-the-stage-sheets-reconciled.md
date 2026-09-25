# D46 — Q30 and Q31 answered from Zoho's own documentation: concurrency binds, not credits; and no token reads two orgs — with the stage sheets placed under zero copy

_22 Sep 2026 · closes Q30 and Q31 · lifts D45's "conditional on Q30" flag and changes what the cross-org read costs · restates D24's read rule under zero copy · governs the mirror references still standing in STAGE-1 to STAGE-5_

## Q31 — the numbers, and which one actually binds

The Leads org is Professional (D20, pending Q15's field-level-security trial). Zoho's current limits for that edition:

| Limit | Professional | Source |
|---|---|---|
| Daily API credits | 50,000 + (licences × 500) + add-ons, capped at 3,000,000 | [API limits, v8](https://www.zoho.com/crm/developer/docs/api/v8/api-limits.html) |
| Concurrency — simultaneous active calls, org-wide | **15** | same |
| Sub-concurrency — COQL/Query, Get Records with `sort_by` or `cvid`, bulk over 10 records, Convert Lead | **10**, the same on every edition | [Sub-concurrency for complex APIs](https://help.zoho.com/portal/en/community/topic/sub-concurrency-for-complex-apis) |
| A plain record read | 1 credit | API limits, v8 |
| A filtered/search read | 3 credits | same |
| COQL | 1 credit to 200 rows, 2 to 1,000, 3 to 2,000 | same |

**Credits are not the constraint.** At D21's seat count — two or three IRs, a manager, a view-only seat and the integration user, about six — the Leads org gets 50,000 + 3,000 ≈ **53,000 credits a day**. A heavy estimate of the console's own appetite (five working IRs, 200 interactions each, four calls per interaction, three credits per call) is about 12,000. Four times the headroom, before any cache.

**Concurrency is the constraint, and it is tighter than D3 thought.** D3 rejected live reads over "20 concurrent" — that is the *Enterprise* figure. This org is Professional: **15**. Worse, the console's two heaviest screens do not draw on the 15. A sorted, filtered leads list is `sort_by` or COQL, and Numbers' rollups are COQL — both sit in the **sub-concurrency 10** bucket, org-wide, whatever the edition. Against D45's stated 5–15 concurrent users, ten simultaneous complex calls is not a ceiling anyone should plan to approach.

**So the D45 cache is load-bearing, and it is specifically the server-side half that bears the load.** The 30–60 s shared cache on Numbers/Plan aggregates and badge counts collapses every user's copy of those calls into one upstream call per TTL window — that is the mechanism that keeps a team of ten off the sub-concurrency 10. The per-session own-book cache does nothing for this: it is per session, so ten users are ten callers. Two consequences for the build: the shared cache is a week-one concern, not a polish item; and the modified-time check that the TypeSafe pass added to D45 (before a write on a lead under an active D44 cover window) is one more call per write and belongs in the budget from the start.

**Not decided here:** whether the Leads org goes to Enterprise for concurrency 20. It is a cost question, ₹1,000/user/month over Professional, and Q15's field-level-security trial may force the same move anyway. The sub-concurrency 10 does not change on Enterprise, so the upgrade buys less than it looks like it buys.

## Q30 — a token belongs to one org, so the console's seat cannot read the Investor org

Two statements from Zoho settle it. Organizations are isolated: *"the multi-org functionality does not allow any kind of data sync between the orgs. The sole purpose of creating multiple accounts is to provide users with ease of access"* ([FAQs: multiple CRM organizations](https://help.zoho.com/portal/en/kb/crm/faqs/multiple-crm-organizations/articles/faqs-multiple-crm-organizations)). And tokens are bound to the org they were issued against: *"you cannot use the org-specific tokens in an environment to make calls to another org in an environment"* ([Org-specific OAuth 2.0 tokens in Zoho CRM](https://help.zoho.com/portal/pt/community/topic/org-specific-oauth2-0-tokens-in-zoho-crm)). A person may belong to as many as ten orgs; that is a convenience for a human at a login screen, not a route for a credential.

**As Q30 was asked — can the console's seat read the Investor org live for a joined ARL ID — the answer is no.** There is no org parameter on a CRM call, and the IR's token is bound to Leads.

**The capability survives in a different shape.** The console's *backend* holds a second credential — a separate OAuth grant for an identity that is a member of the Investor org — and performs the cross-org read server-side, keyed on ARL ID. `financeMirror()` stays exactly what D45 called it, a permission filter over that read, deciding what the IR is allowed to see of it. One fact, one writer is untouched: the second identity reads and never writes; Finance still writes the Investor org alone.

What that costs, stated plainly because D45 assumed it cost nothing:

1. **A seat in the Investor org** for the reading identity — Enterprise, per D20. D45's re-scoping read as though the console's existing seat would do the work, so it carried no seat cost. It does now.
2. **D24 needs restating under zero copy.** *"A seat is required to write, never to read"* was true when reads came from the mirror — nobody touched Zoho to look at something. Under D45 every read is a Zoho call, and a cross-org read is a call into an org where the reader holds no identity at all. The rule survives for humans: a viewer still signs in to the portal and still needs no CRM licence. It is no longer true of the system, which now spends a seat to read on their behalf. D24's three guards are unaffected; its economics are.
3. **D45's "conditional on Q30" flag comes off `imlink`/`transfer`, `financeMirror()` and the cross-org-joins cache row.** The live cross-org read is possible, so the one-event-stream-each-way design does not come back. But what replaces it is a second-credential server-side read, which is a different build item from what D45 described, and it is not free.

**Corrected 22 Sep 2026 — read-only, and one direction, is too narrow.** This decision framed the cross-org problem as the console needing to *read* the Investor org. `contracts/` says otherwise, and always did. Every fact Finance's queue consumes carries `x-direction: leads → investor` and `x-consumed-by: Finance queue` — the claim and the four paper hints are **delivered into** the Investor org by the IR side, not read out of the Leads org by Finance. The traffic is symmetric: **nine facts are written into the Investor org from the Leads side** (`lead.handover`, `lead.closed`, `lead.lost`, `lead.reassigned`, `money.claimed`, `paper.requested`, `paper.chased`, `paper.told`, `paper.said_signed`) and **eleven into the Leads org from the Investor side** (`money.confirmed`, `money.not_found`, `money.reversed`, `paper.sent`, `paper.verified`, `paper.blocked`, `allotment.done`, `allotment.reversed`, `hold.changed`, `account.opened`, `welcome.delivered`). So each side holds a credential into the other, each able to write a **named, bounded set of fields and nothing else** — not a general write, and not a read for browsing. One fact, one writer survives intact, because the two sides share a *record* and never a *field*: Finance alone writes the gate column, the IR alone writes the claim. What D45 abolished was the event *transport* — the outbox, the signed POST, the dedupe — not the direction of travel, which is a property of the design and unchanged. **Finance therefore needs no Leads-org seat**, and no copy of anything is made.

**Not decided here:** whether the reading identity is D17's integration user, already specified as an identity that never acts as a human, or a separate read-only service identity in the Investor org. Either spends a seat. The difference is whose name sits in the Investor org's audit log against every cross-org read the console performs, and that is the owner's call, not the builder's.

## The stage sheets under zero copy

`STAGE-1` through `STAGE-5` were written against D3 and D4 and carry roughly sixty-six sentences that name the mirror, the mapper, the webhook, the poller or a Supabase project. D45 abolished all of it. STAGE-1 is the acute case: its gate cases and three of its numbered build steps *are* the mirror. Run it as written and week one builds the thing D45 deleted, then deletes it.

This decision is the rule those sentences are read under. It is not a rewrite of the sheets — see *What this does not do*.

| In the sheets | Under zero copy |
|---|---|
| STAGE-1 §1.4 write path — *write Zoho as the person, write the mirror from Zoho's answer in the same request* | First half stands. Second half void; D4's read-your-own-writes survives as D45's optimistic local update, then Zoho's answer |
| STAGE-1 §1.5 the mapper and the allow-list | Void as a data path. **Survives as a field projection**: the allow-list is still the only place identity field names live (D13), now governing what a server-side read may return to a screen rather than what crosses into a store |
| STAGE-1 §1.6 the Zoho → mirror webhook and the poller behind it | **Void.** There is nothing to keep current. Rule 8 — *every webhook has something behind it that does not depend on it* — loses its subject here and keeps it everywhere else |
| STAGE-1 D-4 two Supabase projects | See the credentials pass in `READY-TO-BUILD.md`. The leads project is void; the investors project follows the investor apps to Zoho CRM Portals |
| L0-04 *one fact travels portal → Zoho → mirror and comes back complete* | *One fact travels portal → Zoho and comes back complete on the read that follows, inside the same request's response* |
| L0-06 *the mirror never receives a field nobody allowed* | *No screen and no API response carries a field the projection does not allow* |
| L0-05 idempotency | Stands, less the words *one mirror row* |
| STAGE-2 §views or functions on the mirror, scoped by the session | Server-side Zoho queries scoped by the session, served through D45's cache |
| STAGE-2 L1-05 *the leads mirror holds no identity* | *The projection never returns identity* |
| STAGE-2 the 02:00 nightly reconcile — *differences between Zoho and the mirror* | **Void**: there are no two sides to compare. Its alarm duty moves to D45's two new System checks — API concurrency and credit headroom, and live-fetch latency and error rate per page |
| STAGE-4 *the app's five pages read the investors mirror (D03's second project) and nothing else* | Void. The investor apps went to Zoho CRM Portals with the same 22 Sep call. A-01 and A-03 survive in spirit and become D45's own rule: a cached figure says when it was true, and a failed fetch says so rather than showing a stale number |
| STAGE-3, STAGE-5 mirror references | Governed by the same rule; neither sheet was worked through in this pass |

## What this does not do

It does not rewrite the five sheets. They still carry those sixty-six sentences, and a session handed STAGE-1 today would still read *build the webhook* on line 306. The sheets were sampled here, not read end to end — 200 KB across five carefully-sequenced weeks — and a blind rewrite would lose more than it fixed. **Week one should not start from the unrewritten STAGE-1.** Rewriting STAGE-1 against this rule is the next job, and it is a session's work on its own.

It also does not close Q15 (field-level security on Professional), which is still a week-one trial and still decides the Leads edition.

## Rejected

Rewriting STAGE-1 to STAGE-5 in this pass, for the reason above. Deciding the Investor-org reading identity, which spends a seat and puts a name in an audit log — recorded as open, for the owner. Raising the Leads org to Enterprise for the concurrency, which buys 15 → 20 on plain calls and nothing at all on the sub-concurrency 10 where the console's heaviest screens actually sit.

**23 Sep 2026 (D51):** Conditional on T11. If D23's identity wall holds in one Enterprise org, there is no second org and the cross-org credential this decision specifies is not needed. The Q31 concurrency findings survive regardless — Enterprise is concurrency 20, and the sub-concurrency of 10 is identical on every edition. Full record: `D51-one-enterprise-org-built-from-the-super-admin.md`.

**23 Sep 2026 (D52):** The cross-org credential is **not needed** — there is one org. The Q31 findings stand: Enterprise concurrency 20, and the sub-concurrency of 10 applies on every edition, so the shared cache remains load-bearing. Full record: `D52-one-enterprise-org-for-leads-and-investors.md`.

**23 Sep 2026 (D53):** The shared cache is no longer load-bearing in the sense described here: scoping by visibility removes most cross-user sharing. Whether the team stays inside Enterprise's limits without it is now a load test (T10), Jev 0.67. Full record: `D53-every-human-on-an-enterprise-seat-and-the-cache-keyed-by-scope.md`.
