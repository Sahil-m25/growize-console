/**
 * TEST DOUBLE — an in-memory Catalyst NoSQL that reproduces EXACTLY what the LIVE spike saw (run 2, 7 Oct 2026, India DC,
 * table gz_state; catalyst-spike/spike-result.json). Not a reading of the docs: every behaviour below was observed.
 *
 *   partition key "K" (capital); a write that lacks it answers 400 INVALID_KEY; a non-array write body 400 INVALID_INPUT.
 *   insert   POST   /item        → 200 {status:"success", data:{size, create:[{status:"Success"}]}} (NO item echoed).
 *            no item → inserted (conditions ignored); an item: plain insert OVERWRITES; with a condition, overwritten when it
 *            holds, else 200 create:[{status:"CriteriaMismatch"}] with size 0.
 *   update   PUT    /item        → update:[{status:"Success"}]; stale condition → update:[{status:"ConditionMismatch"}] (size 0);
 *            a MISSING key (conditional or not) → ConditionMismatch and the item is NOT created.
 *   fetch    POST   /item/fetch  → data.get=[{item}] (no status); a missing key → 200 data:{size:0} with NO `get` key.
 *   delete   DELETE /item        → delete:[{status:"Success"}]; a missing key → delete:[{status:"ConditionMismatch"}].
 *   Under burst the real service answered 429 TOO_MANY_REQUESTS and 500 INTERNAL_SERVER_ERROR: inject them with
 *   failNext(429, 500, …) (the next calls, in order) or `flaky: { p429, p500 }` (seeded, per call). Neither touches the data.
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
  apiOrigin: "https://api.catalyst.zoho.in", projectId: "4000000006007", table: "gz_state", pkName: "K", orgId: "60001234", environment: null,
  accountsOrigin: "https://accounts.zoho.in", clientId: "1000.FAKECLIENT", clientSecret: "fake-secret-xx", refreshToken: "1000.fake.refresh",
});

export function createFakeCatalyst(options: { seed?: number; maxHops?: number; pk?: string; flaky?: { p429?: number; p500?: number } } = {}) {
  const pk = options.pk ?? "K";
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
    let injected = f ?? 0;
    if (!injected && options.flaky) { const r = rand(); injected = r < (options.flaky.p429 ?? 0) ? 429 : r < (options.flaky.p429 ?? 0) + (options.flaky.p500 ?? 0) ? 500 : 0; }
    const failure = (st: number) => err(st, st === 429 ? "TOO_MANY_REQUESTS" : st >= 500 ? "INTERNAL_SERVER_ERROR" : "FAILED");
    if (injected) return failure(injected);
    const tok = (init.headers.Authorization ?? "").replace(/^Zoho-oauthtoken /, "");
    if (!valid.has(tok)) return err(401, "INVALID_OAUTHTOKEN");
    const b = JSON.parse(init.body ?? "null");
    /** A false condition is HTTP 200 with a per-item status (VERIFIED live), size 0. */
    const refuse = (section: string, status: string) => ok({ size: 0, [section]: [{ status }] });
    const isWrite = (init.method === "POST" && path === "/item") || (init.method === "PUT" && path === "/item") || (init.method === "DELETE" && path === "/item");
    if (isWrite && (!Array.isArray(b) || b.length !== 1 || typeof b[0] !== "object" || b[0] === null)) return err(400, "INVALID_INPUT");
    if (init.method === "POST" && path === "/item") {
      const { item, condition } = b[0] as { item?: Item; condition?: Cond };
      if (!item || typeof item !== "object") return err(400, "INVALID_INPUT");
      if (!item[pk]?.S) return err(400, "INVALID_KEY");
      const k = item[pk]!.S as string, cur = items.get(k);
      if (cur && condition && !holds(cur, condition)) return refuse("create", "CriteriaMismatch");
      items.set(k, item);   // absent, or plain insert (overwrites), or a condition that holds
      return ok({ size: 62, create: [{ status: "Success" }] });
    }
    if (init.method === "PUT" && path === "/item") {
      const { keys, update_attributes, condition } = b[0] as { keys?: Record<string, Attr>; update_attributes?: { operation_type: string; attribute_path: string[]; update_value: Attr }[]; condition?: Cond };
      if (!keys || Array.isArray(keys) || typeof keys !== "object" || !Array.isArray(update_attributes)) return err(400, "INVALID_INPUT");
      if (!keys[pk]?.S) return err(400, "INVALID_KEY");
      const k = keys[pk]!.S as string, cur = items.get(k);
      if (!cur) return refuse("update", "ConditionMismatch");   // VERIFIED: a missing key is never created by update
      if (condition && !holds(cur, condition)) return refuse("update", "ConditionMismatch");
      const next = { ...cur };
      for (const a of update_attributes) { if (a.operation_type !== "PUT") throw new Error("fake: only PUT"); next[a.attribute_path[0]!] = a.update_value; }
      items.set(k, next);
      return ok({ size: 62, update: [{ status: "Success" }] });
    }
    if (init.method === "POST" && path === "/item/fetch") {
      if (!b || !Array.isArray(b.keys) || b.keys.length < 1) return err(400, "INVALID_INPUT");
      const key = b.keys[0]?.[pk]?.S as string | undefined;
      if (!key) return err(400, "INVALID_KEY");
      const cur = items.get(key);
      return cur ? ok({ size: 62, get: [{ item: cur }] }) : ok({ size: 0 });   // missing: no `get` key at all
    }
    if (init.method === "DELETE" && path === "/item") {
      const keys = (b[0] as { keys?: Record<string, Attr> }).keys;
      if (!keys || Array.isArray(keys) || !keys[pk]?.S) return err(400, "INVALID_KEY");
      if (!items.delete(keys[pk]!.S as string)) return refuse("delete", "ConditionMismatch");
      return ok({ size: 62, delete: [{ status: "Success" }] });
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
