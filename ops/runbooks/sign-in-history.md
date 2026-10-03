# Who signed in, from where, and who failed

**4 Oct 2026 — written (M15-S05-T03).** The console has no sign-in history screen and cannot have one: Zoho CRM's audit
log does not record logins, and there is no sign-in API (D47, limit 1). The Logs page says so and links here instead of
showing an empty panel (TC-E11-019). This page is the out-of-band process D47 accepted.

**You will see:** nothing. This is a routine check, not an alarm. It is also the first stop after any of: a person says
they did not sign in when the console shows they did; a step-up failure burst on the Logs page (Plane C); a `refused`
burst against one person in Plane B (someone probing a book that is not theirs); a lost or stolen laptop or phone.

**Where it lives:** Zoho Directory, not Zoho CRM — Setup → Security Control → Login History. Per-person sessions, devices
and IPs are also at accounts.zoho.in → Security → Active Sessions, self-service and one person at a time, with no
org-wide view and no API.

**Who checks it:** Digital Infrastructure (the owner of this repo's ops), with a Zoho super administrator login. Nobody
else holds the Directory screen, and the Auditor reads the console's Logs page only.

**How often:** PROVISIONAL (owner to confirm) — weekly, on Monday, plus on demand after any trigger above. Zoho keeps
login history for a limited window, so a missed fortnight can be unrecoverable; if the window is shorter than a week on
this org, tighten the cadence to match.

**Steps (about ten minutes):**

1. Open Zoho Directory → Security Control → Login History. Set the range to the last seven days.
2. Filter for failed sign-ins. More than a handful against one person, or any from a country the team does not work
   from, is worth a message to that person.
3. Scan successful sign-ins for each seat holder (every human holds their own Enterprise seat, D53) from a new device
   or IP range. Compare with what the person tells you; do not guess.
4. Cross-check the console: Logs → Plane C step-up failures and identity reveals for the same people and days. A reveal
   with no matching sign-in is the thing to escalate.
5. Write one line in the ops notebook: date, range, what you saw, who you contacted. "Nothing unusual" is a line too.

**If something is wrong:** end that person's sessions in Directory, force a password reset, then follow
[pii-leak.md](pii-leak.md) if any identity reveal followed the suspect sign-in.

**Do not:** screenshot the Login History into a ticket or chat without blanking IPs and emails; paste a session token
anywhere; ask the console team to "add a sign-in screen" — there is nothing behind it (D47).
