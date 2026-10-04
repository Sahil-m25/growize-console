/* TC-E12-002 — on the Assignments report, "This week" and "Total" both read "1 not worked" on the same row. Each count button
   carries its column and the IR in its accessible name ("1 not worked — This week, Kavya Nair"); the visible text leads and is unchanged. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoBook } from "@fixtures/book";
import { applyFixtures } from "@fixtures/apply";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";

/* TC-E12-002's own fixture: Ritu Anand assigned to Kavya today — one lead, not yet worked, in This week and in Total */
const state = reducer(initialState(applyFixtures(demoBook(), ["RITU_ASSIGNED_TO_KAVYA_TODAY"]).ds), { type: "signIn", k: "tasneem" as PersonKey });
vi.mock("@/lib/store", async (orig) => ({ ...(await orig() as object), useConsole: () => ({ state, dispatch: () => {} }) }));
vi.mock("@/features/pay/common", () => ({ useGo: () => () => {} }));
import { AssignReport } from "./AssignReport";

const NW = /<button[^>]*class="ar-n ar-late[^"]*"[^>]*>(\d+ not worked)<\/button>/g;
const label = (b: string) => /aria-label="([^"]*)"/.exec(b)?.[1];

describe("Assignments by IR — the 'not worked' counts", () => {
  const rows = renderToStaticMarkup(<AssignReport />).split("</tr>");
  const withNw = rows.filter(r => r.includes("not worked</button>"));

  it("Kavya's row: This week and Total both read '1 not worked' and are named apart (the case's own facts)", () => {
    const k = rows.find(r => r.includes("Kavya"))!;
    expect([...k.matchAll(NW)].map(m => [m[1], label(m[0])])).toEqual([["1 not worked", "1 not worked — This week, Kavya Nair"], ["1 not worked", "1 not worked — Total, Kavya Nair"]]);
  });
  it("the report has rows with a count to name", () => { expect(withNw.length).toBeGreaterThan(0); });
  it("every 'N not worked' button is named by its column, keeping the visible text", () => {
    for (const r of withNw) for (const m of r.matchAll(NW)) {
      expect(label(m[0]), m[0]).toMatch(/^\d+ not worked — [A-Za-z0-9 ]+, [A-Za-z ]+$/);
      expect(label(m[0])!.startsWith(m[1])).toBe(true);
    }
  });
  it("no two buttons on one row share an accessible name, so 'This week' and 'Total' no longer clash", () => {
    for (const r of withNw) {
      const names = [...r.matchAll(NW)].map(m => label(m[0]));
      expect(new Set(names).size).toBe(names.length);
    }
    expect(withNw.some(r => [...r.matchAll(NW)].length > 1)).toBe(true);
  });
});
