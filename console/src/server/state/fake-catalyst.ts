/**
 * TEST DOUBLE — an in-memory Catalyst NoSQL behind the REST shapes ./catalyst.ts sends (SHAPES), with the semantics
 * docs/architecture/shared-state.md documents (and marks UNVERIFIED until the spike):
 *
 *   insert   no item → inserted, conditions ignored (the docs' words); an item → refused DUPLICATE_ITEM without a
 *            condition; with one, replaced when true (`insertOverwrites`, default) or always refused DUPLICATE_ITEM
 *            (`insertOverwrites: false` — the other reading of the docs), CONDITION_FAILED when false
 *   update   no item → 404 NOT_FOUND; condition false → CONDITION_FAILED; else PUT each attribute
 *   query    the item with that partition key, as data.fetched_data: [{ item }]
 *   delete   removes; always success
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
  apiOrigin: "https://api.catalyst.zoho.in", projectId: "4000000006007", table: "gz_state", orgId: "60001234", environment: null,
  accountsOrigin: "https://accounts.zoho.in", clientId: "1000.FAKECLIENT", clientSecret: "fake-secret-xx", refreshToken: "1000.fake.refresh",
});

export function createFakeCatalyst(options: { insertOverwrites?: boolean; seed?: number; maxHops?: number } = {}) {
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
    const b = JSON.parse(init.body ?? "{}");
    if (init.method === "POST" && path === "/item") {
      const k = b.item.k.S as string, cur = items.get(k);
      if (!cur) { items.set(k, b.item); return ok(); }
      if (!b.condition || options.insertOverwrites === false) return err(400, "DUPLICATE_ITEM");
      if (!holds(cur, b.condition)) return err(400, "CONDITION_FAILED");
      items.set(k, b.item);
      return ok();
    }
    if (init.method === "PUT" && path === "/item") {
      const k = b.keys[0].k.S as string, cur = items.get(k);
      if (!cur) return err(404, "NOT_FOUND");
      if (b.condition && !holds(cur, b.condition)) return err(400, "CONDITION_FAILED");
      const next = { ...cur };
      for (const a of b.update_attributes) { if (a.operation_type !== "PUT") throw new Error("fake: only PUT"); next[a.attribute_path[0]] = a.update_value; }
      items.set(k, next);
      return ok();
    }
    if (init.method === "POST" && path === "/item/query") {
      const cur = items.get(b.key_condition.value.S as string);
      return ok({ fetched_data: cur ? [{ item: cur }] : [] });
    }
    if (init.method === "DELETE" && path === "/item") { items.delete(b.keys[0].k.S as string); return ok(); }
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
