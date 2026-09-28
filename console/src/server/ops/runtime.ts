/**
 * M18-S04 — server-only composition of Plane B's error lines and the alert engine.
 *
 * Routes import `withErrorCapture` from here. Background jobs that have no Plane B call of their own
 * (investor-app push, backup) report a failure with `reportOpsFailure`. Mail is not sent: the
 * outbox mailer holds each alert until delivery is configured (human item: provider + `ALERT_EMAIL_TO`).
 */

import { createAlertEngine, createOutboxMailer, eventsFromErrors, tapOpsSink, type AlertEngine, type AlertMailer } from "./alerts";
import type { OpsSink } from "../../lib/zoho/log";
import { createErrorLog } from "../http/error-log";
import { sharedErrorSink } from "../logs/factory";
import { createErrorCapture } from "../http/error-capture";

export const errorLines = sharedErrorSink();
export const alertOutbox = createOutboxMailer();

let mailer: AlertMailer = alertOutbox;
let engine: AlertEngine | null = null;

export function alertEngine(): AlertEngine {
  engine ??= createAlertEngine({ mailer, to: process.env.ALERT_EMAIL_TO ?? null });
  return engine;
}

/** Swap in a real mailer once delivery is configured. Resets the engine's windows. */
export function setAlertMailer(next: AlertMailer): void {
  mailer = next;
  engine = null;
}

export const errorLog = createErrorLog(errorLines);

export const withErrorCapture = createErrorCapture({
  log: errorLog,
  onRecord: (record) => {
    for (const e of eventsFromErrors(record)) alertEngine().record(e);
  },
});

/** Wrap any Plane B sink so its lines feed the alerts (credits header, token refresh, Sign webhook). */
export const alertingOpsSink = (inner: OpsSink): OpsSink => tapOpsSink(inner, alertEngine);

const REASON = /^[a-z][a-z0-9-]{0,39}$/;

/** For jobs with no Plane B call of their own. `reason` is a short code, never a message. */
export function reportOpsFailure(kind: "push-failed" | "backup-failed", reason: string, at: number = Date.now()): void {
  try {
    alertEngine().record({ kind, at, reason: REASON.test(reason) ? reason : "unrecognised" });
  } catch {
    /* never throws into the job */
  }
}
