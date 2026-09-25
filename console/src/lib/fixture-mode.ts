/** FIXTURE_MODE=local (D65): test-only fixtures. Off unless FIXTURE_MODE=local and not a production build. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PEOPLE, SIGNINS } from "../domain/people";

export const fixtureModeOn = (env: NodeJS.ProcessEnv = process.env): boolean => env.FIXTURE_MODE === "local" && env.NODE_ENV !== "production";

const FILE = path.resolve(process.cwd(), "..", "pm", "merge-audit", "ui-sahil", "fixtures-merged.json");
const catalogue = (): Record<string, unknown> => JSON.parse(readFileSync(FILE, "utf8"));

/** Investors-side fixtures are filed as `IM:<NAME>`; ui-cases.json cites them bare. */
export const resolveFixture = (name: string, all: Record<string, unknown> = catalogue()): string | null =>
  Object.hasOwn(all, name) ? name : Object.hasOwn(all, "IM:" + name) ? "IM:" + name : null;

const g = globalThis as { __fixture?: string | null };
export const activeFixture = (): string | null => g.__fixture ?? null;
export const applyFixture = (name: string): string | null => {
  const key = resolveFixture(name);
  if (key) g.__fixture = key;
  return key;
};

/** The dev sign-in list, same people and order as the merged prototype. */
export const signinList = () => SIGNINS.map((k) => ({ key: k, name: PEOPLE[k].n }));
