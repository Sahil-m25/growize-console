# Sandbox seed and reset (M19-S03)

`manifest.json` is the merged prototype's demo book: Leads (and their Touches), Contacts, LLPs, allotments, Receipts, Cases.
It is generated — `node zoho/sandbox/make-manifest.mjs` — never hand-edited. It uses the sandbox's real api names
(`sandbox-schema-2026-10-05.json`). Identity (PAN, Aadhaar, bank, UTR) is not in it; each receipt carries a synthetic `SEED-<id>` UTR.
Two reference keys are resolved at run time: `$persona` (a user id) and `$refs` (the parent's id, by Seed_Key).

## Running it in the sandbox (no token: the admin's browser session)

1. `node zoho/sandbox/build-bundle.mjs` writes `sandbox-setup/bundles/seed.js` (manifest inlined). Paste it into the sandbox tab.
2. Fields: `const p = await GZSeed.planFields()` (steps + `gaps`, writes nothing), then `await GZSeed.applyFields(p.steps)`.
   Creates `Test Seed` (boolean) and `Seed Key` (text, unique) on each seeded module; Administrator read_write, other profiles read_only.
3. `await GZSeed.plan({ personaEmails })` — dry run: order, rows per module, rows to delete first, owner distribution, personas that fell back to admin.
4. `await GZSeed.reset({ personaEmails, confirm: true })` — deletes every `Test_Seed = true` record (children first), then upserts parents first.
   Returns counts, deleted and fallbacks only. Without `confirm: true` it is `plan()`.
`personaEmails` is `{ ir_a, ir_b, kam, finance_ops, compliance, admin }` → email; users are looked up by email at run time.
A persona with no user is assigned to admin and reported. Every function refuses unless `GET /crm/v8/org` says zgid 60090668120.

In Node (service token, background only): `node zoho/sandbox/reset.mjs` with `ZOHO_SANDBOX_ORG_ID`, `ZOHO_SANDBOX_API_DOMAIN`,
`ZOHO_SANDBOX_TOKEN`, `ZOHO_SANDBOX_PERSONA_EMAILS` (JSON). It refuses with `not a sandbox org` unless the org id equals
`ZOHO_SANDBOX_ORG_ID`, is not the live org (60061770791) and the domain is a sandbox one. Dates shift so the demo day (2 Sep 2026)
lands on the run day (datetimes in +05:30). Test: `node --test zoho/sandbox/*.test.mjs`.

Anything a run creates must set `Test_Seed = true`, or the next reset will not remove it.

## Who owns what (so isolation tests have something to prove)

Prototype IRs: Kavya and Nikhil are IR A, Rohit and Ananya are IR B. Imran and Neha are `kam`; Meena and Harsha are `finance_ops`; Fahad is `compliance`.

| Module | IR A | IR B | admin | other |
|---|---|---|---|---|
| Leads (Owner), 18 | 8 | 8 | 2 (U1, U2: the unassigned pool) | |
| Contacts (Owner and Originating_IR), 15 | 7 | 8 | | |
| Contacts.KAM | | | | `kam` on 8; 7 investors have no KAM |
| Touches (Owner = their lead's), 57 | follows the lead | follows the lead | | |
| Allotments (Owner = the investor's IR), 15 | follows the investor | follows the investor | | |
| Receipts (Owner), 15 | | | | `finance_ops` on all 15 |
| Cases (Owner), 8 | | | | `kam` 4, `finance_ops` 3, `compliance` 1 |
| LLPs (Owner), 4 | | | 4 | |

IR A must not see IR B's leads or investors; the KAM must not see the 7 investors with no KAM.

## What the sandbox cannot hold (GAPs)

Documents (45 rows, kept in `manifest.deferred`) have no module. Lead `Rung` has no field: the ladder is carried by the stage stamps
(`First_Touch_At` … `Onboarded_At`). Receipt `Recorded_By` has no field (Owner carries it). Case `Created_Time` is system. `Ticked` for rung 1 has no field.
Picklist values (Lead_Source, Residency, Touches.Channel, Cases Priority/Status) are unverified: `planFields()` lists any the sandbox lacks.

## How to add a fixture

1. **Name** it in `pm/merge-audit/ui-sahil/fixtures-merged.json` (`UPPER_SNAKE`; Investors-side ones as `IM:NAME`), with
   `description` (the business state, in words), `prototype` (the JS that puts the prototype in that state) and `staging`
   (what the sandbox needs).
2. **Cite** it in `pm/plan-merged/ui-cases.json` under the case's `fixtures`.
3. **Local:** `npm run dev:local` in `console/`, then `POST /api/test/fixture/<NAME>` (the autopilot's `seed-local.mjs` does this).
   Unknown names answer 404; outside `FIXTURE_MODE=local`, or in a production build, the endpoint does not exist.
4. **Sandbox:** if the state needs records the manifest lacks, add them to `make-manifest.mjs`, regenerate, commit both.
