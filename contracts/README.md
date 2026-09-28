# Contracts

The typed language between the two sides. Every event that crosses a seam is declared here before it
is emitted, and validated at both ends. Build Book §11 is the prose; these files are the check.

`_envelope.json` is what every event carries: `event_id` (client-minted, the dedupe key, reused across
retries), `type`, `schema_version` (an unknown one dead-letters rather than guessing), `occurred_at`, `sent_at` (optional,
stamped by the sender on each delivery attempt — M13-S01, PROVISIONAL),
`actor`, the identifier pair, and the typed payload. Deliveries are HTTPS POSTs signed with HMAC-SHA256
over the body, with two active keys during rotation. A receiver that cannot verify the signature logs and drops.

30 events.

| Event | Direction | Produced by | Consumed by | Reverses |
|---|---|---|---|---|
| `account.opened` | investor → leads | The receipt (system) | Lead gate column; the console display | — |
| `allotment.done` | investor → leads | The blueprint transition | Lead gate column allotted_at; console rung 7 | — |
| `allotment.reversed` | investor → leads | Head of Finance, with a second hand | Lead gate column; the shelf | `allotment.done` |
| `case.replied` | app ↔ investor | The KAM | The app's case thread | — |
| `details.changed` | app ↔ investor | investor or KAM | Contact; bank_match → pending on a name change | — |
| `farm.progress` | outside → investor | The FMS | investors project project_updates | — |
| `hold.changed` | investor → leads | Head of Finance or the BU Owner | The console display | — |
| `lead.closed` | leads → investor | IR moving to Onboarded | Investor org (the close copy) | — |
| `lead.handover` | leads → investor | IR moving the lead to Said yes | Investor org (creates the Contact), both mirrors | — |
| `lead.lost` | leads → investor | IR | Investor org | — |
| `lead.reassigned` | leads → investor | manager | Investor org (Contact.ir_name) | — |
| `mail.delivered` | outside → investor | the mailer | Contact; update rows | — |
| `money.claimed` | leads → investor | IR | Finance queue; Claims row | — |
| `money.confirmed` | investor → leads | Head of Finance matching | Lead gate column; the Claims answer | — |
| `money.not_found` | investor → leads | Finance | The Claims answer | — |
| `money.received` | outside → investor | The bank | Receipts (unmatched) | — |
| `money.reversed` | investor → leads | Head of Finance, with a second hand | Lead gate column; the shelf; the app account | `money.confirmed` |
| `paper.blocked` | investor → leads | Finance or Compliance | Lead gate columns; the console paperwork card | `paper.verified` |
| `paper.chased` | leads → investor | IR | Finance queue ordering | — |
| `paper.requested` | leads → investor | IR | Finance queue | — |
| `paper.said_signed` | leads → investor | IR | Finance queue ordering | — |
| `paper.sent` | investor → leads | Finance | Lead gate columns; the console paperwork card | — |
| `paper.signed` | outside → investor | eMudhra | Documents; the attachment; the hash | — |
| `paper.told` | leads → investor | IR | Finance queue ordering | — |
| `paper.verified` | investor → leads | Finance | Lead gate columns; opens supp_verified_at | — |
| `push.delivered` | outside → investor | FCM | Contact; update rows | — |
| `request.executed` | app ↔ investor | Finance, Compliance or the owner | The app's request row and notifications | — |
| `request.raised` | app ↔ investor | investor | Requests / Cases; the KAM's queue | — |
| `update.published` | app ↔ investor | Finance or Account Management (M13-S06) | The app's updates feed; one event per investor in the segment | — |
| `welcome.delivered` | investor → leads | The mailer | The console display | — |

## The three reversals

A gate opens on a fact and closes on its reversal (D19). Without these three, a wrong confirmation is
permanent and the only repair is someone editing a record by hand — which is the failure the whole design exists to prevent.

- `money.reversed` reverses `money.confirmed`
- `paper.blocked` reverses `paper.verified`
- `allotment.reversed` reverses `allotment.done`

## Rules that live in these files, not in prose

- **Amounts are whole rupees as integers.** Never a float, never a string.
- **Identity fields appear only in `lead.handover`,** and only on the path to Zoho. The mirror mapper is an allow-list (D13).
- **`additionalProperties: false` on every payload.** A field nobody declared is a field nobody validated.
- **A hint is typed as a hint.** `paper.told`, `paper.chased`, `paper.said_signed` and `money.claimed` order a queue; they are never a precondition.
