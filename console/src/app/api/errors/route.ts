/* POST /api/errors — the client error beacon (M18-S04-T01). The browser reports a source, the page
   route, a request id and Zoho's status/code (see @/lib/zoho/error-beacon); the report is rebuilt
   from Plane B's allow-list and never carries a message, stack or body (D47, D52). 204 always,
   unless the body is oversized (413) or the per-process budget is spent (429). */
import { readLimitedUtf8Body } from "../../../server/http/limited-body";
import { currentRequestId, userIdOf } from "../../../server/http/error-capture";
import { errorLog, withErrorCapture, alertEngine } from "../../../server/ops/runtime";
import { eventsFromErrors } from "../../../server/ops/alerts";
import { BEACON_SOURCES, type BeaconSource } from "../../../lib/zoho/error-beacon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BEACON_BYTES = 2_048;
const BUDGET_PER_MINUTE = 120;
let windowStart = 0;
let used = 0;

async function post(request: Request): Promise<Response> {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    used = 0;
  }
  if (++used > BUDGET_PER_MINUTE) return new Response(null, { status: 429 });
  const body = await readLimitedUtf8Body(request, MAX_BEACON_BYTES);
  if (!body.ok) return new Response(null, { status: body.reason === "payload-too-large" ? 413 : 400 });
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(body.body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  const source = BEACON_SOURCES.find((s) => s === raw.source);
  if (!source) return new Response(null, { status: 400 });
  const record = errorLog.clientError({
    at: now,
    requestId: currentRequestId() ?? "unrecognised",
    failedRequestId: typeof raw.requestId === "string" ? raw.requestId : null,
    userId: userIdOf(request),
    route: typeof raw.route === "string" ? raw.route : "/unrecognised",
    source: source satisfies BeaconSource,
    zohoStatus: typeof raw.zohoStatus === "number" ? raw.zohoStatus : null,
    zohoCode: typeof raw.zohoCode === "string" ? raw.zohoCode : null,
    errorName: typeof raw.errorName === "string" ? raw.errorName : null,
  });
  for (const e of eventsFromErrors(record)) alertEngine().record(e);
  return new Response(null, { status: 204 });
}

export const POST = withErrorCapture(post, "/api/errors");
