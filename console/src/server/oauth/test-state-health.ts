/**
 * D125 — GET /api/test/state-health: why does the shared-state store (STATE_STORE=catalyst) not work from AppSail?
 *
 * GATE. Exactly the D124 test sign-in's: wired (zohoSignInConfigured) + testSigninEnabled(env) + X-Test-Signin-Secret
 * (constant-time); anything short of all three is a 404 identical to a missing route.
 *
 * ANSWER (all secret-free; names, hosts, ids, codes, timings):
 *   storeKind, instance { startedAt, uptimeSeconds }, envSeen { names of set GZ_STATE_* / CATALYST_* variables, pkName,
 *   apiOrigin host, projectId, table }, tokenMint (Catalyst config only), probe (claim, claim again, get, set, get, release
 *   on a random `diag|<rand>` key, each step with ok/value/error/latencyMs), recentEnrolFailures (last 20 on this instance).
 * Any value in the output equal to a configured secret is replaced by [redacted] as a last guard.
 */
import { randomBytes } from "node:crypto";
import { catalystConfigFromEnv, probeCatalystToken, gzEnv, STATE_ENV_ALIASES, type CatalystFetch } from "../state/catalyst";
import { describeError, type ErrorInfo } from "../state/error-info";
import type { SharedState } from "../state/shared-state";
import { recentEnrolFailures } from "./enrol-failures";
import { testSecretMatches, TEST_SECRET_HEADER } from "./test-signin";
import { testSigninEnabled } from "./test-signin-gate";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const STARTED_AT = Date.now();
const SECRET_ENVS = ["GZ_TEST_SIGNIN_SECRET", "GZ_STATE_REFRESH_TOKEN", "CATALYST_REFRESH_TOKEN", "ZOHO_OAUTH_CLIENT_SECRET", "ZOHO_SESSION_KEY", "JOB_SECRET"] as const;

export interface StateHealthDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly configured: boolean;
  readonly state: () => SharedState;
  /** Tests inject the fake Catalyst's fetch for the token mint. */
  readonly fetch?: CatalystFetch;
  readonly now?: () => number;
}

export interface ProbeStep { readonly step: string; readonly ok: boolean; readonly value?: boolean; readonly error?: ErrorInfo; readonly latencyMs: number }

const ENV_NAME = /^(GZ_STATE_|CATALYST_)/;

function envSeen(env: NodeJS.ProcessEnv) {
  const names = Object.keys(env).filter((n) => ENV_NAME.test(n) && (env[n] ?? "").trim() !== "").sort();
  const pkName = gzEnv(env, "GZ_STATE_PK", STATE_ENV_ALIASES.GZ_STATE_PK) || "K";
  const origin = gzEnv(env, "GZ_STATE_API_ORIGIN", STATE_ENV_ALIASES.GZ_STATE_API_ORIGIN);
  let apiOrigin: string | null = null;
  try { apiOrigin = origin ? new URL(origin).host : null; } catch { apiOrigin = "(not a URL)"; }
  return {
    names, pkName, apiOrigin,
    projectId: gzEnv(env, "GZ_STATE_PROJECT_ID", STATE_ENV_ALIASES.GZ_STATE_PROJECT_ID) || null,
    table: gzEnv(env, "GZ_STATE_TABLE", STATE_ENV_ALIASES.GZ_STATE_TABLE) || null,
  };
}

async function probe(state: SharedState, now: () => number): Promise<{ ok: boolean; steps: ProbeStep[] }> {
  const key = `diag|${randomBytes(8).toString("hex")}`;
  const mine = `probe-${randomBytes(6).toString("hex")}`;
  const steps: ProbeStep[] = [];
  let stop = false;
  const run = async (step: string, fn: () => Promise<boolean | undefined>): Promise<void> => {
    if (stop) { steps.push({ step, ok: false, latencyMs: 0, error: { code: "skipped", message: "an earlier step failed" } }); return; }
    const t0 = now();
    try {
      const v = await fn();
      steps.push({ step, ok: v !== false, ...(v === undefined ? {} : { value: v }), latencyMs: now() - t0 });
      if (v === false) stop = true;
    } catch (e) { steps.push({ step, ok: false, error: describeError(e), latencyMs: now() - t0 }); stop = true; }
  };
  await run("claim", () => state.claim(key, 60));                        // expect true
  await run("claimAgain", async () => !(await state.claim(key, 60)));    // value true = the second claim was refused, as it must be
  await run("get", async () => (await state.get(key)) !== null);         // the claim wrote something
  await run("set", async () => { await state.set(key, mine, 60); return undefined; });
  await run("getAfterSet", async () => (await state.get(key)) === mine);
  /* release always runs, even after a failure, so the probe never leaves a key behind */
  stop = false;
  await run("release", async () => { await state.release(key); return undefined; });
  return { ok: steps.every((s) => s.ok), steps };
}

export async function testStateHealth(req: Request, d: StateHealthDeps): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: NO_STORE });
  if (!d.configured || !testSigninEnabled(d.env)) return notFound();
  if (!testSecretMatches(req.headers.get(TEST_SECRET_HEADER), d.env)) return notFound();
  const now = d.now ?? Date.now;

  let state: SharedState | null = null;
  let stateError: ErrorInfo | null = null;
  try { state = d.state(); } catch (e) { stateError = describeError(e); }

  let tokenMint: { ok: true } | { ok: false; error: string; httpStatus?: number; zohoError?: string; stage?: string } | { ok: "skipped"; why: string } = { ok: "skipped", why: "STATE_STORE is not catalyst" };
  let tokenMs: number | null = null;
  if (state?.kind === "catalyst") {
    const t0 = now();
    try {
      const r = await probeCatalystToken(catalystConfigFromEnv(d.env), { fetch: d.fetch });
      tokenMint = r.ok ? { ok: true } : { ok: false, error: r.stage === "network" ? "network" : "http", stage: r.stage, ...(r.httpStatus !== undefined ? { httpStatus: r.httpStatus } : {}), ...(r.error ? { zohoError: r.error } : {}) };
    } catch (e) { tokenMint = { ok: false, error: "config", zohoError: describeError(e).message.slice(0, 300) }; }
    tokenMs = now() - t0;
  }

  const body = {
    ok: true,
    storeKind: state?.kind ?? null,
    ...(stateError ? { stateError } : {}),
    instance: { startedAt: new Date(STARTED_AT).toISOString(), uptimeSeconds: Math.round(process.uptime()) },
    envSeen: envSeen(d.env),
    tokenMint: { ...tokenMint, ...(tokenMs !== null ? { latencyMs: tokenMs } : {}) },
    probe: state ? await probe(state, now) : { ok: false, steps: [] },
    recentEnrolFailures: recentEnrolFailures(),
  };

  let text = JSON.stringify(body);
  for (const n of SECRET_ENVS) {
    const v = (d.env[n] ?? "").trim();
    if (v.length >= 8) text = text.split(v).join("[redacted]");
  }
  return new Response(text, { status: 200, headers: { ...NO_STORE, "Content-Type": "application/json" } });
}
