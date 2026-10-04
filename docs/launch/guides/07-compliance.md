# Quick guide: Compliance and Audit

Seat: Compliance and Audit, Investors side (one seat, D78). Dated 4 Oct 2026. Screenshots from staging go here when staging exists.

## Your job in one line
Own KYC: pass or fail it, and read identity values only when you have a reason. You also read the Finance trail. You write no money.

## Start of day
1. Sign in with Zoho. You are admitted on the Investors side.
2. Open **Tickets** for your own (for example FIRC) and **Documents** for the FEMA row.

## Your day
**Pass a KYC.** Open the investor, press **Work the KYC**, then **Pass it** (or **Fail it**). The investor's KYC then reads passed.

**Fail a passed KYC.** Press **Fail it**. A confirm in the page shows the consequence. It runs only when you press the confirm button.

**Reveal a PAN.** Press reveal on the PAN. Give a reason. Pass the Zoho sign-in prompt. The value shows. It masks again when you hide it or sign out. **Activity** records "Revealed a PAN". Three failed step-ups lock the action and alert Sahil and Pradeep.

**FEMA.** Open the declaration. "FEMA outstanding" clears once it is completed.

**Read the trail.** **Activity** lists actions on investors, allotments, payments, documents and tickets in your scope. D113 (4 Oct): you read the Finance trail read-only, as built, and there is no separate Auditor profile. Identity events show as events, with investor details held back where your seat lacks the right.

## What you will not see or do
- No **Record a receipt**, **Match it** or statement upload. Receipts are readable. Bank numbers stay masked or hidden.
- A Bank ticket shows no **Close it** for you. It needs a seat that can see bank accounts.
- Finance (Meena) is not offered **Work the KYC**. Only you.
- A KAM or IR sees only "clear" or "with Finance".

## End of day
Sign out. Revealed values are masked again.

## If something goes wrong
Report with `docs/launch/support-model.md`. If a value was revealed to someone who should not have it, tell Sahil at once and read `ops/runbooks/pii-leak.md`.

Source: UAT-CMP (CMP-01 to CMP-09) and UAT-AUD for the read-only trail. Open: the UAT script treats Latha's seat as a read-only Auditor, and D78 and D113 make Compliance and Audit one seat. The owner confirms the one profile. **OPEN — owner**.
