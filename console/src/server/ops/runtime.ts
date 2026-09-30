/**
 * M18-S04 — server-only composition of Plane B's error lines and the alert engine.
 *
 * Routes import `withErrorCapture` from here. Background jobs that have no Plane B call of their own
 * (investor-app push, backup) report a failure with `reportOpsFailure`. Mail is not sent: the
 * outbox mailer holds each alert until delivery is configured (human item: provider + `ALERT_EMAIL_TO`).
 */

import { createAlertEngine, createOutboxMailer, creditProjectionLine, eventsFromErrors, tapOpsSink, type AlertEngine, type AlertMailer } from "./alerts";
import type { OpsSink } from "../../lib/zoho/log";
import { createErrorLog } from "../http/error-log";
import { sharedErrorSink } from "../logs/factory";
import { createErrorCapture } from "../http/error-capture";
import { requestGate } from "../http/request-gate";
import { fixtureModeOn } from "../../lib/fixture-mode";

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

const capture = createErrorCapture({
  log: errorLog,
  onRecord: (record) => {
    for (const e of eventsFromErrors(record)) alertEngine().record(e);
  },
});

/* ---- process-start hooks: background checks that must run even when no webhook arrives ---- */
const G = globalThis as typeof globalThis & { __gzOpsStarted?: boolean };
/**
 * Once per process, on the first request through any wrapped route: start the 10-minute Zoho Sign re-read of open
 * requests (server/zoho-sign/runtime ensureSignCheck, M12-S05-T02), so a missed webhook is still caught. Lazy (the
 * Sign runtime is imported only here, on first use), never in fixture mode (D65), and never failing a request.
 * ensureSignCheck itself does nothing until Zoho Sign and the provider-callback token are configured.
 */
export function startProcessHooks(env: NodeJS.ProcessEnv = process.env,
  loadSign: () => Promise<{ ensureSignCheck(): void }> = () => import("../zoho-sign/runtime")): void {
  if (G.__gzOpsStarted) return;
  G.__gzOpsStarted = true;
  if (fixtureModeOn(env)) return;
  void loadSign().then((m) => m.ensureSignCheck()).catch(() => { /* retried by the next webhook (it calls ensureSignCheck too) */ });
}

/** Every route handler, wrapped: Plane B error lines (M18-S04-T01), the process-start hooks above, and the request
 *  gate (M18-S15-H2/H3: rate limits, then the Origin check on writes) — inside the capture, so a 403/429 still
 *  carries its x-request-id, and before the handler (and any guardApi inside it), so a refused write runs nothing. */
export const withErrorCapture: typeof capture = (handler, route) => {
  const wrapped = capture(requestGate(handler, route), route);
  return (request, context) => {
    try { startProcessHooks(); } catch { /* a hook never fails a request */ }
    return wrapped(request, context);
  };
};

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

/** M18-S01-T03: the day's credit projection line (System page / ops check), from the readings this process has seen. */
export function creditsProjectionLine(): string {
  return creditProjectionLine(alertEngine().creditProjection());
}
