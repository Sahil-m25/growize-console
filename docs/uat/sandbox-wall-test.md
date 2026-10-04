# Sandbox wall test: does Zoho itself hide what each persona must not see?

**Org:** Growize Staging only (zgid 60090668120). The bundle refuses any other org, the live one (60061770791) by name.
**Why:** T11 / M12-S10 / ACCESS-PLAN §2–§5. Zoho must enforce the wall with no console in between. The Administrator is the control.
**Needs:** the seed loaded (records carry `Seed_Key`, owners are the IR A / IR B / KAM test users), the five persona users on their own roles and profiles, `Test_Seed` / `Seed_Key` fields on Touches and Receipts.
**Bundle:** `/home/claude/work/sandbox-setup/bundles/wall.js` (rebuild: `node zoho/wall/build-bundle.mjs`). It reads only; it creates one Test_Seed Touch and one Test_Seed Receipt and deletes each at once. It records counts, Seed_Keys, owner tags and yes/no. It never keeps a field value.

## Run, per persona (one browser profile each, so sessions never mix)
Order: **Admin first.** If Admin fails, stop: the environment is broken (seed missing, field not created), not the wall.

| Persona | Zoho user | Key | Role / profile it must show |
|---|---|---|---|
| Admin (control) | Sahil's admin | `admin` | any / Administrator |
| IR A | IR A test user | `ir_a` | Investor Relations / IR |
| IR B | IR B test user | `ir_b` | Investor Relations / IR |
| KAM | KAM test user | `kam` | Key Account Manager / KAM |
| Finance Ops | Finance Ops test user | `finance_ops` | Finance Operations / Finance Ops |
| Compliance and Audit | C&A test user | `compliance` | Compliance and Audit / Compliance and Audit |

1. Log in to crmsandbox.zoho.in/crm/growizestaging as that user. Open any CRM page.
2. The coordinator defines `window.__z` in the tab, then pastes `wall.js`.
3. Run `await GZWall.run("ir_a")` (use the key). Owners are mapped by user full name containing "IR A", "IR B", "KAM" and so on; pass `{ownerMap: {"<userId>": "ir_a", ...}}` as the second argument if names differ.
4. Read the table: `PASS`, `FAIL`, `skip` (the plan does not assert it, or Zoho does not let this user see it), `warn` (metadata disagrees; advisory).
5. Any `FAIL` is a wall defect (or an expectation to correct in `zoho/wall/expectations.json`, with the decision cited). `detail` lines name leaked Seed_Keys and any leftover test record (delete it by hand; the next reset also removes it). Save the table as `docs/uat/results/wall-<persona>-<date>.txt`. Do not paste field values.
6. Check `export` shows `skip`: open Setup > Profiles > the persona's profile by hand and confirm Export is off (IR A, IR B, KAM).

Done when: five personas have zero `FAIL`, Admin shows `env.admin_control PASS`, and the manual list below is ticked.

## What the table proves
Module read/create/edit flags; each sensitive field visible yes/no (bank: Finance Ops only; PAN, Aadhaar last four/ref, KYC: Compliance only; `Aadhaar_Number`: nobody but the Admin control); record scope by owner (IR A sees own leads and own originated investors only; KAM sees investors where KAM is self plus shares; Finance Ops sees all Contacts, Allotments, Receipts; Compliance reads all and creates no Receipt); a test Receipt/Touch create is allowed or refused as planned. Each row carries `traces` (T11, M12-S10-T01/T02/T04, IS-S01-T04, IS-S10-T05, TC-IM02-008/011/015/016, TC-IM04-010/011/012/013, TC-IM05-008).

## Manual UI checklist (the API cannot show these)
**IR A and IR B** (5 clicks each)
1. Leads list: only your leads; search for a Seed_Key of the other IR returns nothing.
2. Open an investor you originated: no Bank, PAN or Aadhaar section; fields read-only.
3. Receipts tab absent from the module menu; a typed URL to Receipts shows no access.
4. Any list view: **Export** / Mass-action export absent. Reports: no report exposes PAN or bank.
5. Open Other IR's lead by pasting its record URL: "no permission", not a blank record.

**KAM** (6 clicks)
1. Contacts list: only investors where KAM is you (plus shared ones).
2. Open one: edit a non-identity field and save; Bank, PAN, KYC fields are not on the page.
3. Allotment under it: opens, money totals (Capital_Invested, Total_Amount_*) not shown.
4. Receipts absent. 5. Export absent. 6. Another KAM's investor by URL: no permission.

**Finance Ops** (6 clicks)
1. Contacts list shows every investor. 2. Open one: Bank block visible, PAN / KYC / Aadhaar blocks absent.
3. Receipts: create a test Receipt (tick Test_Seed), then delete it. 4. Allotments show money totals.
5. Farms (LLP_Creation_Module): Units_Released and LLP_Status are read-only. 6. Export per the profile (record the answer).

**Compliance and Audit** (7 clicks)
1. Every module in the list opens read. 2. Contacts: PAN, Aadhaar last four, Aadhaar ref, KYC visible; Bank block absent.
3. Aadhaar_Number is on no page, no list column, no layout. 4. Receipts: readable; **New** and **Edit** are absent or refused.
5. Allotments: read-only, no edit pencil. 6. Mark KYC passed on a seed investor (the one write it has), then put it back.
7. Export per the profile (record the answer).

**Admin (control)** (3 clicks): Contacts detail shows every block including Aadhaar_Number; Receipts and all leads of every owner list; Setup > Profiles lists the five profiles.
