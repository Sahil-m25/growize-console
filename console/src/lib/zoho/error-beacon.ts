/**
 * M18-S04-T01 — THE CLIENT ERROR BEACON: WHAT A BROWSER MAY TELL THE SERVER ABOUT A FAILURE.
 *
 * D47 Plane B / D52: a browser report carries a source, the page's route, a request id, Zoho's
 * status and code, and the error's constructor name — never a message, a stack, a URL query or
 * anything typed. Messages and stacks are exactly where a phone number or a PAN rides, so the
 * payload builder below has no way to copy them, and the server (`/api/errors`) rebuilds the
 * report from its own allow-list anyway.
 *
 * The front-end loop wires this: `installErrorBeacon()` once from a client component (window
 * `error` + `unhandledrejection`), and `sendErrorBeacon({ source: "save-failed", … })` from the save
 * queue when Zoho refuses a write — three of those in ten minutes alert Digital Infrastructure.
 * Safe to import on the server: nothing touches `window` until a function is called.
 */

export const ERROR_BEACON_PATH = "/api/errors";
export const BEACON_SOURCES = ["onerror", "unhandledrejection", "save-failed", "fetch-failed"] as const;
export type BeaconSource = (typeof BEACON_SOURCES)[number];
/** Reports one page load may send; a render loop throwing forever must not flood Plane B. */
export const MAX_BEACONS_PER_PAGE = 20;

export interface BeaconReport {
  readonly source: BeaconSource;
  /** The page path; the server replaces any segment holding a digit with `{id}`. */
  readonly route?: string;
  /** The `x-request-id` of the failed call, when there was one. */
  readonly requestId?: string;
  readonly zohoStatus?: number;
  readonly zohoCode?: string;
  /** `TypeError`, `ZohoRefused`… — the constructor name only. */
  readonly errorName?: string;
}

/** The JSON body sent. Only the allowed fields are copied, whatever the caller passed. */
export function beaconPayload(r: BeaconReport): string {
  const out: Record<string, string | number> = { source: r.source };
  if (typeof r.route === "string") out.route = r.route.split(/[?#]/)[0]!.slice(0, 200);
  if (typeof r.requestId === "string") out.requestId = r.requestId.slice(0, 64);
  if (typeof r.zohoStatus === "number") out.zohoStatus = r.zohoStatus;
  if (typeof r.zohoCode === "string") out.zohoCode = r.zohoCode.slice(0, 64);
  if (typeof r.errorName === "string") out.errorName = r.errorName.slice(0, 40);
  return JSON.stringify(out);
}

let sent = 0;

export function sendErrorBeacon(r: BeaconReport): boolean {
  if (typeof window === "undefined" || sent >= MAX_BEACONS_PER_PAGE) return false;
  sent++;
  const body = beaconPayload(r);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      return navigator.sendBeacon(ERROR_BEACON_PATH, new Blob([body], { type: "application/json" }));
    }
    void fetch(ERROR_BEACON_PATH, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

const nameOf = (x: unknown): string | undefined =>
  x instanceof Error && /^[A-Za-z]{1,40}$/.test(x.name) ? x.name : undefined;

/** Listens for uncaught errors and rejections; returns the function that stops listening. */
export function installErrorBeacon(target: Window = window): () => void {
  const onError = (e: ErrorEvent) => void sendErrorBeacon({ source: "onerror", route: target.location.pathname, errorName: nameOf(e.error) });
  const onRejection = (e: PromiseRejectionEvent) =>
    void sendErrorBeacon({ source: "unhandledrejection", route: target.location.pathname, errorName: nameOf(e.reason) });
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
