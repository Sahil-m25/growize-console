/* D139 (owner rulings 10 Oct 2026, round 9) — on a scripted Zoho double. Synthetic ids and words only; no real investor data.
 *   W2-KAM-1  a KAM / Head of AM sees rupees: Zoho's own values on their token, per field (record.test.cjs holds the record cases)
 *   IR claims the IR sees the state of their OWN payment reports (pending / matched / rejected, amount, date, day Finance answered)
 *             and never a receipt line (D69 stands; Jev p=1.00)
 * Run: npx vitest run src/server/investors/d139.test.ts */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { userCredential, type UserCredential } from "@/lib/zoho/client";
import { createMemorySink, createOpsLog } from "@/lib/zoho/log";
import { claimLineOf, readClaimLines } from "../leads/claim-lines";
import { buildChase } from "./ir-list";
import { FOUND_TITLE, NOT_FOUND_TITLE } from "../money/claim-answer";

const P = "9007199254";
const IR = "9007199254740990904";
const LEAD = "9007199254740991001", LEAD2 = "9007199254740991011", CONTACT = "9007199254740991003", ALLOT = "9007199254740991004", LLP = "9007199254740991002";
const R1 = "9007199254740991101", R2 = "9007199254740991102", R3 = "9007199254740991103";
const NOW = Date.parse("2026-10-10T06:30:00Z");
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let cred: UserCredential;
beforeAll(async () => {
  cred = await userCredential({ access_token: "synthetic-token-never-live", api_domain: "https://www.zohoapis.in", expires_in: 3_600 },
    { recordIdPrefix: P, gate: gate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: IR, status: "active" }] }), { status: 200 }) } as never);
});
const ok = <T>(value: T) => ({ ok: true as const, value, status: 200, creditsRemaining: null });
const bad = (kind: string) => ({ ok: false as const, error: { kind, status: 400 }, creditsRemaining: null });
const page = (records: unknown[], more = false) => ok({ records, moreRecords: more });

const rows = [
  { id: R1, UTR: `CLAIM-${LEAD}-1`, Match_State: "Not found", Amount: 250_000, Received_On: "2026-09-20", Modified_Time: "2026-09-22T10:00:00+05:30" },
  { id: R2, UTR: `CLAIM-${LEAD}-2`, Match_State: "Not found", Amount: 100_000, Received_On: "2026-09-25", Modified_Time: "2026-09-26T23:30:00Z" },
  { id: R3, UTR: `CLAIM-${LEAD}-3`, Match_State: "Claimed", Amount: 500_000, Received_On: "2026-10-05", Modified_Time: "2026-10-05T12:00:00+05:30" },
];
const notes: Record<string, unknown[]> = {
  [R1]: [{ Note_Title: FOUND_TITLE, Note_Content: "x" }],
  [R2]: [{ Note_Title: NOT_FOUND_TITLE, Note_Content: "Not in the 25 Sep statement" }],
};
const crmOf = (qs: string[] = [], hide: string[] = []) => ({
  async coql(_c: unknown, q: string) {
    qs.push(q);
    if (hide.some((h) => q.includes(h))) return bad("invalid-data");
    return page(q.includes("Amount") ? rows : rows.map(({ id, UTR, Match_State, Modified_Time }) => ({ id, UTR, Match_State, Modified_Time })));
  },
  async getRelated(_c: unknown, _m: string, id: string) { return page(notes[id] ?? []); },
});

describe("IR claims — the state of the IR's OWN payment reports, never a receipt line", () => {
  it("pending / matched / rejected, newest first, with amount, the date said and the IST day Finance answered", async () => {
    const r = await readClaimLines(crmOf() as never, cred, [LEAD]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((x) => [x.seq, x.state, x.amount, x.claimedOn, x.answeredOn, x.reason])).toEqual([
      [3, "pending", 500_000, "2026-10-05", null, null],
      [2, "rejected", 100_000, "2026-09-25", "2026-09-27", "Not in the 25 Sep statement"],   // 23:30 UTC is already the next IST day
      [1, "matched", 250_000, "2026-09-20", "2026-09-22", null],
    ]);
  });
  it("selects only fields the IR profile reads; no allotment, kind, mode, matcher or bank reference is asked for or returned", async () => {
    const qs: string[] = [];
    const r = await readClaimLines(crmOf(qs) as never, cred, [LEAD]);
    expect(qs[0]).toContain("select id, UTR, Match_State, Amount, Received_On, Modified_Time from Receipts");
    expect(qs[0]).not.toMatch(/Matched_By|Allotment|Kind|Mode|Reversal_Of|Idempotency_Key|Note/);
    expect(JSON.stringify(r)).not.toContain("CLAIM-");
  });
  it("Zoho hiding a field repeats the read with the key, state and answer day alone: the state still shows, amount and date said do not (never a guess)", async () => {
    const qs: string[] = [];
    const r = await readClaimLines(crmOf(qs, ["Amount"]) as never, cred, [LEAD]);
    expect(qs.length).toBe(2);
    expect(qs[1]).toContain("select id, UTR, Match_State, Modified_Time from Receipts");
    expect(r.ok && r.lines.map((x) => [x.state, x.amount, x.claimedOn, x.answeredOn ? "d" : null])).toEqual([["pending", null, null, null], ["rejected", null, null, "d"], ["matched", null, null, "d"]].map((x) => x));
  });
  it("only the asked leads' reports; another lead's key is dropped; more than a page is refused, not shown in part", async () => {
    const other = { id: "9007199254740991111", UTR: `CLAIM-${LEAD2}-1`, Match_State: "Claimed" };
    const crm = { async coql() { return page([...rows, other]); } };
    const r = await readClaimLines(crm as never, cred, [LEAD, "not-an-id"]);
    expect(r.ok && r.lines.length).toBe(3);
    expect(await readClaimLines({ async coql() { return page(rows, true); } } as never, cred, [LEAD])).toEqual({ ok: false, kind: "invalid" });
    expect(await readClaimLines({ async coql() { return bad("server"); } } as never, cred, [LEAD])).toEqual({ ok: false, kind: "server" });
    expect(await readClaimLines({ async coql() { throw new Error("x"); } } as never, cred, [])).toEqual({ ok: true, lines: [] });
  });
  it("review 7: more than 200 reports in all are paged, so no claim line is lost", async () => {
    const qs: string[] = [];
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `9007199254741${String(i).padStart(6, "0")}`, UTR: `CLAIM-${LEAD}-${i + 1}`, Match_State: "Claimed", Amount: 1, Received_On: "2026-10-01", Modified_Time: "2026-10-01T10:00:00+05:30" }));
    const crm = { async coql(_c: unknown, q: string) { qs.push(q); const at = Number(/limit (\d+),/.exec(q)![1]); return page(many.slice(at, at + 200), at + 200 < many.length); } };
    const r = await readClaimLines(crm as never, cred, [LEAD]);
    expect(r.ok && r.lines.length).toBe(250);
    expect(qs).toHaveLength(2);
  });
  it("review 8: the answered reports' Notes are read together, at most 10, never one after another", async () => {
    let live = 0, peak = 0, reads = 0;
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `9007199254742${String(i).padStart(6, "0")}`, UTR: `CLAIM-${LEAD}-${i + 1}`, Match_State: "Not found", Modified_Time: "2026-10-01T10:00:00+05:30" }));
    const crm = { async coql() { return page(many); },
      async getRelated() { reads++; peak = Math.max(peak, ++live); await new Promise((r) => setTimeout(r, 5)); live--; return page([{ Note_Title: FOUND_TITLE }]); } };
    const r = await readClaimLines(crm as never, cred, [LEAD]);
    expect(r.ok && r.lines.filter((x) => x.state === "matched").length).toBe(10);
    expect(reads).toBe(10);
    expect(peak).toBe(10);
  });
  it("an answered report whose Note cannot be told apart stays 'answered'; a state that is neither Claimed nor Not found is 'answered'", () => {
    expect(claimLineOf(rows[0]!, null, null)!.state).toBe("answered");
    expect(claimLineOf({ ...rows[0]!, Match_State: "Matched" }, null, null)!.state).toBe("answered");
    expect(claimLineOf({ ...rows[0]!, UTR: "UTR-REAL-123" }, null, null)).toBeNull();
  });
  it("the IR's chase row carries the claims of its lead (and none for a lead with none)", async () => {
    const contact = { id: CONTACT, code: "ARL-INV-0139", firstName: "Synth", lastName: "Investor", originLeadId: LEAD } as never;
    const allot = { id: ALLOT, Customer: CONTACT, LLP_Lookup: LLP, Committed_Units: 10, Allocation_Status: "Reserved", holdUntil: "2026-11-09" } as never;
    const r = await readClaimLines(crmOf() as never, cred, [LEAD]);
    const byLead = new Map([[LEAD, r.ok ? r.lines : []]]);
    const [row] = buildChase([contact], [allot], new Map(), new Map(), null, NOW, byLead);
    expect(row!.claims.map((c) => c.state)).toEqual(["pending", "rejected", "matched"]);
    expect(buildChase([contact], [allot], new Map(), new Map(), null, NOW)[0]!.claims).toEqual([]);
  });
  it("D69 stands: the IR read names no receipt-line field (kind, mode, matcher, reversal, bank key)", () => {
    const src = readFileSync(join(__dirname, "..", "leads", "claim-lines.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/Matched_By|Reversal_Of|Idempotency_Key|\bKind\b|\bMode\b/);
  });
});

describe("W2-KAM-1 — the KAM's rupees are Zoho's, and the mask is gone", () => {
  const src = (f: string) => readFileSync(join(__dirname, "..", "..", f), "utf8");
  it("the record reader reads the AM seat's money through the per-field read, not a prototype unit price", () => {
    const rec = src("server/investors/record.ts");
    expect(rec).toMatch(/isAmSeat\(seat\) && allots\.length \? await readIrMoney/);
    expect(src("server/investors/allotments.ts")).toMatch(/isAmSeat\(seat\)/);
  });
  it("the list projection for AM seats still names no money column (the wall holds for the lists; rupees come from the one per-field read)", () => {
    expect(src("server/data/projections.ts")).toMatch(/amAllotments: checkAmProjection/);
  });
});
