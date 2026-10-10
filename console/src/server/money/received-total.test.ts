/* D140 (W8-IRA-1) — the one writer of the allotment's Total_Amount_Received, on a scripted Zoho double. Synthetic ids only.
 * Run: npx vitest run src/server/money/received-total.test.ts */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { userCredential, type UserCredential } from "@/lib/zoho/client";
import { createMemorySink, createOpsLog } from "@/lib/zoho/log";
import { receivedOf, syncReceived, RECEIVED_FIELD } from "./received-total";

const P = "9007199254";
const FIN = "9007199254740990905";
const ALLOT = "9007199254740991004";
const MT = "2026-10-10T12:00:00+05:30", MT2 = "2026-10-10T12:00:05+05:30";
const NOW = Date.parse("2026-10-10T06:30:00Z");
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let cred: UserCredential;
beforeAll(async () => {
  cred = await userCredential({ access_token: "synthetic-token-never-live", api_domain: "https://www.zohoapis.in", expires_in: 3_600 },
    { recordIdPrefix: P, gate: gate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: FIN, status: "active" }] }), { status: 200 }) } as never);
});
const ok = <T>(value: T) => ({ ok: true as const, value, status: 200, creditsRemaining: null });
const bad = (kind: string) => ({ ok: false as const, error: { kind, status: 409 }, creditsRemaining: null });
const rc = (id: string, kind: string, amount: number, state = "Matched") =>
  ({ id: "90071992547409911" + id, Allotment: { id: ALLOT }, Kind: kind, Amount: amount, UTR: "SYNTH" + id, Received_On: "2026-10-01", Match_State: state, Matched_By: { id: FIN }, Modified_Time: MT });

function crmDouble(o: { receipts: unknown[]; current: unknown; updates?: unknown[] }) {
  const writes: { fields: Record<string, unknown>; ifUnmodifiedSince?: string }[] = [];
  const reads: string[] = [];
  let u = 0;
  const crm = {
    async coql() { return ok({ records: o.receipts, moreRecords: false }); },
    async getRecord(_c: unknown, _m: string, id: string, opts: { fields: string[] }) {
      reads.push(opts.fields.join(","));
      return ok({ id, [RECEIVED_FIELD]: o.current, Modified_Time: u ? MT2 : MT });
    },
    async update(_c: unknown, _m: string, _id: string, fields: Record<string, unknown>, opts: { ifUnmodifiedSince?: string }) {
      writes.push({ fields, ifUnmodifiedSince: opts.ifUnmodifiedSince });
      const r = o.updates?.[u++] ?? ok({ id: ALLOT });
      return r;
    },
  };
  return { crm: crm as never, writes, reads };
}

describe("D140 received-total", () => {
  it("is matched inbound minus matched refunds; pending and claimed count nothing; never below 0", () => {
    const t = (id: string, kind: string, amount: number, state = "Matched") => ({ id, kind, amount, state, at: null });
    expect(receivedOf([t("1", "Advance", 1_000_000), t("2", "Part", 500_000), t("3", "Part", 99, "Pending"), t("4", "Advance", 7, "Claimed")])).toBe(1_500_000);
    expect(receivedOf([t("1", "Advance", 100), t("2", "Refund", 300)])).toBe(0);
  });

  it("writes the sum once, guarded by the allotment's Modified_Time (the W8-IRA-1 case: Rs 10 L advance, field 0)", async () => {
    const d = crmDouble({ receipts: [rc("01", "Advance", 1_000_000)], current: 0 });
    const r = await syncReceived(d.crm, cred, ALLOT);
    expect(r).toEqual({ ok: true, value: { received: 1_000_000, written: true }, code: null });
    expect(d.writes).toEqual([{ fields: { [RECEIVED_FIELD]: 1_000_000 }, ifUnmodifiedSince: MT }]);
  });

  it("writes nothing when Zoho already says the same (a repeated press)", async () => {
    const d = crmDouble({ receipts: [rc("01", "Advance", 1_000_000)], current: 1_000_000 });
    expect(await syncReceived(d.crm, cred, ALLOT)).toEqual({ ok: true, value: { received: 1_000_000, written: false }, code: null });
    expect(d.writes).toEqual([]);
  });

  it("a conflict re-reads and tries once more; a second conflict is reported, never thrown", async () => {
    const d = crmDouble({ receipts: [rc("01", "Advance", 5)], current: 0, updates: [bad("conflict")] });
    expect((await syncReceived(d.crm, cred, ALLOT)).ok).toBe(true);
    expect(d.writes.map((w) => w.ifUnmodifiedSince)).toEqual([MT, MT2]);
    const sink = createMemorySink();
    const e = crmDouble({ receipts: [rc("01", "Advance", 5)], current: 0, updates: [bad("conflict"), bad("conflict")] });
    expect(await syncReceived(e.crm, cred, ALLOT, undefined, createOpsLog(sink))).toEqual({ ok: false, value: null, code: "allotment-changed" });
    const lines = sink.records();
    expect(lines.length).toBe(1);
    expect(JSON.stringify(lines)).toContain("allotment-changed");
    expect(JSON.stringify(lines)).not.toMatch(/"amount"|:5[,}]/);
  });

  it("two Finance matches at once: a total written by the other match's sync during this read is never overwritten with a stale one", async () => {
    /* this sync's receipt read sees only its own match; the other match's sync writes both while that read is in flight */
    const z = { value: 0 as number, mt: MT, receipts: [rc("01", "Advance", 100_000)] };
    const crm = {
      async coql() {
        const seen = z.receipts;
        z.receipts = [rc("01", "Advance", 100_000), rc("02", "Part", 50_000)]; z.value = 150_000; z.mt = MT2;   // the other sync lands
        return ok({ records: seen, moreRecords: false });
      },
      async getRecord(_c: unknown, _m: string, id: string) { return ok({ id, [RECEIVED_FIELD]: z.value, Modified_Time: z.mt }); },
      async update(_c: unknown, _m: string, _id: string, fields: Record<string, unknown>, opts: { ifUnmodifiedSince?: string }) {
        if (opts.ifUnmodifiedSince !== z.mt) return bad("conflict");
        z.value = fields[RECEIVED_FIELD] as number; return ok({ id: ALLOT });
      },
    };
    await syncReceived(crm as never, cred, ALLOT);
    expect(z.value).toBe(150_000);
  });

  it("an unreadable receipt page writes nothing (never a partial total)", async () => {
    const d = crmDouble({ receipts: [{ id: "x" }], current: 0 });
    expect(await syncReceived(d.crm, cred, ALLOT)).toEqual({ ok: false, value: null, code: "receipts-unread" });
    expect(d.writes).toEqual([]);
  });

  it("rule 1: no other server file writes Total_Amount_Received", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) { const s = readFileSync(p, "utf8");
        if (/Total_Amount_Received\s*:/.test(s) || /\[RECEIVED_FIELD\]\s*:/.test(s)) hits.push(p.slice(root.length + 1)); } } };
    walk(root);
    expect(hits).toEqual(["money/received-total.ts"]);
  });
});
