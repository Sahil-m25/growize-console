/* W4-1 — a successful /me save must survive the book reload that follows it. The page's session book is read once at load
   (mobile blank); every later hydrate re-applied it over the saved value unless reloadData re-reads GET /api/session first. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { withSessionAccess } from "@/lib/data/endpoints/session";
import type { SessionAccess } from "@/server/access/session-access";

describe("W4-1: the mobile a person saved is not blanked by the reload", () => {
  const ds = demoBook();
  const who = Object.keys(ds.PEOPLE)[0]!;
  const access = (ph: string) => ({ lead: { ...ds.PEOPLE[who]!, ph }, im: null, grants: {} }) as unknown as SessionAccess;
  const bookWithoutPhone = { ...ds, PEOPLE: { ...ds.PEOPLE, [who]: { ...ds.PEOPLE[who]!, ph: "" } } };

  it("a stale session book (blank mobile) blanks it; a fresh one carries it", () => {
    expect(withSessionAccess(bookWithoutPhone, who, access("")).PEOPLE[who]!.ph).toBe("");
    expect(withSessionAccess(bookWithoutPhone, who, access("+91 90000 07782")).PEOPLE[who]!.ph).toBe("+91 90000 07782");
  });

  it("reloadData re-reads the session book before it hydrates (live)", () => {
    const src = readFileSync(new URL("./store.tsx", import.meta.url), "utf8");
    const i = src.indexOf("loadRef.current = async");
    expect(i).toBeGreaterThan(0);
    const body = src.slice(i, src.indexOf("return load();", i));
    expect(body).toContain('"/api/session"');
    expect(body).toContain("seat = {");
  });
});
