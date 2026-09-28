/**
 * M12-S02-T02 — read an upload's bytes from the request, capped, in memory only.
 *
 * The same rule as server/http/limited-body (which reads UTF-8 text, so it cannot carry a PDF): an absent or
 * false Content-Length never bypasses the cap; a declared length over the cap is refused before one byte is read.
 * The first bytes are available to the caller's magic-byte check. Nothing is written to disk; the caller zeroes
 * the buffer once Zoho has answered.
 */

export type LimitedBytesResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: "payload-too-large" | "empty" | "aborted" | "read-failed" };

export async function readLimitedBytes(request: Request, maxBytes: number, signal?: AbortSignal): Promise<LimitedBytesResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxBytes must be a positive safe integer.");
  if (signal?.aborted) return { ok: false, reason: "aborted" };
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d{1,16}$/.test(declared) && Number(declared) > maxBytes) {
    try { await request.body?.cancel(); } catch { /* already closed */ }
    return { ok: false, reason: "payload-too-large" };
  }
  if (request.body === null) return { ok: false, reason: "empty" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abortRead = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abortRead, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) { try { await reader.cancel(); } catch { /* closed */ } return { ok: false, reason: "aborted" }; }
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* closed */ }
        for (const c of chunks) c.fill(0);
        return { ok: false, reason: "payload-too-large" };
      }
      chunks.push(item.value);
    }
  } catch {
    for (const c of chunks) c.fill(0);
    return { ok: false, reason: signal?.aborted ? "aborted" : "read-failed" };
  } finally {
    signal?.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  if (total === 0) return { ok: false, reason: "empty" };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; c.fill(0); }
  return { ok: true, bytes };
}
