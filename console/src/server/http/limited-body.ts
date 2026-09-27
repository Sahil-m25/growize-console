/** Read a request body without allowing an absent or false Content-Length to bypass the cap. */

export type LimitedBodyResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly reason: "payload-too-large" | "invalid-utf8" | "aborted" | "read-failed" };

async function cancel(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The connection may already have closed; the public result remains generic.
  }
}

export async function readLimitedUtf8Body(
  request: Request,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<LimitedBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxBytes must be a positive safe integer.");
  if (signal?.aborted) return { ok: false, reason: "aborted" };
  if (request.body === null) return { ok: true, body: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abortRead = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abortRead, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) {
        await cancel(reader);
        return { ok: false, reason: "aborted" };
      }
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) {
        await cancel(reader);
        return { ok: false, reason: "payload-too-large" };
      }
      chunks.push(item.value);
    }
    if (signal?.aborted) return { ok: false, reason: "aborted" };
  } catch {
    return { ok: false, reason: signal?.aborted ? "aborted" : "read-failed" };
  } finally {
    signal?.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // Preserve a leading BOM as U+FEFF so re-encoding for HMAC produces the
    // exact original UTF-8 bytes rather than silently dropping it.
    return { ok: true, body: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "invalid-utf8" };
  }
}
