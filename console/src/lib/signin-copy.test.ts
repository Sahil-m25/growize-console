import { describe, expect, it } from "vitest";
import type { Person, PersonKey } from "@/domain";
import { revokedLine, signInHelp } from "./signin-copy";

const p = (n: string, seat: Person["seat"], extra: Partial<Person> = {}): Person =>
  ({ n, i: "XX", seat, mgr: null, on: true, c: 1, em: "", ph: "", ...extra }) as Person;

describe("sign-in copy reads its people from the record", () => {
  it("names Corporate Operations then Digital Infrastructure, as the prototype", () => {
    const PEOPLE = { a: p("Ops One", "ops"), b: p("Corp One", "corp"), c: p("Gone", "ops", { on: false }) } as Record<PersonKey, Person>;
    expect(revokedLine(PEOPLE)).toBe("Corp One or Ops One can turn it back on.");
    expect(signInHelp(PEOPLE)).toBe("Ops One, Digital Infrastructure & Data");
  });
  it("names the team when the book has nobody", () => {
    expect(revokedLine({})).toBe("Digital Infrastructure can turn it back on.");
    expect(signInHelp({})).toBe("Digital Infrastructure & Data");
  });
});
