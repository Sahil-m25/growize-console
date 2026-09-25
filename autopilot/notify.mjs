// Post an autopilot event to Slack (#growize-app-documents, C0AU2BH13SN) through an incoming webhook.
// The webhook URL lives in autopilot/.slack-webhook (git-ignored) or SLACK_WEBHOOK_URL. Without one, events are only
// written to autopilot/logs/slack-outbox.log and the scheduled Cowork check posts the summary instead.
// Usage: node autopilot/notify.mjs "<text>"      (markdown-ish; Slack mrkdwn)
import fs from "node:fs"; import { P } from "./lib.mjs";
const text = process.argv.slice(2).join(" ").trim(); if (!text) process.exit(0);
const f = P("autopilot", ".slack-webhook");
const url = process.env.SLACK_WEBHOOK_URL || (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "");
fs.mkdirSync(P("autopilot", "logs"), { recursive: true });
fs.appendFileSync(P("autopilot", "logs", "slack-outbox.log"), `${new Date().toISOString()}\t${url ? "sent" : "queued"}\t${text.replace(/\n/g, " ⏎ ")}\n`);
if (!url) process.exit(0);
try {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!r.ok) console.error("slack webhook", r.status, await r.text());
} catch (e) { console.error("slack webhook failed:", e.message); }   // never break a round over a notification
