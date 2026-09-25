# Drills

Seventeen of the 145 failure modes are drill-only: they are not watched continuously because watching
them costs more than rehearsing them. A drill is a rehearsal on a schedule, with a written outcome.

| Drill | Cadence | Proves |
|---|---|---|
| Restore from S3 into a scratch Zoho sandbox | Quarterly | The backup is a backup, not a folder of files |
| Key rotation with two live keys | Quarterly | A rotation does not drop events |
| The reconcile against a seeded divergence | Monthly | The reconcile finds what it claims to find |
| Losing the integration user's token mid-day | Once, before go-live | The system degrades to a queue, not to corruption |
| A full statement-vs-ledger walk on a bad week | Once, before go-live | Finance can actually do the thing the design asks of them |

Each drill writes its outcome to `ops/drills/<date>-<name>.md`. A drill with no written outcome did not happen.
