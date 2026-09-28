/**
 * M12-S08-T01 — THE EMBED-TOKEN ENDPOINT: the investor signs inside the investor app (D6, D72, D73).
 *
 * The app sends a signed `sign.embed` event (contracts/sign.embed.json, HMAC over the exact body with the
 * contract key). In order, before any URL exists:
 *   1. Signature, JSON, schema (events.ts validateEvent), type = sign.embed. An event_id seen before is
 *      refused (409): a signing URL is one-time, so a replay never mints a second one.
 *   2. Identity: actor.kind investor and actor.investor_contact_id = ids.investor_contact_id — the app's own
 *      Supabase user → Contact mapping (MA1), asserted under the contract key. The frame host must be on the
 *      console's allow-list (the investor app's origin).
 *   3. Under the provider-callback service token (the investor has no Zoho token; background act, no screen):
 *      the Contact is read (ARL_ID must match ids.arl_code when sent); the request must be on this Contact's
 *      paper — its FEMA slot or one of its allotments' supplementary / allocation-letter slots; Zoho Sign is
 *      re-read and one SIGN action's recipient email must be this Contact's email; the request must be out.
 *   4. embedtoken → a one-time Zoho Sign URL valid for 2 minutes (Zoho's own expiry). It is returned in the
 *      HTTP answer only: never stored, never logged (Plane B: ids and codes). The status comes back by
 *      webhook as in M12-S05, never from the app.
 * Anyone who is not the recipient is refused (403) and the refusal is written to Plane B.
 */

import type { ServiceCredential, ZohoRecord, ZohoServiceClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { validateEvent, verify, type JsonSchema, type SeenEvents } from "../contracts/events";
import { EMBED_URL_TTL_MS, type SignApi } from "./api";
import { PAPER_FIELDS, RECORD_ID, signStateOf } from "./papers";

export const EMBED_SIGNATURE_HEADER = "x-signature";
export const MAX_EMBED_BYTES = 16 * 1024;
export type EmbedRefusal =
  | "signature" | "json" | "invalid" | "not-accepted" | "replayed" | "wrong-identity" | "host-not-allowed" | "no-contact"
  | "arl-mismatch" | "not-your-request" | "not-recipient" | "not-out";
export type EmbedResult =
  | { readonly status: 200; readonly signUrl: string; readonly expiresAt: number }
  | { readonly status: 400 | 401 | 403 | 409; readonly reason: EmbedRefusal }
  | { readonly status: 503; readonly reason: "unavailable" };

export interface EmbedDeps {
  readonly schemas: Readonly<Record<string, JsonSchema>>;
  readonly keys: readonly string[];
  readonly seen: SeenEvents;
  readonly allowedHosts: readonly string[];
  readonly crm: Pick<ZohoServiceClient, "getRecord" | "coql">;
  readonly sign: Pick<SignApi, "getRequest" | "embedToken">;
  readonly credential: (signal?: AbortSignal) => Promise<ServiceCredential>;
  readonly log: OpsLog;
  readonly clock?: () => number;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const ACTOR = { kind: "service", job: "provider-callback" } as const;

export function createEmbedEndpoint(deps: EmbedDeps) {
  const clock = deps.clock ?? Date.now;
  const hosts = new Set(deps.allowedHosts.map((h) => { try { return new URL(h).origin; } catch { return ""; } }).filter((h) => h.startsWith("https://")));
  const refuse = (status: 400 | 401 | 403 | 409, reason: EmbedRefusal, ids: readonly string[] = []): EmbedResult => {
    try { deps.log.refusal({ at: clock(), actor: ACTOR, action: "sign-embed", reason, recordIds: ids.filter((x) => RECORD_ID.test(x)) }); } catch { /* never blocks the answer */ }
    return { status, reason };
  };
  const down = (code: string, ids: readonly string[] = []): EmbedResult => {
    try { deps.log.refusal({ at: clock(), actor: ACTOR, action: "sign-embed", reason: `unavailable.${code}`, recordIds: ids.filter((x) => RECORD_ID.test(x)) }); } catch { /* ignore */ }
    return { status: 503, reason: "unavailable" };
  };

  return Object.freeze({
    async handle(rawBody: string, signature: unknown, signal?: AbortSignal): Promise<EmbedResult> {
      if (Buffer.byteLength(rawBody, "utf8") > MAX_EMBED_BYTES || !verify(rawBody, signature, deps.keys)) return refuse(401, "signature");
      let event: Obj;
      try { event = JSON.parse(rawBody) as Obj; } catch { return refuse(400, "json"); }
      const v = validateEvent(deps.schemas, event);
      if (!v.ok) return refuse(400, "invalid");
      if (v.type !== "sign.embed") return refuse(400, "not-accepted");
      const eventId = event.event_id as string;
      if (await deps.seen.has(eventId)) return refuse(409, "replayed");
      await deps.seen.add(eventId); // before any Zoho call: two presses with one event never make two URLs

      const actor = obj(event.actor)!, ids = obj(event.ids)!, payload = obj(event.payload)!;
      const contactId = String(ids.investor_contact_id ?? "");
      if (actor.kind !== "investor" || actor.investor_contact_id !== contactId || !RECORD_ID.test(contactId)) return refuse(403, "wrong-identity");
      let host = "";
      try { host = new URL(String(payload.host)).origin; } catch { host = ""; }
      if (!hosts.has(host)) return refuse(403, "host-not-allowed", [contactId]);
      const requestId = String(payload.request_id);

      let cred: ServiceCredential;
      try { cred = await deps.credential(signal); } catch { return down("credential", [contactId]); }

      let contact: ZohoRecord | null;
      try {
        const c = await deps.crm.getRecord(cred, "Contacts", contactId, { fields: ["id", "Email", "ARL_ID", PAPER_FIELDS.fema.req], signal });
        if (!c.ok) return c.error.kind === "not-found" || c.error.kind === "forbidden" ? refuse(403, "no-contact", [contactId]) : down(c.error.kind, [contactId]);
        contact = c.value;
      } catch { return down("unexpected", [contactId]); }
      if (!contact || contact.id !== contactId) return refuse(403, "no-contact", [contactId]);
      if (typeof ids.arl_code === "string" && contact.ARL_ID !== ids.arl_code) return refuse(403, "arl-mismatch", [contactId]);
      const email = typeof contact.Email === "string" ? contact.Email.trim().toLowerCase() : "";
      if (!email) return refuse(403, "not-recipient", [contactId]);

      let onPaper = contact[PAPER_FIELDS.fema.req] === requestId;
      if (!onPaper) {
        const s = PAPER_FIELDS.supplementary, a = PAPER_FIELDS["allocation-letter"];
        try {
          const q = await deps.crm.coql(cred, `select id, ${s.req}, ${a.req} from ${s.module} where (Customer = '${contactId}' and (${s.req} = '${requestId}' or ${a.req} = '${requestId}')) limit 0, 2`, { signal });
          if (!q.ok) return down(q.error.kind, [contactId]);
          onPaper = q.value.records.some((r) => r[s.req] === requestId || r[a.req] === requestId);
        } catch { return down("unexpected", [contactId]); }
      }
      if (!onPaper) return refuse(403, "not-your-request", [contactId]);

      const g = await deps.sign.getRequest(cred, requestId, { signal });
      if (!g.ok) return g.error.kind === "not-found" ? refuse(409, "not-out", [contactId]) : down(g.error.kind, [contactId]);
      const st = signStateOf(g.value);
      if (st !== "sent" && st !== "viewed") return refuse(409, "not-out", [contactId]);
      const action = g.value.actions.find((x) => x.type === "SIGN" && x.recipientEmail === email && !/SIGNED|DECLINED|COMPLETED/.test(x.status));
      if (!action) return refuse(403, "not-recipient", [contactId]);

      const t = await deps.sign.embedToken(cred, requestId, action.actionId, host, { signal });
      if (!t.ok) {
        // Zoho documents embedtoken only for actions created with is_embedded; a request sent by email may be
        // refused here — the investor then signs from the email (PROVISIONAL, Jev 0.83; the sandbox proves it).
        return t.error.kind === "invalid-data" || t.error.kind === "forbidden" ? refuse(409, "not-out", [contactId]) : down(t.error.kind, [contactId]);
      }
      deps.log.event?.({ at: clock(), actor: ACTOR, action: "sign-embed", reason: "issued", recordIds: [contactId] });
      return { status: 200, signUrl: t.value.signUrl, expiresAt: clock() + EMBED_URL_TTL_MS };
    },
  });
}
export type EmbedEndpoint = ReturnType<typeof createEmbedEndpoint>;
