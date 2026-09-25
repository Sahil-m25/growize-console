# D54 — The org as found: hold D52, adopt the LLP modules, Aadhaar to last-4, and the wall before the second seat

_23 Sep 2026 · the owner's call, by multiple choice · closes B-15, B-16, B-17 and B-18 · holds D52 against what the org had been doing · every option scored by Jev (`jev-1.13.0`, `orgfound.mjs` and `b15-18.mjs` in device scratch) before it was put to the owner_

## Why this exists

The first read of the real Zoho org (`docs/zoho-org-as-found-2026-09-23.md`) found four things D51-D53
had been written without knowing: one user licence; leads being converted with Zoho's Convert button,
which D52 ruled out; the full Aadhaar number on Contacts; and an investor side already half-built under
other names. Each became a question, and the owner chose the recommended option on all four.

## What was decided

**1 · Seats (B-15): the wall first, then one test seat, then the team.** Build the roles, profiles and
field-level security with the super admin; then buy one seat for the restricted test user and run T11;
then buy each role's seats as the build reaches it. Jev 0.75 against 0.25 for buying the test seat
first — the lowest confidence in this decision (0.62), because building the rules with a test user
already in hand lets each one be checked as it is made. The price of the chosen order: the protections
are configured with nobody to test them against, so **T11 runs before any real user gets a seat, with
no exceptions**, and every module created after T11 is re-checked with the same test user before
anyone else is given access to it.

**2 · Aadhaar (B-16): last four digits and a reference; the full number hidden now.** Add
`aadhaar_last4` and `aadhaar_ref` to Contacts, fill them from the existing values in a one-off job run
by the super admin (four Contacts), and hide `Aadhaar_Number` from every profile Zoho lets us restrict.
If the Administrator profile cannot be restricted, the field stays visible only to the super admin, the
one seat that exists. The job logs record IDs only, never a value (D47 Plane B). **Clearing and removing
the full-number field is the owner's call, with compliance advice, and is not scheduled** — it is
destructive and cannot be undone. Jev 0.99.

**3 · Conversion and Deals (B-17): stop converting; Deals are history.** Native conversion stops today
(A-22). The five converted Leads and the four Contacts and two Deals it produced stay as legacy history
— Zoho cannot un-convert a Lead. **No new Deals are created.** An allotment links to the Contact and to
the farm LLP directly; the `Deal` lookup on `LLP_UnitAllocation_Module` stays for the two old records
and is not used going forward. Jev 0.97 on stopping, 0.82 on Deals as history only (confidence 0.72).
One consequence to design for: a converted Lead drops out of Zoho's list views and default COQL, so the
console's Leads list will not show the five — their investors appear as Contacts, and nothing links
back to a rung history for them.

**4 · The existing investor modules (B-18): adopt and extend.** `LLP_Creation_Module` becomes the
Projects/shelf object (B38). `LLP_UnitAllocation_Module` becomes Allotments (B34, B41). Payments leave
the ten fixed `Amount_n` / `UTR…UTR_10` / `Date_n` columns for a new **Receipts** module, one record per
money movement (Jev 0.06 that the fixed columns could carry D21's maker-checker or D19's reversals);
the two issued allocations' payments are moved into it, and the old columns stop being written — they
are not deleted. `ARL_Holdings` and `ARL_Transactions` are left exactly as they are and managed in Zoho
as today; a **read-only panel on the investor page comes in a later pass**, under the same field-level
security and step-up rules (Jev 1.00). Only what has no home is created: on the portal side Documents,
Templates, Holds, KYC Files, FEMA, Requests, Care log, Statements and Updates; on the console side
Touches, Events, Paper, Payment Claims and Plan. The two Team-module duplicates are checked by someone
on the Team-module Admins profile — the super admin cannot read `LLP_Creation` — and then hidden;
nothing is deleted without the owner. Jev 0.99.

## What it changes

- **A-21** (the wall in the real org) now explicitly comes before the test seat, and the test seat
  before T11.
- **The IM workbook's "proposed" shelf and Allotments** are superseded by the existing modules. The
  sheet *Org as found (23 Sep)* carries the mapping; the *Workflow to Zoho* sheet is not rewritten.
- **The portal's `allot()`** targets `LLP_UnitAllocation_Module` through a blueprint transition — A-09
  unchanged in substance, new target.
- **T4's module ceiling** must count the six custom modules already in the org (four standard-profile,
  two Team), not only the ones this build adds.
- **Permanent API names are mapped, not fought** (C-12): `ISFC_Code`, `Pet_Unit_Price`, the `Darft`
  status value and the two types of `FEMA_Applicable` stay as they are and are translated in the
  adapter.
- **Zero copy holds through every migration here.** Moving payments into Receipts and filling the
  Aadhaar fields are writes inside Zoho, run by jobs that keep no copy and log IDs only.

## New work

A-23 the Aadhaar fields, fill job and hide · A-24 the Receipts module and the move of the two
allocations' payments · A-25 adopt the shelf and Allotments (missing fields such as released units,
`available` as a formula, a lifecycle blueprint on Allotments; the ten Contacts lifecycle picklists
folded into one field under a blueprint) · A-26 create the modules with no home · A-27 the Team-module
duplicates checked, then hidden · A-28 the ARL read-only panel, later pass. Order in the org:
A-20 renew → A-22 stop converting → A-21 wall and A-23 Aadhaar → buy the test seat → T11 → A-24 to
A-26, each re-checked with the test user → the team's seats, role by role.
