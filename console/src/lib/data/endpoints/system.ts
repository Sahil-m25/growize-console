/* M15-S05-NOTE-2 — the System page's live checks: GET /api/system (server/system/facts + checks: Zoho credits headroom,
   429s and failures from Plane B, the audit archive's last run, investor-app delivery from the outbox).
   Live: the route (only `sys` seats; 403 otherwise).
   Fixture: no live facts exist in the demo book. The page's own demo CHECKS (the prototype's states) already fill the
   screen in fixture mode, so the fixture answers an empty view and the live card stays out of the way. */

import type { SystemView } from "@/server/system/checks";
import type { ConsoleState } from "@/lib/store";
import { ok, type ReadEndpoint } from "../api";

/** Which Zoho CRM org this deployment talks to (ZOHO_CRM_ENVIRONMENT / ZOHO_EXPECTED_ORG_ID) and the org id a token
 *  last proved in this process — ids only, never a secret. Absent in fixture mode. */
export interface SystemCrm {
  readonly environment: "production" | "sandbox" | "misconfigured";
  readonly expectedOrgId: string | null;
  readonly verifiedOrgId: string | null;
}
export type SystemLive = SystemView & { readonly asOf: number; readonly crm?: SystemCrm };

export const systemRead: ReadEndpoint<ConsoleState, void, SystemLive> = {
  path: () => "/api/system",
  pick: j => j as SystemLive,
  fixture: () => ok({ working: 0, attention: 0, down: 0, cards: [], all: [], asOf: 0 }),
};
