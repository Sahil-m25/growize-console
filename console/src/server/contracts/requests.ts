/**
 * M13-S05-T01 — request.raised → exactly one Case, owned by the investor's KAM (D17, D45, D53, D73).
 *
 * Runs on the provider-callback service credential (background work, never a screen). In order:
 *   1. The Contact check, before Zoho is touched: actor.kind is "investor" and actor.investor_contact_id is the
 *      same Contact as ids.investor_contact_id (PROVISIONAL, Jev 0.97). A mismatch is refused (422) and
 *      written to Plane B by id; the app never files a request on someone else's Contact.
 *   2. Idempotent on payload.app_request_id (PROVISIONAL, Jev 0.73). Cases has no app_request_id field yet
 *      (BLOCKED M13-S02-NOTE-2), so: a persistent index app_request_id → Case (ids only, append-only file),
 *      then on a miss a COQL look for the marker the Case carries at the end of its Subject ("· ref <id>").
 *      A COQL the org refuses as a query does not block the insert; Zoho down throws (the app redelivers).
 *   3. The Contact is read (exists; ids.arl_code, when sent, must equal its ARL_ID) and the Case is inserted
 *      with Owner = the Contact's KAM (Zoho's default, the token's user, when the Contact has no KAM).
 *   4. request.executed { state: "received", case_id } goes back to the app through the outbox.
 * The masked payload is never written anywhere: not to the Case, not to a log.
 */

import type { OpsLog } from "../../lib/zoho/log";
import type { ServiceCredential, ZohoRecord, ZohoServiceClient } from "../../lib/zoho/client";
import type { AppendOnlyStore } from "../logs/jsonl";
import type { SharedState } from "../state/shared-state";
import { slaDue, SLA_DAYS } from "../cases/writes";
import { requestExecuted } from "./outbox";

const RECORD_ID = /^\d{15,22}$/;
/** What an app_request_id may be: it is written into a Subject and a COQL literal, so nothing that could escape. */
export const APP_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,63}$/;
export const CASE_MARKER = (appRequestId: string): string => `· ref ${appRequestId}`;

/** request kind → Ticket_Category (PROVISIONAL mapping; the KAM can recategorise). */
export const CATEGORY_OF_KIND: Readonly<Record<string, string>> = Object.freeze({
  bank_change: "Bank", payout_mandate: "Bank", exit: "Compliance", nominee: "Records", details: "Records", statement: "Records", other: "Query",
});

export type IntakeRefusal = "wrong-identity" | "not-a-request" | "bad-request-id" | "contact-mismatch" | "no-contact" | "request-id-reused";
export type IntakeResult =
  | { readonly ok: true; readonly caseId: string; readonly created: boolean }
  | { readonly ok: false; readonly refused: IntakeRefusal };

export interface RequestIndex {
  get(appRequestId: string): Promise<{ readonly caseId: string; readonly contactId: string } | null>;
  put(appRequestId: string, caseId: string, contactId: string): Promise<void>;
}

/** app_request_id → Case, in memory and in an append-only file when one is given (ids only; survives a restart). */
export function createRequestIndex(store?: AppendOnlyStore | null): RequestIndex {
  let map: Map<string, { caseId: string; contactId: string }> | null = null;
  const load = () => {
    if (map) return map;
    map = new Map();
    if (store) for (const day of store.days()) for (const l of store.read(day)) {
      const x = l as { appRequestId?: unknown; caseId?: unknown; contactId?: unknown } | null;
      if (typeof x?.appRequestId === "string" && typeof x.caseId === "string" && typeof x.contactId === "string") map.set(x.appRequestId, { caseId: x.caseId, contactId: x.contactId });
    }
    return map;
  };
  return Object.freeze({
    get: async (id: string) => load().get(id) ?? null,
    put: async (id: string, caseId: string, contactId: string) => { load().set(id, { caseId, contactId }); store?.append({ appRequestId: id, caseId, contactId }); },
  });
}

/**
 * app_request_id → Case in SharedState (docs/architecture/shared-state.md inventory 9): one key per request id,
 * value "caseId|contactId" (ids only), no expiry — the file index above also keeps every day. Used when
 * STATE_STORE=catalyst; a store failure rejects, so the intake throws and the app redelivers.
 */
export function createSharedRequestIndex(state: SharedState): RequestIndex {
  const key = (id: string) => `req|${id}`;
  return Object.freeze({
    async get(id: string) {
      const v = await state.get(key(id));
      const m = v === null ? null : /^(\d{15,22})\|(\d{15,22})$/.exec(v);
      return m ? Object.freeze({ caseId: m[1]!, contactId: m[2]! }) : null;
    },
    async put(id: string, caseId: string, contactId: string) { await state.set(key(id), `${caseId}|${contactId}`); },
  });
}

/** Thrown when Zoho is not answering: the event is not marked applied, so the app redelivers. */
export class IntakeUnavailable extends Error {
  constructor(readonly kind: string) { super(`Zoho did not answer (${kind}).`); }
}

export interface RequestIntakeDeps {
  readonly crm: Pick<ZohoServiceClient, "coql" | "insert" | "getRecord">;
  readonly credential: () => Promise<ServiceCredential>;
  readonly index: RequestIndex;
  readonly log: OpsLog;
  readonly contactIdPrefix: string;
  /** publishToInvestorApp; failures stay in the outbox's own retry and dead-letter shelf. */
  readonly publish?: (event: Record<string, unknown>) => Promise<unknown>;
  readonly clock?: () => number;
}

const lookupId = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : null;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};

/** The pure half of the Contact check: who sent it and which Contact it names. Exported for tests. */
export function contactCheck(event: Record<string, unknown>, prefix: string): { ok: true; contactId: string; appRequestId: string; kind: string } | { ok: false; refused: IntakeRefusal } {
  if (event.type !== "request.raised") return { ok: false, refused: "not-a-request" };
  const p = (event.payload ?? {}) as { kind?: unknown; app_request_id?: unknown };
  if (typeof p.app_request_id !== "string" || !APP_REQUEST_ID.test(p.app_request_id)) return { ok: false, refused: "bad-request-id" };
  const named = (event.ids as Record<string, unknown> | undefined)?.investor_contact_id;
  if (typeof named !== "string" || !RECORD_ID.test(named) || !named.startsWith(prefix)) return { ok: false, refused: "no-contact" };
  const actor = (event.actor ?? {}) as { kind?: unknown; investor_contact_id?: unknown };
  if (actor.kind !== "investor" || actor.investor_contact_id !== named) return { ok: false, refused: "contact-mismatch" };
  return { ok: true, contactId: named, appRequestId: p.app_request_id, kind: typeof p.kind === "string" ? p.kind : "other" };
}

const TRANSIENT = new Set(["network", "server", "busy", "concurrency-exceeded", "credits-exhausted", "rate-limited-unclassified", "auth-expired", "aborted"]);

export function createRequestIntake(deps: RequestIntakeDeps) {
  const clock = deps.clock ?? Date.now;
  const refused = (r: IntakeRefusal, ids: readonly string[]): IntakeResult => {
    try { deps.log.refusal({ at: clock(), actor: { kind: "service", job: "provider-callback" }, action: "request-to-case", reason: r, recordIds: ids }); } catch { /* never blocks */ }
    return { ok: false, refused: r };
  };
  const noted = (reason: string, ids: readonly string[]): void => {
    try { deps.log.event?.({ at: clock(), actor: { kind: "service", job: "provider-callback" }, action: "request-to-case", reason, recordIds: ids }); } catch { /* never blocks */ }
  };
  const tellApp = async (appRequestId: string, contactId: string, caseId: string): Promise<void> => {
    if (!deps.publish) return;
    try { await deps.publish(requestExecuted({ appRequestId, contactId, state: "received", caseId, at: clock() }, clock)); } catch { /* the outbox reports its own failures */ }
  };

  return Object.freeze({
    /** The Case id for an app_request_id already filed (the replay answer), or null. */
    caseFor: async (appRequestId: string): Promise<string | null> => (await deps.index.get(appRequestId))?.caseId ?? null,

    async handle(event: Record<string, unknown>): Promise<IntakeResult> {
      const c = contactCheck(event, deps.contactIdPrefix);
      if (!c.ok) {
        const named = (event.ids as Record<string, unknown> | undefined)?.investor_contact_id;
        return refused(c.refused, typeof named === "string" && RECORD_ID.test(named) ? [named] : []);
      }
      const credential = await deps.credential();
      if (credential?.kind !== "service" || credential.job !== "provider-callback") return refused("wrong-identity", []);

      const known = await deps.index.get(c.appRequestId);
      if (known) return known.contactId === c.contactId ? { ok: true, caseId: known.caseId, created: false } : refused("request-id-reused", [c.contactId]);

      // The Case as Zoho has it, by the Subject marker, in case the index was lost or another instance filed it.
      const marker = CASE_MARKER(c.appRequestId);
      const found = await deps.crm.coql(credential, `select id, Subject, Related_To from Cases where Subject like '%${marker}' limit 0, 5`);
      if (found.ok) {
        const hit = found.value.records.find((r: ZohoRecord) => typeof r.Subject === "string" && r.Subject.endsWith(marker));
        if (hit) {
          if (lookupId(hit.Related_To) !== c.contactId) return refused("request-id-reused", [c.contactId, hit.id]);
          await deps.index.put(c.appRequestId, hit.id, c.contactId);
          await tellApp(c.appRequestId, c.contactId, hit.id);
          return { ok: true, caseId: hit.id, created: false };
        }
      } else if (TRANSIENT.has(found.error.kind)) throw new IntakeUnavailable(found.error.kind);
      else noted("marker-lookup-skipped", []);

      const contact = await deps.crm.getRecord(credential, "Contacts", c.contactId, { fields: ["id", "KAM", "ARL_ID"] });
      if (!contact.ok) {
        if (contact.error.kind === "not-found") return refused("no-contact", [c.contactId]);
        throw new IntakeUnavailable(contact.error.kind);
      }
      if (!contact.value) return refused("no-contact", [c.contactId]);
      const code = (event.ids as Record<string, unknown>).arl_code;
      if (typeof code === "string" && contact.value.ARL_ID !== code) return refused("contact-mismatch", [c.contactId]);
      const kam = lookupId(contact.value.KAM);

      const now = clock();
      const ins = await deps.crm.insert(credential, "Cases", [{
        Subject: `App request · ${c.kind.replace(/_/g, " ")} ${marker}`.slice(0, 255),
        // Related_To is the org's Contact lookup; Case_Origin "Web" stands for the app until an App value exists (GAP).
        Related_To: { id: c.contactId }, Case_Origin: "Web", Status: "New", Priority: "Medium",
        Ticket_Category: CATEGORY_OF_KIND[c.kind] ?? "Query", SLA_Due: slaDue(now, SLA_DAYS.normal),
        Description: `Raised in the investor app. Request ${c.appRequestId}.`,
        ...(kam ? { Owner: { id: kam } } : {}),
      }]);
      if (!ins.ok) throw new IntakeUnavailable(ins.error.kind);
      const o = ins.value.length === 1 ? ins.value[0] : null;
      if (!o || !o.ok || !o.id) throw new IntakeUnavailable("partial");
      await deps.index.put(c.appRequestId, o.id, c.contactId);
      noted(kam ? "case-created" : "case-created-no-kam", [o.id, c.contactId]);
      await tellApp(c.appRequestId, c.contactId, o.id);
      return { ok: true, caseId: o.id, created: true };
    },
  });
}
export type RequestIntake = ReturnType<typeof createRequestIntake>;
