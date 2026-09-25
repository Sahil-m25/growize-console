# D47 — Three log planes: the record audit read live, the org audit archived, and the console's own operational and security log — which zero copy never forbade

_22 Sep 2026 · resolves O-01 · corrects D45's API-headroom check · names three limits Zoho cannot lift · stands on D13, D19, D22, D45, D46_

## What this settles

O-01 asked where the Activity page's data comes from once there is no mirror. The question conflated three different things that all get called "logs", and only one of them was ever inside D45's ban. D45 forbade *a second persisted store of lead or investor data that screens read from*. Two of the three planes below hold no record data at all.

| Plane | What it holds | Whose | Read how | Retention |
|---|---|---|---|---|
| **A · The record audit** | Who changed which field on which record, from what to what, and whether it came from a UI, an API call or a workflow | Zoho's | Live per record via `GET /{module}/{id}/__timeline`. Cross-record only via a scheduled export of the org audit log, archived by us | Zoho deletes at **3 years**. Our archive is what outlives it |
| **B · The operational log** | Every Zoho call the console makes — acting human, endpoint, status, latency, the credits header, 429s, errors — plus every authorisation refusal our own layer issues, and every save-queue retry | **Ours** | Ours to query | Ours to set |
| **C · The identity and authority log** | D22's step-up attempts, successes and failures; D13's identity reveals; session start and end; the borrowing and return of a temporary grant (D35) | **Ours** | Ours to query | Ours to set |

## Why B and C were always ours

D22 requires a step-up attempt to be "logged whether it succeeds or fails", with three failures locking the action and raising an alert. D13 requires every identity reveal to be a logged action. Zoho has no mechanism for either. The runbooks already written — `ops/runbooks/api-budget.md`, `pii-leak.md`, `heartbeat-silent.md` — are each written against telemetry Zoho does not produce. This plane was assumed by the ops design from the start; D45 simply never mentioned it, because D45 was about where *records* live.

Verified: an application-level log of the console's own calls and refusals is outside D45's ban (Jev 0.85).

## What the Activity page becomes — O-01 resolved

The **lead page's own history panel** is Plane A, live: one Timeline call per record, which is exactly what Timeline is for.

The **cross-lead Activity page (B12)** is Plane A's *archive*, not a live Zoho query. Timeline is per-record only, and a fan-out of one call per lead is not viable against a sub-concurrency of 10 (D46). The console's in-memory `LOG` stops being the source of that page and becomes a rendering of the archive.

Whether that archive is an *exception* to zero copy or simply *outside* it is the owner's reading, and it is genuinely arguable — the archive is append-only, write-once, and is never the source of a record shown on a screen, but it is undeniably a persisted copy of something Zoho holds. Recorded here as the owner's call rather than as a fact (Jev 0.68). Zoho forces the question either way: audit entries are permanently deleted at three years, and a *filtered* export reaches back only 180 days, so an organisation that needs a longer trail has no alternative mechanism.

## Three limits Zoho cannot lift

**1 · There is no sign-in API.** Zoho CRM's own FAQ states that the audit log does not capture login history — it lives in Zoho Directory, visible at Setup → Security Control → Login History. Zoho Accounts shows sessions, devices and IPs per user, self-service, with no admin-wide view and no API. **Who signed in, from where, and who failed cannot be rendered in the console.** Accepted as an out-of-band process: an administrator opens Zoho for this one class of data.

**2 · Zoho logs nothing when someone is refused.** A person probing for a record they are not entitled to see leaves no trace in any Zoho surface. Under zero copy every staff read passes through the console's own permission layer first, so Plane B is the only place that signal can exist (Jev 0.65 — likely rather than certain, but the practical conclusion is the same either way). **If Plane B does not log the refusal, nobody ever sees it.**

**3 · There is no API-usage endpoint — and this corrects D45.** Zoho's API Dashboard shows credits consumed, and calls by user, module and IP, but it is a UI screen with 30-day retention and no programmatic route. D45's new System-page check for *"Zoho API concurrency and credit headroom"* therefore **cannot be built by querying Zoho**. It must be assembled from Plane B's own call telemetry plus the `X-API-CREDITS-REMAINING` response header — which Zoho sends only once usage passes 50% of the daily allowance, so the header's *appearance* is itself the early warning (Jev 0.76).

## Per user, per team, per org

**Per user** — direct. Timeline filters on `done_by.id`; the audit export filters on `done_by` with `equal` or `in`.

**Per team** — no native filter. Zoho's audit log knows nothing of roles or territories. Resolve the hierarchy through the Roles and Users APIs into a list of user ids and pass it with `in`. This is the same hierarchy predicate D40 and D44 already require for team views: reuse that function, never write a second one, or the two will disagree.

**Per org** — unfiltered export, three years, asynchronous and heavy. A scheduled job, never a screen's live query.

The **180-day ceiling applies only to a filtered export**; unfiltered reaches the full three years. That is why the archiving job runs unfiltered and filters afterwards, on our side.

## Debugging, and the sandbox

Sandboxes are an Enterprise and Ultimate feature. **Professional does not get one**, so the Leads org as specified has nowhere to reproduce a production fault safely. Either integration work happens against the Investor org, or this joins Q15's edition question — which may force Enterprise anyway.

*(Zoho's edition-comparison pages carry no Sandbox row at all; this rests on the availability table in the "Creating Sandbox" article, so it is an argument from absence. Confirm with Zoho support before spending money on it.)*

## Rejected

Making the Activity page a live cross-record Zoho query — Timeline is per-record, the export is asynchronous, and a per-lead fan-out is not viable at sub-concurrency 10.

Treating Plane B as a zero-copy violation and going without it — that would leave D22's step-up lock, D13's reveal log and every existing runbook with no data to read, in order to honour a rule that never covered them.

Putting a sign-in history screen in the console — there is no API behind it. A screen in front of an empty source is worse than sending an administrator to Zoho.

## Open

Where Planes B and C physically live. They need a store, and it is the same class of problem as O-02 — but note that **D14's S3 with Object Lock is already an append-only, tamper-evident target in this design**, and an append-only audit archive is exactly what it is for. That is the obvious candidate and it costs nothing new.

Whether Plane A's archive is an exception to D45 or outside it — the owner's reading, as above.

**23 Sep 2026 (D52/D53):** One org, so one audit log. Everything above that assumes two — the sandbox paragraph's "the Leads org as specified" and its fallback to "the Investor org" — now reads as one Enterprise org with one audit log, one unfiltered export and one archive job. Per team is unchanged in method: the role hierarchy, now a single one spanning IRs and Finance, resolved into a user-id list and passed with `in`, through the same function D40 and D44 use. Viewers hold their own seats, so their reads run on their own tokens and are scoped and attributed by Zoho natively; Plane B no longer carries D50's record of which human read through a service token, because no service token serves a screen. Limit 2 stands — a refusal on a person's own token is still logged nowhere but Plane B — and so does Plane B as the durable record of reads, since Zoho's audit log records changes and its API dashboard keeps thirty days. The sandbox question is settled: the org is Enterprise (D51), which carries one; the absence-of-a-row caveat above still wants Zoho support's confirmation. The headroom check's ceilings become Enterprise's — concurrency 20, sub-concurrency 10. Full record: `D52-one-enterprise-org-for-leads-and-investors.md`, `D53-every-human-on-an-enterprise-seat-and-the-cache-keyed-by-scope.md`.
