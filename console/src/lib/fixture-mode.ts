/** FIXTURE_MODE=local (D65): test-only fixtures. Off unless FIXTURE_MODE=local and not a production build.
 *  The server keeps the applied fixture list and a version (globalThis, fixture mode only); the
 *  client polls `GET /api/data/version` and re-hydrates when it moves. */
import { readFileSync } from "node:fs";
import path from "node:path";

export const fixtureModeOn = (env: NodeJS.ProcessEnv = process.env): boolean => env.FIXTURE_MODE === "local" && env.NODE_ENV !== "production";

const FILE = path.resolve(process.cwd(), "..", "pm", "merge-audit", "ui-sahil", "fixtures-merged.json");
const catalogue = (): Record<string, unknown> => JSON.parse(readFileSync(FILE, "utf8"));

/** Investors-side fixtures are filed as `IM:<NAME>`; ui-cases.json cites them bare. */
export const resolveFixture = (name: string, all: Record<string, unknown> = catalogue()): string | null =>
  Object.hasOwn(all, name) ? name : Object.hasOwn(all, "IM:" + name) ? "IM:" + name : null;

type FixtureState = { applied: string[]; version: number };
const g = globalThis as { __gzFixtures?: FixtureState };
const fx = (): FixtureState => (g.__gzFixtures ??= { applied: [], version: 0 });

export const appliedFixtures = (): string[] => [...fx().applied];
export const fixtureVersion = (): number => fx().version;

/** Apply a named fixture (catalogue-checked). Re-applying one already applied still bumps the version. */
export const applyFixture = (name: string): string | null => {
  const key = resolveFixture(name);
  if (!key) return null;
  const s = fx();
  if (!s.applied.includes(key)) s.applied.push(key);
  s.version++;
  return key;
};

/** Clear every applied fixture — back to the plain demo book. */
export const resetFixtures = (): void => {
  const s = fx();
  s.applied = [];
  s.version++;
};
