/**
 * Server-only composition of the roster (D49): the reader over the process's log sink (logs/runtime `logSource`, so file or
 * Stratus alike), and the availability writer on the shared Plane C. One per process.
 */

import { createPlaneCLog } from "../identity/plane-c";
import { logSinks } from "../logs/factory";
import { logSource } from "../logs/runtime";
import { createAvailability } from "./availability";
import { createRoster } from "./roster";

const G = globalThis as typeof globalThis & { __gzRoster?: { roster: ReturnType<typeof createRoster>; availability: ReturnType<typeof createAvailability> } };

function held() {
  if (!G.__gzRoster) {
    const roster = createRoster(logSource());
    G.__gzRoster = { roster, availability: createAvailability({ planeC: createPlaneCLog(logSinks().identity), roster }) };
  }
  return G.__gzRoster;
}

export const rosterRuntime = () => held().roster;
export const availabilityRuntime = () => held().availability;
