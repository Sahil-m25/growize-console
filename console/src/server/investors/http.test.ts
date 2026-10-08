/* B-02a / B-08a: a read Zoho refused is not an outage. invalid-data (COQL rejects a hidden or missing column) answers 502 and
   says so; forbidden (no module permission) answers 403; only a real outage reads "Zoho is not answering" (503).
   Run: npx vitest run src/server/investors/http.test.ts */
import { describe, expect, it } from "vitest";
import { failureResponse as investorsFailure } from "./http";
import { failureResponse as casesFailure, writeFailure as casesWriteFailure } from "../cases/http";

describe("investors failureResponse", () => {
  it("answers invalid-data with 502 and an honest message, never 'not answering'", async () => {
    const r = investorsFailure({ kind: "source-error", errorKind: "invalid-data" });
    expect(r.status).toBe(502);
    const b = await r.json();
    expect(b.code).toBe("invalid-data");
    expect(b.error).toMatch(/refused this read/);
    expect(b.error).not.toMatch(/not answering/);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("answers forbidden with 403", async () => {
    const r = investorsFailure({ kind: "source-error", errorKind: "forbidden" });
    expect([r.status, (await r.json()).code]).toEqual([403, "forbidden"]);
  });
  it("keeps 503 'not answering' for an outage, 403 for a refusal and 409 for a conflict", async () => {
    const down = investorsFailure({ kind: "source-error", errorKind: "server" });
    expect([down.status, (await down.json()).error]).toEqual([503, "Zoho is not answering. Try again."]);
    expect(investorsFailure({ kind: "refused", reason: "seat-denied" }).status).toBe(403);
    expect(investorsFailure({ kind: "conflict" }).status).toBe(409);
  });
});

describe("cases failureResponse (tickets, farms, events)", () => {
  it("answers invalid-data with 502 and the honest message (B-02c: a Cases field missing in Zoho)", async () => {
    const r = casesFailure({ kind: "source-error", errorKind: "invalid-data", retryable: false });
    const b = await r.json();
    expect([r.status, b.code]).toEqual([502, "invalid-data"]);
    expect(b.error).not.toMatch(/not answering/);
  });
  it("answers forbidden with 403 and keeps the retryable split for an outage", async () => {
    expect(casesFailure({ kind: "source-error", errorKind: "forbidden", retryable: false }).status).toBe(403);
    expect(casesFailure({ kind: "source-error", errorKind: "server", retryable: true }).status).toBe(503);
    expect(casesFailure({ kind: "source-error", errorKind: "unexpected", retryable: false }).status).toBe(502);
  });
});

/* W2-KAM-6: a write Zoho refuses (a per-record NO_PERMISSION inside a 400 reads as invalid-data) is not "Zoho is not answering". */
describe("cases writeFailure", () => {
  it("answers a refused write as a refusal: invalid-data 502, forbidden 403 — never 'not answering'", async () => {
    const bad = casesWriteFailure({ kind: "source-error", errorKind: "invalid-data", retryable: false });
    const b = await bad.json();
    expect([bad.status, b.code]).toEqual([502, "invalid-data"]);
    expect(b.error).toMatch(/Zoho refused this change/);
    expect(b.error).not.toMatch(/not answering/);
    expect(casesWriteFailure({ kind: "source-error", errorKind: "forbidden", retryable: false }).status).toBe(403);
    expect(casesWriteFailure({ kind: "source-error", errorKind: "server", retryable: true }).status).toBe(503);
  });
  it("gives the hand-over's own refusals their statuses", async () => {
    const r = casesWriteFailure({ kind: "refused", reason: "owner-change-refused", message: "m" });
    expect([r.status, (await r.json()).code]).toEqual([403, "owner-change-refused"]);
    expect(casesWriteFailure({ kind: "refused", reason: "handover-refused", message: "m" }).status).toBe(502);
  });
});

describe("source-invalid", () => {
  it("is 502 with its own message, not 'not answering' (Numbers cash/risk on an unpriced allotment)", async () => {
    const r = investorsFailure({ kind: "source-error", errorKind: "source-invalid" });
    const b = await r.json();
    expect([r.status, b.code]).toEqual([502, "source-invalid"]);
    expect(b.error).toMatch(/cannot read/);
  });
});
