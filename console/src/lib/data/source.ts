/* THE SOURCE CHOICE — server-only (route handlers import this; no client module may). Fixture
   mode serves the demo book from `console/fixtures/` plus the applied fixtures; everything else
   serves `zohoSource`, which in phase 1 is the empty book on a real Kolkata clock. */

import { appliedFixtures, currentLane, fixtureModeOn, fixtureVersion } from "@/lib/fixture-mode";
import { clockDay, kolkataNow } from "./clock";
import { emptyDataset } from "./empty";
import { decodeSession, SESSION_COOKIE } from "./session";
import { stubUser, withStubUser } from "./stub-user";
import type { DataPayload, DataSource, Dataset } from "./types";

/** The live read on the signed-in person's own Zoho token (D53, M01-S03); the empty book when Zoho
 *  sign-in is not configured or nobody is signed in. */
export const zohoSource: DataSource = {
  async load(): Promise<Dataset> {
    const live = await (await import("@/server/data/zoho-source")).loadLiveDataset();
    if (live) return live;
    const now = kolkataNow();
    return emptyDataset(clockDay(now), now);
  },
};

/** The demo book, then whatever fixtures the test runner has applied. The fixtures load lazily so
 *  nothing of them is ever bundled into a module that did not ask. */
export const fixtureSource: DataSource & { loadApplied(lane?: string): Promise<{ ds: Dataset; actions: unknown[] }> } = {
  async loadApplied(lane = "") {
    const [{ demoBook }, { applyFixtures }] = await Promise.all([import("@fixtures/book"), import("@fixtures/apply")]);
    return applyFixtures(demoBook(), appliedFixtures(lane));
  },
  async load() {
    return (await this.loadApplied()).ds;
  },
};

export const getSource = (env: NodeJS.ProcessEnv = process.env): DataSource =>
  fixtureModeOn(env) ? fixtureSource : zohoSource;

/** What `GET /api/data` answers. */
export async function loadPayload(lane?: string): Promise<DataPayload> {
  const src = getSource();
  if (src === fixtureSource) {
    const l = lane ?? (await currentLane());
    const version = fixtureVersion(l);
    const { ds, actions } = await fixtureSource.loadApplied(l);
    return { ds, actions, version, fixtures: true };
  }
  return { ds: await withSessionStub(await src.load()), actions: [], version: 0, fixtures: false };
}

/** Phase 1's Zoho stub (./stub-user): while the configured stub person is the one signed in, they
 *  are on the book this session is served — and nowhere else. */
async function withSessionStub(ds: Dataset): Promise<Dataset> {
  const u = stubUser();
  if (!u) return ds;
  const { cookies } = await import("next/headers");
  const s = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  return s && s.who === u.key && s.seat === u.seat ? withStubUser(ds, u) : ds;
}
