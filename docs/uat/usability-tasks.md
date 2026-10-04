# Usability session — tasks list

- **What this is:** the written script for the two-IR observed session [M18-S08-T03, M18-S08-T04, TC-E16-016]. Two IRs each do a normal day's work on the staging sandbox while one observer times them and writes down every stumble. It finds what the scripted UAT cannot: a step the page lets you do that a person does not see how to do.
- **Not the same as UAT.** UAT (`scenarios/01-ir.md`) checks the app does what each step says. This session checks a person can find and finish the step alone. Task IR-23 in the IR scenario is this session, summarised.
- **Who:** two IRs from the seeded demo book (Rohit and Kavya unless Sahil names others), one at a time, plus one observer (not the IR's manager, not Sahil). Session length: 45 minutes each, plus 10 minutes to set up and 10 to talk afterwards. Target: Day 3 to Day 5 of the UAT slot (`README.md`).
- **Files:** `usability-consent.md` (read it out and have it signed before starting), `usability-timing-sheet.csv` (one row per task per participant; the observer fills it in).

## Before the session

1. Sandbox seeded and reset the same morning. Entry criteria of `README.md` met. Smoke suite green.
2. The IR has signed in once before, with their own Zoho login. They are told which leads are theirs; they are not told where anything is.
3. Finance has sent the NDA for the lead used in task 5 (the state of fixture `L2_NDA_SENT_BY_FINANCE`: sent for signature, the IR has not told the investor yet). Task 6's lead is one the IR owns at Said yes with no payment reported.
4. The observer has the timing sheet, a watch that shows seconds, and a second screen or a seat behind the IR. The IR shares their screen or the observer sits beside them. No voice recording.
5. Sandbox data only. If a real investor's name, PAN or bank number appears on the screen, stop and tell Sahil (that is a P1, `defect-intake.md`).

## What the observer says, and does not say

Say once, at the start: "This is a test of the app, not of you. Say what you are thinking as you go. I will not help unless you ask, and if you ask I will write it down as a stumble. You can stop at any time."

Never point at a control, read a label aloud, or say "try the menu". If the IR is silent for 60 seconds, ask "What are you looking for?" and write the answer down. At 3 minutes over the target on a task, say "Let's move on" and mark the task Not done.

## The tasks

Do them in this order. Read each card out loud; the IR does not see this page. Times are targets set from the number of steps in the prototype; re-set them after the first session [PROVISIONAL, Sahil to confirm].

| # | Task, as said to the IR | Done when | Target | Stories | Lead used |
|---|---|---|---|---|---|
| U1 | "You have just signed in. Tell me what you would do first today and how many things are due now." | The IR names the first follow-up on Today and the due-now count shown ('<n> due now · <m> open'). | 1 min | M05-S01 | Today |
| U2 | "A caller gave you only the last digits of a mobile number: 12277 (Kavya: 77310). Find that investor and open their page." | The right lead page is open: Meera Krishnan (Kavya: Deepa Varghese). Phone shown matches. | 1 min | M06-S03, TC-E06-011 | search box |
| U3 | "You just called them and they were interested. Record the call, and say they should be called back tomorrow evening." | A call is logged, a next step 'Call back' is set for tomorrow at the evening time offered. The IR did not use the Undo by mistake. | 3 min | M07-S02, M07-S03, TC-E07-016 | the lead from U2 |
| U4 | "A new person gave you their number at a stall and said WhatsApp is fine. Add them as 'Usability Lead 1', mobile 98861 40277, source Website." | 'Usability Lead 1 was added' shows. The lead is on the IR's Today. WhatsApp permission is ticked, with how it was given. | 3 min | M04-S01, M04-S03 | new |
| U5 | "Finance has sent this investor their NDA. You told them by WhatsApp that it is in their inbox. Record that." | The NDA row reads told, by WhatsApp. The IR then finds 'They say it's signed' unaided after being asked: "Two days later they say they signed. Record that." The row reads 'with Finance'. | 3 min | M12-S11, TC-E09-015 | Sanjay Menon (Kavya: the lead Finance prepared) |
| U6 | "This investor says they paid their balance by RTGS today. Tell Finance." | 'Payment reported - waiting for Finance' shows. The IR did not mark the lead paid. | 4 min | M08-S03, TC-E08-011 | Prakash Bhat is already reported: use a Said-yes lead (Kavya: Joseph Mathew, balance) |
| U7 | "Earlier today you pressed something by mistake on that lead. Undo it." | The IR finds Undo (10 seconds) or the un-tick with a reason, whichever applies, or says it is too late. Scored on finding it, not on the outcome. | 2 min | M07-S03, M08-S01, IR-06 | the lead from U5 or U6 |
| U8 | "Your manager asks what you did today. Show me." | The IR opens Activity and finds their own actions, latest first, without leaving their own pages. | 2 min | M15-S01, M15-S03, IR-22 | Activity |
| U9 | "You are leaving. Make sure the next person who uses this computer sees nothing of yours." | The IR signs out. The observer then opens the sign-in page: no draft or name of the IR remains. | 1 min | M18-S02, IR-24 | Sign out |
| U10 | "Now work your Today list as you would on a normal morning. I will watch and not help." | The first five items the IR picks up are done without help; stumbles are in the notes. | 15 min | TC-E16-016, IR-23 | Today |

Total target for U1 to U9: 20 minutes of task time; with U10, about 35.

## What counts

- **Completed unaided:** the Done-when column is met and the observer gave no help. A hint, a pointing finger, or the IR asking "where is it?" is help.
- **Stumble:** any of these, one row in the timing sheet each: pressed the wrong control; pressed the right control and did not see it worked; read a message and did the opposite; went to a page and backed out; paused for more than 30 seconds; said "I expected..." or "where is...".
- **Severity of a stumble:** 3 = the task was not finished or a wrong thing was saved; 2 = finished late or after help; 1 = finished, but the IR said it was unclear. A severity 3 is entered as a P2 defect (`defect-intake.md`) with the task number as the step; a severity 2 repeated by both IRs is also a P2; the rest are P3.
- **Pass for the session** [M18-S08 AC2]: task times and stumbles are recorded for both IRs, and every task has either been completed unaided by at least one IR or has a logged defect. The session does not block go-live by itself; a severity 3 on U3, U5 or U6 for both IRs is raised with Sahil before sign-off.

## After the session

1. The observer totals the timing sheet (seconds per task, stumbles per task) and sends it to Sahil the same day. Names in the sheet are IR1 and IR2; the key to who is who stays with the observer.
2. Each stumble of severity 2 or 3 becomes a defect line as in `defect-intake.md`, citing the task id (U1 to U10).
3. Sahil decides which stumbles are fixed before go-live and which wait.
