# Quick guide: Head of Finance

Seat: Head of Finance, Investors side. Dated 4 Oct 2026. Screenshots from staging go here when staging exists.

## Your job in one line
Be the second hand on refunds and money leaving, match what is still pending, and be the only one who releases holds and farm units, issues allotments and unlocks the app. Every reveal needs step-up and is logged.

## Start of day
1. Sign in with Zoho.
2. **Today** reads "Harsha's day": banked to date, balance outstanding, units reserved of released, tickets open. Money that is only recorded and not matched is not counted. **Holds running** and the **Land** card are on Today.

## Your day
**Match what is still pending.** A receipt Finance records is already matched (D113). Open **Payments**, then **Not reconciled**: IR claims and statement lines that did not auto-match show **Match it**. Press it. Banked to date rises, the allotment's payment status is recalculated, and the IR's gate opens on their next read.
Refunds and money leaving need your second hand, never the recorder's (D22).

**The first matched advance** opens the investor's app account **On hold**. The hold runs 30 days. No welcome email goes out.

**Holds.** Open a running hold: **Extend the hold** (step-up, then it waits for Zoho approval). Open a lapsed hold: **Release the reservation** (step-up, then a confirm that states the forfeit and refund). The units go back to the farm. The refund waits for Zoho approval.

**Allot.** After the balance is matched, open the investor, verify the allocation letter with its reference, and the allotment reads **Issued**. If money is still outstanding, the page refuses and names the amount.

**Block a signed paper.** Press **Block it** with a reason. The IR's gate clears and the paper row shows the reason.

**Farms.** **Release 54** on a farm adds released units. **Take it back** is refused when units are held, and names how many.

**Send welcome and unlock.** On an investor whose app card reads "On hold", press **Send welcome and unlock** and confirm. Later **Lock app access** needs a reason. The welcome never goes out on its own.

**Reveal an identity value.** Press reveal on a PAN. Give a reason (one of three). Pass the Zoho sign-in prompt. The value shows, then masks again when you hide it, sign out or change person. Three failed step-ups lock the action and alert Sahil and Pradeep.

**Activity, Numbers, Teams.** Activity shows actions in your scope. Numbers, **Collection**, shows money figures. Teams lists Investors-side seats.

**Tickets.** After a KAM hands you a bank ticket, open **Tickets, Mine** and close it.

## What you will not see
Nothing is hidden from you on money. Identity values still need step-up.

## End of day
Sign out.

## If something goes wrong
Report with `docs/launch/support-model.md`. For a mismatch use `ops/runbooks/money-mismatch.md`. Never edit a receipt amount to make it match.

Source: UAT-HOF (HOF-01 to HOF-15).
