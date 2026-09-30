"use client";

/* ── @/lib/data/api — THE ONE CLIENT ADAPTER between a screen and its /api route (phase 2b, D104) ──
   A wired screen never reads a record from the store and never dispatches a data write. It declares an
   ENDPOINT (src/lib/data/endpoints/<area>.ts) and calls useApiRead / useApiWrite. The endpoint has two
   halves with ONE result type — the route's own response shape:

     live     fetch the /api route on the signed-in person's session (Zoho is the only store, rule 1)
     fixture  FIXTURE_MODE=local only: the same answer projected from the client's demo book — the book the
              reducer holds, the only copy there is — and a write runs the reducer action it replaces

   Which half runs is decided once, here, from the hydrated payload's `fixtures` flag (ApiModeProvider in
   the store). The fixture half is synchronous, so a fixture page paints on the first render exactly as
   before; the live half fetches, and every successful live write re-reads the live reads (liveTick).
   Nothing here keeps a record: the live half holds the last answer for the component that asked, and
   drops it with the component (D45).
   ────────────────────────────────────────────────────────────────────────────────────────────── */

import { createContext, createElement, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

/* ---- results --------------------------------------------------------------------------------- */
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = {
  ok: false;
  /** HTTP status; 0 = the console was not reached */
  status: number;
  /** the route's short code ("not-found", "changed", "same-hand", …) */
  code: string;
  /** the in-page message: the route's own `error`, never a Zoho body */
  error: string;
  recordId?: string | null;
};
export type ApiResult<T> = ApiOk<T> | ApiErr;

export type Read<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "error"; err: ApiErr };

/** A 409 from any route reads the same in every page (M09-S03: server/investors/record RECORD_CONFLICT_MESSAGE). */
export const CHANGED = "Changed by someone else — reload.";
export const UNREACHABLE = "Could not reach the console. Nothing was changed; try again.";

export const ok = <T>(data: T): ApiOk<T> => ({ ok: true, data });
export const fail = (status: number, code: string, error: string, recordId?: string): ApiErr =>
  ({ ok: false, status, code, error, ...(recordId ? { recordId } : {}) });

/* ---- endpoints ------------------------------------------------------------------------------- */
/** B = the book the fixture half projects from (e.g. {s, me} on the Investors side, ConsoleState on the lead side). */
export interface ReadEndpoint<B, A, T> {
  /** the route, or null when there is nothing to read yet (no id) */
  path(args: A): string | null;
  /** the route's JSON → T (a field pick; no reshaping the fixture half would have to copy) */
  pick(json: unknown): T;
  /** FIXTURE_MODE=local: the same T from the demo book. Pure. */
  fixture(book: B, args: A): ApiResult<T>;
}

export type Method = "POST" | "PUT" | "PATCH" | "DELETE";
export interface WriteEndpoint<B, A, T, D = unknown> {
  method: Method;
  path(args: A): string;
  /** the JSON body; omit for none */
  body?(args: A): unknown;
  /** send an Idempotency-Key (one per press; pass the same key to retry the same press) */
  idempotent?: boolean;
  pick(json: unknown): T;
  /** FIXTURE_MODE=local: run the reducer action this write replaces, answer as the route would. */
  fixture(book: B, dispatch: D, args: A): ApiResult<T>;
  /** live only: what the page does with a refusal (e.g. the Investors side's in-page note). */
  onLiveError?(dispatch: D, err: ApiErr): void;
}

/* ---- mode ------------------------------------------------------------------------------------ */
export type ApiMode = "live" | "fixture";
/* Default "fixture": only a component rendered with no store around it (a vitest render test) sees the
   default; every page is inside ConsoleProvider, which always provides the real mode. */
const ModeCtx = createContext<ApiMode>("fixture");
export function ApiModeProvider({ fixtures, children }: { fixtures: boolean; children: ReactNode }) {
  return createElement(ModeCtx.Provider, { value: fixtures ? "fixture" : "live" }, children);
}
export const useApiMode = (): ApiMode => useContext(ModeCtx);

/* ---- live re-read after a write ------------------------------------------------------------ */
let tick = 0;
const subs = new Set<() => void>();
export function bumpLive(): void { tick++; subs.forEach(f => f()); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const useLiveTick = () => useSyncExternalStore(subscribe, () => tick, () => 0);

/* ---- the transport (live half) --------------------------------------------------------------- */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One call to a route. Never throws. A non-2xx becomes ApiErr carrying the route's `error` and `code`. */
export async function apiFetch(method: "GET" | Method, path: string, opts: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal; fetch?: Fetch } = {}): Promise<ApiResult<unknown>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let r: Response;
  try {
    r = await (opts.fetch ?? fetch)(path, { method, headers, cache: "no-store", credentials: "same-origin", signal: opts.signal,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    return fail(0, "network", UNREACHABLE);
  }
  const json: unknown = await r.json().catch(() => null);
  if (r.ok) return ok(json);
  const b = (json && typeof json === "object" ? json : {}) as { error?: unknown; code?: unknown; recordId?: unknown; existing?: { contactId?: unknown } };
  const code = typeof b.code === "string" ? b.code : String(r.status);
  const error = r.status === 409 && /changed$/.test(code) ? CHANGED
    : typeof b.error === "string" && b.error ? b.error : `Refused (${r.status}).`;
  /* a duplicate names the record it collided with (add-paid: existing.contactId) — the page links to it */
  const rid = typeof b.recordId === "string" ? b.recordId : typeof b.existing?.contactId === "string" ? b.existing.contactId : null;
  return { ok: false, status: r.status, code, error, ...(rid ? { recordId: rid } : {}) };
}

export const newIdempotencyKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/* ---- the two halves as plain functions (the hooks below only schedule them; tests call them) ---- */
const asRead = <T>(r: ApiResult<T>): Read<T> => (r.ok ? { state: "ok", data: r.data } : { state: "error", err: r });

/** Live read: GET the route, pick T. */
export async function liveRead<B, A, T>(ep: ReadEndpoint<B, A, T>, path: string, opts: { signal?: AbortSignal; fetch?: Fetch } = {}): Promise<Read<T>> {
  const r = await apiFetch("GET", path, opts);
  return asRead(r.ok ? ok(ep.pick(r.data)) : r);
}

/** One press of a write in either mode. Live: Idempotency-Key when the endpoint asks for one; a success re-reads every live read. */
export async function runWrite<B, A, T, D>(mode: ApiMode, ep: WriteEndpoint<B, A, T, D>, book: B, dispatch: D, args: A,
  opts: { idempotencyKey?: string; fetch?: Fetch } = {}): Promise<ApiResult<T>> {
  if (mode === "fixture") return ep.fixture(book, dispatch, args);
  const r = await apiFetch(ep.method, ep.path(args), {
    body: ep.body?.(args), fetch: opts.fetch,
    idempotencyKey: ep.idempotent ? opts.idempotencyKey ?? newIdempotencyKey() : undefined,
  });
  if (!r.ok) { ep.onLiveError?.(dispatch, r); return r; }
  bumpLive();
  return ok(ep.pick(r.data));
}

/* ---- the hooks ------------------------------------------------------------------------------- */
/** Read an endpoint. Fixture mode: synchronous, from `book`. Live: GET the route; re-read after any live write. */
export function useApiRead<B, A, T>(ep: ReadEndpoint<B, A, T>, book: B, args: A, fetcher?: Fetch): Read<T> {
  const mode = useApiMode();
  const path = ep.path(args);
  const t = useLiveTick();
  const [live, setLive] = useState<{ path: string; r: Read<T> } | null>(null);
  useEffect(() => {
    if (mode !== "live" || !path) return;
    const ac = new AbortController();
    void liveRead(ep, path, { signal: ac.signal, fetch: fetcher }).then(r => { if (!ac.signal.aborted) setLive({ path, r }); });
    return () => ac.abort();
  }, [mode, path, t]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!path) return { state: "idle" };
  if (mode === "fixture") return asRead(ep.fixture(book, args));
  /* a re-read keeps showing the last answer for the same path rather than flashing "loading" */
  return live && live.path === path ? live.r : { state: "loading" };
}

/** A write. Returns a press handler answering the route's result (fixture: the reducer's). To retry the same
 *  press, pass the same idempotencyKey back. */
export function useApiWrite<B, A, T, D>(ep: WriteEndpoint<B, A, T, D>, book: B, dispatch: D, fetcher?: Fetch):
  (args: A, opts?: { idempotencyKey?: string }) => Promise<ApiResult<T>> {
  const mode = useApiMode();
  return useCallback((args: A, opts?: { idempotencyKey?: string }) =>
    runWrite(mode, ep, book, dispatch, args, { idempotencyKey: opts?.idempotencyKey, fetch: fetcher }), [mode, ep, book, dispatch, fetcher]);
}
