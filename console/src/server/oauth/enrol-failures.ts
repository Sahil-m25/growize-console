/* D125 diagnostics: a small in-memory ring (last 20) of test sign-in enrolment SAVE failures, so a swallowed error can be read
   back through GET /api/test/state-health. Per instance, lost on restart. Holds a timestamp, the Zoho user id and a secret-free
   error description; never a token. */
import { describeError, type ErrorInfo } from "../state/error-info";

export const ENROL_FAILURE_RING = 20;
export interface EnrolFailure extends ErrorInfo { readonly at: string; readonly who: string }

const G = globalThis as typeof globalThis & { __gzEnrolFailures?: EnrolFailure[] };
const ring = (): EnrolFailure[] => (G.__gzEnrolFailures ??= []);

export function recordEnrolFailure(who: string, e: unknown, now: () => number = Date.now): EnrolFailure {
  const f: EnrolFailure = { at: new Date(now()).toISOString(), who, ...describeError(e) };
  const r = ring();
  r.push(f);
  while (r.length > ENROL_FAILURE_RING) r.shift();
  console.error(`[auth] test sign-in enrolment FAILED to save who=${who} code=${f.code}${f.httpStatus !== undefined ? ` http=${f.httpStatus}` : ""}${f.catalystCode ? ` catalyst=${f.catalystCode}` : ""}${f.stage ? ` stage=${f.stage}` : ""} (the sign-in itself goes on)`);
  return f;
}

/** Newest last. */
export const recentEnrolFailures = (): readonly EnrolFailure[] => ring().slice();
export const clearEnrolFailures = (): void => { ring().length = 0; };
