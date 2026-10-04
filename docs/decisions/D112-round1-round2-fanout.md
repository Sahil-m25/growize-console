# D112 — Fan-out rounds 1 and 2: wiring review closed, bugs fixed, phase 3 local half (4 Oct 2026)

Built in the cloud workspace from 27e8ccb (laptop not linked); branch integrate2.

**Round 1 (5 agents; Modified_Time plumbing on Opus, four Sonnet builders).**
- Records now carry Zoho Modified_Time on read (Lead.mt, HoldingLine.version, Cases version, Events modifiedTime), so live writes send it and a stale edit gets 409 "Changed by someone else — reload".
- New routes: /api/investors/am/managers, /api/leads/[id]/claim, /api/cases/[id]/messages + /api/cases/deliveries, /api/events/[id]/sheet, /api/teams/{id} drawer fields, /api/documents/sign/templates, Numbers Service section.
- Lead-side Activity and Documents on their routes; receipt-drawer oversell refusal.
- Bugs fixed: offline Investors receipts now queue (TC-IM01-008/009); Auditor Activity reads the Finance trail (TC-IM10-008); TC-IM06-012 passes.
- Phase 2b: 57 of 66 done; 9 review (owner decisions or Zoho fields).

**Round 2 (6 Sonnet builders): phase 3 local half for M01–M17 (88 subtasks, 81 stories).**
- Jev UI cases run per story on the merged demo build; API cases as node tests on recorded fixtures; new suites: isolation matrix (63 cases), all 31 contract schemas through the stub receiver, field register, no-native-dialog CI gate.
- Bugs fixed: last native confirm() removed; Google Fonts request removed (TC-IM01-001); "Not done." no longer prefixes a recorded receipt (D21).
- Phase 3: 33 done, 47 waiting (sandbox/tester half), 1 review (TC-E11-016 reveal control).
- fanout.mjs record takes an optional `subtasks` list so a phase's local half can be recorded without marking its sandbox subtasks done.

**Gates on integrate2.** tsc clean; vitest 64 files / 543; node suite 86 files / 1,792; lint:a11y; scripts 44/44; jev 31/31; check:dialogs 0; build:local ok; Jev regression on round-1 stories matches the builders' results.
