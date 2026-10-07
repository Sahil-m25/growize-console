/* Diagnostics: turn any thrown value into a small, secret-free description (error class, SharedStateError code, HTTP status,
   the backend's own error word). Never a token, never a stored value. Used by the test state-health route and the enrolment
   failure ring. */
import { SharedStateError } from "./shared-state";

export interface ErrorInfo {
  /** SharedStateError code ("unavailable" | "contended" | "bad-response" | "bad-key") or the JS error class name. */
  readonly code: string;
  readonly message: string;
  readonly stage?: string;
  readonly httpStatus?: number;
  readonly catalystCode?: string;
}

export function describeError(e: unknown): ErrorInfo {
  if (e instanceof SharedStateError) {
    return {
      code: e.code, message: e.message.slice(0, 200),
      ...(e.detail.stage ? { stage: e.detail.stage } : {}),
      ...(e.detail.httpStatus !== undefined ? { httpStatus: e.detail.httpStatus } : {}),
      ...(e.detail.catalystCode ? { catalystCode: e.detail.catalystCode } : {}),
    };
  }
  /* any other error: its class only (its message could carry anything) */
  const name = e instanceof Error && /^[A-Za-z0-9_]{1,40}$/.test(e.name) ? e.name : "Error";
  return { code: name, message: `${name} (message withheld)` };
}
