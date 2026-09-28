/**
 * M18-S04-T02 — ALERTS: THE FAULTS DIGITAL INFRASTRUCTURE HEARS ABOUT BEFORE A USER DOES.
 *
 * A small rule engine fed with events from Plane B (D47): each rule counts its events in a sliding
 * window and fires when the count reaches the threshold, then keeps quiet for a cool-down so one
 * outage is one email, not a hundred. The rules (story M18-S04):
 *
 *   credits-header        the first X-API-CREDITS-REMAINING of the Kolkata day — the org is past
 *                         half its daily Zoho allowance (D47); once per day
 *   server-error-spike    5 or more 5xx answers within 5 minutes (PROVISIONAL — Jev, 0.66)
 *   failed-saves          3 or more failed saves within 10 minutes
 *   token-refresh-failed  any failed service-token refresh
 *   sign-webhook-failed   any Zoho Sign callback that could not be processed
 *   push-failed           any failed investor-app push
 *   backup-failed         any failed backup run
 *
 * Delivery is an interface (`AlertMailer`). Nothing here sends real email: the default mailer keeps
 * an outbox in memory, and the recipient comes from `ALERT_EMAIL_TO` once the mail provider is set
 * up (a human item). An alert names the rule, the count, the window, route templates and request
 * ids — never a body or an identity value (D52). A mailer that throws never fails the caller.
 */

import type { OpsRecord, OpsSink } from "../../lib/zoho/log";
import { kolkataNow } from "../../lib/data/clock";
import type { ErrorRecord } from "../http/error-log";

export type AlertEvent =
  | { readonly kind: "credits-header"; readonly at: number; readonly creditsRemaining: number }
  | { readonly kind: "server-error"; readonly at: number; readonly requestId: string; readonly route: string }
  | { readonly kind: "save-failed"; readonly at: number; readonly requestId: string | null; readonly route: string }
  | { readonly kind: "token-refresh-failed"; readonly at: number; readonly job: string }
  | { readonly kind: "sign-webhook-failed"; readonly at: number; readonly reason: string }
  | { readonly kind: "push-failed"; readonly at: number; readonly reason: string }
  | { readonly kind: "backup-failed"; readonly at: number; readonly reason: string };

export type AlertEventKind = AlertEvent["kind"];

export interface AlertRule {
  readonly key: string;
  readonly on: AlertEventKind;
  readonly threshold: number;
  readonly windowMs: number;
  /** After firing, the rule stays quiet this long. */
  readonly cooldownMs: number;
  /** Fire at most once per Kolkata calendar day (credits header). */
  readonly oncePerDay?: boolean;
  readonly subject: string;
}

const MIN = 60_000;
export const ALERT_RULES: readonly AlertRule[] = Object.freeze([
  { key: "credits-header", on: "credits-header", threshold: 1, windowMs: MIN, cooldownMs: 0, oncePerDay: true, subject: "Zoho credits: past half the daily allowance" },
  { key: "server-error-spike", on: "server-error", threshold: 5, windowMs: 5 * MIN, cooldownMs: 30 * MIN, subject: "Console: server errors spiking" },
  { key: "failed-saves", on: "save-failed", threshold: 3, windowMs: 10 * MIN, cooldownMs: 30 * MIN, subject: "Console: saves are failing" },
  { key: "token-refresh-failed", on: "token-refresh-failed", threshold: 1, windowMs: MIN, cooldownMs: 30 * MIN, subject: "Zoho: a service token failed to refresh" },
  { key: "sign-webhook-failed", on: "sign-webhook-failed", threshold: 1, windowMs: MIN, cooldownMs: 30 * MIN, subject: "Zoho Sign: a webhook could not be processed" },
  { key: "push-failed", on: "push-failed", threshold: 1, windowMs: MIN, cooldownMs: 30 * MIN, subject: "Investor app: a push failed" },
  { key: "backup-failed", on: "backup-failed", threshold: 1, windowMs: MIN, cooldownMs: 30 * MIN, subject: "Backup: a run failed" },
]);

export interface Alert {
  readonly rule: string;
  readonly subject: string;
  readonly at: number;
  readonly count: number;
  readonly windowMs: number;
  readonly firstAt: number;
  /** Request ids, route templates, job names and reason codes — at most 10 each. */
  readonly refs: readonly string[];
}

export interface AlertMessage {
  readonly to: string | null;
  readonly subject: string;
  readonly text: string;
}

export interface AlertMailer {
  send(message: AlertMessage): Promise<void>;
}

export interface OutboxMailer extends AlertMailer {
  sent(): readonly AlertMessage[];
  clear(): void;
}

/** Keeps messages in memory. The default until mail delivery is configured; sends nothing. */
export function createOutboxMailer(capacity = 200): OutboxMailer {
  let box: AlertMessage[] = [];
  return {
    async send(message) {
      box.push(message);
      if (box.length > capacity) box.splice(0, box.length - capacity);
    },
    sent: () => box.slice(),
    clear() {
      box = [];
    },
  };
}

const REF = /^[A-Za-z0-9._{}/\[\]-]{1,80}$/;

function refOf(e: AlertEvent): string | null {
  const v =
    e.kind === "server-error" ? `${e.route} ${e.requestId}`
      : e.kind === "save-failed" ? (e.requestId ? `${e.route} ${e.requestId}` : e.route)
        : e.kind === "token-refresh-failed" ? e.job
          : e.kind === "credits-header" ? `credits=${e.creditsRemaining}`
            : e.reason;
  return v.split(" ").every((p) => REF.test(p)) ? v : null;
}

export function alertText(alert: Alert): string {
  const mins = Math.round(alert.windowMs / MIN);
  return [
    alert.subject,
    `Rule: ${alert.rule} — ${alert.count} in ${mins} min (first ${kolkataNow(new Date(alert.firstAt))}, last ${kolkataNow(new Date(alert.at))} Asia/Kolkata).`,
    ...(alert.refs.length ? ["References:", ...alert.refs.map((r) => `  ${r}`)] : []),
    "Open System in the console for the Plane B lines.",
  ].join("\n");
}

export interface AlertEngineOptions {
  readonly mailer: AlertMailer;
  readonly to?: string | null;
  readonly rules?: readonly AlertRule[];
  readonly clock?: () => number;
  readonly onDeliveryError?: (error: unknown) => void;
}

export interface AlertEngine {
  /** Counts the event; returns the alerts it fired (delivery runs in the background). */
  record(event: AlertEvent): readonly Alert[];
  fired(): readonly Alert[];
  /** Resolves when every delivery started so far has settled. */
  settled(): Promise<void>;
}

export function createAlertEngine(options: AlertEngineOptions): AlertEngine {
  const rules = options.rules ?? ALERT_RULES;
  const clock = options.clock ?? Date.now;
  const windows = new Map<string, AlertEvent[]>();
  const lastFired = new Map<string, number>();
  const firedDay = new Map<string, string>();
  const history: Alert[] = [];
  let inflight: Promise<void>[] = [];

  const deliver = (alert: Alert) => {
    const p = Promise.resolve()
      .then(() => options.mailer.send({ to: options.to ?? null, subject: alert.subject, text: alertText(alert) }))
      .catch((error) => {
        try {
          options.onDeliveryError?.(error);
        } catch {
          /* ignored */
        }
      });
    inflight.push(p);
  };

  return {
    record(event) {
      const now = typeof event.at === "number" && Number.isFinite(event.at) ? event.at : clock();
      const out: Alert[] = [];
      for (const rule of rules) {
        if (rule.on !== event.kind) continue;
        const win = (windows.get(rule.key) ?? []).filter((e) => now - e.at < rule.windowMs);
        win.push(event);
        windows.set(rule.key, win);
        if (win.length < rule.threshold) continue;
        const day = kolkataNow(new Date(now)).slice(0, 10);
        if (rule.oncePerDay && firedDay.get(rule.key) === day) continue;
        const last = lastFired.get(rule.key);
        if (last !== undefined && now - last < rule.cooldownMs) continue;
        const refs = [...new Set(win.map(refOf).filter((r): r is string => r !== null))].slice(-10);
        const alert: Alert = Object.freeze({
          rule: rule.key, subject: rule.subject, at: now, count: win.length, windowMs: rule.windowMs,
          firstAt: win[0]!.at, refs: Object.freeze(refs),
        });
        lastFired.set(rule.key, now);
        firedDay.set(rule.key, day);
        windows.set(rule.key, []);
        history.push(alert);
        if (history.length > 500) history.splice(0, history.length - 500);
        out.push(alert);
        deliver(alert);
      }
      return out;
    },
    fired: () => history.slice(),
    async settled() {
      const now = inflight;
      inflight = [];
      await Promise.all(now);
    },
  };
}

/** Sign-webhook boundary reasons that mean "we could not process it" (not "it was forged"). */
const SIGN_FAILURES: ReadonlySet<string> = new Set([
  "provider-failed", "crm-failed", "callback-unavailable", "callback-deadline", "request-read-failed",
]);

/** The alert events one Plane B Zoho-call or refusal line implies. */
export function eventsFromOps(r: OpsRecord): AlertEvent[] {
  const out: AlertEvent[] = [];
  if (r.kind === "zoho-call") {
    if (r.creditsRemaining !== null) out.push({ kind: "credits-header", at: r.at, creditsRemaining: r.creditsRemaining });
    if (r.op === "refreshToken" && r.errorClass !== null) {
      out.push({ kind: "token-refresh-failed", at: r.at, job: r.actor.kind === "service" ? r.actor.job : "user-session" });
    }
  } else if (r.action === "signWebhook" && SIGN_FAILURES.has(r.reason)) {
    out.push({ kind: "sign-webhook-failed", at: r.at, reason: r.reason });
  }
  return out;
}

/** The alert events one Plane B error line implies. */
export function eventsFromErrors(r: ErrorRecord): AlertEvent[] {
  if (r.kind === "route-error") {
    return r.status >= 500 ? [{ kind: "server-error", at: r.at, requestId: r.requestId, route: r.route }] : [];
  }
  return r.source === "save-failed" ? [{ kind: "save-failed", at: r.at, requestId: r.failedRequestId, route: r.route }] : [];
}

/** Wraps a Plane B sink so every line it takes is also offered to the alert engine. */
export function tapOpsSink(inner: OpsSink, engine: () => AlertEngine): OpsSink {
  return {
    write(record) {
      inner.write(record);
      try {
        for (const e of eventsFromOps(record)) engine().record(e);
      } catch {
        /* Alerting never fails the call it watches. */
      }
    },
  };
}
