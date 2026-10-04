/**
 * Next.js server-start hook (runs once per server process, before any request). Fails the start when the
 * shared state store is misconfigured or unreachable (server/state/runtime.ts), or when it is shared and
 * SESSION_ENC_KEY is missing or malformed (server/oauth/session-store.ts) — never a silent fallback.
 * The NEXT_RUNTIME test must wrap the import (not an early return) so the edge bundle drops node:crypto.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupCheck } = await import("./server/state/runtime");
    const kind = await startupCheck();
    /* M18-S09-NOTE-1: a shared state store without SESSION_ENC_KEY would keep sessions unencrypted — refuse */
    const { sessionStoreStartupCheck } = await import("./server/oauth/session-store");
    sessionStoreStartupCheck(kind);
  }
}
