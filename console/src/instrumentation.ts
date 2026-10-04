/**
 * Next.js server-start hook (runs once per server process, before any request). Fails the start when the
 * shared state store is misconfigured or unreachable (server/state/runtime.ts), or GRANT_STORE / SIGN_CHECK_TIMER
 * name a value they refuse — never a silent fallback.
 * The NEXT_RUNTIME test must wrap the import (not an early return) so the edge bundle drops node:crypto.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupCheck } = await import("./server/state/runtime");
    await startupCheck();
    // The per-instance switches that ride on it (docs/architecture/shared-state.md): a bad GRANT_STORE /
    // SIGN_CHECK_TIMER refuses the start instead of failing closed on every request.
    const { grantStoreKind } = await import("./server/access/grants");
    grantStoreKind();
    const { signCheckTimerOn } = await import("./server/zoho-sign/runtime");
    signCheckTimerOn();
  }
}
