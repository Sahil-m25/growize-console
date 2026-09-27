/* THE FIXTURE HOOK (M19-S03 fills the registry). A fixture is a named change to the demo book the
   UI-case runner asks for after page load (`POST /api/test/fixture/<name>`). It may edit the dataset
   in place and/or return lead-side store actions the client dispatches after hydrating. */

import type { Dataset } from "@/lib/data/types";

export type FixtureFn = (ds: Dataset) => void | { actions: unknown[] };

/** The demo book already IS these; applying them changes nothing. */
const noop: FixtureFn = () => {};

export const FIXTURES: Record<string, FixtureFn> = {
  DEMO_STAFF: noop,
  DEMO_BOOK: noop,
  DEMO_BOOK__C: noop,
  DEMO_DATA: noop,
  DEMO_DATA__F: noop,
  "IM:DEMO_PORTAL": noop,
  "IM:DEMO_BOOK": noop,
  "IM:DEMO_BOOK__C": noop,
};

/** Apply `names` in order to a copy of `ds`. An unregistered name is skipped (its transform is a later story). */
export function applyFixtures(ds: Dataset, names: string[]): { ds: Dataset; actions: unknown[] } {
  const out = structuredClone(ds);
  const actions: unknown[] = [];
  for (const n of names) {
    const r = FIXTURES[n]?.(out);
    if (r && Array.isArray(r.actions)) actions.push(...r.actions);
  }
  return { ds: out, actions };
}
