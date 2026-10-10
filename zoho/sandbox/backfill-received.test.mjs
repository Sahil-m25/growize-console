// D140 backfill: the pure plan, and the built bundle in a vm against a fake window.__z. Run: node --test zoho/sandbox/backfill-received.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planBackfill } from "./backfill-received.mjs";

const A1 = "100000000000000001", A2 = "100000000000000002", A3 = "100000000000000003";
const MT = "2026-10-10T10:00:00+05:30";
const allots = [
  { id: A1, Total_Amount_Received: 0, Total_Amount_Receivable: 0, Total_LLP_Units: 10, Unit_Price: 100000, Modified_Time: MT },
  { id: A2, Total_Amount_Received: 250000, Total_Amount_Receivable: 500000, Total_LLP_Units: 5, Unit_Price: 100000, Modified_Time: MT },
  { id: A3, Total_Amount_Received: null, Total_Amount_Receivable: null, Total_LLP_Units: null, Unit_Price: 100000, Modified_Time: MT },
];
const receipts = [
  { id: "r1", Allotment: { id: A1 }, Kind: "Advance", Amount: 1000000, Match_State: "Matched" },
  { id: "r2", Allotment: { id: A2 }, Kind: "Part", Amount: 100000, Match_State: "Matched" },
  { id: "r3", Allotment: { id: A2 }, Kind: "Part", Amount: 150000, Match_State: "Matched" },
  { id: "r4", Allotment: { id: A3 }, Kind: "Advance", Amount: 50000, Match_State: "Matched" },
  { id: "r5", Allotment: { id: A3 }, Kind: "Refund", Amount: 80000, Match_State: "Matched" },
  { id: "r6", Allotment: { id: A1 }, Kind: "Advance", Amount: 999, Match_State: "Pending" },
];

test("plan: matched inbound minus refunds, never below 0; equal rows are left alone; unmatched counts nothing", () => {
  const p = planBackfill(allots, receipts);
  assert.deepEqual(p.changes, [
    { id: A1, from: 0, to: 1000000, modifiedTime: MT },
    { id: A3, from: null, to: 0, modifiedTime: MT },
  ]);
  assert.equal(p.skipped, 1);
});

test("plan (B-24): Total_Amount_Receivable = Total_LLP_Units x Unit_Price only where it is empty or 0 and both inputs exist", () => {
  const rows = [
    { id: A1, Total_Amount_Receivable: 0, Total_LLP_Units: 10, Unit_Price: 100000, Modified_Time: MT },        // 0 -> 1,000,000
    { id: A2, Total_Amount_Receivable: 500000, Total_LLP_Units: 5, Unit_Price: 100000, Modified_Time: MT },     // already set: left alone, never recomputed
    { id: A3, Total_Amount_Receivable: null, Total_LLP_Units: 3, Unit_Price: 250000, Modified_Time: MT },       // empty -> 750,000
    { id: "100000000000000004", Total_Amount_Receivable: null, Total_LLP_Units: 3, Unit_Price: null, Modified_Time: MT },   // no price
    { id: "100000000000000005", Total_Amount_Receivable: 0, Total_LLP_Units: 0, Unit_Price: 100000, Modified_Time: MT },    // no units
  ];
  const p = planBackfill(rows, []);
  assert.deepEqual(p.receivableChanges, [
    { id: A1, from: 0, to: 1000000, modifiedTime: MT },
    { id: A3, from: null, to: 750000, modifiedTime: MT },
  ]);
  // idempotent: once written, the next plan proposes nothing
  const after = rows.map((r) => ({ ...r, Total_Amount_Receivable: p.receivableChanges.find((c) => c.id === r.id)?.to ?? r.Total_Amount_Receivable }));
  assert.deepEqual(planBackfill(after, []).receivableChanges, []);
});

const out = join(mkdtempSync(join(tmpdir(), "gzbackfill-")), "b.js");
execFileSync("node", [new URL("./backfill-received.mjs", import.meta.url).pathname, out]);
const src = readFileSync(out, "utf8");
const load = (zgid, moved = false) => {
  const calls = [];
  const z = async (method, path, body, headers) => {
    calls.push({ method, path, body, headers });
    if (path === "/crm/v8/org") return { status: 200, body: { org: [{ zgid }] } };
    if (path === "/crm/v8/coql") return { status: 200, body: { data: body.select_query.includes("from Receipts") ? receipts : allots, info: { more_records: false } } };
    if (method === "GET") return { status: 200, body: { data: [{ Modified_Time: moved ? "2026-10-10T11:00:00+05:30" : MT }] } };
    if (method === "PUT") return { status: 200, body: { data: [{ status: "success", code: "SUCCESS" }] } };
    return { status: 500, body: {} };
  };
  const window = { __z: z };
  vm.runInNewContext(src, { window });
  return { api: window.GZBackfillReceived, calls };
};

test("bundle: no imports; refuses any org but the sandbox and writes nothing", async () => {
  assert.doesNotMatch(src, /^(import|export) /m);
  const { api, calls } = load("60061770791");
  await assert.rejects(api.plan(), /not the sandbox/);
  await assert.rejects(api.apply({ changes: [{ id: A1, to: 1 }] }), /not the sandbox/);
  assert.ok(calls.every((c) => c.method === "GET"));
});

test("bundle: plan is read-only; apply writes the planned rows guarded, skips a row that moved", async () => {
  const { api, calls } = load("60090668120");
  const p = await api.plan();
  assert.equal(p.changes.length, 2);
  assert.ok(calls.every((c) => c.method === "GET" || c.path === "/crm/v8/coql"));
  const r = await api.apply(p);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { written: 2, moved: 0, failed: [] });
  const puts = calls.filter((c) => c.method === "PUT");
  assert.deepEqual(puts.map((c) => c.body.data[0].Total_Amount_Received), [1000000, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(p.receivableChanges.map((c) => [c.id, c.to]))), [[A1, 1000000]]);
  assert.equal(puts[0].body.data[0].Total_Amount_Receivable, 1000000);          // A1 needs both: ONE guarded PUT carries both fields
  assert.equal("Total_Amount_Receivable" in puts[1].body.data[0], false);
  assert.ok(puts.every((c) => c.headers["If-Unmodified-Since"] === MT));
  const m = load("60090668120", true);
  assert.deepEqual(JSON.parse(JSON.stringify(await m.api.apply(await m.api.plan()))), { written: 0, moved: 2, failed: [] });
});
