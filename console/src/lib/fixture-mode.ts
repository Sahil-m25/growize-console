/** FIXTURE_MODE=local (D65): test-only fixtures. Off unless FIXTURE_MODE=local and not a production build.
 *  The server keeps the applied fixture list and a version (globalThis, fixture mode only); the
 *  client polls `GET /api/data/version` and re-hydrates when it moves. */
import { readFileSync } from "node:fs";
import path from "node:path";

/* On only with FIXTURE_MODE=local, and never in a production build — except the separate local TEST
   build (`npm run build:local` / `start:local`, GZ_LOCAL_BUILD=1, output in .next-local), which exists
   so the UI cases run against compiled pages instead of the dev server's on-demand compiler. */
export const fixtureModeOn = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.FIXTURE_MODE === "local" && (env.NODE_ENV !== "production" || env.GZ_LOCAL_BUILD === "1");

const FILE = path.resolve(process.cwd(), "..", "pm", "merge-audit", "ui-sahil", "fixtures-merged.json");
const catalogue = (): Record<string, unknown> => JSON.parse(readFileSync(FILE, "utf8"));

/** Investors-side fixtures are filed as `IM:<NAME>`; ui-cases.json cites them bare. */
export const resolveFixture = (name: string, all: Record<string, unknown> = catalogue()): string | null =>
  Object.hasOwn(all, name) ? name : Object.hasOwn(all, "IM:" + name) ? "IM:" + name : null;

/* LANES. Several test runs may share one dev server (several agents, one machine); each run names a
   lane (`?lane=x` on the first URL — the middleware keeps it in a cookie — or the `x-gz-lane` header
   the seeder sends) and gets its own applied-fixture list. No lane is the lane "". */
type FixtureState = { applied: string[]; version: number };
const g = globalThis as { __gzLanes?: Record<string, FixtureState> };
const fx = (lane = ""): FixtureState => ((g.__gzLanes ??= {})[lane] ??= { applied: [], version: 0 });

export const appliedFixtures = (lane = ""): string[] => [...fx(lane).applied];
export const fixtureVersion = (lane = ""): number => fx(lane).version;

/** Apply a named fixture (catalogue-checked). Re-applying one already applied still bumps the version. */
export const applyFixture = (name: string, lane = ""): string | null => {
  const key = resolveFixture(name);
  if (!key) return null;
  const s = fx(lane);
  if (!s.applied.includes(key)) s.applied.push(key);
  s.version++;
  return key;
};

/** Clear every applied fixture — back to the plain demo book. */
export const resetFixtures = (lane = ""): void => {
  const s = fx(lane);
  s.applied = [];
  s.version++;
};

/** The lane a request belongs to: the seeder's header, else the page's cookie. */
export const LANE_COOKIE = "gz_lane";
export async function currentLane(): Promise<string> {
  const { headers, cookies } = await import("next/headers");
  const h = await headers();
  const v = h.get("x-gz-lane") ?? (await cookies()).get(LANE_COOKIE)?.value ?? "";
  return /^[a-z0-9-]{0,24}$/i.test(v) ? v : "";
}
