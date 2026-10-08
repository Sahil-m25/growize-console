/**
 * POST /api/test/sign/complete — TEST SIGNING (SANDBOX ONLY): the tester plays the signer.
 *
 * GATE. Exactly the D124 test sign-in's — wired (zohoSignInConfigured) + testSigninEnabled(env) + X-Test-Signin-Secret
 * (constant-time) — and test signing on (ZOHO_SIGN_MODE=fake, ./fake.ts). Anything short of all of them is a 404
 * identical to a missing route.
 *
 * ACT. Body { requestId, outcome?: "completed" | "declined" }. The fake request (it must be out) moves to that state,
 * then a callback for it is signed with this process's fake webhook secret and handed to the REAL webhook handler
 * (./webhook.ts handleZohoSignWebhook with the runtime's own deps): re-read from "Zoho Sign", the record found by its
 * stored *_Sign_Req_Id under the provider-callback service token, and on completed the filer (./file.ts) puts the
 * signed copy in the slot and sets *_Verified_At — NDA_Verified_At on the Lead, Supplementary_Verified_At (the console's
 * Agreement_Signed) on the allotment — exactly as a real completion would. A request already in the asked state is
 * re-delivered (the filer answers "already filed"), so a failed filing can be retried by calling again.
 */

import { createHmac } from "node:crypto";
import { testSecretMatches, TEST_SECRET_HEADER } from "../oauth/test-signin";
import { testSigninEnabled } from "../oauth/test-signin-gate";
import { signMode, type FakeSign } from "./fake";
import type { ZohoSignWebhookResult } from "./webhook";

export const TEST_SIGN_COMPLETE_ROUTE = "/api/test/sign/complete";

export interface FakeCompleteDeps {
  readonly env: NodeJS.ProcessEnv;
  /** zohoSignInConfigured() — the real OAuth door must be wired (never fixture mode). */
  readonly configured: boolean;
  readonly fake: () => FakeSign;
  /** the fake webhook secret (runtime fakeWebhookSecret) */
  readonly secret: () => string;
  /** the real webhook handler with the runtime's deps */
  readonly webhook: (body: string, signature: string) => Promise<ZohoSignWebhookResult>;
  readonly clock?: () => number;
}

const NO_STORE = { "Cache-Control": "no-store" } as const;
const notFound = () => new Response("Not found", { status: 404, headers: NO_STORE });
const fail = (status: number, why: string, message: string, extra: Record<string, unknown> = {}) =>
  Response.json({ ok: false, why, message, ...extra }, { status, headers: NO_STORE });

/** On only where the test sign-in is on AND test signing is on. A refused ZOHO_SIGN_MODE counts as off here (the start already refused). */
export function testSignCompleteEnabled(env: NodeJS.ProcessEnv): boolean {
  if (!testSigninEnabled(env)) return false;
  try { return signMode(env) === "fake"; } catch { return false; }
}

export async function testSignComplete(req: Request, d: FakeCompleteDeps): Promise<Response> {
  if (!d.configured || !testSignCompleteEnabled(d.env) || !testSecretMatches(req.headers.get(TEST_SECRET_HEADER), d.env)) return notFound();
  const body: unknown = await req.json().catch(() => null);
  const b = body && typeof body === "object" ? (body as { requestId?: unknown; outcome?: unknown }) : null;
  const requestId = b?.requestId;
  const outcome = b?.outcome === undefined ? "completed" : b.outcome;
  if (typeof requestId !== "string" || !/^\d{10,25}$/.test(requestId) || (outcome !== "completed" && outcome !== "declined")) {
    return fail(400, "bad-request", "Send { \"requestId\": \"<the *_Sign_Req_Id on the record>\", \"outcome\": \"completed\" | \"declined\" }.");
  }
  const fake = d.fake();
  const settled = await fake.settle(requestId, outcome);
  let redelivered = false;
  if (!settled.ok) {
    if (settled.code === "not-found") return fail(409, "unknown-request", "No test-signing request has this id (sent before test signing was on, or expired).");
    if (settled.status !== outcome) return fail(409, "not-out", `This request is ${settled.status}, no longer out for signature.`, { status: settled.status });
    redelivered = true;
  }
  const at = (d.clock ?? Date.now)();
  const event = JSON.stringify({
    requests: { request_id: requestId, request_status: outcome },
    notifications: { operation_type: outcome === "completed" ? "RequestCompleted" : "RequestRejected", performed_at: at },
  });
  const signature = createHmac("sha256", d.secret()).update(event, "utf8").digest("base64");
  const r = await d.webhook(event, signature);
  if (!r.ok) {
    return fail(502, `webhook-${r.kind}`, r.retryable ? "The request moved but the record was not written. Call again to retry." : "The request moved; the webhook refused it.",
      { requestId, status: outcome, retryable: r.retryable, redelivered });
  }
  return Response.json({ ok: true, requestId, status: outcome, redelivered, webhook: { outcome: r.outcome, recordId: r.recordId } }, { headers: NO_STORE });
}
