/* screensOf(k) — ir-console-redesigned.html 2934-2940 (reachNow/screensOf). reachOf is the
   ceiling (seat + chain + whatever loan is switched on); a screen also needs the view cap still
   on and drops a PAGECAPS entry marked `nopage` ("add" — capture moved into a door and stopped
   being a screen). Kept local to `me` because `src/features/people/helpers.ts`'s `screensOf`
   does not drop `nopage` yet — see crossOwnerRequests. */

import { PAGECAPS } from "@/domain";
import type { NavKey, PersonKey } from "@/domain";
import { hasCap, reachOf } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";

export function meScreens(state: ConsoleState, k: PersonKey): NavKey[] {
  return reachOf(state, k).filter((p) => {
    const pc = (PAGECAPS as Record<string, { nopage?: boolean } | undefined>)[p];
    return !!pc && !pc.nopage && hasCap(state, k, p, "view");
  }) as NavKey[];
}
