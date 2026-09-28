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
  /** M18-S01-T03: extra lines for the message (the credits projection). Numbers and times only. */
  readonly lines?: readonly string[];
}

/* ===== M18-S01-T03 — THE DAILY CREDIT PROJECTION ========================================== */

/** One X-API-CREDITS-REMAINING reading. The header is org-wide, so every actor's reading counts. */
export interface CreditSample {
  readonly at: number;
  readonly creditsRemaining: number;
}

export interface CreditProjection {
  /** The Kolkata calendar day the readings belong to ("2026-09-28"). */
  readonly day: string;
  readonly at: number;
  readonly remaining: number;
  /** Credits spent per hour; null when there is nothing to measure it from. */
  readonly usedPerHour: number | null;
  /** Credits left at Kolkata midnight at that rate (negative: the day runs out first). */
  readonly projectedAtDayEnd: number | null;
  /** When the allowance runs out at that rate, if before midnight. */
  readonly exhaustsAt: number | null;
  /**
   * "trend": the slope between the day's first and latest readings (at least 10 min apart).
   * "half-allowance": one reading only — Zoho first sends the header at half the daily allowance (D47),
   * so the day has spent about what is left, since Kolkata midnight. PROVISIONAL: Zoho's window is a
   * rolling 24 h, not the calendar day, so this is an early-warning estimate, not an accounting.
   */
  readonly basis: "trend" | "half-allowance";
}

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 19_800_000;
const HOUR_MS = 3_600_000;
const TREND_MIN_SPAN_MS = 10 * 60_000;
/** Kolkata midnight at or before `at`. */
export const kolkataDayStart = (at: number): number => Math.floor((at + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;

/** Projects the day's credits from its readings (only the latest reading's Kolkata day counts). */
export function projectCredits(samples: readonly CreditSample[]): CreditProjection | null {
  const ok = samples.filter((x) => Number.isFinite(x.at) && Number.isFinite(x.creditsRemaining) && x.creditsRemaining >= 0);
  if (!ok.length) return null;
  const last = ok.reduce((a, b) => (b.at >= a.at ? b : a));
  const start = kolkataDayStart(last.at);
  const day = ok.filter((x) => x.at >= start && x.at <= last.at).sort((a, b) => a.at - b.at);
  const first = day[0]!;
  let perMs: number | null = null;
  let basis: CreditProjection["basis"] = "half-allowance";
  if (last.at - first.at >= TREND_MIN_SPAN_MS && first.creditsRemaining >= last.creditsRemaining) {
    perMs = (first.creditsRemaining - last.creditsRemaining) / (last.at - first.at);
    basis = "trend";
  } else if (first.at > start) {
    perMs = first.creditsRemaining / (first.at - start);
  }
  const end = start + DAY_MS;
  const projectedAtDayEnd = perMs === null ? null : Math.round(last.creditsRemaining - perMs * (end - last.at));
  const exhaustsAt = perMs !== null && perMs > 0 && projectedAtDayEnd !== null && projectedAtDayEnd < 0
    ? Math.round(last.at + last.creditsRemaining / perMs)
    : null;
  return Object.freeze({
    day: kolkataNow(new Date(last.at)).slice(0, 10),
    at: last.at,
    remaining: last.creditsRemaining,
    usedPerHour: perMs === null ? null : Math.round(perMs * HOUR_MS),
    projectedAtDayEnd,
    exhaustsAt,
    basis,
  });
}

/** The one-line projection for the alert and the System check. */
export function creditProjectionLine(p: CreditProjection | null): string {
  if (!p) return "Credits projection: no X-API-CREDITS-REMAINING reading yet today.";
  const time = (ms: number) => kolkataNow(new Date(ms)).slice(11);
  const head = `Credits projection ${p.day}: ${p.remaining} left at ${time(p.at)} Asia/Kolkata`;
  if (p.usedPerHour === null || p.projectedAtDayEnd === null) return `${head}; not enough readings for a rate yet.`;
  const tail = p.exhaustsAt !== null
    ? `runs out about ${time(p.exhaustsAt)} at this rate`
    : `about ${p.projectedAtDayEnd} left at midnight`;
  return `${head}; about ${p.usedPerHour}/h (${p.basis} basis); ${tail}.`;
}

/** The Plane B reason code for a projection: "exhausts-2320", "end-of-day-12000" or "no-rate". */
export function creditProjectionCode(p: CreditProjection | null): string {
  if (!p || p.projectedAtDayEnd === null) return "no-rate";
  if (p.exhaustsAt !== null) return `exhausts-${kolkataNow(new Date(p.exhaustsAt)).slice(11).replace(":", "")}`;
  return `end-of-day-${Math.max(0, p.projectedAtDayEnd)}`;
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

/** "=" admits the credits ref ("credits=20000"); before M18-S01 it was silently dropped. */
const REF = /^[A-Za-z0-9._{}/\[\]=-]{1,80}$/;

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
    ...(alert.lines ?? []),
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
  /** M18-S01-T03: today's credit projection from the credits-header readings seen so far. */
  creditProjection(): CreditProjection | null;
}

export function createAlertEngine(options: AlertEngineOptions): AlertEngine {
  const rules = options.rules ?? ALERT_RULES;
  const clock = options.clock ?? Date.now;
  const windows = new Map<string, AlertEvent[]>();
  const lastFired = new Map<string, number>();
  const firedDay = new Map<string, string>();
  const history: Alert[] = [];
  let inflight: Promise<void>[] = [];
  let credits: CreditSample[] = [];
  const noteCredits = (e: AlertEvent, now: number) => {
    if (e.kind !== "credits-header") return;
    const start = kolkataDayStart(now);
    credits = credits.filter((x) => x.at >= start);
    credits.push({ at: now, creditsRemaining: e.creditsRemaining });
    if (credits.length > 500) credits.splice(1, credits.length - 500); // keep the day's first reading
  };

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
      noteCredits(event, now);
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
          ...(event.kind === "credits-header" ? { lines: Object.freeze([creditProjectionLine(projectCredits(credits))]) } : {}),
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
    creditProjection: () => projectCredits(credits),
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

/** The service actor Plane B files the alarm's own lines under. */
export const ALERTS_ACTOR = "ops-alerts";

/**
 * Wraps a Plane B sink so every line it takes is also offered to the alert engine. M18-S01-T03: when the
 * credits alarm fires, two Plane B event lines follow the call line that carried the header —
 * "credits-alarm" (reason "remaining-<n>") and "credits-projection" (creditProjectionCode) — so the
 * day's first header and its projection stay on record after the in-memory engine is gone.
 */
export function tapOpsSink(inner: OpsSink, engine: () => AlertEngine): OpsSink {
  return {
    write(record) {
      inner.write(record);
      try {
        const e = engine();
        for (const ev of eventsFromOps(record)) {
          for (const alert of e.record(ev)) {
            if (alert.rule !== "credits-header" || ev.kind !== "credits-header") continue;
            const actor = { kind: "service", job: ALERTS_ACTOR } as const;
            inner.write({ kind: "event", at: alert.at, actor, action: "credits-alarm", reason: `remaining-${ev.creditsRemaining}`, recordIds: [] });
            inner.write({ kind: "event", at: alert.at, actor, action: "credits-projection", reason: creditProjectionCode(e.creditProjection()), recordIds: [] });
          }
        }
      } catch {
        /* Alerting never fails the call it watches. */
      }
    },
  };
}
