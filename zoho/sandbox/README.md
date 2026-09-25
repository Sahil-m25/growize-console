# Sandbox seed and reset (M19-S03)

`manifest.json` is the merged prototype's demo book: Leads, Contacts, LLPs, allotments, Receipts, Documents, Cases (tickets).
It is generated — `node zoho/sandbox/make-manifest.mjs` — never hand-edited. Identity (PAN, Aadhaar, bank) is not in it.

`node zoho/sandbox/reset.mjs` deletes every record with `Test_Seed = true` and upserts the manifest (key `Seed_Key`),
shifting dates so the demo day (2 Sep 2026) lands on the run day. It refuses with `not a sandbox org` unless the org id
equals `ZOHO_SANDBOX_ORG_ID` and the API domain is a sandbox one. Env: `ZOHO_SANDBOX_ORG_ID`, `ZOHO_SANDBOX_API_DOMAIN`,
`ZOHO_SANDBOX_TOKEN` (service token; never printed). Test: `node --test zoho/sandbox/reset.test.mjs`.

Needs a boolean field `Test_Seed` and a text field `Seed_Key` on each seeded module in the sandbox. Anything a run creates
must set `Test_Seed = true`, or the next reset will not remove it.

## How to add a fixture

1. **Name** it in `pm/merge-audit/ui-sahil/fixtures-merged.json` (`UPPER_SNAKE`; Investors-side ones as `IM:NAME`), with
   `description` (the business state, in words), `prototype` (the JS that puts the prototype in that state) and `staging`
   (what the sandbox needs).
2. **Cite** it in `pm/plan-merged/ui-cases.json` under the case's `fixtures`.
3. **Local:** `npm run dev:local` in `console/`, then `POST /api/test/fixture/<NAME>` (the autopilot's `seed-local.mjs` does this).
   Unknown names answer 404; outside `FIXTURE_MODE=local`, or in a production build, the endpoint does not exist.
4. **Sandbox:** if the state needs records the manifest lacks, add them to `make-manifest.mjs`, regenerate, commit both.
