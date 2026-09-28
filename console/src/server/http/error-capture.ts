/**
 * M18-S04-T01 — EVERY ROUTE HANDLER, WRAPPED: A SERVER ERROR IS ALWAYS A PLANE B LINE.
 *
 * `withErrorCapture(handler, "/api/route")` gives each request an id (the caller's `x-request-id`
 * when it is a safe token, a fresh UUID otherwise), answers with it in `x-request-id`, and files a
 * Plane B line (`error-log.ts`) when the handler throws, answers 5xx, or noted a Zoho failure on the
 * way. The line holds request id, user id, route template, statuses, Zoho status/code and the
 * error's class and name — never a body, a message or an identity value (D47, D52).
 *
 * A handler that turns a Zoho failure into its own response calls `noteZohoFailure(failure)` so the
 * line still carries Zoho's status and code; one that would rather throw throws `ZohoRouteError`.
 * An uncaught throw becomes a 500 that says only that something failed and quotes the request id.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ZohoFailure } from "../../lib/zoho/errors";
import { decodeSession, SESSION_COOKIE } from "../../lib/data/session";
import { safeErrorName, safeRequestId, safeUserId, safeZohoCode, type ErrorLog, type ErrorRecord } from "./error-log";

export const REQUEST_ID_HEADER = "x-request-id";

/** Thrown by a handler to fail with Zoho's verdict attached. */
export class ZohoRouteError extends Error {
  readonly failure: ZohoFailure;
  constructor(failure: ZohoFailure) {
    super(`Zoho call failed: ${failure.kind}`);
    this.name = "ZohoRouteError";
    this.failure = failure;
  }
}

type ZohoNote = { readonly status: number | null; readonly code: string | null; readonly kind: string };
type Context = { readonly requestId: string; zoho: ZohoNote | null };
const store = new AsyncLocalStorage<Context>();

const zohoNoteOf = (f: ZohoFailure): ZohoNote => ({
  status: f.status,
  code: "code" in f && typeof f.code === "string" ? f.code : null,
  kind: f.kind,
});

/** The current request's id, inside a wrapped handler. */
export const currentRequestId = (): string | null => store.getStore()?.requestId ?? null;

/** Attach Zoho's verdict to the current request's Plane B line (the last one noted wins). */
export function noteZohoFailure(failure: ZohoFailure): void {
  const ctx = store.getStore();
  if (ctx) ctx.zoho = zohoNoteOf(failure);
}

/** What the console answers when a handler throws a Zoho failure. */
export function statusForZohoFailure(f: ZohoFailure): number {
  switch (f.kind) {
    case "conflict": return 409;
    case "forbidden": return 403;
    case "not-found": return 404;
    case "auth-expired":
    case "auth-rejected": return 401;
    case "invalid-data":
    case "partial": return 422;
    case "credits-exhausted":
    case "concurrency-exceeded":
    case "rate-limited-unclassified":
    case "busy": return 503;
    default: return 502;
  }
}

/** The session's person key from the request's cookie, if it is a safe user id. */
export function userIdOf(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const at = part.indexOf("=");
    if (at < 0 || part.slice(0, at).trim() !== SESSION_COOKIE) continue;
    return safeUserId(decodeSession(part.slice(at + 1).trim())?.who);
  }
  return null;
}

function withRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

export interface ErrorCaptureOptions {
  readonly log: ErrorLog;
  /** Called with every filed line (the alert engine listens here). Must not throw; if it does, it is ignored. */
  readonly onRecord?: (record: ErrorRecord) => void;
  readonly clock?: () => number;
  readonly newId?: () => string;
}

export type RouteHandler<C> = (request: Request, context: C) => Response | Promise<Response>;

export function createErrorCapture(options: ErrorCaptureOptions) {
  const clock = options.clock ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const file = (entry: Parameters<ErrorLog["routeError"]>[0]) => {
    const record = options.log.routeError(entry);
    try {
      options.onRecord?.(record);
    } catch {
      /* Alerting never fails the request. */
    }
  };

  return function withErrorCapture<C>(handler: RouteHandler<C>, route: string): (request: Request, context: C) => Promise<Response> {
    return async (request, context) => {
      const startedAt = clock();
      const requestId = safeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? newId();
      const ctx: Context = { requestId, zoho: null };
      const base = { requestId, route, method: request.method };
      let response: Response;
      try {
        response = await store.run(ctx, () => handler(request, context));
      } catch (error) {
        const zoho = error instanceof ZohoRouteError ? zohoNoteOf(error.failure) : ctx.zoho;
        const status = error instanceof ZohoRouteError ? statusForZohoFailure(error.failure) : 500;
        file({
          ...base, at: startedAt, userId: userIdOf(request), status,
          zohoStatus: zoho?.status ?? null, zohoCode: safeZohoCode(zoho?.code), errorClass: zoho?.kind ?? "exception",
          errorName: error instanceof Error ? safeErrorName(error.name) : null, durationMs: clock() - startedAt,
        });
        const message = status >= 500 ? "Something went wrong on our side." : "Zoho refused the request.";
        return withRequestId(Response.json({ error: message, requestId }, { status, headers: { "Cache-Control": "no-store" } }), requestId);
      }
      if (response.status >= 500 || ctx.zoho) {
        file({
          ...base, at: startedAt, userId: userIdOf(request), status: response.status,
          zohoStatus: ctx.zoho?.status ?? null, zohoCode: safeZohoCode(ctx.zoho?.code), errorClass: ctx.zoho?.kind ?? null,
          errorName: null, durationMs: clock() - startedAt,
        });
      }
      return withRequestId(response, requestId);
    };
  };
}
