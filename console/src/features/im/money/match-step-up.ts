/* M10-S02-NOTE-10 — a refund match answers 403 { code: "step-up" } until a live step-up "refund" is open (D22). The Match button
   then opens the step-up panel and, once the person is confirmed, presses the match again. The confirmation is a full-page
   trip to Zoho and back, so the receipt id waits in sessionStorage (this tab only, an id and nothing else — rule 7) and the
   page that comes back with ?stepup=ok presses it. 423 { code: "locked" } is not a step-up to open: its message is shown. */
import type { ApiResult } from "@/lib/data/api";

export const MATCH_PENDING_KEY = "gz-match-after-stepup";

/** the match route's "confirm it is you first" answer (not the locked one, not any other 403) */
export const needsStepUp = (r: ApiResult<unknown>): boolean => !r.ok && r.status === 403 && r.code === "step-up";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const tabStore = (): Store | null => { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } };

export function holdMatch(id: string, st: Store | null = tabStore()): void { try { st?.setItem(MATCH_PENDING_KEY, id); } catch { /* storage blocked: the person presses Match again */ } }
export function dropMatch(st: Store | null = tabStore()): void { try { st?.removeItem(MATCH_PENDING_KEY); } catch { /* nothing to drop */ } }
/** true once, when `id` is the receipt held for the step-up that just succeeded */
export function takeHeldMatch(id: string, back: string | null, st: Store | null = tabStore()): boolean {
  try {
    if (back !== "ok" || st?.getItem(MATCH_PENDING_KEY) !== id) return false;
    st.removeItem(MATCH_PENDING_KEY);
    return true;
  } catch { return false; }
}

/**
 * One press of Match. `go` is the match call. A step-up answer is returned as "step-up" (the caller opens the panel);
 * a second step-up answer right after a step-up was open (`retry`) is shown as the route's message, not asked again
 * (no loop). Anything else is the route's own result, whose message the endpoint already put in the page note.
 */
export async function pressMatch<T>(go: () => Promise<ApiResult<T>>, retry: boolean): Promise<"matched" | "step-up" | "refused"> {
  const r = await go();
  if (r.ok) return "matched";
  return !retry && needsStepUp(r) ? "step-up" : "refused";
}
