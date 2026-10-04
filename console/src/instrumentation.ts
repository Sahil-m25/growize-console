/**
 * Next.js server-start hook (runs once per server process, before any request). Fails the start when the
 * shared state store is misconfigured or unreachable (server/state/runtime.ts) — never a silent fallback.
 * The NEXT_RUNTIME test must wrap the import (not an early return) so the edge bundle drops node:crypto.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupCheck } = await import("./server/state/runtime");
    await startupCheck();
  }
}
