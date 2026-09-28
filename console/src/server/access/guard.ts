/**
 * ROUTE GUARD — the runtime half (M01-S01-T04/T06). Pure logic and the route table: ./guard-core.
 *
 *   API handlers:  export const GET = withErrorCapture(guardApi("/api/data", get), "/api/data");
 *                  (withErrorCapture stays the outer wrapper, so a guard fault is still captured)
 *   Page routes:   const v = await pageGuard(pageIdOf(path)); if (!v.ok) redirect(v.landing);
 *                  — from a server component (app/template.tsx). Not from Edge middleware: the Zoho
 *                  session store and its sealer are Node-only.
 *
 * Fixture mode, and the phase-1 stub (Zoho sign-in not configured, not production), pass through
 * unchanged: the demo's own Shell gate decides there. A production build with no Zoho sign-in refuses
 * with 503 (fail closed).
 */

import { cookies } from "next/headers";
import { fixtureModeOn } from "../../lib/fixture-mode";
import { createPlaneCLog, createPlaneCMemorySink, type PlaneCLog } from "../identity/plane-c";
import { userSessions, zohoSignInConfigured } from "../oauth/runtime";
import { SID_COOKIE } from "../oauth/user-session";
import { createGuard, refusalResponse, type Guard, type GuardVerdict } from "./guard-core";

export { pageIdOf, API_ROUTES, GUARD_REFUSALS, seatPresets } from "./guard-core";
export type { GuardVerdict } from "./guard-core";

export function guardMode(env: NodeJS.ProcessEnv = process.env): "enforce" | "pass" | "not-configured" {
  if (fixtureModeOn(env)) return "pass";
  if (zohoSignInConfigured(env)) return "enforce";
  return env.NODE_ENV === "production" ? "not-configured" : "pass";
}

type Held = { guard: Guard; planeC: PlaneCLog };
const G = globalThis as typeof globalThis & { __gzRouteGuard?: Held };

/** PROVISIONAL until M01-S04's durable Plane C sink: an in-memory Plane C, as oauth/runtime.ts has. */
function held(): Held {
  if (G.__gzRouteGuard) return G.__gzRouteGuard;
  const planeC = createPlaneCLog(createPlaneCMemorySink());
  const guard = createGuard({
    mode: () => guardMode(),
    planeC,
    async readSession() {
      const jar = await cookies();
      const r = await userSessions().current(jar.get(SID_COOKIE)?.value);
      return r.ok ? { ok: true, session: r.session } : { ok: false, why: r.why };
    },
  });
  G.__gzRouteGuard = { guard, planeC };
  return G.__gzRouteGuard;
}

/** Decide a console page for the signed-in person. `!ok` → redirect to `landing`. */
export function pageGuard(pageId: string | null): Promise<GuardVerdict> {
  return held().guard.page(pageId);
}

/** Wrap one API handler: a refused request gets a 401/403/503 with the named message and no data. */
export function guardApi<A extends unknown[]>(route: string, handler: (...args: A) => Response | Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const v = await held().guard.api(route);
    if (!v.ok) return refusalResponse(v);
    return handler(...args);
  };
}
