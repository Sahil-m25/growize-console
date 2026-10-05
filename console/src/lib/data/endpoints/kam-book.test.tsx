/* R5 — the "move a whole book" endpoint: path/body/pick (live) and the fixture half (demo book). */
import { describe, expect, it, vi } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { bookOf, initialImUi, type ImAction, type ImState } from "@/lib/im";
import { runWrite } from "../api";
import { kamMoveBook } from "./investors";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));

describe("move a whole book", () => {
  it("live: POST /api/kams/[from]/move-book with toKamUserId, and continueFrom when resuming", async () => {
    const f = fetchOf(200, { moved: 3, movedIds: ["1", "2", "3"], notMoved: ["4"], reasons: { conflict: 1 }, continueFrom: "5" });
    const b = { s: demo(), me: "divya" };
    const r = await runWrite("live", kamMoveBook, b, () => {}, { from: "111", to: "222" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/kams/111/move-book");
    expect(f.mock.calls[0][1]!.method).toBe("POST");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ toKamUserId: "222" });
    expect(r).toEqual({ ok: true, data: { moved: 3, notMoved: 1, continueFrom: "5" } });
    await runWrite("live", kamMoveBook, b, () => {}, { from: "111", to: "222", continueFrom: "5" }, { fetch: f });
    expect(JSON.parse(f.mock.calls[1][1]!.body as string)).toEqual({ toKamUserId: "222", continueFrom: "5" });
  });
  it("live: a refusal goes to the page note", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("live", kamMoveBook, { s: demo(), me: "divya" }, (a: ImAction) => seen.push(a), { from: "111", to: "222" },
      { fetch: fetchOf(403, { error: "Only a key account manager can be named.", code: "assignee-not-am" }) });
    expect(r.ok).toBe(false);
    expect(seen).toEqual([{ type: "note", msg: "Only a key account manager can be named." }]);
  });
  it("fixture: Divya moves Imran's four accounts to Neha, one assignKam each; a KAM, a non-KAM target and the same KAM are refused", async () => {
    const s = demo();
    const ids = bookOf(s, "divya", "imran").map(x => x.id);
    expect(ids).toHaveLength(4);
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", kamMoveBook, { s, me: "divya" }, (a: ImAction) => seen.push(a), { from: "imran", to: "neha" });
    expect(r).toEqual({ ok: true, data: { moved: 4, notMoved: 0, continueFrom: null } });
    expect(seen).toEqual(ids.map(id => ({ type: "assignKam", id, k: "neha" })));
    expect(await runWrite("fixture", kamMoveBook, { s, me: "imran" }, () => {}, { from: "imran", to: "neha" })).toMatchObject({ ok: false, status: 403, code: "seat-denied" });
    expect(await runWrite("fixture", kamMoveBook, { s, me: "divya" }, () => {}, { from: "imran", to: "harsha" })).toMatchObject({ ok: false, status: 403, code: "assignee-not-am" });
    expect(await runWrite("fixture", kamMoveBook, { s, me: "divya" }, () => {}, { from: "imran", to: "imran" })).toMatchObject({ ok: false, status: 400, code: "same-kam" });
  });
});
