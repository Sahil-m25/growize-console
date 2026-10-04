/**
 * The `catalyst` SharedState adapter: Zoho Catalyst NoSQL over its REST API, with `fetch` (no SDK, no new
 * dependency). Selected only by STATE_STORE=catalyst (./runtime.ts); misconfiguration is a startup error.
 *
 * Endpoints, as documented (read 4 Oct 2026):
 *   insert  POST   {api}/baas/v1/project/{project}/nosqltable/{table}/item          scope ZohoCatalyst.nosql.item.INSERT
 *           https://docs.catalyst.zoho.com/en/api/code-reference/cloud-scale/nosql/insert-item/
 *   update  PUT    {api}/baas/v1/project/{project}/nosqltable/{table}/item          scope ZohoCatalyst.nosql.item.UPDATE
 *           https://docs.catalyst.zoho.com/en/api/code-reference/cloud-scale/nosql/update-item/
 *   query   POST   {api}/baas/v1/project/{project}/nosqltable/{table}/item/query    scope ZohoCatalyst.nosql.POST
 *           https://docs.catalyst.zoho.com/en/api/code-reference/cloud-scale/nosql/query-table/
 *   delete  DELETE {api}/baas/v1/project/{project}/nosqltable/{table}/item          scope (documented as) ZohoCatalyst.nosql.item.INSERT
 *           https://docs.catalyst.zoho.com/en/api/code-reference/cloud-scale/nosql/delete-item/
 *   Headers: Authorization: Zoho-oauthtoken …; optional CATALYST-ORG and Environment: Development.
 *   Fetch-item is a GET with a JSON body (fetch-item page), which WHATWG fetch refuses, so reads use query.
 *   Conditions (insert and update): https://docs.catalyst.zoho.com/en/sdk/javascript/v1/cloudscale/nosql/insert-items/
 *   — "items are inserted only if the evaluation is true. If there is no existing data, the conditions are ignored
 *   and the items are inserted." Update offers `add` (atomic add) and `if_not_exists` functions (update-item page).
 *   TTL: a TTL attribute set at table creation; a scheduler deletes expired items once every 24 hours
 *   (https://docs.catalyst.zoho.com/en/cloud-scale/help/nosql/llms-full.md). So expiry is ALSO enforced here, on
 *   read, from our own `exp` attribute; the TTL attribute only keeps the table small.
 *
 * UNVERIFIED (each is a line in docs/architecture/shared-state.md "What the Catalyst spike must verify"): the
 * exact JSON shapes in SHAPES below (the docs' REST samples are internally inconsistent, so they follow the SDK
 * samples), the error code a failed condition returns (CONDITION_FAILED_CODES), whether a plain insert onto an
 * existing key fails or overwrites (claim() works either way), and the India DC API host.
 *
 * The table: partition key `k` (String). Attributes: `v` (S, the value), `exp` (N, epoch ms; NO_EXPIRY when none),
 * `ver` (N, bumped on every write — the compare-and-set token), `ttl` (N, epoch seconds — the table's TTL attribute).
 * `k` is sha256(key): no IP, Zoho user id or event key leaves the process in the clear (rule 7 belt and braces).
 *
 * Semantics: claim() is one conditional insert (atomic in Catalyst — UNVERIFIED but documented), with a
 * conditional update to take over an expired claim. set/incr/take are read → conditional update on `ver`,
 * retried with jitter: no lost update, but under contention they may reject with SharedStateError("contended")
 * — the "best effort" the interface documents. Each operation costs 1–2 HTTP calls (claim 1, others 2).
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
}

/* ------------------------------------------------ config ------------------------------------------------ */

/** Hosts of the Catalyst API per data centre. UNVERIFIED for .in (India DC) — the docs' samples use .com. */
const API_HOST = /^api\.catalyst\.(zoho\.(com|in|eu|com\.au|jp|sa)|zohocloud\.ca)$/;

export const CATALYST_ENV = Object.freeze([
  "CATALYST_API_ORIGIN", "CATALYST_PROJECT_ID", "CATALYST_STATE_TABLE", "CATALYST_REFRESH_TOKEN",
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
    apiOrigin, projectId, table, orgId, environment: envName === "Development" ? "Development" : null,
    accountsOrigin, clientId, clientSecret, refreshToken,
  });
}

/* ------------------------------------------- wire shapes (UNVERIFIED) ------------------------------------------- */

type Attr = { S: string } | { N: string };
type Item = Record<string, Attr>;
type Condition = { attribute: string[]; operator: string; value: Attr };

/** Every request body in one place, so the spike corrects one object. Follows the SDK samples. */
export const SHAPES = Object.freeze({
  insert: (item: Item, condition?: Condition) => ({ item, ...(condition ? { condition } : {}) }),
  update: (k: string, put: Item, condition?: Condition) => ({
    keys: [{ k: { S: k } }],
    update_attributes: Object.entries(put).map(([name, value]) => ({ operation_type: "PUT", attribute_path: [name], update_value: value })),
    ...(condition ? { condition } : {}),
  }),
  query: (k: string) => ({ key_condition: { attribute: "k", operator: "equals", value: { S: k } }, consistent_read: true, limit: 1 }),
  remove: (k: string) => ({ keys: [{ k: { S: k } }] }),
  lessThan: (attribute: string, n: number): Condition => ({ attribute: [attribute], operator: "less_than", value: { N: String(n) } }),
  equals: (attribute: string, n: number): Condition => ({ attribute: [attribute], operator: "equals", value: { N: String(n) } }),
});

/** Error codes taken to mean "the condition was false". UNVERIFIED: the spike records the real one. */
export const CONDITION_FAILED_CODES: readonly string[] = Object.freeze(["CONDITION_FAILED", "CONDITIONAL_CHECK_FAILED", "CONDITION_CHECK_FAILED", "DUPLICATE_VALUE", "DUPLICATE_ITEM"]);
const isConditionFailed = (code: string) => CONDITION_FAILED_CODES.includes(code) || /CONDITION/i.test(code);

/** The TTL attribute for an item that never expires: 2100-01-01 (the TTL scheduler would delete it then). */
const FAR_TTL_S = 4_102_444_800;

/* ------------------------------------------------ adapter ------------------------------------------------ */

type Stored = { v: string; exp: number; ver: number };
type Reply = { ok: true; data: unknown } | { ok: false; status: number; code: string };

export function createCatalystState(cfg: CatalystConfig, deps: CatalystDeps = {}): SharedState {
  const doFetch: CatalystFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const clock = deps.clock ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const maxAttempts = deps.maxAttempts ?? 8;
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
      if (res.status >= 500 || res.status === 401 || res.status === 429) throw new SharedStateError("unavailable", `shared state: Catalyst answered ${res.status}`);
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
  /** The query answer's items, tolerant of the shapes the docs show (one item, a list, wrapped or bare). */
  const itemsOf = (data: unknown): Item[] => {
    const d = data as { fetched_data?: unknown; items?: unknown } | null;
    const raw = d?.fetched_data ?? d?.items ?? [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((x) => (x && typeof x === "object" && "item" in x ? (x as { item: unknown }).item : x))
      .filter((x): x is Item => !!x && typeof x === "object");
  };

  const read = async (k: string): Promise<Stored | null> => {
    const r = await call("POST", "/item/query", SHAPES.query(k));
    if (!r.ok) throw new SharedStateError("bad-response", `shared state: query refused (${r.code})`);
    const item = itemsOf(r.data).find((i) => attr(i.k) === k);
    if (!item) return null;
    const v = attr(item.v), exp = Number(attr(item.exp)), ver = Number(attr(item.ver));
    if (v === null || !Number.isFinite(exp) || !Number.isFinite(ver)) throw new SharedStateError("bad-response", "shared state: an item without v/exp/ver");
    return { v, exp, ver };
  };

  const fields = (v: string, exp: number, ver: number): Item => ({
    v: { S: v }, exp: { N: String(exp) }, ver: { N: String(ver) }, ttl: { N: String(exp === NO_EXPIRY ? FAR_TTL_S : Math.ceil(exp / 1_000)) },
  });
  const itemFor = (k: string, v: string, exp: number, ver: number): Item => ({ k: { S: k }, ...fields(v, exp, ver) });

  /** Insert when no unexpired item holds k. "ok" | "held" (the condition was false). */
  const insertIfFree = async (k: string, v: string, exp: number, ver: number): Promise<"ok" | "held"> => {
    const r = await call("POST", "/item", SHAPES.insert(itemFor(k, v, exp, ver), SHAPES.lessThan("exp", clock() + 1)));
    if (r.ok) return "ok";
    if (isConditionFailed(r.code)) return "held";
    throw new SharedStateError("bad-response", `shared state: insert refused (${r.code})`);
  };
  /** Update when `cond` holds. "ok" | "lost" (condition false or the item is gone). */
  const updateIf = async (k: string, v: string, exp: number, ver: number, cond: Condition): Promise<"ok" | "lost"> => {
    const r = await call("PUT", "/item", SHAPES.update(k, fields(v, exp, ver), cond));
    if (r.ok) return "ok";
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
      if ((await insertIfFree(k, "1", exp, 1)) === "ok") return true;
      /* Held — or held by an expired claim, if a conditional insert never overwrites (UNVERIFIED): take an
         expired one over with a conditional update. The item vanishing in between: insert once more. */
      const taken = await updateIf(k, "1", exp, Math.floor(now), SHAPES.lessThan("exp", now + 1));   // exp <= now; ver = now: only needs to change
      if (taken === "ok") return true;
      const cur = await read(k);
      if (cur === null) return (await insertIfFree(k, "1", exp, 1)) === "ok";
      return false;
    },
    async release(key: string) {
      const r = await call("DELETE", "/item", SHAPES.remove(hashOf(key)));
      if (!r.ok && r.status !== 404) throw new SharedStateError("bad-response", `shared state: delete refused (${r.code})`);
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
