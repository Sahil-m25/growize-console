# D32 — The 52 findings of the design review are fixed in the prototype

_10 Sep 2026 · closes `docs/design-review.html` · ten parallel fix agents, 115 verified edits, one file_

The review found 52 defects, 37 of them P0. This decision records what was changed and, as
importantly, what was deliberately not.

## Method
Ten agents, each owning a disjoint set of functions, each handing back a **patch file of exact
string replacements** rather than editing the 750 KB prototype directly — the only safe way to run
parallel work on one file. Every anchor was required to appear exactly once; 115 of 115 applied with
no collision. Verified afterwards by rendering 164 page-views (8 seats × 14 pages × 2 themes), all
29 drawers, every lead door and three phone widths, with zero script errors.

## What changed, by theme

**It causes contact now.** The lead's phone number is a `tel:` link and a WhatsApp button, both
gated on consent and on `canWork`. Tapping either arms a one-shot focus listener that, on return,
opens the touch drawer seeded to that channel — it *offers* to record, it never records, because
rule 6 says a system touch is never a human touch and the count is the signal. Saving a touch on a
lead with no dated next action now opens the next-step drawer instead of doing nothing. My day's
dead `Open the record` tags became real buttons.

**One fact, one writer.** Four second writers deleted, not reconciled: the lead's Money drawer is
read-only and points at the claim path; `p.actual` is computed-only and the `Math.max` is gone from
`gapNow`; the inventory stepper is removed from Payments, leaving Plan as the only writer; and
`decideExt` uses the same `plusDays` as `record`, so the forfeit clock has one implementation.

**Nothing consequential commits on one click.** `tick` reads `LADDER[].needs` and opens a rung
drawer instead of writing; where the console genuinely does not hold the evidence — the qualification
scorecard is not a field — the button says what it is recording (`Qualified — scorecard done`) and the
log records that the IR asserted it. `untick` collects the reason it always claimed to need. The
owner drawer has a footer, dead until a person and a reason are chosen, labelled `Move it to <name>`.

**Drafts belong to records.** One `DRAFTS` store keyed `drawer:leadId`. Typing a lost-reason on one
lead and pressing Escape no longer puts those words in the next lead's box.

**Numbers can say where they came from.** Provenance moved from the tab to the value: every invented
figure carries `.prov.demo` on the number itself, including the two that were marked computed and
were literals. A zero draws no bar. `pct()` returns nothing under a sample of 20 and the count is
shown instead. Plan refuses to say "Reconciles" unless its last period reaches the target date — it
now says the 90 days are unplanned. Recovery actions are wired on every non-green Plan row.

**Bank references are masked** to the last four everywhere they render, with a `Show the reference`
control that writes a line to the log naming who revealed it — masked at the point of writing too,
so the log never holds the whole value.

**Red means yours to fix.** Investor transfers no longer carries a red badge nobody in this console
can clear. `count('today')` has one definition in both scopes and no longer vanishes when the section
opens. `ragOf()` returns the reason, so the badge reads `Breached · no touch for 7 days`.

**The audit log is auditable** — eleven clickable kind tiles combining with the person and day
filters, CSV export of the filtered rows and of the month, and an honest `88 of 357`.

**The back office stops contradicting itself.** Documents derives both halves from one scope and one
vocabulary. Investor transfers stops claiming a reconciliation it cannot perform, renames the card to
what it actually checks, and adds the count that matters — writes this side believes it sent that the
other side has not acknowledged — each with a named owner and a human retry, per rule 8. System opens
on Findings whenever anything is amber or red.

**Empty states point somewhere**, a polite live region announces every write, clickable table rows
announce as buttons, and bare RAG dots carry hidden text.

## Not done, and why
- **Backend failure states** — pending, retry, stale-record conflict, token expiry mid-form. There is
  no backend to fail; the review specifies the write-lifecycle component these need, and it belongs in
  the port, not here.
- **Bulk select on the leads list** — needs a selection model and a confirm step.
- **Step-up authentication** on the reveal control — it asks `seeMoney()` today because this prototype
  has no real auth. D22's eight actions need the Zoho sign-in the port will have.
- `setSecondary`, `handover` and `endCover` still commit on the click; `NDRAFT` is still one box.
  Same two-line shape as the fixes above, in functions no agent owned this pass.
