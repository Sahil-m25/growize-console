# Build tracker in Slack

- Canvas: "Growize Console — Build Tracker", id `F0C4B32FJ4X`, channel #product-development-team (`C0C5LNH3PFS`).
- Source of truth: `pm/plan-merged/growize-console-plan.json` + `autopilot/console/progress.json` + `autopilot/console/BLOCKED.md`.
- Refresh (D98): `python3 ops/tracker/canvas.py --push`. It reruns `autopilot/status.mjs`, writes `canvas.md`, and replaces the canvas body through Slack's `canvases.edit` when a bot token is present (`ops/tracker/.slack-token`, git-ignored, or `SLACK_BOT_TOKEN`). `autopilot/done.mjs` runs it after every recorded round, so the canvas follows the build by itself.
- Token (one-time, Sahil): api.slack.com/apps → Create app → From scratch → OAuth & Permissions → Bot token scopes `canvases:write` (and `canvases:read`) → Install to workspace → copy the `xoxb-…` token into `ops/tracker/.slack-token`. Invite the app to the channel or share the canvas with it (edit access).
- Without a token the file is still written and Claude can push it with the Slack connector.
- `ui-run.json` holds the latest full Jev run (summary line shown in the canvas).
