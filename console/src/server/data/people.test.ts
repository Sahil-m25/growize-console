/* M01-S03-NOTE-4 — PEOPLE from Zoho Users on the viewer's own token (server/data/people.ts, live.ts).
   Recorded fixtures only (lib/zoho/__fixtures__/teams, users, people): no request reaches Zoho. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLoadWindow, createMemoryStore, createScopedCache } from "../../lib/zoho/cache";
import { createZohoClient, userCredential } from "../../lib/zoho/client";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";
import { createZohoUserDirectory } from "../identity/users";
import { createZohoSeatDirectory } from "../oauth/seat";
import { createInvestorEvents } from "./events";
import { createLiveDataLayer } from "./live";
import { readPeople } from "./people";
import { createPlaneCLog, createPlaneCMemorySink } from "../identity/plane-c";

const FX = join(__dirname, "..", "..", "lib", "zoho", "__fixtures__");
const fx = (area: string, name: string) => JSON.parse(readFileSync(join(FX, area, `${name}.response.json`), "utf8")) as { status: number; headers?: Record<string, string>; body: unknown };
const respond = (r: { status: number; headers?: Record<string, string>; body: unknown }) => new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
const NOW = Date.parse("2026-10-04T10:00:00+05:30");
const U = (nn: string) => `5540230000003000${nn}`;
const seatsFx = fx("oauth", "current-user.seats") as unknown as { recordIdPrefix: string; roleIds: never; profileIds: never };
const seats = createZohoSeatDirectory({ recordIdPrefix: seatsFx.recordIdPrefix, roleIds: seatsFx.roleIds, profileIds: seatsFx.profileIds });
const gate = { async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c: unknown, t: () => unknown) { return t(); }, snapshot() { return {}; } } as never;
const ALL = [...(fx("teams", "users.all.page1").body as { users: { id: string }[] }).users, ...(fx("teams", "users.all.page2").body as { users: { id: string }[] }).users];

async function credential(id: string) {
  const body = { users: [ALL.find((u) => u.id === id) ?? { id, status: "active" }] };
  return userCredential({ access_token: `synthetic-${id}-never-live`, api_domain: "https://www.zohoapis.in", expires_in: 3600 },
    { recordIdPrefix: "554023", gate, log: createOpsLog(createMemorySink()), clock: () => NOW, fetch: async () => new Response(JSON.stringify(body), { status: 200 }) } as never);
}

function rig(users: (page: string) => string = (p) => `users.all.page${p}`, dir: "teams" | "people" = "teams") {
  const calls: { path: string; auth: string; query: Record<string, string> }[] = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: "554023", gate, log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url: string, init: { headers: Record<string, string> }) => {
      const u = new URL(url);
      calls.push({ path: u.pathname, auth: init.headers.Authorization!, query: Object.fromEntries(u.searchParams) });
      if (u.pathname === "/crm/v8/users") return respond(fx(dir, users(u.searchParams.get("page")!)));
      throw new Error(`unexpected ${u.pathname}`);
    } } as never);
  const own = (name: string) => createZohoUserDirectory({ seats, gate, log, clock: () => NOW,
    fetch: async () => { const r = fx("users", name) as { status?: number; body?: unknown }; return { status: r.status ?? 200, text: async () => JSON.stringify(r.body ?? r), headers: { get: () => null } }; } });
  return { crm, calls, sink, log, own };
}

describe("readPeople", () => {
  it("lists what Zoho returns on the viewer's own token: names, seats, managers, leavers; the viewer's email only", async () => {
    const r = rig();
    const res = await readPeople({ crm: r.crm, seats }, await credential(U("05")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { people, im } = res.value;
    expect(r.calls.map((c) => [c.query.type, c.query.page])).toEqual([["AllUsers", "1"], ["AllUsers", "2"]]);
    expect(r.calls.every((c) => c.auth === `Zoho-oauthtoken synthetic-${U("05")}-never-live`)).toBe(true);
    expect(Object.keys(people)).toHaveLength(18);
    expect(people[U("05")]).toMatchObject({ n: "Test User 05", i: "TU", seat: "ir", mgr: U("04"), on: true, em: "user05@example.invalid", ph: "" });
    expect(people[U("04")]).toMatchObject({ seat: "conv", on: true, em: "" });
    expect(people[U("17")]!.on).toBe(false);
    expect(people[U("03")]!.seat).toBe("ops");
    expect(Object.values(people).filter((p) => p.em !== "")).toHaveLength(1);
    expect(Object.values(people).every((p) => p.ph === "")).toBe(true);
    expect(people[U("05")]!.c).toBeGreaterThanOrEqual(1);
    // the Investors side's names: seats with an Investors role only, leavers left out
    expect(im[U("07")]).toMatchObject({ n: "Test User 07", r: "head" });
    expect(im[U("05")]).toBeUndefined();
    expect(im[U("18")]).toBeUndefined();
  });

  it("an unseated Zoho user (unknown role) is not listed", async () => {
    const r = rig();
    const res = await readPeople({ crm: r.crm, seats }, await credential(U("05")));
    expect(res.ok && res.value.people[U("20")]).toBeFalsy();
  });

  it("a refused list falls back to the viewer's own entry by id; nothing else is shown", async () => {
    const r = rig(() => "users.list.no-permission", "people");
    const res = await readPeople({ crm: r.crm, seats, users: r.own("users.kavya-ir") }, await credential(U("14")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.value.people)).toEqual([U("14")]);
    expect(res.value.people[U("14")]).toMatchObject({ n: "Test User 14", seat: "ir", em: "user14@example.invalid", on: true });
  });

  it("a viewer Zoho lists but the door cannot seat keeps the others; their own entry is not invented", async () => {
    const r = rig();
    const res = await readPeople({ crm: r.crm, seats, users: r.own("users.kavya-ir") }, await credential(U("20")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.people[U("20")]).toBeUndefined();
    expect(res.value.people[U("05")]!.em).toBe("");
  });

  it("neither readable: not ok, with the failure class (no values)", async () => {
    const r = rig(() => "users.list.no-permission", "people");
    const res = await readPeople({ crm: r.crm, seats }, await credential(U("14")));
    expect(res).toEqual({ ok: false, code: "forbidden" });
  });

  it("the Plane B lines carry no name or email", async () => {
    const r = rig();
    await readPeople({ crm: r.crm, seats }, await credential(U("05")));
    const text = JSON.stringify(r.sink.records());
    expect(text).not.toMatch(/Test User|example\.invalid/);
  });
});

describe("the live layer feeds PEOPLE", () => {
  function layerRig(users: (page: string) => string, dir: "teams" | "people", withSeats = true) {
    const r = rig(users, dir);
    const planeC = createPlaneCLog(createPlaneCMemorySink());
    const store = createMemoryStore({ clock: () => NOW });
    const cache = createScopedCache({ store, clock: () => NOW, loads: createLoadWindow(() => NOW) });
    const layer = createLiveDataLayer({ crm: r.crm, cache, log: r.log, events: createInvestorEvents({ log: r.log, planeC, clock: () => NOW }), recordIdPrefix: "554023",
      clock: () => NOW, recheck: async () => null, ...(withSeats ? { seats, users: r.own("users.kavya-ir") } : {}) } as never);
    return { ...r, layer, cache, store };
  }
  const principal = async (nn: string) => ({ credential: await credential(U(nn)), session: { who: U(nn), seat: "stranger" }, sessionId: "sid" });

  it("load() fills PEOPLE and the Investors side's names, and caches none of it (rule 8)", async () => {
    const r = layerRig((p) => `users.all.page${p}`, "teams");
    const out = await r.layer.load(await principal("05"));
    expect(out.ds.PEOPLE[U("05")]!.n).toBe("Test User 05");
    expect(out.ds.PEOPLE[U("05")]!.em).toBe("user05@example.invalid");
    expect(out.problems.filter((p) => p.startsWith("people:"))).toEqual([]);
    expect(await r.store.keys()).toEqual([]);     // names are never cached: counts and aggregates only
  });

  it("a person Zoho will not list at all: PEOPLE empty and `people:forbidden` in problems; the book is not failed", async () => {
    const r = layerRig(() => "users.list.no-permission", "people", false);
    const out = await r.layer.load(await principal("14"));
    expect(out.ds.PEOPLE).toEqual({});
    expect(out.problems).toEqual([]);     // no seat directory wired: not attempted
    const r2 = layerRig(() => "users.list.no-permission", "people");
    const lay = createLiveDataLayer({ crm: r2.crm, cache: r2.cache, log: r2.log, events: createInvestorEvents({ log: r2.log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW }), recordIdPrefix: "554023", clock: () => NOW, recheck: async () => null, seats } as never);
    const o2 = await lay.load(await principal("14"));
    expect(o2.ds.PEOPLE).toEqual({});
    expect(o2.problems).toEqual(["people:forbidden"]);
  });
});
