/* M18-S15-H4 — POST /api/documents/upload: over the size cap → 413, a type off the allow-list → 415, and nothing
 * is written (the uploader, the only thing that calls Zoho, is never reached). Through the real route module;
 * only the signed-in context and the uploader are stubbed. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const commit = vi.fn();
const refusal = vi.fn();

vi.mock("@/server/investors/http", () => ({
  NO_STORE: { "Cache-Control": "no-store" },
  investorsContext: async () => ({
    ok: true,
    ctx: { principal: { session: { seat: "fin" }, credential: { userId: "u-test" } }, rt: { log: { refusal } } },
  }),
}));
vi.mock("@/server/documents/runtime", () => ({ documentUploader: () => ({ commit }) }));

const { POST } = await import("@/app/api/documents/upload/route");
const { MAX_UPLOAD_BYTES } = await import("@/server/documents/upload");

const URL_ = "http://localhost:3001/api/documents/upload?scope=personal&id=4000000000001&name=paper.pdf";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const post = (init: RequestInit & { duplex?: "half" }) => POST(new Request(URL_, { method: "POST", ...init }), {} as never);

beforeEach(() => {
  commit.mockReset();
  refusal.mockReset();
  commit.mockResolvedValue({ ok: true, value: { id: "att-1" } });
});

describe("M18-S15-H4 upload caps", () => {
  it("a declared size over the cap is 413 before a byte is read; nothing is written", async () => {
    const res = await post({ headers: { "content-type": "application/pdf", "content-length": String(MAX_UPLOAD_BYTES + 1), "idempotency-key": "k-1" }, body: PDF });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too-large");
    expect(commit).not.toHaveBeenCalled();
  });

  it("a body that streams past the cap with no Content-Length is 413; nothing is written", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { if (sent > MAX_UPLOAD_BYTES) { c.close(); return; } sent += chunk.byteLength; c.enqueue(chunk); },
    });
    const res = await post({ headers: { "content-type": "application/pdf", "idempotency-key": "k-2" }, body, duplex: "half" });
    expect(res.status).toBe(413);
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(["text/html", "application/x-msdownload", "application/octet-stream", "image/svg+xml", "text/csv"])(
    "Content-Type %s is 415 before the body is read; nothing is written", async (type) => {
      const res = await post({ headers: { "content-type": type, "idempotency-key": "k-3" }, body: PDF });
      expect(res.status).toBe(415);
      expect((await res.json()).code).toBe("type-not-allowed");
      expect(commit).not.toHaveBeenCalled();
    });

  it("no Content-Type at all is 415", async () => {
    const res = await post({ headers: { "idempotency-key": "k-4" }, body: new Blob([PDF]).stream(), duplex: "half" });
    expect(res.status).toBe(415);
    expect(commit).not.toHaveBeenCalled();
  });

  it("an allowed type within the cap reaches the uploader (the harness does reach the write)", async () => {
    const res = await post({ headers: { "content-type": "application/pdf; charset=binary", "idempotency-key": "k-5" }, body: PDF });
    expect(res.status).toBe(200);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
