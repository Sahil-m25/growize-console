/**
 * M17-S01-T01 — server-only composition of the Teams reads: the user-token Zoho client, the seat
 * directory and pinned role/profile ids (ZOHO_SEAT_IDS), the shared grant store and a scoped count cache.
 */

import { createScopedCache } from "../../lib/zoho/cache";
import { createZohoClient } from "../../lib/zoho/client";
import { sharedGrantReader } from "../access/grants";
import { oauthParts } from "../oauth/runtime";
import { createTeamsService, type TeamsService } from "./service";
import type { PinnedSeatIds } from "./teams";

const G = globalThis as typeof globalThis & { __gzTeams?: TeamsService };

export function teamsService(env: NodeJS.ProcessEnv = process.env): TeamsService {
  if (G.__gzTeams) return G.__gzTeams;
  const o = oauthParts(env);
  const pinned = JSON.parse(env.ZOHO_SEAT_IDS!) as PinnedSeatIds;
  G.__gzTeams = createTeamsService({
    crm: createZohoClient({ gate: o.gate, log: o.log, recordIdPrefix: o.recordIdPrefix, maxAttempts: 2 }),
    seats: o.seats,
    pinned,
    grants: sharedGrantReader(),
    cache: createScopedCache(),
    log: o.log,
  });
  return G.__gzTeams;
}
