/**
 * Next.js server-start hook (runs once per server process, before any request). Fails the start when the
 * shared state store is misconfigured or unreachable (server/state/runtime.ts) — never a silent fallback.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startupCheck } = await import("./server/state/runtime");
  await startupCheck();
}
