import { describe, expect, it } from "vitest";
import { signInAdmits } from "./admission";
import { emptyDataset } from "./empty";
import { parseStubUser, stubAllowed, stubUser, withStubUser } from "./stub-user";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("parseStubUser — ZOHO_STUB_USER=\"Full Name|email|seat\"", () => {
  it("reads a lead seat", () => {
    const r = parseStubUser("Asha Rao|asha.rao@example.com|ir");
    expect(r).toEqual({ ok: true, user: { key: "asharao", n: "Asha Rao", em: "asha.rao@example.com", seat: "ir", leadSeat: "ir", imRole: null, ext: false } });
  });
  it("reads Digital Infrastructure as both sides", () => {
    const r = parseStubUser(" Dev Ops | dev@x.io | OPS ");
    expect(r.ok && r.user).toMatchObject({ seat: "ops", leadSeat: "ops", imRole: "di", ext: false });
  });
  it("reads Investors roles and their aliases", () => {
    expect(parseStubUser("A B|a@x.io|hof")).toMatchObject({ ok: true, user: { seat: "head", leadSeat: "fin", imRole: "head", ext: true } });
    expect(parseStubUser("A B|a@x.io|fin")).toMatchObject({ ok: true, user: { imRole: "ops", ext: true } });
    expect(parseStubUser("A B|a@x.io|kam")).toMatchObject({ ok: true, user: { leadSeat: "am", imRole: "kam", ext: true } });
    expect(parseStubUser("A B|a@x.io|amh")).toMatchObject({ ok: true, user: { seat: "amlead", imRole: "amlead" } });
    expect(parseStubUser("A B|a@x.io|audit")).toMatchObject({ ok: true, user: { imRole: "audit" } });
    expect(parseStubUser("A B|a@x.io|sys")).toMatchObject({ ok: true, user: { seat: "admin", leadSeat: "corp", imRole: "admin", ext: false } });
  });
  it("refuses anything else, without throwing", () => {
    for (const bad of [undefined, "", "   ", "Only Name", "A|a@x.io", "A|a@x.io|ir|extra", "|a@x.io|ir", "A B|not-an-email|ir",
      "A B|a@x.io|cp", "A B|a@x.io|mkt", "A B|a@x.io|", "<b>x</b>|a@x.io|ir"]) {
      const r = parseStubUser(bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/ZOHO_STUB_USER/);
    }
  });
});

describe("stubAllowed / stubUser", () => {
  it("only outside fixture mode and outside production", () => {
    expect(stubAllowed(env({ NODE_ENV: "development" }))).toBe(true);
    expect(stubAllowed(env({ NODE_ENV: "production" }))).toBe(false);
    expect(stubAllowed(env({ NODE_ENV: "production", GZ_LOCAL_BUILD: "1" }))).toBe(true);
    expect(stubAllowed(env({ NODE_ENV: "development", FIXTURE_MODE: "local" }))).toBe(false);
    expect(stubUser(env({ NODE_ENV: "production", ZOHO_STUB_USER: "A B|a@x.io|ir" }))).toBeNull();
    expect(stubUser(env({ NODE_ENV: "development", ZOHO_STUB_USER: "A B|a@x.io|nope" }))).toBeNull();
    expect(stubUser(env({ NODE_ENV: "development", ZOHO_STUB_USER: "A B|a@x.io|ir" }))?.key).toBe("a");
  });
});

describe("withStubUser — the person joins the empty book for the session only", () => {
  const empty = () => emptyDataset("2026-09-28T00:00");
  it("admits every default seat and every Investors role, and leaves the input untouched", () => {
    for (const seat of ["ir", "conv", "ops", "head", "fin", "comp", "audit", "amlead", "kam", "di", "admin", "root"]) {
      const r = parseStubUser(`Test Person|t@x.io|${seat}`);
      if (!r.ok) throw new Error(r.error);
      const base = empty();
      const ds = withStubUser(base, r.user);
      expect(signInAdmits({ PEOPLE: ds.PEOPLE, GRANT: ds.GRANT, im: ds.im }, "t"), seat).toBe(true);
      expect(base.PEOPLE).toEqual({});
      expect(base.im.P).toEqual({});
      expect(ds.PEOPLE.t).toMatchObject({ n: "Test Person", i: "TP", mgr: null, on: true });
    }
  });
  it("a by-grant seat is not admitted without a grant", () => {
    const r = parseStubUser("Test Person|t@x.io|exec");
    if (!r.ok) throw new Error(r.error);
    const ds = withStubUser(empty(), r.user);
    expect(signInAdmits({ PEOPLE: ds.PEOPLE, GRANT: ds.GRANT, im: ds.im }, "t")).toBe(false);
  });
});
