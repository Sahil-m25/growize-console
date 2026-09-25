# D39 — Show recorded weekly work and simplify the IR's Today page

_16 Sep 2026 · the owner's request: show what IRs have done, remove discouraging goal deficits and reduce unnecessary data points_

An IR's Today page prioritizes the investor follow-up queue. A collapsed **Your week** section
contains **Your work this week**, showing just **Leads added** and **Follow-ups recorded**.
These are actual recorded facts, with no quota denominator, shortfall bar, still-to-enter tile,
units/weeks/capturers arithmetic or personal **Where the number comes from** panel.
The **Closest to closing** shortlist remains available with investor context and actions.

The first-touch, missing-next-step and full-book summary cards duplicate the daily queue and
Leads. Remove those cards from the IR planning rail and weekly disclosure. First contact and
setting a next step remain actionable in the queue; the full book and stage filters remain in
Leads. Relevant reservation deadlines remain available in the calendar/planning context. The
Next.js personal layout releases the empty side-rail width when these cards are removed.
Manager planning/oversight and Finance confirmation/paperwork workflows retain their separate
purpose. This replaces D33's personal quota door with a recorded-work view; it does not remove
the shared Plan or change target authority.

The week starts Monday in the console's existing clock and ends at its current time. Count only
the current IR's currently readable captures and human follow-up log entries. A contact attempt
counts as work recorded; it does not imply a successful connection. Follow-up totals use the
existing log recording timestamp, so recording a backdated contact this week counts as recording
work this week while its original contact date remains in conversation history. Automated or
system touches, future records, other IRs' activity and unreadable investors do not contribute.
Activity page filters cannot change these totals. Closing a captured lead as Lost does not remove
the week's capture credit; losing permission to read it does remove it from this scoped view.
The completed-work section remains accessible when the active queue becomes empty.

All ranked closing lists and reused book/rail renderers intersect the current readable record
set before rendering names. Manager capture counts and review rows use the actual reporting
chain rather than aggregating unrelated IRs. The shared organization plan calculation keeps its
existing authority and meaning.

Scope: the active redesigned standalone console and its Next.js port. These are frontend sample
data implementations; this change adds no backend, API or database authorization claim.
Validate scoped/date-bounded totals, neutral empty states, preserved contact/next-step actions,
manager/Finance behavior, and existing D37/D38 regressions. Local browser policy still prevents
a rendered review of the standalone HTML.

Final validation passed: 27 console source/application suites, including 133 focused weekly
checks and eight rejected in-memory broken variants; 39 port regression cases, TypeScript
checking and a production build generating 18 pages. These checks cover the actual templates
and local work-recording behavior; rendered browser appearance remains unverified.
