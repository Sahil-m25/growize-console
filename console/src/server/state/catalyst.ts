/**
 * The `catalyst` SharedState adapter: Zoho Catalyst NoSQL over its REST API, with `fetch` (no SDK, no new
 * dependency). Selected only by STATE_STORE=catalyst (./runtime.ts); misconfiguration is a startup error.
 *
 * Wire shapes: VERIFIED against the official SDK zcatalyst-sdk-node 3.4.0 (lib/no-sql/table.js, types.d.ts), 6 Oct 2026.
 *   base {api}/baas/v1/project/{project}; headers Authorization: Zoho-oauthtoken …, Content-Type: application/json,
 *   optional CATALYST-ORG and Environment: Development. Scopes that work: ZohoCatalyst.nosql.READ, ZohoCatalyst.nosql.rows.ALL.
 *   insert  POST   /nosqltable/{table}/item        body ARRAY [{ item, condition?, return? }]
 *   update  PUT    /nosqltable/{table}/item        body ARRAY [{ keys: {pk:{S}} (one object), update_attributes[], condition?, return? }]
 *   delete  DELETE /nosqltable/{table}/item        body ARRAY [{ keys: {pk:{S}}, condition? }]
 *   fetch   POST   /nosqltable/{table}/item/fetch  body { keys: [{pk:{S}}], consistent_read: true }
 *   Response { status:"success", data:{ get|create|update|delete: [{ status, item, old_item }], … } }. Each entry has its
 *   OWN status: a false condition may come back inside the array with a non-success status on HTTP 200, or as an HTTP 4xx
 *   error_code. Both are handled; any per-item non-success on a conditional write is taken as "condition false".
 *   TTL: a TTL attribute set at table creation; a scheduler deletes expired items once every 24 hours
 *   (https://docs.catalyst.zoho.com/en/cloud-scale/help/nosql/llms-full.md). So expiry is ALSO enforced here, on
 *   read, from our own `exp` attribute; the TTL attribute only keeps the table small.
 *   Conditions: "items are inserted only if the evaluation is true. If there is no existing data, the conditions are
 *   ignored and the items are inserted." Update offers `add` (atomic add) and `if_not_exists` functions.
 *
 * VERIFIED LIVE (spike run 2, 7 Oct 2026, India DC, table gz_state; catalyst-spike/spike-result.json):
 *   - the partition key is "K" (capital): CATALYST_STATE_PK=K; the default here is "K" too ("k" answers 400 INVALID_KEY).
 *   - top-level status "success"; per-item status "Success" (capital); an insert echoes no item: data.create=[{status:"Success"}].
 *   - a plain insert onto an existing key OVERWRITES. A conditional insert (exp less_than now) on a LIVE item answers
 *     HTTP 200 data.create=[{status:"CriteriaMismatch"}] (size 0); onto an EXPIRED item it overwrites: claim() is ONE call.
 *   - fetch of a missing key: HTTP 200 data:{size:0}, no `get` key at all. An entry may carry no status.
 *   - update with a stale ver: HTTP 200 data.update=[{status:"ConditionMismatch"}]. Update of a MISSING key (conditional
 *     or not) is ConditionMismatch and creates nothing, so set/incr/take on an absent key INSERT (conditional insert).
 *   - delete: [{status:"Success"}]; delete of a missing key: [{status:"ConditionMismatch"}] (treated as done).
 *   - 50 concurrent conditional inserts on one key: exactly one winner. 20 concurrent ver-CAS increments: final 20.
 *   - under burst: HTTP 429 TOO_MANY_REQUESTS (rejected before processing: retried with backoff, then "unavailable") and
 *     HTTP 500 INTERNAL_SERVER_ERROR (the write may or may not have landed: "unavailable", never assumed won).
 *   - the Environment header is optional. Latency from the owner's PC: p50 ~65 ms, p95 ~110-130 ms.
 *   - update_function `add` works but does not return the new value, so incr stays read + conditional update.
 *
 * STILL UNVERIFIED: the HTTP-4xx error_code text of a failed condition (never seen live: failures come as per-item
 * statuses on HTTP 200; an unknown per-item status or code is "bad-response", not "condition false"), and latency from
 * inside AppSail.
 *
 * The table: partition key CATALYST_STATE_PK (default `K`, String). Attributes: `v` (S, the value), `exp` (N, epoch ms; NO_EXPIRY when none),
 * `ver` (N, bumped on every write — the compare-and-set token), `ttl` (N, epoch seconds — the table's TTL attribute).
 * The partition key value is sha256(key): no IP, Zoho user id or event key leaves the process in the clear (rule 7 belt and braces).
 *
 * Semantics: claim() is ONE conditional insert (atomic; it also takes over an expired claim). set/incr/take are
 * read → (insert when absent | conditional update on `ver`), retried with jitter: no lost update, but under
 * contention they may reject with SharedStateError("contended"). Each operation costs 1–2 HTTP calls (claim 1, others 2).
 */

import { createHash } from "node:crypto";
import { accountsOriginOf } from "../oauth/service-token";
import {
  bucketStep, checkKey, checkTtl, checkValue, expiryOf, NO_EXPIRY, SharedStateError, type SharedState,
} from "./shared-state";

export interface CatalystConfig {
  readonly apiOrigin: string;
  readonly projectId: string;
  readonly table: string;
  /** The partition-key attribute name of the table (env CATALYST_STATE_PK, default "K"). */
  readonly pkName: string;
  readonly orgId: string | null;
  readonly environment: "Development" | null;
  readonly accountsOrigin: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export type CatalystFetch = (url: string, init: {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}) => Promise<{ readonly status: number; json(): Promise<unknown> }>;

export interface CatalystDeps {
  readonly fetch?: CatalystFetch;
  readonly clock?: () => number;
  /** Per HTTP call. AppSail answers a request within 30 s; a state call must be a small part of that. */
  readonly timeoutMs?: number;
  /** Read → conditional write rounds before "contended". */
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Retries of an HTTP 429 (rejected before processing, so always safe to repeat) before "unavailable". */
  readonly rateLimitRetries?: number;
}

/* ------------------------------------------------ config ------------------------------------------------ */

/** Hosts of the Catalyst API per data centre. api.catalyst.zoho.in is verified (auth succeeded). */
const API_HOST = /^api\.catalyst\.(zoho\.(com|in|eu|com\.au|jp|sa)|zohocloud\.ca)$/;

export const CATALYST_ENV = Object.freeze([
  "CATALYST_API_ORIGIN", "CATALYST_PROJECT_ID", "CATALYST_STATE_TABLE", "CATALYST_STATE_PK", "CATALYST_REFRESH_TOKEN",
  "ZOHO_ACCOUNTS_ORIGIN", "ZOHO_OAUTH_CLIENT_ID", "ZOHO_OAUTH_CLIENT_SECRET",
] as const);

/** Every problem at once, by variable name only (never a value). Throws when anything is wrong. */
export function catalystConfigFromEnv(env: NodeJS.ProcessEnv): CatalystConfig {
  const bad: string[] = [];
  const v = (name: string): string => (env[name] ?? "").trim();
  const need = (name: string, ok: (s: string) => boolean, what: string): string => {
    const s = v(name);
    if (!s) bad.push(`${name} is not set`); else if (!ok(s)) bad.push(`${name} ${what}`);
    return s;
  };
  const safeSecret = (s: string) => s.length >= 8 && s.length <= 4_096 && !/[\r\n\0]/.test(s);
  const apiOrigin = need("CATALYST_API_ORIGIN", (s) => {
    try { const u = new URL(s); return u.protocol === "https:" && u.origin === s.replace(/\/$/, "") && API_HOST.test(u.hostname); } catch { return false; }
  }, "must be an exact https Catalyst API origin (e.g. https://api.catalyst.zoho.in)").replace(/\/$/, "");
  const projectId = need("CATALYST_PROJECT_ID", (s) => /^\d{1,20}$/.test(s), "must be the numeric project id");
  const table = need("CATALYST_STATE_TABLE", (s) => /^[A-Za-z0-9_]{1,64}$/.test(s), "must be the table id or name (letters, digits, _)");
  const pkName = v("CATALYST_STATE_PK") || "K";
  if (!/^[A-Za-z0-9_]{1,64}$/.test(pkName)) bad.push("CATALYST_STATE_PK must be letters, digits, _ (1-64) when set");
  const refreshToken = need("CATALYST_REFRESH_TOKEN", safeSecret, "is not a usable refresh token");
  const clientId = need("ZOHO_OAUTH_CLIENT_ID", safeSecret, "is not a usable client id");
  const clientSecret = need("ZOHO_OAUTH_CLIENT_SECRET", safeSecret, "is not a usable client secret");
  let accountsOrigin = need("ZOHO_ACCOUNTS_ORIGIN", () => true, "");
  if (accountsOrigin) { try { accountsOrigin = accountsOriginOf(accountsOrigin); } catch { bad.push("ZOHO_ACCOUNTS_ORIGIN must be an exact https Zoho accounts origin"); } }
  const orgId = v("CATALYST_ORG_ID") || null;
  if (orgId !== null && !/^\d{1,20}$/.test(orgId)) bad.push("CATALYST_ORG_ID must be numeric when set");
  const envName = v("CATALYST_ENVIRONMENT");
  if (envName && envName !== "Development" && envName !== "Production") bad.push("CATALYST_ENVIRONMENT must be Development or Production when set");
  if (bad.length) throw new Error(`STATE_STORE=catalyst is misconfigured: ${bad.join("; ")}.`);
  return Object.freeze({
    apiOrigin, projectId, table, pkName, orgId, environment: envName === "Development" ? "Development" : null,
    accountsOrigin, clientId, clientSecret, refreshToken,
  });
}

/* ------------------------------------------- wire shapes (VERIFIED, SDK 3.4.0) ------------------------------------------- */

type Attr = { S: string } | { N: string };
type Item = Record<string, Attr>;
type Condition = { attribute: string[]; operator: string; value: Attr };

/** Every request body in one place. Insert/update/delete bodies are ARRAYS; fetch is an object. */
export const SHAPES = Object.freeze({
  insert: (item: Item, condition?: Condition) => [{ item, ...(condition ? { condition } : {}) }],
  update: (pk: string, k: string, put: Item, condition?: Condition) => [{
    keys: { [pk]: { S: k } },
    update_attributes: Object.entries(put).map(([name, value]) => ({ operation_type: "PUT", attribute_path: [name], update_value: value })),
    ...(condition ? { condition } : {}),
  }],
  fetch: (pk: string, k: string) => ({ keys: [{ [pk]: { S: k } }], consistent_read: true }),
  remove: (pk: string, k: string) => [{ keys: { [pk]: { S: k } } }],
  lessThan: (attribute: string, n: number): Condition => ({ attribute: [attribute], operator: "less_than", value: { N: String(n) } }),
  equals: (attribute: string, n: number): Condition => ({ attribute: [attribute], operator: "equals", value: { N: String(n) } }),
});

/** Per-item statuses / error codes that mean "the condition was false". CriteriaMismatch (conditional insert) and
 *  ConditionMismatch (update, delete; also update/delete of a missing key) are VERIFIED live (7 Oct 2026); the rest are
 *  defensive fallbacks for an HTTP 4xx error_code, never seen live. */
export const CONDITION_FAILED_CODES: readonly string[] = Object.freeze(["CriteriaMismatch", "ConditionMismatch", "CONDITION_FAILED", "CONDITIONAL_CHECK_FAILED", "CONDITION_CHECK_FAILED", "DUPLICATE_VALUE", "DUPLICATE_ITEM"]);
const isConditionFailed = (code: string) => CONDITION_FAILED_CODES.some((c) => c.toLowerCase() === code.toLowerCase());

/** The TTL attribute for an item that never expires: 2100-01-01 (the TTL scheduler would delete it then). */
const FAR_TTL_S = 4_102_444_800;

/* ------------------------------------------------ adapter ------------------------------------------------ */

type Stored = { v: string; exp: number; ver: number };
/** ok: HTTP 2xx + status success. `entry` is the first per-item entry of the named section (null when absent). */
type Reply = { ok: true; data: unknown } | { ok: false; status: number; code: string };
type Section = "get" | "create" | "update" | "delete";
type Entry = { status?: unknown; item?: unknown; error_code?: unknown; code?: unknown } | null;

export function createCatalystState(cfg: CatalystConfig, deps: CatalystDeps = {}): SharedState {
  const doFetch: CatalystFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const clock = deps.clock ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const maxAttempts = deps.maxAttempts ?? 8;
  const rateLimitRetries = deps.rateLimitRetries ?? 4;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = `${cfg.apiOrigin}/baas/v1/project/${cfg.projectId}/nosqltable/${cfg.table}`;
  const hashOf = (key: string) => createHash("sha256").update(checkKey(key)).digest("base64url");

  /* ---- the OAuth access token (refresh-token grant; never logged, never at rest) ---- */
  let token: { value: string; until: number } | null = null;
  let refreshing: Promise<string> | null = null;
  const accessToken = (force: boolean): Promise<string> => {
    if (!force && token && clock() < token.until) return Promise.resolve(token.value);
    refreshing ??= (async () => {
      try {
        const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString();
        let res: Awaited<ReturnType<CatalystFetch>>;
        try {
          res = await doFetch(`${cfg.accountsOrigin}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(timeoutMs) });
        } catch { throw new SharedStateError("unavailable", "shared state: the Zoho accounts server did not answer"); }
        const j = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
        if (res.status !== 200 || typeof j?.access_token !== "string" || !j.access_token) throw new SharedStateError("unavailable", "shared state: the Catalyst token was refused");
        const life = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in * 1_000 : 3_600_000;
        token = { value: j.access_token, until: clock() + Math.max(60_000, life - 5 * 60_000) };
        return token.value;
      } finally { refreshing = null; }
    })();
    return refreshing;
  };

  /* ---- one HTTP call: 5xx, network and timeouts throw; 4xx come back as a code ---- */
  const call = async (method: "POST" | "PUT" | "DELETE", path: string, body: unknown): Promise<Reply> => {
    let limited = 0;
    for (let round = 0; round < 2; round++) {
      const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${await accessToken(round > 0)}`, "Content-Type": "application/json" };
      if (cfg.orgId) headers["CATALYST-ORG"] = cfg.orgId;
      if (cfg.environment) headers.Environment = cfg.environment;
      let res: Awaited<ReturnType<CatalystFetch>>;
      try { res = await doFetch(`${base}${path}`, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }); } catch {
        throw new SharedStateError("unavailable", "shared state: Catalyst did not answer in time");
      }
      const j = (await res.json().catch(() => null)) as { status?: unknown; data?: { error_code?: unknown; code?: unknown } } | null;
      if (res.status === 401 && round === 0) { token = null; continue; }   // a revoked or expired token: refresh once
      if (res.status === 429) {   // VERIFIED live under burst: TOO_MANY_REQUESTS, rejected before processing → back off and repeat
        if (limited >= rateLimitRetries) throw new SharedStateError("unavailable", "shared state: Catalyst is rate limiting (429)");
        await sleep(Math.floor(100 * 2 ** limited + Math.random() * 100)); limited++; round--; continue;
      }
      if (res.status >= 500 || res.status === 401) throw new SharedStateError("unavailable", `shared state: Catalyst answered ${res.status}`);
      if (res.status >= 200 && res.status < 300 && j?.status === "success") return { ok: true, data: j.data };
      const code = typeof j?.data?.error_code === "string" ? j.data.error_code : typeof j?.data?.code === "string" ? j.data.code : `HTTP_${res.status}`;
      return { ok: false, status: res.status, code };
    }
    throw new SharedStateError("unavailable");
  };

  const attr = (a: unknown): string | null => {
    if (!a || typeof a !== "object") return null;
    const x = a as { S?: unknown; N?: unknown };
    return typeof x.S === "string" ? x.S : typeof x.N === "string" ? x.N : typeof x.N === "number" ? String(x.N) : null;
  };
  /** The first per-item entry of data[section]. */
  const entryOf = (data: unknown, section: Section): Entry => {
    const list = (data as Record<string, unknown> | null)?.[section];
    const e = Array.isArray(list) ? list[0] : null;
    return e && typeof e === "object" ? (e as Entry) : null;
  };
  /** A per-item failure: its status is present and not "success". Returns its code, or null when the entry succeeded. */
  const entryFailure = (e: Entry): string | null => {
    if (!e || e.status === undefined || String(e.status).toLowerCase() === "success") return null;
    return typeof e.error_code === "string" ? e.error_code : typeof e.code === "string" ? e.code : typeof e.status === "string" ? e.status : "ITEM_FAILED";
  };

  const read = async (k: string): Promise<Stored | null> => {
    const r = await call("POST", "/item/fetch", SHAPES.fetch(cfg.pkName, k));
    if (!r.ok) throw new SharedStateError("bad-response", `shared state: fetch refused (${r.code})`);
    const e = entryOf(r.data, "get");
    const item = e && typeof e.item === "object" && e.item !== null ? (e.item as Item) : null;
    if (!item || Object.keys(item).length === 0) return null;   // absent: no item (or a non-success entry for a missing key)
    if (entryFailure(e) !== null) return null;
    const v = attr(item.v), exp = Number(attr(item.exp)), ver = Number(attr(item.ver));
    if (v === null || !Number.isFinite(exp) || !Number.isFinite(ver)) throw new SharedStateError("bad-response", "shared state: an item without v/exp/ver");
    return { v, exp, ver };
  };

  const fields = (v: string, exp: number, ver: number): Item => ({
    v: { S: v }, exp: { N: String(exp) }, ver: { N: String(ver) }, ttl: { N: String(exp === NO_EXPIRY ? FAR_TTL_S : Math.ceil(exp / 1_000)) },
  });
  const itemFor = (k: string, v: string, exp: number, ver: number): Item => ({ [cfg.pkName]: { S: k }, ...fields(v, exp, ver) });

  /** Insert when no unexpired item holds k. "ok" | "held" (the condition was false). */
  const insertIfFree = async (k: string, v: string, exp: number, ver: number): Promise<"ok" | "held"> => {
    const r = await call("POST", "/item", SHAPES.insert(itemFor(k, v, exp, ver), SHAPES.lessThan("exp", clock() + 1)));
    if (r.ok) {   // VERIFIED: a false condition is HTTP 200 + create=[{status:"CriteriaMismatch"}]; any other non-success is not trusted
      const f = entryFailure(entryOf(r.data, "create"));
      if (f === null) return "ok";
      if (isConditionFailed(f)) return "held";
      throw new SharedStateError("bad-response", `shared state: insert refused (${f})`);
    }
    if (isConditionFailed(r.code)) return "held";
    throw new SharedStateError("bad-response", `shared state: insert refused (${r.code})`);
  };
  /** Update when `cond` holds. "ok" | "lost" (condition false or the item is gone). */
  const updateIf = async (k: string, v: string, exp: number, ver: number, cond: Condition): Promise<"ok" | "lost"> => {
    const r = await call("PUT", "/item", SHAPES.update(cfg.pkName, k, fields(v, exp, ver), cond));
    if (r.ok) {   // VERIFIED: stale ver AND a missing key both answer update=[{status:"ConditionMismatch"}] (nothing is created)
      const f = entryFailure(entryOf(r.data, "update"));
      if (f === null) return "ok";
      if (isConditionFailed(f)) return "lost";
      throw new SharedStateError("bad-response", `shared state: update refused (${f})`);
    }
    if (isConditionFailed(r.code) || r.status === 404) return "lost";
    throw new SharedStateError("bad-response", `shared state: update refused (${r.code})`);
  };

  /** Read → compute → conditional write, retried. `next` sees the live value (null when absent or expired). */
  const mutate = async <T>(key: string, next: (cur: string | null, curExp: number | null, now: number) => { v: string; exp: number; out: T }): Promise<T> => {
    const k = hashOf(key);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(Math.floor(Math.random() * 20 * attempt));
      const cur = await read(k);
      const now = clock();
      const live = cur && now < cur.exp ? cur : null;
      const n = next(live?.v ?? null, live?.exp ?? null, now);
      const done = cur === null
        ? (await insertIfFree(k, n.v, n.exp, 1)) === "ok"
        : (await updateIf(k, n.v, n.exp, cur.ver + 1, SHAPES.equals("ver", cur.ver))) === "ok";
      if (done) return n.out;
    }
    throw new SharedStateError("contended");
  };

  return Object.freeze({
    kind: "catalyst",
    async claim(key: string, ttlSeconds?: number) {
      const k = hashOf(key), ttl = checkTtl(ttlSeconds);
      const now = clock(), exp = expiryOf(now, ttl);
      /* One conditional insert (exp < now): VERIFIED live to insert when absent, to overwrite an EXPIRED claim, and to answer
         CriteriaMismatch for a live one. A 429 is retried inside call(); a 5xx throws "unavailable": never assume won. */
      return (await insertIfFree(k, "1", exp, 1)) === "ok";
    },
    async release(key: string) {
      const r = await call("DELETE", "/item", SHAPES.remove(cfg.pkName, hashOf(key)));
      if (!r.ok && r.status !== 404) throw new SharedStateError("bad-response", `shared state: delete refused (${r.code})`);
      if (r.ok) {   // VERIFIED: delete of a missing key answers ConditionMismatch: release is idempotent; anything else is not
        const f = entryFailure(entryOf(r.data, "delete"));
        if (f !== null && !isConditionFailed(f) && !/NOT_?FOUND|NO_?SUCH|NOT_?EXIST/i.test(f)) throw new SharedStateError("bad-response", `shared state: delete refused (${f})`);
      }
    },
    async get(key: string) {
      const cur = await read(hashOf(key));
      return cur && clock() < cur.exp ? cur.v : null;
    },
    async set(key: string, value: string, ttlSeconds?: number) {
      const v = checkValue(value), ttl = checkTtl(ttlSeconds);
      await mutate(key, (_c, _e, now) => ({ v, exp: expiryOf(now, ttl), out: undefined }));
    },
    async incr(key: string, ttlSeconds?: number) {
      const ttl = checkTtl(ttlSeconds);
      return mutate(key, (cur, curExp, now) => {
        const n = (cur === null ? 0 : Number(cur) || 0) + 1;
        return { v: String(n), exp: curExp ?? expiryOf(now, ttl), out: n };
      });
    },
    async take(key: string, capacity: number, refillPerMinute: number) {
      return mutate(key, (cur, _e, now) => {
        let prev: { tokens: number; at: number } | null = null;
        if (cur !== null) { try { prev = JSON.parse(cur) as { tokens: number; at: number }; } catch { prev = null; } }
        const step = bucketStep(prev, capacity, refillPerMinute, now);
        return { v: JSON.stringify(step.next), exp: now + step.fullInMs, out: step.waitMs };
      });
    },
  });
}
