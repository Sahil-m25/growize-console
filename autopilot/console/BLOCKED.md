# CONSOLE — things only a person can do

The autopilot adds items here and never waits for them. Tick an item when it is done: change `- [ ]` to `- [x]`.

- [ ] M02-S01-T01 (M02-S01, Sahil, Before its story (do early)) Renew Enterprise and buy the test-user seat — Renew the Enterprise subscription (annual) before 13 Oct; add one user licence for the restricted test user; save the invoice reference in the ops notes.
- [x] M02-S02-T02 (M02-S02, Sahil, Before its story (do early)) Rung vocabulary and gate columns — Replace Lead_Status values with the ladder; add gate columns (advance/balance confirmation) read-only for IR profile.
- [x] M02-S04-T01 (M02-S04, Sahil, Before its story (do early)) Role hierarchy — Create roles Digital Infrastructure, IR Manager, IR; Head of Finance, Finance, Compliance; Head of AM, KAM; Farm ops; viewer; keep CEO for the super admin only.
- [ ] M02-S04-T02 (M02-S04, Sahil, Before its story (do early)) Profiles per seat — One profile per seat of both sides, module permissions per SEATCAPS (no Convert/Export/Mass delete for IR); API access on (T7); Sahil's profile with every module but identity fields hidden (D68).
- [ ] M02-S04-T03 (M02-S04, Sahil, Before its story (do early)) Field-level security wall — Encrypt pan and bank_account on Contacts; pan readable by Head of Finance and Compliance, bank by Head of Finance and Finance; hide pan, bank, Aadhaar_Number, UTR_n, DOB everywhere else; aadhaar_last4/aadhaar_ref only (A-21, A-23).
- [ ] M02-S04-T04 (M02-S04, Sahil, Before its story (do early)) Private sharing and B-12 rules — Default sharing Private on Leads, Contacts and custom modules; IR Manager read on IR subtree via hierarchy; Finance → Leads sharing rule for gate columns (B-12); document the answer.
- [ ] M02-S05-T01 (M02-S05, Autopilot, Build) Create restricted test user — Invite test@ user on IR role/profile; not the super admin; not a service identity.
- [ ] M02-S05-T02 (M02-S05, Autopilot, Build) Run T11, T6, T7, T9 — Sahil scripts the API calls (curl with the test user's token) and runs them with the tester; record status codes and bodies.
- [ ] M02-S05-T03 (M02-S05, Autopilot (Jev), Build) Tester attacks UI/report/export doors — Tester signs in to Zoho as the test user and tries list views, global search, reports, export; records screenshots.
- [ ] M02-S06-T01 (M02-S06, Sahil, Before its story (do early)) Remove Convert permission — Untick Convert Leads on every profile; confirm no workflow converts.
- [ ] M02-S08-T01 (M02-S08, Autopilot, Build) Mailbox and templates — --note
- [ ] M02-S08-T02 (M02-S08, Autopilot (Jev), Build) Send and check — --note
- [ ] M02-S09-T01 (M02-S09, Autopilot, Build) Prove share/unshare — With super admin + test user, add and revoke a share on one lead; record request/response.
- [ ] M19-S03-T01 (M19-S03, Autopilot, Build) Seed manifest and reset script — JSON manifest of the merged prototype's demo book (people, leads, investors, LLPs, allotments, receipts, notes, paperwork); reset = delete records tagged 'test-seed' then upsert the manifest; refuses unless org id = sandbox.
- [ ] M03-S01-NOTE-1 (M03-S01) FACT CHANGE PROPOSED: TC-E03-001 'offers exactly six people … does not offer Harsha Bhat / Arvind Menon or Pradeep Ram' → the merged console (D98, prototype growize-console-merged.html vSignin) offers every person either side admits: the four IRs, Tasneem, Harsha, Meena, Fahad, Latha, Divya, Imran, Neha, Sahil and Pradeep (Investors-side administrator). The prototype itself fails this case; the fact predates the merge.
- [ ] M03-S01-NOTE-2 (M03-S01) FACT CHANGE PROPOSED: TC-E03-002 'does not offer Harsha Bhat' → Harsha Bhat (Head of Finance) signs in for the Investors side in the merged console (D98, merge notes 'Who sees what'). The prototype fails this fact too.
- [ ] M03-S01-NOTE-3 (M03-S01) FACT CHANGE PROPOSED: TC-E03-004 'does not offer Pradeep Ram' → Pradeep Ram holds the Investors-side administrator seat (System, Activity, Team) in the merged console, so he is offered. The prototype fails this fact too.
