# UI cases retired (M19-S10, 4 Oct 2026)

Retired cases leave `ui-cases.json` `cases` and move to its `retired` array, each with a `retired_reason`; their plan tests carry `ui_mode: "retired"` and `ui_retired_reason`. The case ids are kept so history still resolves.

| Case | Story | Reason |
|---|---|---|
| TC-IM05-009 | M10-S02 | D113 ruling 1: a Finance-recorded receipt is matched at once; there is no pending receipt to offer 'Match it' on. The matching rule is now covered by TC-IM05-006 and the money-header cases. |
| TC-IM05-010 | M10-S02 | D113 ruling 1: the recorder-cannot-match-own-receipt rule is gone, so this case asserts a rule that no longer exists. |
| TC-IM10-010 | M15-S05 | Duplicate of TC-IM02-019: after the D22 step-up the reveal does not land on the log straight after the reason; the step-up panel is asserted there (M01-S10-NOTE-8). |
| TC-IM12-003 | M18-S02 | Duplicate of TC-IM02-004: the administrator rail is asserted there; the old 'exactly two pages' fact described a restricted Sahil, who is now the super user (D68/D110). |
| TC-IM12-004 | M18-S02 | Duplicate of TC-IM02-003: the Key Account Manager rail is asserted there with the merged rail names (D98). |
| TC-E03-003 | M03-S01 | Duplicate of TC-E03-001: the sign-in screen lists exactly the fourteen people who may sign in, so Gokul S is already absent from that list. |

## Plan-only cases left as ui-todo (no screen yet, or not yet reliable)

TC-E12-016, E12-017, E12-018, E12-019 (Plan editing and recovery actions: the form steps are not yet judged reliably; E12-017 and E12-019 were tried and scored 0.11 and 0.86 REVIEW), TC-E14-004, E14-005, E14-006, E14-007, E14-010, E14-012, E14-014, E14-020 (Teams grants, loops, successor handover, temporary access, failed-write test: multi-step form flows not yet converted). None duplicates a runnable case, so none is retired.
