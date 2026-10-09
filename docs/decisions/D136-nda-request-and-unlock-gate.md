# D136 — The IR asks Finance to send the paper; the app account waits for the 10% (9 Oct 2026)

**Status:** proposed. Built on branch `req-nda-unlock` (from `cd480c6`). Not deployed; no Zoho org touched. The new Lead fields
below are not in Zoho yet: until they exist, the request write fails (honestly) and Finance's queue says the fields are missing.

**Serves:** workflow gaps G1 and G2, Jira GC-1526. **Keeps:** D61 (Finance's side of a paper is written only by Finance), D53
(everyone on their own token), D93 / D115 ruling 1 (the account is created On hold; "Send welcome and unlock" is the one release),
D44 (guarded writes), M18-S11 (no native dialogs).

## The owner's workflow (8 Oct)
"NDA: the IR asks Finance to send it; the request lands on Finance's to-do list; Finance sends it via Zoho Sign (logged) and marks
it signed/approved. Supplementary agreement: requested by the IR, approved/signed by Finance. Money: Finance verifies the 10%
receipt, then the remainder within 30 days. After the 10% is verified an app account can be created in the investor app."

## Decision
1. **G1 — the IR's request.** While a round's next step is Finance's send ("Send it for signature"), the lead page's Paperwork row
   offers the IR "Ask Finance to send the NDA" (or "…the supplementary", once the final draft is agreed). It is one more IR beat
   (`request`) on `POST /api/leads/[id]/paperwork`: same row token, same If-Unmodified-Since, same 10 s Undo. It writes
   `Leads.NDA_Requested_At` / `NDA_Requested_By` (or, for the supplementary, `Supp_Requested_At` only) on the IR's own token. A second press answers
   `already` and writes nothing; a paper already sent or verified is refused (`already-sent`, 409). Nothing of Finance's is written.
2. **Finance's to-do.** Seats with the paper right (`doc`: Head of Finance, Finance Operations, Compliance, the super user) get one
   queue row per request not yet out: "Send the NDA — requested by <IR> n days ago" (now), oldest first, whose **Send it** opens
   Documents › Send one on that lead (the NDA goes on the Lead) or the investor's send drawer (the supplementary goes on the
   allotment). A Lead Zoho does not share with Finance is invisible, not refused, so until Digital Infrastructure confirms the
   Finance sharing rule on Leads (`GZ_FINANCE_LEADS_SHARED=1`) the queue carries a note that requests on unshared leads are not
   listed; a refused or failed read says so (never an empty "nothing waiting").
3. **G2 — the app account waits for the 10%.** "Send welcome and unlock" is refused unless the investor has at least one
   MATCHED Advance or Full receipt on a live (not Cancelled) allotment, read on the releaser's own token. The button is disabled
   with the reason; a receipts read that fails refuses as unknown. Creating the account On hold is unchanged.
4. **GC-1526 — Finance's override.** Finance Operations and the Head of Finance only (not the super user, not any other seat; the
   card never shows them the control) may unlock without the 10%: a typed reason (10–500 characters) and an on-page confirmation
   step. The reason is written first as a Note on the Contact under their own name (no Note, no unlock; a failed unlock takes the
   Note back), then the guarded Hold → Invite. One ops-log line (`app-access` / `override-unlocked`, ids only) and one Plane C
   line `app-access-override` (beside the `app-access-released` line, reason `override`).

## Zoho fields to create (Leads, PROPOSED)
| API name | Type | Read | Write |
|---|---|---|---|
| `NDA_Requested_At` | DateTime | IR, IR Manager, Channel Partner, Finance Operations, Head of Finance, Compliance and Audit, Digital Infrastructure | IR, IR Manager, Channel Partner (the console writes it on their token) |
| `NDA_Requested_By` | Lookup (Users) | same | same |
| `Supp_Requested_At` | DateTime | same | same |

`Supp_Requested_By` is **dropped**: Zoho refused to create it in the sandbox (`LIMIT_EXCEEDED`, the Leads module has hit its user-lookup
field limit). The supplementary request writes only `Supp_Requested_At`; Finance's queue names the requester as the lead's **Owner**
(the IR who owns the lead). `NDA_Requested_By` exists and stays. Leads has no room for any further user lookup (see
`zoho/changes/2026-10-08-09-sandbox.md`, P-KAM-ACCESS).

Finance needs the Finance sharing rule on Leads (owed since B-21 / W3-E2E-2) to see the requested leads at all. No Contact or
Receipts field is added; the gate reads `LLP_UnitAllocation_Module.Customer/Allocation_Status` and `Receipts.Allotment/Kind/Match_State`.

## Open
- Whether a matched **Part** payment before any Advance should also count as the 10% (built: Advance or Full only, as asked).
- Whether the super user should hold the override (built: no, per GC-1526's "Finance and Head of Finance").
