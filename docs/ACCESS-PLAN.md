# Access-control plan: who sees and changes what in Zoho (approved 25 Sep 2026, D78)

**Status:** approved by the owner, not yet applied to Zoho. Owner calls: R1 superseded by D110 (Sahil moves to a non-admin Digital Infrastructure profile); R2 answered (Compliance and Auditor become one seat).
**Basis:** the seat rules in both prototypes, plus decisions D13/D22, D45, D51–D54, D68, D69/D74 and D70–D76.
**Principle:** Zoho enforces the rules. The console re-checks every rule and logs what happens, but it is never the only protection (D52).

## 1. Who gets a seat (one Zoho user each, D53)

| Person | Seat | Zoho role (who they can see) | Zoho profile (what they can do) |
|---|---|---|---|
| Pradeep Ram | Corp / root | CEO (top) | Administrator |
| Arvind Menon | BU owner | BU Owner, under CEO | Leadership |
| Sahil Mohite | Digital Infrastructure / super user (D68) | Digital Infrastructure, under CEO | Digital Infrastructure (non-administrator, least privileges; D110, risk R1) |
| Tasneem Qureshi | IR Manager | IR Manager, under BU Owner | IR Manager |
| Rohit, Kavya, Nikhil, Ananya | Investor Relations | IR, under IR Manager | IR |
| Jhalak Mehta | Exec (read) | Exec, under BU Owner | Viewer |
| Harsha Bhat | Head of Finance | Head of Finance, under BU Owner | Finance Head |
| Meena Raghavan | Finance Operations | Finance Ops, under Head of Finance | Finance Ops |
| Fahad Rizvi, Latha Prabhu | Compliance & Audit (one seat, D78) | Compliance & Audit, under Head of Finance | Compliance & Audit: reads everything, passes or fails KYC, sees PAN and Aadhaar, no money writes |
| Divya Kamath | Head of Account Management | Head of AM, under BU Owner | AM Head |
| Imran Sheikh, Neha Bhandari | KAM | KAM, under Head of AM | KAM |
| Channel partners | Partner | Partner, under IR Manager | Channel Partner |
| T11 Test | Restricted test user | IR (then each role in turn) | IR (then each profile in turn) |
| App integration | The investor app's contract receiver | none (service) | Integration: creates Cases only |

That is 15 people plus the test user and the integration user. Seats are added only after the T11 test passes (D54).

## 2. Default sharing for each module

| Module | Default | Who sees more, and how |
|---|---|---|
| Leads | Private | Managers see their team's leads through the role tree |
| Contacts (investors) | Private | Finance sees all through a sharing rule. The KAM and the originating IR are given a record share (see §4) |
| LLP_UnitAllocation_Module (allotments) | Private | Finance sees all through a sharing rule; the KAM gets a record share |
| Receipts | Private | Finance only, through a sharing rule |
| Touches | Private | The person who logged it, plus the managers above them. KAM access is by record share (see §4) |
| Cases (tickets) | Private | The owner (KAM or Finance) plus the managers above them |
| LLP_Creation_Module (farms) | Public, read only | All staff can read. Only the Head of Finance can edit the release fields |
| Investor_Updates | Public, read only | Finance and AM profiles can create and edit |

## 3. Who can see which sensitive fields

| Field | Hidden from every profile except |
|---|---|
| Bank_Account_Number, ISFC_Code, Account_Holder_Full_name, Bank_Name/Branch/Address/Account_Type, Bank_Proof, Bank_Verification | Finance Head, Finance Ops |
| PAN_Number, PAN_Proof, Aadhaar_Last4, Aadhaar_Ref, KYC, KYC_Completed_On, FEMA_Declaration | Finance Head, Compliance & Audit |
| Aadhaar_Number (the full number) | nobody. Hidden once Last4 and Ref are filled from it (D54), then removed with compliance advice |
| Receipts (whole module), Total_Amount_Received/Receivable, Capital_*, Amount_n/UTR_n/Date_n | Finance Head, Finance Ops (read access for Compliance & Audit) |
| Units_Released, LLP_Status (farm release) | editable by Finance Head only; everyone else reads |

The console masks every one of these fields by default. Each reveal needs step-up confirmation and is logged (D13/D22).

## 4. Record shares the console creates (Zoho's share-records API)

1. **An IR's own investor (D69/D74).**
   - When a lead says yes, the console fills in `Originating_IR`, `Said_Yes_At` and `Origin_Lead`.
   - It then shares that Contact with that IR as **read only**.
   - The share never moves if the lead is reassigned later.
   - The IR profile's field rules (§3) hide identity and money.
2. **A KAM's investors.**
   - When `Contacts.KAM` is set or changed, the console shares the Contact and its allotments with the new KAM (read/write), and removes the old KAM's share.
   - It does the same for that investor's Touches, so the KAM sees the whole history from lead to investor.
3. **Cover windows (D44/D52).** When one IR covers for another, the console creates temporary shares and removes them when the cover ends.

## 5. Money rules
- Only the Finance profiles can create or edit a Receipt.
- **Maker-checker:** a validation rule rejects `Match_State = Matched` when `Matched_By` is the same person as `Created_By`. The console checks this too.
- Reversals link back through `Reversal_Of`. A reversal needs the Head of Finance (validation rule plus a Zoho approval process).

## 6. Order of work
1. Create the roles and profiles in §1, §2 and §3. No real users yet.
2. Add the T11 test user and run the leak suite (M12-S10) on **each** profile in turn, not just IR.
3. Fill `Aadhaar_Last4`/`Aadhaar_Ref` from the existing values (a one-off job that logs record IDs only), then hide `Aadhaar_Number`.
4. Add the real users, one team at a time, re-running the suite after each team.
5. Switch on the console's share jobs (§4) and the maker-checker rule (§5).

## 7. Risks and decisions needed

**R1: Administrators see everything. RESOLVED (D110, supersedes the D78 acceptance):** Sahil keeps every page and action of both sides, including logged PAN, Aadhaar and bank reveals (D68), but on a dedicated non-administrator **Digital Infrastructure** profile with least privileges, not Administrator. Every reveal is logged by the console. The permanent super admin (Tech Team) is a separate seat. No administrator token in the app (CLAUDE.md rule 2). Zoho's Administrator profile ignores field-level security, so it is held only by the Corporate root (Pradeep) and the separate super admin.
- Owner task: create the profile in Zoho and move Sahil's user (M03-S05-T02).
- **Business owner = the `bu` seat; seats, roles and responsibilities are assigned by Sahil (admin and Digital Infrastructure) and can be added later (D113 5c).**

**R2: Compliance and Auditor seats (OD3). RESOLVED (D78):** merged into one Compliance & Audit seat and profile.

**R3: Share jobs are console code.** If the console fails to add or remove a share, access drifts. Mitigations:
- a nightly check that compares `Originating_IR` and `KAM` with the actual shares;
- the leak suite.

**R4: Licences.** 15 people means 15 Enterprise seats, plus the test user and the integration user.

**Jev check on this draft.** Each rule was scored "enforced with no gap" against a known-good and a known-bad example. This question separates good from bad weakly (0.20 vs 0.09), so the scores are only a ranking.
- Weakest: A14, the super user (R1); A5, Finance's all-records access (tightened by the field rules in §3); A8 and A13 (the Administrator bypass again); A2 (fixed by testing every profile); A12 (fixed by sharing Touches along with the KAM share).
- Strongest: A16 and A17 (documents and emails follow record access), A15 (seat changes are audited), and A1.
