import { describe, expect, it } from "vitest";
import { parseIntake, sheetRows } from "./sheet";

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

describe("parseIntake (live: the tablet sheet pasted as it is exported)", () => {
  const head = "Name, Mobile, WhatsApp, Call, Email, City, Units";
  it("reads each row by its header; consent is the sheet's own columns, never assumed", () => {
    const r = parseIntake([head, "Asha Kulkarni, 9876501234, yes, yes, asha@example.com, Pune, 2", "Ravi Rao, 9400000002, yes, no,,,"].join("\n"));
    expect(r.err).toBeNull();
    expect(r.rows).toEqual([
      { name: "Asha Kulkarni", mobile: "9876501234", email: "asha@example.com", city: "Pune", units: 2, consent: { msg: true, call: true, email: false } },
      { name: "Ravi Rao", mobile: "9400000002", consent: { msg: true, call: false, email: false } },
    ]);
  });
  it("a tab-separated paste works; a row with no name or mobile is counted and left out; no header is an error; nothing is nothing", () => {
    const r = parseIntake("Name\tMobile\tWhatsApp\tCall\nMeena Iyer\t9400000003\ty\ty\n\t9400000004\ty\ty");
    expect(r.rows.map(x => x.name)).toEqual(["Meena Iyer"]);
    expect(r.skipped).toBe(1);
    expect(parseIntake("Asha, 9876501234").err).toMatch(/first row must name the columns/);
    expect(parseIntake("")).toEqual({ rows: [], skipped: 0, err: null });
  });
  it("a missing WhatsApp or Call column reads as no consent, so the loader refuses the row", () => {
    expect(parseIntake("Name, Mobile\nAsha, 9876501234").rows[0]!.consent).toEqual({ msg: false, call: false, email: false });
  });
});
