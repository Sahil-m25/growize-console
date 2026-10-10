// D140 (W8-IRA-1) one-off: set every allotment's Total_Amount_Received to what its matched receipts say (matched inbound
// Advance/Part/Balance/Full minus matched Refunds, never below 0) — the same arithmetic as console/src/server/money/received-total.ts,
// which keeps it right from now on. Before D140 nothing wrote the field, so existing allotments read 0 (or a stale seed value).
//
// Run: node zoho/sandbox/backfill-received.mjs [outPath]  → writes /home/claude/work/sandbox-setup/bundles/backfill-received.js,
// one IIFE (no imports) defining window.GZBackfillReceived. Paste it into the sandbox admin's logged-in tab (window.__z present):
//   const p = await GZBackfillReceived.plan();     // DRY RUN: reads only. { allotments, receipts, changes: [{ id, from, to, modifiedTime }], skipped }
//   const r = await GZBackfillReceived.apply(p);   // writes p.changes only; each row re-read first and skipped if it moved since plan()
//   await GZBackfillReceived.plan();               // again: changes must be []
// B-24 (D140 addendum, 10 Oct 2026): plan() also proposes Total_Amount_Receivable = Total_LLP_Units x Unit_Price (the total committed,
// the investor's ticket) for allotments where it is empty or 0 and both inputs are positive numbers. A row needing both fields is written in ONE guarded PUT.
// plan() = { allotments, receipts, changes (received), receivableChanges: [{ id, from, to, modifiedTime }], skipped }.
// Every function refuses unless GET /crm/v8/org says zgid 60090668120 (the sandbox). Output carries ids, counts and Zoho codes only.
// Test: node --test zoho/sandbox/backfill-received.test.mjs

export const SANDBOX_ZGID = "60090668120";
export const ALLOTMENTS = "LLP_UnitAllocation_Module";
export const FIELD = "Total_Amount_Received";
export const RECEIVABLE = "Total_Amount_Receivable";
const INBOUND = new Set(["Advance", "Part", "Balance", "Full"]);
const PAGE = 200;
const RECORD_ID = /^\d{15,22}$/;

const idOf = (v) => (typeof v === "string" && RECORD_ID.test(v) ? v : v && typeof v === "object" && typeof v.id === "string" && RECORD_ID.test(v.id) ? v.id : null);
const numOf = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Pure: allotment rows {id, Total_Amount_Received, Modified_Time} + matched receipt rows {Allotment, Kind, Amount} → the writes needed. */
export function planBackfill(allotments, receipts) {
  const sum = new Map();
  let skipped = 0;
  for (const r of receipts) {
    const on = idOf(r.Allotment), amt = numOf(r.Amount);
    if (!on || amt === null || amt <= 0 || r.Match_State !== "Matched") { skipped++; continue; }
    if (INBOUND.has(r.Kind)) sum.set(on, (sum.get(on) ?? 0) + amt);
    else if (r.Kind === "Refund") sum.set(on, (sum.get(on) ?? 0) - amt);
    else skipped++;
  }
  const changes = [];
  for (const a of allotments) {
    if (!idOf(a.id)) continue;
    const to = Math.max(0, sum.get(a.id) ?? 0), from = numOf(a[FIELD]);
    if (from !== to) changes.push({ id: a.id, from, to, modifiedTime: typeof a.Modified_Time === "string" ? a.Modified_Time : null });
  }
  const receivableChanges = [];
  for (const a of allotments) {
    if (!idOf(a.id)) continue;
    const from = numOf(a[RECEIVABLE]), units = numOf(a.Total_LLP_Units), price = numOf(a.Unit_Price);
    if (from !== null && from !== 0) continue;
    if (units === null || price === null || units <= 0 || price <= 0) continue;
    const to = units * price;
    if (!Number.isSafeInteger(to)) continue;
    receivableChanges.push({ id: a.id, from, to, modifiedTime: typeof a.Modified_Time === "string" ? a.Modified_Time : null });
  }
  return { allotments: allotments.length, receipts: receipts.length, changes, receivableChanges, skipped };
}

/** Over call(method, path, body[, headers]) → {status, body} (window.__z). */
export function backfillApi(call) {
  const codes = (b) => [...new Set((b?.data ?? []).map((x) => x?.code).filter(Boolean))].join(",");
  const must = (r, what) => { if (![200, 201, 202, 204, 207].includes(r.status)) throw new Error(`Zoho ${what} -> ${r.status}${codes(r.body) ? " " + codes(r.body) : ""}`); return r.body ?? {}; };
  const guard = async () => {
    const zgid = String(must(await call("GET", "/crm/v8/org"), "GET org").org?.[0]?.zgid ?? "");
    if (zgid !== SANDBOX_ZGID) throw new Error("not the sandbox org (zgid " + SANDBOX_ZGID + "): refused");
  };
  const coqlAll = async (select, from, where) => {
    const out = [];
    for (let off = 0; ; off += PAGE) {
      const r = await call("POST", "/crm/v8/coql", { select_query: `select ${select} from ${from} where ${where} order by id asc limit ${off}, ${PAGE}` });
      if (r.status === 204) return out;
      const b = must(r, "coql " + from);
      out.push(...(b.data ?? []));
      if (!b.info?.more_records) return out;
    }
  };
  const read = async () => {
    const allotments = await coqlAll(`id, ${FIELD}, ${RECEIVABLE}, Total_LLP_Units, Unit_Price, Modified_Time`, ALLOTMENTS, "id is not null");
    const receipts = await coqlAll("id, Allotment, Kind, Amount, Match_State", "Receipts", "(Match_State = 'Matched' and Allotment is not null)");
    return { allotments, receipts };
  };
  return {
    async plan() { await guard(); const { allotments, receipts } = await read(); return planBackfill(allotments, receipts); },
    async apply(p) {
      if (!p || !Array.isArray(p.changes)) throw new Error("apply(plan): pass the object from plan()");
      await guard();
      const log = { written: 0, moved: 0, failed: [] };
      // one PUT per allotment, carrying whichever of the two fields the plan proposes for it
      const rows = new Map();
      const add = (c, field) => {
        const row = rows.get(c.id) ?? { id: c.id, modifiedTime: c.modifiedTime, data: {}, bad: false };
        if (!Number.isSafeInteger(c.to) || c.to < 0 || (field === RECEIVABLE && c.to <= 0)) row.bad = true;
        else row.data[field] = c.to;
        rows.set(c.id, row);
      };
      for (const c of p.changes) { if (idOf(c.id)) add(c, FIELD); else log.failed.push({ id: String(c.id), code: "invalid" }); }
      for (const c of p.receivableChanges ?? []) { if (idOf(c.id)) add(c, RECEIVABLE); else log.failed.push({ id: String(c.id), code: "invalid" }); }
      for (const row of rows.values()) {
        if (row.bad) { log.failed.push({ id: row.id, code: "invalid" }); continue; }
        const now = must(await call("GET", `/crm/v8/${ALLOTMENTS}/${row.id}?fields=${Object.keys(row.data).join(",")},Modified_Time`), "GET allotment").data?.[0];
        if (!now || now.Modified_Time !== row.modifiedTime) { log.moved++; continue; }   // changed since plan(): re-plan
        const r = await call("PUT", `/crm/v8/${ALLOTMENTS}/${row.id}`, { data: [row.data] }, { "If-Unmodified-Since": row.modifiedTime });
        const res = r.body?.data?.[0];
        if (r.status >= 200 && r.status < 300 && (!res || res.status === "success")) log.written++;
        else log.failed.push({ id: row.id, code: res?.code ?? String(r.status) });
      }
      return log;
    },
  };
}

// ---- node only (the bundle stops reading here) ----
const isMain = typeof process !== "undefined" && process.argv?.[1] && new URL(import.meta.url).pathname === (await import("node:path")).resolve(process.argv[1]);
if (isMain) {
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const src = readFileSync(new URL(import.meta.url), "utf8").split("// ---- node only")[0]
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").replace(/^export /gm, "");
  const out = process.argv[2] || "/home/claude/work/sandbox-setup/bundles/backfill-received.js";
  const bundle = `/* GZBackfillReceived - D140 one-off: allotment Total_Amount_Received = matched receipts. Generated by zoho/sandbox/backfill-received.mjs; do not edit. Refuses unless org zgid is ${SANDBOX_ZGID}. */
(() => {
"use strict";
${src}
const call = (m, p, b, h) => { if (typeof window.__z !== "function") throw new Error("window.__z missing"); return window.__z(m, p, b, h); };
const api = backfillApi(call);
window.GZBackfillReceived = { plan: () => api.plan(), apply: (p) => api.apply(p) };
})();
`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bundle);
  console.log(`wrote ${out} (${Buffer.byteLength(bundle)} bytes)`);
}
