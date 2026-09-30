// jev/ground.mjs: one test per source, plus the size cap.
import test from "node:test"; import assert from "node:assert/strict";
import { decisionRows, citedIn, topical, nineRules, storyOf, seatTable, ground, sources } from "../ground.mjs";

const DEC = "# Decisions\r\n\r\n| # | Decision | Date |\r\n|---|---|---|\r\n" +
  "| [D1](decisions/D01-x.md) | Zoho CRM is the primary system of record | 4 Sep 2026 |\r\n" +
  "| [D15](decisions/D15.md) | Farm progress arrives by webhook; nothing farm-related goes to Zoho — **Superseded by D110 (farms live in Zoho)** |\r\n" +
  "| D34 | *No file exists.* Cited by D35 | 11 Sep 2026 |\r\n" +
  "| [D45](decisions/D45.md) | Zero copy: the console reads and writes Zoho live; a short cache is allowed | 22 Sep 2026 |\r\n" +
  "| [D53](decisions/D53.md) | Every human holds a full Enterprise seat; the cache is keyed by visibility scope | 23 Sep 2026 |\r\n" +
  "| [D110](decisions/D110.md) | Owner rulings: D15 superseded (farms in Zoho) | 30 Sep 2026 |\r\n";
const CL = "# X\n\n## The nine rules this system is built on\n\n1. **One fact, one writer.** Zoho only\n   store (D45).\n2. **Two.** b\n3. **Three.** c\n4. **Four.** d\n5. **Five.** e\n6. **Six.** f\n7. **Seven.** g\n8. **Eight.** h\n9. **Nine.** i\n\nAfter.\n\n## How to work\n";
const Q = { stories: [{ id: "M01-S01", title: "Rail", so_that: "s", acceptance: ["A1", "A2", "A3"], decisions: ["D45"] }] };
const NAV = `export const SEATCAPS: Record<SeatKey, X> = {\n  ir  :{leads:["view","edit"], me:["view"]},\n  /* comment */ fin :{}\n};\n`;
const S = { rows: decisionRows(DEC), rules: nineRules(CL), queue: Q, seatSrc: NAV.includes("SEATCAPS") ? NAV : "", root: "/nowhere" };

test("source 1 — cited decisions: CRLF rows, D01 ≡ D1, a superseded row brings its successor", () => {
  assert.equal(Object.keys(S.rows).length, 6);
  assert.equal(S.rows.D1.text, "Zoho CRM is the primary system of record"); assert.equal(S.rows.D1.date, "4 Sep 2026");
  assert.deepEqual(citedIn("per D01 and D45, not D999x"), ["D1", "D45"]);
  assert.ok(S.rows.D15.superseded); assert.deepEqual(S.rows.D15.by, ["D110"]); assert.ok(S.rows.D34.missing);
  const g = ground("Where do farms live? (D15)", { sources: S, topK: 0, seats: false });
  assert.deepEqual(g.cited, ["D15", "D110"]); assert.match(g.state.decisions.D110, /farms in Zoho/);
});

test("source 2 — topic: lexical top-k, skipping superseded and missing rows and the ones already cited", () => {
  const r = topical("farm webhook zoho cache seat", S.rows, 5).map(x => x.id);
  assert.ok(!r.includes("D15") && !r.includes("D34"));
  assert.ok(r.includes("D53"));
  const g = ground("keyed cache by visibility scope (D45)", { sources: S, topK: 2, seats: false });
  assert.deepEqual(g.related, ["D53"]);
});

test("source 3 — the nine rules, one string per rule, wrapped lines joined", () => {
  assert.equal(S.rules.length, 9); assert.equal(S.rules[0], "1. One fact, one writer. Zoho only store (D45).");
  assert.deepEqual(ground("x", { sources: S, topK: 0, seats: false }).state.rules, S.rules);
  assert.equal(ground("x", { sources: S, topK: 0, seats: false, rules: false }).state.rules, undefined);
});

test("source 4 — story acceptance from queue.json (named or found in the text)", () => {
  assert.deepEqual(storyOf(Q, "M01-S01").acceptance, ["A1", "A2", "A3"]); assert.equal(storyOf(Q, "M99-S99"), null);
  const g = ground("While building M01-S01 …", { sources: S, topK: 0, seats: false });
  assert.equal(g.story, "M01-S01"); assert.deepEqual(g.state.story.acceptance, ["A1", "A2", "A3"]);
});

test("source 5 — seat table from SEATCAPS, attached when the text is about access", () => {
  assert.deepEqual(seatTable(NAV), { ir: "leads:view,edit me:view", fin: "(no console pages)" });
  assert.ok(ground("which seat may open the page?", { sources: S, topK: 0 }).seats);
  assert.ok(!ground("how are receipts matched?", { sources: S, topK: 0 }).seats);
  const real = sources(); assert.ok(Object.keys(ground("seat", { sources: real, topK: 0, seats: true }).state.seats).includes("ops"));
});

test("size cap: deterministic truncation, related → seats → acceptance → decision text → decisions; rules kept", () => {
  const big = { ...S, queue: { stories: [{ id: "M01-S01", title: "t", so_that: "s", acceptance: Array.from({ length: 40 }, (_, i) => "acceptance line " + i + " ".repeat(80)) }] } };
  const a = ground("M01-S01 seat keyed cache zoho live D1", { sources: big, topK: 3, cap: 2500 });
  const b = ground("M01-S01 seat keyed cache zoho live D1", { sources: big, topK: 3, cap: 2500 });
  assert.deepEqual(a, b);
  assert.ok(JSON.stringify(a.state).length <= 2600);
  assert.ok(a.dropped[0].startsWith("related:")); assert.ok(a.dropped.includes("seats")); assert.ok(a.dropped.some(d => d.startsWith("acceptance:")));
  assert.equal(a.state.rules.length, 9);
});
