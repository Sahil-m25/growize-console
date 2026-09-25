# An identity field got past the wall

**23 Sep 2026 — re-scoped, and rewritten.** This page was *An identity field reached the mirror*.
There is no mirror and no mapper (D45), so its first step — stop the mapper, disable the inbound
webhook — would stop nothing, and a responder who found no mirror could conclude there was no leak.
Under one org the wall is field-level security inside Zoho plus the application-side guards around
it (D52), and Jev put 0.85 on the leaks living in the second half: logs, the cache, callbacks,
exports, and a service token behind a screen. The steps below are written against those. The old
text is in git at `d9690dc`.

**You will see:** the PII canary — a PAN- or account-shaped value, or an identity field's API name,
somewhere it must never be: a Plane B log line, a cache entry, a logged callback payload, an export,
a screen's response; or a profile check that finds an identity field visible to an IR or service
profile.

**What it means:** one of D52's guards failed. Name which, because each stops differently:

| Where it surfaced | What broke | Stop it by |
|---|---|---|
| A field visible to an IR or service profile | Field-level security — a field was opened, or a new Contact field was created visible | Hiding it on that profile, as an administrator in Zoho itself |
| A Plane B log line | A writer logged a body instead of IDs and status codes | Turning that writer off — revert the deploy or flag it out |
| A logged callback payload | A receiver logged what it should only have used to re-fetch | Turning the receiver's logging off; the callbacks can keep arriving |
| A cache entry | A per-record payload cached, or an aggregate keyed by the wrong scope (D53) | Flushing the cache. It is rebuilt from Zoho, so a flush costs latency and nothing else — that is what makes it a cache and not a copy |
| An export | An export not run on the requester's own token | Revoking the file or its link |
| A screen | A service or administrator token behind it | Revoking that token. The screen fails loud, which is correct |

**This is the one runbook where you act before you diagnose.**

1. **Stop the path** — the right-hand column. A screen going dark is survivable; the path staying
   open is not.
2. **Find the extent.** Plane B for which requests, which people and what window; Plane C for
   reveals, step-ups and exports in that window; Plane A's archive, setup entities, for when a field
   permission changed and who changed it; Zoho's API dashboard, thirty days deep, for calls by user.
3. **Remove what was written.** Redact the log lines, delete the export. If Plane B sits on D14's
   S3 Object Lock, as D47 proposes, a written line cannot be removed until its retention ends —
   record where it is, and treat that exposure as permanent.
4. **Check whether anyone saw it** — whose requests returned it. If it reached anyone not entitled to
   it, this is a notifiable event and Q20's counsel is the next call, not a later one.
5. Only then: fix the guard, add the case to T11's attack (A-15), and switch the path back on.

**Do not:** fix the writer and leave the lines. The lines are the exposure.

**Do not:** investigate through the application with an administrator's token. Field-level security
cannot bind an administrator, which is why no administrator token is ever used by the application
(D52). An administrator looks in Zoho, directly.

**The rule that was broken:** identity is absent unless someone deliberately opens it. A new Contact
field is created hidden from IR profiles; the default fetch never carries identity; the reveal is a
second call made after the reason is captured (D52). The mirror's allow-list was the same idea in the
old design. If any of these was built the other way round — visible until hidden, fetched until
stripped — that is the real defect, and every field is a future incident.
