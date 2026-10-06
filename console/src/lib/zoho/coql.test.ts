import { describe, expect, it } from "vitest";
import { coqlAll, coqlAny, coqlWhere } from "./coql";

describe("coql folding", () => {
  it("one part is itself, none is empty", () => {
    expect(coqlAll(["a = 1"])).toBe("a = 1");
    expect(coqlAny(["a = 1"])).toBe("a = 1");
    expect(coqlAll([])).toBe("");
    expect(coqlAny([])).toBe("");
  });
  it("two parts are one bracket pair", () => {
    expect(coqlAll(["a", "b"])).toBe("(a and b)");
    expect(coqlAny(["a", "b"])).toBe("(a or b)");
  });
  it("three or more fold pairwise from the left", () => {
    expect(coqlAll(["a", "b", "c"])).toBe("((a and b) and c)");
    expect(coqlAll(["a", "b", "c", "d"])).toBe("(((a and b) and c) and d)");
    expect(coqlAny(["a", "b", "c"])).toBe("((a or b) or c)");
  });
  it("mixed nesting keeps the groups it was given", () => {
    expect(coqlAll([coqlAny(["a", "b", "c"]), "d", "e"])).toBe("((((a or b) or c) and d) and e)");
  });
  it("skips empty parts", () => {
    expect(coqlAll(["a", "", "b"])).toBe("(a and b)");
  });
  it("coqlWhere wraps a bare clause once and leaves a single group alone", () => {
    expect(coqlWhere("id is not null")).toBe("(id is not null)");
    expect(coqlWhere("(a and b)")).toBe("(a and b)");
    expect(coqlWhere("((a and b) and c)")).toBe("((a and b) and c)");
    expect(coqlWhere("(a or b) and (c or d)")).toBe("((a or b) and (c or d))");
    expect(coqlWhere("x like '%)%'")).toBe("(x like '%)%')");
    expect(coqlWhere("(x like '%)(%')")).toBe("(x like '%)(%')");
  });
});
