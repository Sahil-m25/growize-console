/**
 * BACKGROUND JOBS ON A MULTI-INSTANCE HOST (docs/architecture/shared-state.md inventory 18).
 *
 * A job (the Zoho Sign re-check, the investor-app outbox drain) is started by a platform scheduler calling
 * POST /api/jobs/<name> (catalyst/README.md), or by an in-process timer on a single long-lived process. Either
 * way it runs through `claimJob`: one claim per job name in SharedState, so a run that overlaps another — the
 * scheduler firing while a timer or a slow previous run is still going, on this instance or another — does
 * nothing. The claim is released when the run ends; its TTL frees it if the instance dies mid-run.
 *
 * `jobSecretOk` is the endpoint's door: JOB_SECRET (at least 32 characters) in the X-Job-Secret header,
 * compared in constant time over sha256 digests (equal length whatever was sent).
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { SharedStateError, type SharedState } from "../state/shared-state";

export const JOB_SECRET_HEADER = "x-job-secret";
/** Longest a run may hold its claim if the instance dies mid-run (the next scheduled call then runs). */
export const JOB_CLAIM_TTL_S = 9 * 60;
export const JOB_NAME = /^[a-z][a-z0-9-]{0,31}$/;

export type JobRun =
  | { readonly ran: true }
  | { readonly ran: false; readonly reason: "already-running" | "state-unavailable" };

export async function claimJob(state: SharedState, name: string, run: () => Promise<void>, ttlSeconds = JOB_CLAIM_TTL_S): Promise<JobRun> {
  if (!JOB_NAME.test(name)) throw new TypeError("A job name is a short lower-case code.");
  const key = `job|${name}`;
  let mine: boolean;
  try { mine = await state.claim(key, ttlSeconds); } catch (e) {
    if (e instanceof SharedStateError) return { ran: false, reason: "state-unavailable" };
    throw e;
  }
  if (!mine) return { ran: false, reason: "already-running" };
  try { await run(); } finally { await state.release(key).catch(() => { /* the TTL frees it */ }); }
  return { ran: true };
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** "not-configured" when JOB_SECRET is unset or shorter than 32 characters; else whether the header matches. */
export function jobSecretOk(sent: string | null, env: NodeJS.ProcessEnv = process.env): boolean | "not-configured" {
  const secret = env.JOB_SECRET ?? "";
  if (secret.length < 32) return "not-configured";
  return timingSafeEqual(digest(sent ?? ""), digest(secret)) && typeof sent === "string";
}

/** The route body every job endpoint shares: door, then one claimed run. Answers no detail beyond a code. */
export async function jobResponse(request: Request, name: string, run: () => Promise<JobRun>, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const ok = jobSecretOk(request.headers.get(JOB_SECRET_HEADER), env);
  if (ok === "not-configured") return Response.json({ error: "Jobs are not configured on this host.", code: "not-configured" }, { status: 503, headers });
  if (!ok) return Response.json({ error: "Not allowed.", code: "job-secret" }, { status: 401, headers });
  let r: JobRun;
  try { r = await run(); } catch {
    return Response.json({ job: name, ran: false, code: "job-failed" }, { status: 500, headers });
  }
  if (r.ran) return Response.json({ job: name, ran: true }, { headers });
  return Response.json({ job: name, ran: false, code: r.reason }, { status: r.reason === "state-unavailable" ? 503 : 200, headers });
}
