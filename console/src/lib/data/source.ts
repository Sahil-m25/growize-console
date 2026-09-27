/* THE SOURCE CHOICE — server-only (route handlers import this; no client module may). Fixture
   mode serves the demo book from `console/fixtures/` plus the applied fixtures; everything else
   serves `zohoSource`, which in phase 1 is the empty book on a real Kolkata clock. */

import { appliedFixtures, fixtureModeOn, fixtureVersion } from "@/lib/fixture-mode";
import { clockDay, kolkataNow } from "./clock";
import { emptyDataset } from "./empty";
import type { DataPayload, DataSource, Dataset } from "./types";

/** Phase 2 replaces this with the live read on the signed-in person's own Zoho token (D53). */
export const zohoSource: DataSource = {
  async load(): Promise<Dataset> {
    const now = kolkataNow();
    return emptyDataset(clockDay(now), now);
  },
};

/** The demo book, then whatever fixtures the test runner has applied. The fixtures load lazily so
 *  nothing of them is ever bundled into a module that did not ask. */
export const fixtureSource: DataSource & { loadApplied(): Promise<{ ds: Dataset; actions: unknown[] }> } = {
  async loadApplied() {
    const [{ demoBook }, { applyFixtures }] = await Promise.all([import("@fixtures/book"), import("@fixtures/apply")]);
    return applyFixtures(demoBook(), appliedFixtures());
  },
  async load() {
    return (await this.loadApplied()).ds;
  },
};

export const getSource = (env: NodeJS.ProcessEnv = process.env): DataSource =>
  fixtureModeOn(env) ? fixtureSource : zohoSource;

/** What `GET /api/data` answers. */
export async function loadPayload(): Promise<DataPayload> {
  const src = getSource();
  if (src === fixtureSource) {
    const version = fixtureVersion();
    const { ds, actions } = await fixtureSource.loadApplied();
    return { ds, actions, version, fixtures: true };
  }
  return { ds: await src.load(), actions: [], version: 0, fixtures: false };
}
