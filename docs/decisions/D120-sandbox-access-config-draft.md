# D120 (draft): sandbox access configuration, applied by code

**Date:** 5 Oct 2026 · **Status:** draft for the coordinator and owner; not applied to any org · **Builds on:** ACCESS-PLAN §1–§5, D78, D80, D110, D115-2, rule 7

## What was built
`zoho/access/`:
- `spec.json`: the configuration as data.
- `plan.mjs`: pure planners plus orchestration over an injected `call()`.
- `plan.test.mjs`: `node --test`.
- `build-bundle.mjs`: writes `/home/claude/work/sandbox-setup/bundles/access.js`, about 24 KB.

In the admin's sandbox tab:
1. `await GZAccess.plan()` (a dry run; it returns steps).
2. `await GZAccess.apply(steps)` runs the API steps in order and stops at the first non-2xx response or per-item error. The log holds statuses and Zoho codes only.
3. `await GZAccess.verify()` returns a pass/fail table.

Every entry point first checks `GET /crm/v8/org` for zgid `60090668120`. On the live org (`60061770791`) it refuses with "this is the LIVE org". Repeat plan/apply until `plan()` returns only manual steps. A second run makes no change.

## What spec.json encodes
- **12 profiles, each cloned from Standard:**
  - Leadership
  - Digital Infrastructure
  - IR Manager
  - IR
  - Viewer
  - Finance Head
  - Finance Ops
  - Compliance and Audit
  - AM Head
  - KAM
  - Channel Partner
  - Integration

  Zoho caps Enterprise at 25 profiles, so 14 in total fits. The profile is named "Compliance and Audit": the D80 role refused "&", and the profile docs give no character rule, so the name avoids it and matches the role.
- **Module permissions.** Each profile gets view, create, edit and delete on the 15 sandbox modules.
  - Only Finance Head and Finance Ops create or edit Receipts and Investor_Payouts (§5).
  - Only Finance Head edits LLP_Creation_Module (§2).
  - Integration gets Cases view and create, and nothing else.
- **General permissions:**
  - Export is off for every created profile (rule 7). Administrator is not touched.
  - Mass delete is off for everyone.
  - Mass update is on for the heads only: Leadership, IR Manager, Finance Head and AM Head.
  - Import is on for Digital Infrastructure only.
- **Field-level security.** Every created profile gets a value for every field below. The planner refuses any spec that breaks the rule-7 wall.

  | Group | Fields | Rule |
  |---|---|---|
  | bank | 8 Contacts fields | Finance Ops edits; Finance Head and Digital Infrastructure read; hidden from the rest |
  | identity | Contacts PAN_Number, PAN_Proof, Aadhaar_Last4, Aadhaar_Ref, KYC, KYC_Completed_On, FEMA_Declaration; Leads.PAN | Compliance and Audit edits; Finance Head and Digital Infrastructure read; hidden from the rest |
  | Aadhaar_Number | Contacts.Aadhaar_Number | Hidden from all 12 profiles |
  | Receipts money | 8 fields | Finance profiles edit; Compliance and Digital Infrastructure read; hidden from the rest |
  | Allotment money | Total_Amount_Received, Total_Amount_Receivable, Capital_Invested, Token_Advance_Amount | Same as Receipts money |
  | Payout money | 7 fields | Same as Receipts money |
  | Farm release | LLP_Creation Units_Released, LLP_Status | Finance Head edits; everyone else reads |

  The plan's Amount_n, UTR_n and Date_n fields and Bank_Address are not in the sandbox, so they are skipped.
- **Sharing rules.** All are record-owner based: from CEO and its subordinates (every user), to one role with no subordinates, and superiors not allowed. They are named `GZ <module> - <role>` and matched by content as well as by name.
  - Contacts, allotments, Receipts and Investor_Payouts: read/write for Head of Finance and for Finance Operations; read for Compliance and Audit.
- **Default sharing.** Verify only, against what D80 set. A mismatch becomes a manual step.
- **Personas:**

  | Persona | Role | Profile |
  |---|---|---|
  | IR A | Investor Relations | IR |
  | IR B | Investor Relations | IR |
  | KAM | Key Account Manager | KAM |
  | Finance Ops | Finance Operations | Finance Ops |
  | Compliance & Audit | Compliance and Audit | Compliance and Audit |

  Personas for later: IR Manager, Finance Head, a Digital Infrastructure member who is not the super admin, and Viewer.

## PROVISIONAL choices (made where the plan is silent)
- **P1.** No non-administrator profile can delete on any module. Other gaps were filled with least privilege.
- **P2.** Digital Infrastructure reads bank and identity fields but never writes them.
  - This is so the logged reveals that D68 and D110 allow work on Sahil's own token. §3 predates D110.
  - This departs from the brief's "no non-finance profile reads bank". To change it, flip the `grant` for that profile to hidden. The wall test names the exception.
- **P3.** One writer per field, following field-register:
  - Bank fields: Finance Ops writes and Finance Head reads.
  - Identity fields: Compliance writes and Finance Head reads.
- **P4.** Aadhaar_Last4 is hidden from IR and KAM, following ACCESS-PLAN §3. Field-register lists them as readers, so the register needs reconciling.
- **P5.** Leadership and Viewer get no Receipts or Payouts module, and money fields are hidden from them.
- **P6.** Investor_Payouts is treated like Receipts.
- **P7.** Two additions to the money field groups:
  - Token_Advance_Amount is treated as money.
  - On Receipts, the Mode, Kind, Received_On, Match_State, Matched_By and Reversal_Of fields are hidden along with Amount and UTR.
- **P8.** Lead_Events create and edit for IR, IR Manager and Digital Infrastructure. D115-2 makes event-sheet load the super administrator's right only. A Zoho profile cannot express that per user, so it stays a console seat right (`CONSOLE_SUPER_ADMIN_IDS`).
- **P9.** Integration gets no access to Contacts. If linking a Case to a Contact needs it, add Contacts view; identity stays hidden either way.
- **P10.** Compliance and Audit also gets read sharing rules on Leads, Touches and Cases ("reads everything", D80).
- **P11.** Mass update is on for the heads only, and import for Digital Infrastructure only.

## Manual steps (the planner emits them; Setup click-paths)
1. **Module or general permissions missing from `permissions_details`** (for example Tasks/Calls/Notes appearing as "Activities", or Export): Setup > Users and Control > Security Control > Profiles > {profile} > module-level or Tools permissions.
2. **A spec field that is not in the schema:** Setup > Customization > Modules and Fields > {module}. Create it hidden, then re-plan. None are missing on 5 Oct.
3. **Default sharing mismatch, or the data_sharing GET failing:** Setup > Users and Control > Security Control > Data Sharing Settings.
4. **The five test users** (licence-bound): Setup > Users and Control > Users > Add User, with the role and profile from the persona map.
5. **Not built here:**
   - The maker-checker validation rule from §5 is held by D115-4.
   - Removing Aadhaar_Number (§6 step 3) needs compliance advice.

## UNVERIFIED API shapes (probe with a GET first)
- **Permission ids.** The planner assumes `permissions_details` ids are org-wide, so a fresh clone is diffed against Standard's ids. If they are not, the PUT fails with INVALID_DATA, apply stops, and the next `plan()` reads the real clone.
- **Custom module names.** The planner assumes `permissions_details[].module` is the api_name for custom modules. It also accepts the name `Crm_Implied_<Action>_<Module>`.
- **General permission labels.** Export, Mass Update, Mass Delete and Import are assumed to appear as display labels. If they do not, a manual step is emitted.
- **Sharing rules on custom modules.** The docs list only standard modules. A refusal stops apply; set the rule by hand.
- **`GET /crm/v8/settings/data_sharing`.** The page 404s on zoho.com. The shape comes from the Kaizen 252 post, and the `share_type` values come from a third-party mirror.
- **The `&` character in profile names.** Not checked; it is avoided.

Verified: org, get profiles, clone, update permissions, field meta, update custom fields (unlisted profiles unchanged; one field per call is used), create, get and update sharing rules, and get roles. The URLs are cited in `zoho/access/plan.mjs`.

## Applied 5 Oct 2026
- **What and who.** The coordinator applied the access config to the Zoho sandbox only, with the owner's explicit approval. Live was not touched.
- **Independent verify.** 759/759 checks pass (profiles, module View/Create/Edit/Delete, per-module general permissions, field-level security, sharing rules).
- **Three facts from the live run, now in the code** (`zoho/access/plan.mjs`, tests in `plan.test.mjs`):
  1. **Parent permissions.** Zoho refuses to enable a child permission whose parent is disabled ("Child permission can not be enabled, since its parent permission is disabled"; each `permissions_details` item has `parent_permissions`). `planProfiles` computes the final enabled set (enabled + on - off), removes any id whose parents are not all in it (repeatedly), skips "on" toggles outside it, adds explicit "off" toggles for enabled permissions that fall out, and orders View on, then Create/Edit on, then the rest on; offs in the reverse order. A general permission on a module whose Edit stays off is skipped, not sent (the step's `why` counts the skipped ones).
  2. **Mandatory fields take no field-level security.** Zoho answers "INVALID OPERATION: The field permission cannot be changed because it is a mandatory field". `planLayoutRequired` emits, before the FLS steps, `PATCH /crm/v8/settings/layouts/{id}?module={m}` with `required:false` for each FLS field that the spec hides or makes read-only for some profile and that a layout section requires (at most 5 field actions per call; merge semantics). `readState` now also reads the layouts of the FLS modules.
  3. **General permissions are per module**, named `Crm_Implied_<Prefix>_<Module>` (unchanged from e255182).
- **Sharing-rule POSTs** sent back to back on one module fail with CANNOT_PROCESS "Sharing rule computation is in process". `applySteps` retries such a step up to 6 times, 10 s apart. One browser call stays under a 35 s budget; when a wait or the next step would pass it, apply returns `{ ok:false, retryable:true, next }`, and the caller re-plans (idempotent) and applies again.
- **Four fields were required on the Standard layouts and are now not required in the sandbox, so that they can be hidden:** Contacts.PAN_Number, Contacts.Aadhaar_Number, LLP_UnitAllocation_Module.Token_Advance_Amount, LLP_Creation_Module.LLP_Status.
  - **HUMAN: the owner confirms before this goes to live.** The console and the Finance process now enforce these values, not Zoho. The same layout change would apply on live.
- **Tasks and Calls permissions** are not exposed in the API. They stay as cloned from Standard. Manual check in Setup > Profiles.
