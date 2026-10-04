/* M15-S05-NOTE-2 — GET /api/system as the System page reads it. */
import { describe, expect, it, vi } from "vitest";
import { liveRead } from "../api";
import { systemRead } from "./system";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("systemRead", () => {
  it("live: reads /api/system and passes the view through", async () => {
    const view = { working: 1, attention: 0, down: 0, cards: [], all: [{ key: "credits", t: "Zoho API credits left", state: "working", figure: "42000", owner: "Digital Infrastructure", fix: "x" }], asOf: 5 };
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200, view));
    const r = await liveRead(systemRead, "/api/system", { fetch: f });
    expect(f.mock.calls[0]![0]).toBe("/api/system");
    expect(r).toEqual({ state: "ok", data: view });
  });
  it("live: a seat without `sys` is refused 403 with its code", async () => {
    const f = vi.fn(async () => json(403, { error: "The system checks are Digital Infrastructure's.", code: "not-a-system-reader" }));
    const r = await liveRead(systemRead, "/api/system", { fetch: f });
    expect(r.state).toBe("error");
    if (r.state === "error") expect(r.err.code).toBe("not-a-system-reader");
  });
  it("fixture: empty, so the page's demo checks stand alone", () => {
    const r = systemRead.fixture({} as never, undefined);
    expect(r).toEqual({ ok: true, data: { working: 0, attention: 0, down: 0, cards: [], all: [], asOf: 0 } });
  });
});
