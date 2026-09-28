import { describe, expect, it } from "vitest";
import { sheetRows } from "./sheet";

describe("sheetRows", () => {
  it("returns one row per loadable sheet row, ids and phones in the prototype's shape", () => {
    const r = sheetRows("E-04", { ok: 3 }, []);
    expect(r.map((x) => x.id)).toEqual(["S04-01", "S04-02", "S04-03"]);
    expect(r[0]!.ph).toBe("+91 9400000000");
  });
  it("refuses a row whose number or id is already on the book", () => {
    const r = sheetRows("E-04", { ok: 3 }, [{ id: "L1" as never, ph: "94000 07919" }, { id: "S04-03" as never, ph: "" }]);
    expect(r.map((x) => x.i)).toEqual([0]);
  });
  it("no sheet, no rows", () => expect(sheetRows("E-09", undefined, [])).toEqual([]));
});
