import { afterEach, describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import { applyFixtures } from "@fixtures/apply";
import { admitted } from "./admission";
import { clockDay, kolkataNow, reviveClock } from "./clock";
import { emptyDataset, recordCount } from "./empty";
import { decodeSession, encodeSession } from "./session";
import { fixtureSource, getSource, zohoSource } from "./source";

describe("the empty book", () => {
  it("holds zero records on both sides", () => {
    const ds = emptyDataset("2026-09-27T00:00", "2026-09-27T10:15");
    expect(recordCount(ds)).toBe(0);
    expect(ds.LEADS).toEqual([]);
    expect(ds.PEOPLE).toEqual({});
    expect(ds.im.INV).toEqual([]);
    expect(ds.im.NOW).toBe("2026-09-27T10:15");
  });
  it("is what the phase-1 Zoho source serves, on a real Kolkata clock", async () => {
    const ds = await zohoSource.load();
    expect(recordCount(ds)).toBe(0);
    expect(ds.NOW).toBe(clockDay(ds.im.NOW));
    expect(ds.im.NOW).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("the one clock", () => {
  it("reads Asia/Kolkata wall time whatever the host zone", () => {
    expect(kolkataNow(new Date("2026-08-27T20:00:00Z"))).toBe("2026-08-28T01:30");
    const d = reviveClock("2026-08-28T01:30");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 7, 28, 1, 30]);
  });
});

describe("getSource()", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("serves the fixtures only with FIXTURE_MODE=local outside production", () => {
    expect(getSource({ FIXTURE_MODE: "local", NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(fixtureSource);
    expect(getSource({ FIXTURE_MODE: "local", NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(fixtureSource);
    expect(getSource({ FIXTURE_MODE: "local", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(zohoSource);
    expect(getSource({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(zohoSource);
    expect(getSource({ FIXTURE_MODE: "on", NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(zohoSource);
  });
});

describe("the demo book", () => {
  it("is the prototype's, on the prototype's dates", () => {
    const ds = demoBook();
    expect(ds.NOW).toBe("2026-08-28T00:00");
    expect(ds.im.NOW).toBe("2026-09-02T00:00");
    expect(ds.LEADS.find((l) => l.id === "L2")?.n).toBe("Sanjay Menon");
    expect(recordCount(ds)).toBeGreaterThan(0);
  });
  it("offers on the sign-in screen exactly who either side admits, in the record's order", () => {
    expect(admitted(demoBook())).toEqual([
      "rohit", "kavya", "nikhil", "ananya", "tasneem", "harsha", "meena", "fahad", "latha",
      "divya", "imran", "neha", "sahil", "pradeep",
    ]);
  });
  it("offers a granted-only seat once Digital Infrastructure grants it a screen (D60)", () => {
    const ds = demoBook();
    expect(admitted(ds)).not.toContain("jhalak");
    ds.GRANT.jhalak = { leads: ["view"] };
    expect(admitted(ds)).toContain("jhalak");
    ds.GRANT.jhalak = { me: ["view"] };
    expect(admitted(ds)).not.toContain("jhalak");
  });
  it("never offers somebody switched off", () => {
    const ds = demoBook();
    ds.PEOPLE.kavya = { ...ds.PEOPLE.kavya!, on: false };
    expect(admitted(ds)).not.toContain("kavya");
    expect(admitted(ds)).not.toContain("gokul");
    expect(admitted(ds)).not.toContain("vinay");
  });
  it("applies DEMO_* fixtures as no-ops and never mutates its input", () => {
    const ds = demoBook();
    const r = applyFixtures(ds, ["DEMO_STAFF", "DEMO_BOOK", "IM:DEMO_PORTAL", "NOT_REGISTERED_YET"]);
    expect(r.ds).toEqual(ds);
    expect(r.ds).not.toBe(ds);
    expect(r.actions).toEqual([]);
  });
});

describe("the session cookie", () => {
  it("round-trips who and seat", () => {
    const v = encodeSession({ who: "rohit", seat: "ir" });
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSession(v)).toEqual({ who: "rohit", seat: "ir" });
  });
  it("refuses anything that is not exactly a session", () => {
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession("")).toBeNull();
    expect(decodeSession("not-base64!")).toBeNull();
    expect(decodeSession(btoa(JSON.stringify({ who: "" , seat: "ir" })))).toBeNull();
    expect(decodeSession(btoa(JSON.stringify({ seat: "ir" })))).toBeNull();
  });
});
