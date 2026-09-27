# Build tracker in Slack

- Canvas: "Growize Console — Build Tracker", id `F0C4B32FJ4X`, channel #product-development-team (`C0C5LNH3PFS`).
- Source of truth: `pm/plan-merged/growize-console-plan.json` + `autopilot/console/progress.json` + `autopilot/console/BLOCKED.md`.
- Refresh: `python3 ops/tracker/canvas.py > ops/tracker/canvas.md`, then replace the canvas body with that file (Claude does this with the Slack canvas tools). The canvas is read-only by convention; people comment on rows.
