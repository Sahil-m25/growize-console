# Change control (M20-S06)

Written 4 Oct 2026. One process for every new request, so the plan and the dates stay honest. The log is `docs/launch/change-log.md`.

## 1. The process in one paragraph

Any new request raised during a stage is written in the change log before it is built, with its size and impact. The owner decides: this stage (and says what moves out), the next stage, or the backlog. If it is accepted, the decision is recorded (a decision file if it changes the design, a BLOCKED.md line if it waits on a person), the plan files and the affected tests are updated by the end of that week, and any Zoho change is exported under `zoho/` in the same commit as the code that needs it. Nothing reaches production without the deploy approval. Nothing is built from a request that has no log row and no owner decision.

## 2. Steps

| # | Step | Who | Where it is written |
|---|---|---|---|
| 1 | **Raise.** Say what is wanted and why. | Anyone. Usually through Sahil (`docs/launch/support-model.md`, S4 requests). | A new row in `change-log.md` with status "Raised" |
| 2 | **Size and impact.** Stories, units or hours; which stories, tests, Zoho objects and seats it touches; what it risks. | Sahil, with the autopilot's numbers (`autopilot/status.json`) | Same row |
| 3 | **Decide.** This stage (name what moves out), next stage, or backlog. Or refuse. | The owner. The never-list below is always the owner's. | Same row, with the date. Plus the record in step 4 |
| 4 | **Record.** A decision file when the design changes; a BLOCKED.md line when a person must act or a fact is proposed. | Sahil or the coordinator | See section 3 |
| 5 | **Update the plan.** Stories and subtasks added, changed or removed. Affected test cases changed. | The coordinator (autopilot tooling) | `autopilot/console/queue.json` and the plan files, through the tooling. A person does not hand-edit them |
| 6 | **Build behind the log.** Zoho changes exported under `zoho/`. | The builder | Commit |
| 7 | **Approve the deploy.** | Sahil, as required reviewer of the `production` environment | GitHub environment (`ops/env/README.md`) |
| 8 | **Close.** Row status "Done", with the commit or decision. | Sahil | Same row |

At each week's end (Friday note, `stage-reviews.md` section 8): every accepted change has its plan and test updates, or the note says why not (acceptance 3 of M20-S06).

Test TC-E17-006: every story added after 28 Sep has a change-log row with the owner's decision.

## 3. The records

**Decision records.** `docs/decisions/Dnn-*.md`, one per decision, plus a row in `docs/DECISIONS.md`. A decision that creates work and adds no line to `docs/CARRY-FORWARD.md` has not finished. One line goes in `docs/SESSIONS.md` when work finishes: date, what changed, which decision or test case it serves (CLAUDE.md).
Never re-derive a decision from the code. If code and decision disagree, the decision is right and the code is a defect (CLAUDE.md).

**BLOCKED.md.** `autopilot/console/BLOCKED.md` holds what waits on a person. Lines are typed. A tick means "confirmed" (D106). Only the coordinator writes it (D111). The kinds in use:

| Kind | Means | Who closes it |
|---|---|---|
| PROVISIONAL | The build chose something. Confirm keeps it. | Owner |
| FACT CHANGE PROPOSED | A test case or story text disagrees with the merged console or a later decision. Confirm means the case is stale. Reverse means the case is right and the build changes. | Owner. D113 item 3 approved all of them. `ui-cases.json` may now be edited. |
| OWNER DECISION | A choice only the owner can make | Owner |
| HUMAN / HUMAN PROOF / task lines for Sahil | A person must do or prove something | The named person |
| GAP, BUG OPEN, BLOCK, STAGING PROOF, FRONT-END LOOP | Work notes with a cause | The coordinator, when proved |

**Fact changes.** A fact change is a proposal to change what a test expects, never to change what the system does. Order: the build is checked against the acceptance and the decisions (D109). If the case is stale, a FACT CHANGE PROPOSED line is filed. After approval the case is edited and the line is closed. If the case is right, the build is fixed.

**Owner rulings.** The owner rules in writing and the ruling becomes a decision file (D110, D113 are examples). The rulings sheet (`jev/cli.mjs`, D106) sorts open lines so the owner reads the ones that cost most first. The never-list for any automated judgment (D107): money, legal or signed paper, field-level security, seats, profiles and sharing, licences. These always go to the owner.

**Zoho exports.** Every Zoho change is an export committed under `zoho/`, in the same commit as the code that depends on it. Never a console-only change (CLAUDE.md, `zoho/README.md`). Zoho API names cannot be changed once created (C-12), so a new field is a commitment: name it carefully, and hide rather than delete if it was a mistake.

**Deploy approval.** `production` needs green staging and a manual approval by the required reviewer (`.github/workflows/pipeline.yml`, `ops/env/README.md`). Staging fails on any non-PASS Jev case, on an untrusted run, or on a missing calibrator. During hypercare, at most one release a day unless a P1 needs one (`docs/ops/hypercare.md`, proposed).

## 4. Size guide (proposed)

| Size | Meaning | Who may approve |
|---|---|---|
| Small | One unit, under 2 loop hours, no new Zoho field, module or permission | Sahil logs it. The owner is told in the Friday note. |
| Medium | A story, or any new Zoho field, module or sharing rule | The owner decides before it is built |
| Large | Several stories, a new seat, a change to a decision, money or paper | The owner decides in writing and a decision file is added |

Anything on the never-list is Large, whatever its size. These thresholds are my proposal. **OPEN — owner** to confirm.

## 5. What moves out
When a change enters the current stage, the decision names what moves out (to the next stage or the backlog). If nothing moves out, the log row says what absorbed it: a longer forecast, or a separate worktree clock (D105 did this).

## 6. Notes on specific acceptance text
- **M18-S14, acceptance 1.** The 401 body stays as built: `{error, code, landing, session, signedOut}`, no record data. Read the line as "answers 401 with no session cookie and no record data in the body" (D113 5a). The earlier wording "{code} only" is superseded. No test file was changed here.
- **M20-S03.** The story lists seats "Farm ops" and "viewer". Farm ops is kept as a persona, not provisioned (D113 5b). Guides for Farm ops and viewer are not written (`docs/launch/guides/README.md`).

## 7. Open items
| # | Item | Owner |
|---|---|---|
| 1 | Size thresholds in section 4 | owner |
| 2 | Who may approve in Sahil's absence | owner |
