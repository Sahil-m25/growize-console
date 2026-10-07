/**
 * TEST DOUBLE — an in-memory Catalyst NoSQL behind the VERIFIED REST wire shapes (zcatalyst-sdk-node 3.4.0) that
 * ./catalyst.ts sends, with the semantics docs/architecture/shared-state.md documents (and marks UNVERIFIED):
 *
 *   insert   POST   /item        body ARRAY [{ item, condition? }] → data.create[{ status, item }]
 *   update   PUT    /item        body ARRAY [{ keys: {pk:{S}}, update_attributes, condition? }] → data.update[…]
 *   delete   DELETE /item        body ARRAY [{ keys: {pk:{S}} }] → data.delete[…]
 *   fetch    POST   /item/fetch  body { keys: [{pk:{S}}], consistent_read } → data.get[{ status, item }]
 *   Anything else (a non-array write body, a missing partition key) answers 400 INVALID_INPUT / INVALID_KEY, as the
 *   owner's first live spike saw.
 *
 *   insert: no item → inserted, conditions ignored (the docs' words); an item → refused (DUPLICATE_ITEM) without a
 *   condition; with one, replaced when true (`insertOverwrites`, default) or always refused (`insertOverwrites: false`).
 *   update: no item or condition false → refused. How a refusal is reported is `failureStyle`: "item" (default; HTTP 200,
 *   a non-success entry inside data.<section>[]) or "http" (HTTP 400 + error_code) — the exact real behaviour is
 *   UNVERIFIED, so tests run both.
 *
 * Each conditional write is atomic (evaluated and applied in one step), as Catalyst documents. Requests are
 * delayed by a seeded random number of macrotask hops, so concurrent callers interleave between their reads and
 * writes: the simulated race. Never imported by app code.
 */

import type { CatalystConfig, CatalystFetch } from "./catalyst";

type Attr = { S?: string; N?: string };
type Item = Record<string, Attr>;
type Cond = { attribute: string[]; operator: string; value: Attr };

export const FAKE_CONFIG: CatalystConfig = Object.freeze({
  apiOrigin: "https://api.catalyst.zoho.in", projectId: "4000000006007", table: "gz_state", pkName: "k", orgId: "60001234", environment: null,
  accountsOrigin: "https://accounts.zoho.in", clientId: "1000.FAKECLIENT", clientSecret: "fake-secret-xx", refreshToken: "1000.fake.refresh",
});

export function createFakeCatalyst(options: { insertOverwrites?: boolean; seed?: number; maxHops?: number; failureStyle?: "item" | "http"; pk?: string } = {}) {
  const pk = options.pk ?? "k";
  const style = options.failureStyle ?? "item";
  const items = new Map<string, Item>();
  const seen: { method: string; path: string; body: string }[] = [];
  let seed = options.seed ?? 7;
  const rand = () => { seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff; return seed / 0x7fffffff; };
  const maxHops = options.maxHops ?? 3;
  const hop = () => new Promise<void>((r) => setImmediate(r));
  let tokenN = 0;
  let valid = new Set<string>();
  let failNext: number[] = [];

  const num = (a: Attr | undefined) => Number(a?.N ?? a?.S);
  const holds = (item: Item, c: Cond): boolean => {
    const have = item[c.attribute[0]!];
    if (c.operator === "less_than") return num(have) < num(c.value);
    if (c.operator === "equals") return have !== undefined && (have.N ?? have.S) === (c.value.N ?? c.value.S);
    throw new Error(`fake: unsupported operator ${c.operator}`);
  };
  const reply = (status: number, j: unknown) => ({ status, json: async () => j });
  const ok = (data: unknown = {}) => reply(200, { status: "success", data });
  const err = (status: number, code: string) => reply(status, { status: "failure", data: { error_code: code, message: code } });

  const fetch: CatalystFetch = async (url, init) => {
    const u = new URL(url);
    for (let i = Math.floor(rand() * (maxHops + 1)); i > 0; i--) await hop();
    if (u.pathname === "/oauth/v2/token") {
      const t = `tok-${++tokenN}`;
      valid.add(t);
      return reply(200, { access_token: t, expires_in: 3600, api_domain: "https://www.zohoapis.in", token_type: "Bearer" });
    }
    const path = u.pathname.replace(/^\/baas\/v1\/project\/\d+\/nosqltable\/[A-Za-z0-9_]+/, "");
    seen.push({ method: init.method, path, body: init.body ?? "" });
    const f = failNext.shift();
    if (f) return err(f, f >= 500 ? "INTERNAL_SERVER_ERROR" : "FAILED");
    const tok = (init.headers.Authorization ?? "").replace(/^Zoho-oauthtoken /, "");
    if (!valid.has(tok)) return err(401, "INVALID_OAUTHTOKEN");
    const b = JSON.parse(init.body ?? "null");
    /** A refused write: inside the array on HTTP 200, or as an HTTP 400. */
    const refuse = (section: string, code: string) => style === "http" ? err(400, code) : ok({ size: 1, [section]: [{ status: "failure", error_code: code }] });
    const isWrite = (init.method === "POST" && path === "/item") || (init.method === "PUT" && path === "/item") || (init.method === "DELETE" && path === "/item");
    if (isWrite && (!Array.isArray(b) || b.length !== 1 || typeof b[0] !== "object" || b[0] === null)) return err(400, "INVALID_INPUT");
    if (init.method === "POST" && path === "/item") {
      const { item, condition } = b[0] as { item?: Item; condition?: Cond };
      if (!item || typeof item !== "object") return err(400, "INVALID_INPUT");
      if (!item[pk]?.S) return err(400, "INVALID_KEY");
      const k = item[pk]!.S as string, cur = items.get(k);
      if (!cur) { items.set(k, item); return ok({ size: 1, create: [{ status: "Success", item }] }); }
      if (!condition || options.insertOverwrites === false) return refuse("create", "DUPLICATE_ITEM");
      if (!holds(cur, condition)) return refuse("create", "CONDITION_FAILED");
      items.set(k, item);
      return ok({ size: 1, create: [{ status: "Success", item }] });
    }
    if (init.method === "PUT" && path === "/item") {
      const { keys, update_attributes, condition } = b[0] as { keys?: Record<string, Attr>; update_attributes?: { operation_type: string; attribute_path: string[]; update_value: Attr }[]; condition?: Cond };
      if (!keys || Array.isArray(keys) || typeof keys !== "object" || !Array.isArray(update_attributes)) return err(400, "INVALID_INPUT");
      if (!keys[pk]?.S) return err(400, "INVALID_KEY");
      const k = keys[pk]!.S as string, cur = items.get(k);
      if (!cur) return refuse("update", "NOT_FOUND");
      if (condition && !holds(cur, condition)) return refuse("update", "CONDITION_FAILED");
      const next = { ...cur };
      for (const a of update_attributes) { if (a.operation_type !== "PUT") throw new Error("fake: only PUT"); next[a.attribute_path[0]!] = a.update_value; }
      items.set(k, next);
      return ok({ size: 1, update: [{ status: "Success", item: next }] });
    }
    if (init.method === "POST" && path === "/item/fetch") {
      if (!b || !Array.isArray(b.keys) || b.keys.length < 1) return err(400, "INVALID_INPUT");
      const key = b.keys[0]?.[pk]?.S as string | undefined;
      if (!key) return err(400, "INVALID_KEY");
      const cur = items.get(key);
      return ok({ size: cur ? 1 : 0, get: cur ? [{ status: "Success", item: cur }] : [] });
    }
    if (init.method === "DELETE" && path === "/item") {
      const keys = (b[0] as { keys?: Record<string, Attr> }).keys;
      if (!keys || Array.isArray(keys) || !keys[pk]?.S) return err(400, "INVALID_KEY");
      items.delete(keys[pk]!.S as string);
      return ok({ size: 1, delete: [{ status: "Success" }] });
    }
    return err(400, "UNKNOWN_ENDPOINT");
  };

  return {
    fetch,
    items,
    seen,
    tokens: () => tokenN,
    /** The next calls (after the token) answer these statuses. */
    failNext: (...statuses: number[]) => { failNext = statuses; },
    /** Every access token issued so far stops working (revoked / expired). */
    revokeTokens: () => { valid = new Set(); },
  };
}
