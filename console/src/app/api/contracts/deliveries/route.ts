/* GET /api/contracts/deliveries?event=<event_id> | ?record=<zoho id> — the investor-app delivery state a
   page shows next to a reply or an update (M13-S01-T01): status, its label ("Delivered" only on a
   push.delivered; otherwise "Not delivered yet"), attempts and a short reason code. Never the payload. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorAppOutboxSynced } from "@/server/contracts/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD = /^\d{15,22}$/;

async function get(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const event = q.get("event"), record = q.get("record");
  const outbox = await investorAppOutboxSynced();
  if (event && UUID.test(event)) { const s = outbox.state(event); return Response.json({ deliveries: s ? [s] : [] }, { headers: NO_STORE }); }
  if (record && RECORD.test(record)) return Response.json({ deliveries: outbox.forRecord(record) }, { headers: NO_STORE });
  return Response.json({ error: "Ask by event or record id." }, { status: 400, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/contracts", get), "/api/contracts/deliveries");
