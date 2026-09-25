# D31 — Updates moves into a bell; People becomes Team & access and stays

_10 Sep 2026 · answers the proposal "we don't need the people page at all, just the top notification icon"_

**The bell.** Updates was a destination you only visited because a red badge sent you. It is now a
button in the top bar carrying the unread count, opening the same groups as a drawer, with
`See everything` into the page. The page stays reachable and stays authorised — the NAV entry is
marked `bell:true`, so `navFor()` still gates it while the sidebar skips the row. A manager needs the
full page at table width to audit the team's week; an IR needs a glance. One destination, two depths.

**People stays.** Two independent audits reached the same answer: a bell cannot hold any of the four
jobs that page carries, and one of them is load-bearing.

| What it holds | How often | Where it belongs |
|---|---|---|
| Teams — who reports to whom | A few times a year | Stays. Reporting lines *are* the access model — "a manager is the ceiling" is computed from the chain, and this is the only place a manager is set. |
| The capability grid | Rarely | System, admin-only, rendered as deviations from the seat rather than a 14 × N matrix. |
| The roster | Daily | Split: reading it belongs in the top-bar presence chip, writing it on My day where the manager already stands. |
| Temporary access | Occasional | The grant ledger belongs beside Activity. It is what makes "no shared logins" true. |

Renamed **Team & access** and filed with System: it was never a directory, and the old name invited
exactly the question that was asked of it. The row count the proposal wanted came from the bell
instead — an IR's sidebar is six rows, an admin's thirteen.

**Also fixed under this decision**, both found by the audit and both one-line: a door on a phone opens
the bottom sheet rather than `window.open` (which is a whole browser tab per door per lead, never
popup-blocked because the tap is a real gesture); and the unread badge's white-on-red, which is
2.81:1 in the dark palette, now uses a `--late-ink` token that flips with the theme.
