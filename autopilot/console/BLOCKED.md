# CONSOLE — things only a person can do

The autopilot adds items here and never waits for them. Tick an item when it is done: change `- [ ]` to `- [x]`.

- [ ] M02-S01-T01 (M02-S01, Sahil, Before its story (do early)) Renew Enterprise and buy the test-user seat — Renew the Enterprise subscription (annual) before 13 Oct; add one user licence for the restricted test user; save the invoice reference in the ops notes.
- [ ] M02-S02-T02 (M02-S02, Sahil, Before its story (do early)) Rung vocabulary and gate columns — Replace Lead_Status values with the ladder; add gate columns (advance/balance confirmation) read-only for IR profile.
- [ ] M02-S04-T01 (M02-S04, Sahil, Before its story (do early)) Role hierarchy — Create roles Digital Infrastructure, IR Manager, IR; Head of Finance, Finance, Compliance; Head of AM, KAM; Farm ops; viewer; keep CEO for the super admin only.
- [ ] M02-S04-T02 (M02-S04, Sahil, Before its story (do early)) Profiles per seat — One profile per seat of both sides, module permissions per SEATCAPS (no Convert/Export/Mass delete for IR); API access on (T7); Sahil's profile with every module but identity fields hidden (D68).
- [ ] M02-S04-T03 (M02-S04, Sahil, Before its story (do early)) Field-level security wall — Encrypt pan and bank_account on Contacts; pan readable by Head of Finance and Compliance, bank by Head of Finance and Finance; hide pan, bank, Aadhaar_Number, UTR_n, DOB everywhere else; aadhaar_last4/aadhaar_ref only (A-21, A-23).
- [ ] M02-S04-T04 (M02-S04, Sahil, Before its story (do early)) Private sharing and B-12 rules — Default sharing Private on Leads, Contacts and custom modules; IR Manager read on IR subtree via hierarchy; Finance → Leads sharing rule for gate columns (B-12); document the answer.
- [ ] M02-S05-T01 (M02-S05, Autopilot, Build) Create restricted test user — Invite test@ user on IR role/profile; not the super admin; not a service identity.
- [ ] M02-S05-T02 (M02-S05, Autopilot, Build) Run T11, T6, T7, T9 — Sahil scripts the API calls (curl with the test user's token) and runs them with the tester; record status codes and bodies.
- [ ] M02-S05-T03 (M02-S05, Autopilot (Jev), Build) Tester attacks UI/report/export doors — Tester signs in to Zoho as the test user and tries list views, global search, reports, export; records screenshots.
