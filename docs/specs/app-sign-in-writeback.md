# Spec for the investor-app team: sign-in write-back to Zoho

**Ticket:** GC-1525 "App activity" · **Owner ask (9 Oct 2026):** "the KAM should have access to which investors have logged in and when — to know if they got the email, if they had problems etc.; this page can be used by IR too for their leads until full conversion."
**Decisions:** D52 (one Zoho org: the app writes the same Contact the console reads), D73/D93 (App_Access and the welcome), D53 (the console reads on each person's own token), D45 (no copy anywhere).

The console shows a card "App activity" on the investor record and an "App:" column on My accounts and the IR's Investors list. It **reads** five Contact fields. The investor app is their **only writer**. The console never writes them.

## 1. The fields (Zoho Contacts, API names exact)

| API name | Type | Meaning | Written |
|---|---|---|---|
| `App_First_Sign_In_At` | DateTime | First successful sign-in ever | Once, on the first success; never changed after |
| `App_Last_Sign_In_At` | DateTime | Most recent successful sign-in | Every successful sign-in |
| `App_Sign_In_Count` | Integer | Number of successful sign-ins, all time | Every successful sign-in (absolute value, see section 3) |
| `App_Last_Failed_Sign_In_At` | DateTime | Most recent failed sign-in | Every failed sign-in |
| `App_Failed_Sign_In_Count` | Integer | **Consecutive failed sign-ins since the last success.** Reset to `0` on a successful sign-in | Every failed sign-in; reset on success |

Already in Zoho and already written by the app (unchanged, listed so nobody renames them): `App_Welcome_At` (DateTime, written when the welcome is delivered), `App_Welcome_Channel` (`Email`, `WhatsApp`, `SMS`, `App push`). `App_Access` (`Hold` / `Invite`) is written by the console only; the app reads it.

Datetimes are ISO 8601 with an offset, e.g. `2026-10-08T14:05:00+05:30` (UTC `Z` is accepted; the console shows Asia/Kolkata). Counts are non-negative integers.

## 2. What counts as an event

- **Successful sign-in:** the app has verified the investor and opened a session. Not a token refresh, not a page load, not a deep-link open that reuses a live session.
- **Failed sign-in:** the app rejected a credential or one-time code for a **known, invited** account (wrong or expired code, locked out, link already used). An attempt for an address that matches no Contact has no record to write to and is not written.
- A sign-in for an account on `Hold` is a failed sign-in (the app refuses it).

## 3. Idempotency and ordering

The app retries and can be delivered twice. The writes must be safe to repeat:

1. **Write absolute values, never increments.** The app keeps its own authoritative sign-in log (it already has one for security). `App_Sign_In_Count` is that log's count of successes, `App_Failed_Sign_In_Count` is its count of failures since the last success. Writing the same event twice writes the same numbers.
2. **`App_First_Sign_In_At` is write-once:** send it only while the Contact's value is empty (or send the earliest success time from the log; a repeat is then a no-op).
3. **`App_Last_*_At` take the event's own time** (from the log, not the time of the write), and never move backwards: if the log's latest success is older than what Zoho holds, skip the write.
4. **One call per event, one record, only these fields:** `PUT /crm/v8/Contacts/{id}` with a body holding the fields in section 1 that changed. No `If-Unmodified-Since`: these fields have one writer, so there is no edit to lose. A 5xx or 429 is retried with backoff and the same values. Do not queue more than the latest state per Contact (if three failures arrive while Zoho is down, send one write with the final count).
5. **Burst control:** at most one write per Contact per 30 seconds for failures (send the latest absolute values when the window closes). Successes are written at once.
6. A failed write never blocks or delays the sign-in itself. The investor's session does not depend on Zoho.

## 4. Same org, no new seam (D52)

The Contact is in the one Enterprise org the console reads, so this is a same-org field write, not a webhook event: no payload to `contracts/`, no queue of ours, no copy in a database (D45). The app writes with the credential it already uses for `App_Welcome_At` (the **App integration** user, today "creates Cases only" in ACCESS-PLAN section 1): Digital Infrastructure must grant that profile **edit** on exactly these five fields and on `App_Welcome_At` / `App_Welcome_Channel`, and nothing more. The write is the app reporting its own system event (a sign-in it just saw), not a human's work done under the integration user.

## 5. What must not be written (D52, rule 7)

Timestamps and counts only. **Never** write: an IP address, device or browser identifier, user agent, location, the e-mail address or phone number that was typed, the failure reason or code, a session id, or any token. Do not put any of it in a Note, a Case or a log line that carries the Contact either. The console, the KAM and the IR see exactly: when, how many.

## 6. Zoho field set-up (Digital Infrastructure)

Create the five fields on Contacts as above (DateTime, DateTime, Integer, DateTime, Integer; not mandatory; default empty, count default empty so "never" stays distinguishable from `0`). New Contact fields are created **hidden** (rule 7), then granted:

| Profile | Access |
|---|---|
| App integration | Read and write |
| KAM, AM Head, Finance Head, Finance Ops, Compliance & Audit, Digital Infrastructure | Read only |
| IR | Read only (the IR sees this for their own-lead investors until conversion; sharing already limits which Contacts) |
| IR Manager, Viewer, Leadership | Read only |
| Channel Partner | Hidden |

Export the field definitions and the profile change into `zoho/investor/` in the same commit (CLAUDE.md: every Zoho change is an export).

Until the fields exist the console degrades: it asks Zoho again without them, shows the account facts (status, welcome time and channel), says "Sign-in activity is not recorded yet", and shows `App: -` in the list. Nothing breaks. The same happens if a profile cannot see a field.

## 7. Acceptance (for the app team)

1. Invite an account, sign in once: `App_First_Sign_In_At` = `App_Last_Sign_In_At` = that time, `App_Sign_In_Count` = 1, `App_Failed_Sign_In_Count` = 0 (or empty).
2. Sign in again later: first unchanged, last moves, count = 2.
3. Enter a wrong code twice: `App_Failed_Sign_In_Count` = 2, `App_Last_Failed_Sign_In_At` = the second attempt. The card reads "2 failed sign-ins since last success".
4. Sign in successfully: failed count back to 0, the sign-in count up by one.
5. Replay the same event twice (retry): Zoho holds the same values.
6. Inspect the Contact's timeline and the app's outbound logs: no IP, device, e-mail typed or reason anywhere.
