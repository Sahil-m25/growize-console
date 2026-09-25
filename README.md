# Growize

One repository. Four applications, two Zoho orgs, two Supabase projects, one design.

```
docs/            the five documents, every decision as its own file, and what is still open
contracts/       30 event schemas — the typed language between the two sides
zoho/            customisation exports for the CRM org(s); the org is code too
db-leads/        Supabase leads project — migrations, edge functions, seeds
db-investors/    Supabase investors project — the same, plus the app's own tables
console/         the IR lead console (12 pages) — with the working prototype
portal/          the Investor Management portal (12 pages) — with the working prototype
app/             the investor app (5 pages)
ops/             the daily diagnostic, backups, drills, six runbooks
tools/           the code graph and the agent tooling
```

## Start here

| If you are | Read, in this order |
|---|---|
| **Sahil** (deciding) | `docs/ready-to-build.html` — the eleven calls only you can make and the twelve accounts that block everything, tickable. `docs/READY-TO-BUILD.md` is the same thing in markdown |
| **The builder** | `CLAUDE.md`, then `docs/DECISIONS.md`, then `docs/plan.html` for this week |
| **The tester** | `docs/test-book.html` — 104 cases, each carrying the decision it defends |
| **The founder** | `docs/plan.html` — thirteen weeks, page by page |
| **An agent** | `CLAUDE.md`. Always. |

## The documents

| File | What it is |
|---|---|
| `docs/build-book.html` | The whole design in 25 sections and three appendices — data model, write path, rules, money, compliance, automation, and now the repository (§23), the daily diagnostic (§24) and how the agent works (§25). § numbers are cited everywhere else |
| `docs/test-book.html` | 22 phases, 104 cases, 87 unit tests, 7 UAT scripts, a 17-case smoke pack, 10 personas |
| `docs/where-it-breaks.html` | 145 failure modes across 14 groups: 27 near-certain, 53 silent, 52 that halt |
| `docs/plan.html` · `docs/plan.xlsx` | Thirteen weeks by page. Coding Mon–Fri, testing Sat–Sun |
| `docs/design-spec.html` | The design system — tokens, type, the writer colours |
| `docs/ready-to-build.html` | *Eleven Calls, Twelve Accounts* — what is still open, sorted by who can close it. Tick a row and the page remembers |
| `docs/READY-TO-BUILD.md` | The same, in markdown, for grepping and for agents |
| `docs/DECISIONS.md` | 25 decisions, one file each. Why anything is the way it is |
| `docs/OPEN-QUESTIONS.md` | Each with the default the build assumes |
| `docs/SESSIONS.md` | One line per session. What changed, which decision it serves |
| `docs/archive/` | Superseded working documents. None authoritative |

## Why one repo and not several

Every failure this design fears is a copy of one fact drifting from another copy. Splitting the
console, the portal and the app into separate repositories would reproduce that problem in git:
a change to `contracts/` would need three pull requests that can land in any order, and the day
they are out of step is the day the seam breaks. One repository means one history, one clone, and
a cross-cutting change is one commit that is either in or out.

Folders, not submodules. A submodule is a second repository wearing a folder's clothes, with its own
pointer to keep in sync — the same drift, hidden.

## The daily diagnostic

`ops/diagnose/run.py` runs every morning, checks eight areas, and writes a report to
`ops/diagnose/reports/YYYY-MM-DD.md`. It **never fixes anything.** Each finding carries what is wrong,
why, the evidence, the blast radius, a proposed fix, the repercussions of applying it, and what happens
if it is ignored. A person decides. See `ops/diagnose/README.md`.

## Setup

```bash
cp .env.example .env          # values come from the vault, never from git
pip install graphifyy && graphify install --platform claude
graphify build                # the code graph — rebuild after any structural change
```

`tools/PLUGINS.md` explains what each tool does, what it measures, and where it must not be used.
