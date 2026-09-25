#!/usr/bin/env python3
"""The daily diagnostic. Finds what is wrong and why. Changes nothing.

Read-only by construction: every client below is built from a read-only credential.
If you find yourself adding a write call here, stop — that belongs in a different job
with a different key and a person's decision in front of it.
"""
from __future__ import annotations
import argparse, datetime, json, os, pathlib, sys
from dataclasses import dataclass, field, asdict

REPORTS = pathlib.Path(__file__).parent / "reports"
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))

SEVERITIES = ("blocker", "major", "minor", "note")


@dataclass
class Finding:
    id: str
    area: str                 # outbox · invariants · money · zoho · supabase · paper · backups · repo
    severity: str             # one of SEVERITIES
    what: str                 # what is wrong, in one sentence
    why: str                  # the cause, with the evidence that shows it
    evidence: list[str] = field(default_factory=list)
    blast_radius: str = ""    # who or what is affected right now
    proposed_fix: str = ""    # empty is honest when the cause is not yet known
    repercussions: str = ""   # what the fix would break, replay, or make irreversible
    if_ignored: str = ""      # what happens if nobody acts
    failure_mode: str = ""    # the id in where-it-breaks.html, when it matches one

    def md(self) -> str:
        ev = "\n".join(f"  - {e}" for e in self.evidence) or "  - (none recorded)"
        return (
            f"## {self.id} · {self.area}: {self.what}\n\n"
            f"**Severity** {self.severity}"
            + (f" · **failure mode** {self.failure_mode}" if self.failure_mode else "")
            + "\n\n"
            f"**Why**\n{self.why}\n\n"
            f"**Evidence**\n{ev}\n\n"
            f"**Blast radius**\n{self.blast_radius or 'not yet assessed'}\n\n"
            f"**Proposed fix**\n{self.proposed_fix or 'None yet — the cause is not established. Do not guess.'}\n\n"
            f"**Repercussions of that fix**\n{self.repercussions or 'Unknown. Establish these before acting.'}\n\n"
            f"**If ignored**\n{self.if_ignored or 'not yet assessed'}\n\n"
            f"**Applied?** No. This job never applies anything.\n"
        )


# --- checks -----------------------------------------------------------------
# Each check receives read-only clients and returns a list of Finding.
# They are deliberately separate so one failing check cannot silence the others.

def check_outbox(ctx) -> list[Finding]:      return []   # undelivered age, dead letters, ordering
def check_invariants(ctx) -> list[Finding]:  return []   # the thirteen cross-org assertions
def check_money(ctx) -> list[Finding]:       return []   # unmatched, suspense, statement gaps, due < 0
def check_zoho(ctx) -> list[Finding]:        return []   # credits, concurrency, failed rules, human gate writes
def check_supabase(ctx) -> list[Finding]:    return []   # advisors, errors, slow queries, pg_cron age
def check_paper(ctx) -> list[Finding]:       return []   # stuck signings, ageing approvals, signed-without-file
def check_backups(ctx) -> list[Finding]:     return []   # object age and size, last restore drill
def check_repo(ctx) -> list[Finding]:        return []   # CI, secrets scan, schema drift, contract versions

CHECKS = [check_outbox, check_invariants, check_money, check_zoho,
          check_supabase, check_paper, check_backups, check_repo]


def build_context(readonly: bool = True):
    """Read-only clients. Never return anything that can write."""
    return {"readonly": readonly}


def run(day: datetime.date, dry_run: bool = False) -> str:
    ctx = build_context()
    findings: list[Finding] = []
    failed_checks: list[str] = []
    for i, check in enumerate(CHECKS, 1):
        try:
            findings.extend(check(ctx))
        except Exception as exc:                      # a broken check is itself a finding
            failed_checks.append(f"{check.__name__}: {exc!r}")
    rank = {s: i for i, s in enumerate(SEVERITIES)}
    findings.sort(key=lambda f: (rank.get(f.severity, 9), f.area))

    counts = {s: sum(1 for f in findings if f.severity == s) for s in SEVERITIES}
    head = [
        f"# Diagnostic — {day.isoformat()}",
        "",
        f"_Run {datetime.datetime.now(IST):%d %b %Y %H:%M} IST. Read-only. Nothing was changed._",
        "",
        f"**{len(findings)} findings** — "
        + ", ".join(f"{counts[s]} {s}" for s in SEVERITIES if counts[s]),
        "",
    ]
    if failed_checks:
        head += ["> **Checks that could not run** — treat as unknown, not as clean:", ""] + \
                [f"> - {c}" for c in failed_checks] + [""]
    if not findings:
        head += ["Nothing found. That is a statement about these checks, not about the system.", ""]
    body = "\n".join(f.md() for f in findings)
    report = "\n".join(head) + body

    if dry_run:
        print(report)
    else:
        REPORTS.mkdir(parents=True, exist_ok=True)
        (REPORTS / f"{day.isoformat()}.md").write_text(report, encoding="utf-8")
        (REPORTS / f"{day.isoformat()}.json").write_text(
            json.dumps([asdict(f) for f in findings], indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Daily diagnostic — explains, never fixes.")
    p.add_argument("--date", default="today")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    d = datetime.datetime.now(IST).date() if a.date == "today" else datetime.date.fromisoformat(a.date)
    run(d, a.dry_run)
