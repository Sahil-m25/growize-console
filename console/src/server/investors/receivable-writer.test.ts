/* B-24 / D140 addendum (10 Oct 2026) — Total_Amount_Receivable is the TOTAL committed (units x Unit_Price), written once by the
 * allotment's creator on their own token; only the create paths write it. Synthetic data only.
 * Run: npx vitest run src/server/investors/receivable-writer.test.ts */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
/** The allotment create paths: Finance's D137 convert, Finance's add-paid, and the oversell-guarded insert. */
const CREATE_PATHS = ["server/farms/oversell.ts", "server/investors/add-paid.ts", "server/investors/convert.ts"];

describe("B-24: only the allotment create paths write Total_Amount_Receivable", () => {
  it("no other source file sets the field (the future G5 amount-change flow is the only later writer)", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { if (f !== "__fixtures__" && f !== "node_modules") walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
        if (/(?<![.\w])Total_Amount_Receivable["']?\s*:/.test(readFileSync(p, "utf8"))) hits.push(p.slice(SRC.length + 1));
      }
    };
    walk(SRC);
    expect(hits.sort()).toEqual(CREATE_PATHS);
  });

  it("each create path writes units x price on the insert, never in an update", () => {
    for (const rel of CREATE_PATHS) {
      const s = readFileSync(join(SRC, rel), "utf8");
      expect(s).toMatch(/Total_Amount_Receivable\s*:/);
      expect(s).not.toMatch(/\.update\([^)]*Total_Amount_Receivable/);
    }
    expect(readFileSync(join(SRC, "server/investors/convert.ts"), "utf8")).toMatch(/Total_Amount_Receivable: units \* farm\.unitPrice/);
    expect(readFileSync(join(SRC, "server/investors/add-paid.ts"), "utf8")).toMatch(/Total_Amount_Receivable: total/);
    expect(readFileSync(join(SRC, "server/farms/oversell.ts"), "utf8")).toMatch(/Total_Amount_Receivable: price \* ask\.units/);
  });

  it("no reader treats it as the balance any more: nothing compares it to 0", () => {
    const s = readFileSync(join(SRC, "server/farms/occupancy.ts"), "utf8");
    expect(s).not.toMatch(/Total_Amount_Receivable = 0/);
    expect(s).not.toMatch(/receivable === 0/);
  });
});
