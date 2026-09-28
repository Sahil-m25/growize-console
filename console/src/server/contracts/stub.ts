/**
 * M13-S01-T03 — THE STUB RECEIVER AND THE SWITCH TO THE REAL APP.
 *
 * The investor app's codebase, staging URL and signing secret are not in hand (MA1), so the console
 * pushes to a stub that stands where the app will: the same `createStubReceiver` (events.ts) that
 * verifies the HMAC, validates against contracts/, applies each event_id once, records it for tests and
 * answers push.delivered. Switching to the app is configuration only:
 *
 *   INVESTOR_APP_URL               "stub" → the in-process stub · an https URL → the app · unset → the stub
 *                                  outside production, and nothing sent (events wait) in production
 *   CONTRACT_SIGNING_KEY           the live HMAC key (≥ 32 chars); the stub makes a per-process key when unset
 *   CONTRACT_SIGNING_KEY_PREVIOUS  the key being rotated out (accepted inbound, never used to sign)
 *   CONTRACTS_DIR                  where the schemas are; default ../contracts from the console
 */

import { randomUUID, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createStubReceiver, type JsonSchema } from "./events";
import type { PushFetch } from "./outbox";

export function contractsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CONTRACTS_DIR?.trim() || path.resolve(process.cwd(), "..", "contracts");
}

/** Every schema in contracts/, keyed by file name ("case.replied.json"), as validateEvent wants. */
export function loadSchemas(dir: string = contractsDir()): Readonly<Record<string, JsonSchema>> {
  return Object.freeze(Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as JsonSchema])));
}

export type InvestorAppMode = { readonly kind: "stub" } | { readonly kind: "app"; readonly url: string } | { readonly kind: "off" };

export function investorAppMode(env: NodeJS.ProcessEnv = process.env): InvestorAppMode {
  const v = (env.INVESTOR_APP_URL ?? "").trim();
  if (v === "stub") return { kind: "stub" };
  if (v === "") return env.NODE_ENV === "production" ? { kind: "off" } : { kind: "stub" };
  let u: URL;
  try { u = new URL(v); } catch { throw new Error("INVESTOR_APP_URL must be \"stub\" or an https URL."); }
  if (u.protocol !== "https:" || u.username || u.password) throw new Error("INVESTOR_APP_URL must be an https URL with no credentials.");
  return { kind: "app", url: u.toString() };
}

const G = globalThis as typeof globalThis & { __gzStubKey?: string };

/** The live key and the one being rotated out. In stub mode a missing key becomes a per-process one. */
export function contractKeys(env: NodeJS.ProcessEnv = process.env, mode: InvestorAppMode = investorAppMode(env)): { readonly current: string | null; readonly all: readonly string[] } {
  const ok = (k: string | null | undefined): k is string => typeof k === "string" && k.length >= 32;
  let current: string | null = ok(env.CONTRACT_SIGNING_KEY) ? env.CONTRACT_SIGNING_KEY : null;
  if (!current && mode.kind === "stub") current = (G.__gzStubKey ??= randomBytes(32).toString("hex"));
  const all = [current, env.CONTRACT_SIGNING_KEY_PREVIOUS].filter(ok);
  return { current, all };
}

/** The stub standing in for the app, reached through a fetch that never leaves the process. */
export function createInProcessStub(o: {
  readonly schemas: Readonly<Record<string, JsonSchema>>; readonly keys: readonly string[];
  readonly accepts?: readonly string[]; readonly clock?: () => number; readonly down?: () => boolean;
}) {
  const recorded: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const receiver = createStubReceiver({
    schemas: o.schemas, keys: o.keys, accepts: o.accepts ?? ["case.replied", "farm.progress", "update.published", "request.executed", "money.confirmed", "account.opened", "money.not_found"],
    seen: { has: async (id) => seen.has(id), add: async (id) => { seen.add(id); } },
    record: async (e) => { recorded.push(e); }, newId: randomUUID, clock: o.clock,
  });
  const fetch: PushFetch = async (_url, init) => {
    if (o.down?.()) return { status: 503, text: async () => "" };
    const r = await receiver.receive(init.body, init.headers["X-Signature"]);
    return { status: r.status, text: async () => JSON.stringify(r) };
  };
  return Object.freeze({
    receiver, fetch,
    /** The events the stub applied, in order — for tests only. */
    recorded: (): readonly Record<string, unknown>[] => recorded.slice(),
    reset: (): void => { recorded.length = 0; seen.clear(); },
  });
}
