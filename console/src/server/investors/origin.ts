/**
 * The lead an investor came from, from the investor record — two things, both on the signed-in person's own token (rule 2, D53):
 *
 *   view   W6-KAM-1: "Open lead ›" on the Journey. A seat that holds the Leads page opens /leads/<id>; a seat that does not (KAM,
 *          Finance, Head of AM) but whom Zoho lets read the origin lead (the KAM_Access backfill, the Finance sharing rule) gets this
 *          read-only view instead of a link the page guard bounced silently to /today. One GET of the Contact's Origin_Lead, then one
 *          GET of that lead with a short, identity-free projection (no name, email, mobile or address — the record already names
 *          the investor). A column Zoho hides from the seat is dropped and the read repeats (per field, as app-activity does); a
 *          lead Zoho does not return is `readable: false` with the reason, never an error page.
 *
 *   fix    W7-FIN-2: Finance creates the investor Contact at the 10% (D137) but cannot write Contacts.Originating_IR (D122), and Zoho
 *          silently drops it from Finance's insert — so the IR who brought the investor in cannot see them. Until the Zoho workflow
 *          `gz_set_originating_ir` is pasted (zoho/deluge/gz_set_originating_ir.deluge), Digital Infrastructure — whose profile may
 *          write Originating_IR — gets one press on the record: Originating_IR = Origin_Lead.Owner, written on DI's own token,
 *          guarded by the Contact's Modified_Time (D44), read back before it is called done (Zoho drops a field a profile may not
 *          edit without an error). Like the workflow it fills an EMPTY field only — never overwrites a set one (`already`).
 *          Ops log `origin-ir` with ids only. Nothing is cached (D45).
 */
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";

export const CONTACTS = "Contacts";
export const LEADS = "Leads";
/** What the read-only lead view shows: where the lead stands and who owns it. No identity field. */
export const LEAD_VIEW_FIELDS: readonly string[] = Object.freeze(["Lead_Status", "Lead_Source", "Owner", "Units_Interested", "Created_Time", "Said_Yes_At", "Lost_At"]);
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/;

export interface OriginLeadView {
  readonly contactId: string;
  readonly leadId: string | null;
  /** false: Zoho did not return the lead to this seat (or the investor has no origin lead) */
  readonly readable: boolean;
  readonly reason: "no-origin" | "not-shared" | null;
  readonly status: string | null;
  readonly source: string | null;
  readonly owner: { readonly id: string; readonly name: string | null } | null;
  readonly unitsInterested: number | null;
  readonly createdAt: string | null;
  readonly saidYesAt: string | null;
  readonly lostAt: string | null;
  /** columns Zoho hides from this seat (shown as "not shown for your seat") */
  readonly hiddenFields: readonly string[];
  /** Contacts.Originating_IR is set (the IR sees this investor); null when the seat cannot read it */
  readonly originatingIrSet: boolean | null;
}

export type OriginRefusal = "invalid-request" | "not-allowed" | "not-visible" | "no-origin" | "lead-not-visible" | "no-owner" | "changed" | "not-written";
export const ORIGIN_MESSAGES: Readonly<Record<OriginRefusal, string>> = Object.freeze({
  "invalid-request": "Not done — reload the investor and try again.",
  "not-allowed": "Only Digital Infrastructure sets the originating IR from here.",
  "not-visible": "This investor is not one Zoho shows you.",
  "no-origin": "This investor has no origin lead, so there is no lead owner to copy.",
  "lead-not-visible": "Zoho does not show you this investor's origin lead, so its owner cannot be read.",
  "no-owner": "The origin lead has no owner to copy.",
  changed: "Not done — the investor record changed while you were looking at it. Reload and try again.",
  "not-written": "Zoho did not store the originating IR for your seat — the field is not editable on your profile. Set it in Zoho, or paste the gz_set_originating_ir workflow.",
});

export type ViewResult =
  | { readonly ok: true; readonly value: OriginLeadView }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "not-visible"; readonly message: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };
export type FixResult =
  | { readonly ok: true; readonly value: { readonly contactId: string; readonly originatingIrId: string; readonly already: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: OriginRefusal; readonly message: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface OriginDeps {
  readonly crm: Pick<ZohoClient, "getRecord"> & Partial<Pick<ZohoClient, "update">>;
  /** Fresh on the live session: the Digital Infrastructure seat (the only console seat that may write Originating_IR, D122). */
  readonly authority?: { mayFixOriginatingIr(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean> };
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const nameOf = (v: unknown): string | null => {
  const n = v && typeof v === "object" ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" && n.trim() ? n.trim().slice(0, 80) : null;
};
const text = (r: ZohoRecord, k: string, max = 60): string | null => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim().slice(0, max) : null);
const stamp = (r: ZohoRecord, k: string): string | null => (typeof r[k] === "string" && ZDT.test(r[k] as string) ? (r[k] as string) : null);
const retryable = (k: string): boolean => k === "network" || k === "server" || k === "busy" || k === "rate-limited-unclassified" || k === "unexpected";
const fieldOf = (e: unknown): string | null => {
  const x = e as { field?: string | null; records?: readonly { field?: string | null }[] } | null;
  return x?.field ?? x?.records?.find((r) => r.field)?.field ?? null;
};

export function createOrigin(deps: OriginDeps) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("origin needs crm (getRecord), the ops log and the record-id prefix");
  }
  const { crm, log } = deps;
  const now = () => { try { return (deps.clock ?? Date.now)(); } catch { return 0; } };
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const note = (userId: string, reason: string, ids: readonly unknown[]) =>
    log.refusal({ at: now(), actor: { kind: "user", userId }, action: "origin-ir", reason, recordIds: ids.filter(validId) });
  const trusted = (p: unknown): { credential: UserCredential; sessionId: string } | null => {
    const c = p && typeof p === "object" ? (p as { credential?: unknown; sessionId?: unknown }) : null;
    return c && isUserCredential(c.credential) && typeof c.sessionId === "string" && SESSION_ID.test(c.sessionId) ? { credential: c.credential, sessionId: c.sessionId } : null;
  };

  /** The Contact's origin columns. Originating_IR is asked for alongside and dropped if Zoho hides it from the seat. */
  async function contactOf(cred: UserCredential, contactId: string, signal?: AbortSignal)
    : Promise<{ row: ZohoRecord; irRead: boolean } | null | { error: ZohoFailureKind | "unexpected" }> {
    let irRead = true;
    let r = await crm.getRecord(cred, CONTACTS, contactId, { fields: ["Origin_Lead", "Originating_IR", "Modified_Time"], signal }).catch(() => null);
    if (r && !r.ok && r.error.kind === "invalid-data") {
      irRead = false;
      r = await crm.getRecord(cred, CONTACTS, contactId, { fields: ["Origin_Lead", "Modified_Time"], signal }).catch(() => null);
    }
    if (!r) return { error: "unexpected" };
    if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? null : { error: r.error.kind };
    return r.value && r.value.id === contactId ? { row: r.value, irRead } : null;
  }

  return Object.freeze({
    /** W6-KAM-1: the origin lead, read-only, as Zoho shows it to this person. */
    async view(principal: unknown, contactId: unknown, signal?: AbortSignal): Promise<ViewResult> {
      const p = trusted(principal);
      if (!p || !validId(contactId)) return { ok: false, kind: "refused", reasonCode: "invalid-request", message: ORIGIN_MESSAGES["invalid-request"] };
      const cred = p.credential;
      const c = await contactOf(cred, contactId, signal);
      if (c === null) return { ok: false, kind: "refused", reasonCode: "not-visible", message: ORIGIN_MESSAGES["not-visible"] };
      if ("error" in c) return { ok: false, kind: "source-error", errorKind: c.error, retryable: retryable(c.error) };
      const leadId = idOf(c.row.Origin_Lead);
      const originatingIrSet = c.irRead ? !!idOf(c.row.Originating_IR) : null;
      const empty = (reason: OriginLeadView["reason"]): ViewResult => ({ ok: true, value: Object.freeze({
        contactId, leadId, readable: false, reason, status: null, source: null, owner: null, unitsInterested: null, createdAt: null, saidYesAt: null,
        lostAt: null, hiddenFields: Object.freeze([]), originatingIrSet }) });
      if (!leadId) return empty("no-origin");
      let fields = [...LEAD_VIEW_FIELDS];
      for (;;) {
        if (!fields.length) return empty("not-shared");
        const r = await crm.getRecord(cred, LEADS, leadId, { fields, signal }).catch(() => null);
        if (!r) return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true };
        if (!r.ok) {
          if (r.error.kind === "not-found" || r.error.kind === "forbidden") return empty("not-shared");
          const named = r.error.kind === "invalid-data" ? fieldOf(r.error) : null;
          if (named && fields.includes(named)) { fields = fields.filter((f) => f !== named); continue; }
          if (r.error.kind === "invalid-data" && fields.length > 1) { fields = ["Owner"]; continue; }   // Zoho names none: the owner alone
          if (r.error.kind === "invalid-data") return empty("not-shared");
          return { ok: false, kind: "source-error", errorKind: r.error.kind, retryable: retryable(r.error.kind) };
        }
        if (!r.value || r.value.id !== leadId) return empty("not-shared");
        /* only the columns asked for (and so shown to this seat) are read off the row */
        const l: ZohoRecord = Object.fromEntries(Object.entries(r.value).filter(([k]) => k === "id" || fields.includes(k))) as ZohoRecord;
        const ownerId = idOf(l.Owner);
        const units = typeof l.Units_Interested === "number" && Number.isSafeInteger(l.Units_Interested) && l.Units_Interested >= 0 ? l.Units_Interested : null;
        return { ok: true, value: Object.freeze({
          contactId, leadId, readable: true, reason: null,
          status: text(l, "Lead_Status"), source: text(l, "Lead_Source"),
          owner: ownerId ? Object.freeze({ id: ownerId, name: nameOf(l.Owner) }) : null,
          unitsInterested: units, createdAt: stamp(l, "Created_Time"), saidYesAt: stamp(l, "Said_Yes_At"), lostAt: stamp(l, "Lost_At"),
          hiddenFields: Object.freeze(LEAD_VIEW_FIELDS.filter((f) => !fields.includes(f))), originatingIrSet,
        }) };
      }
    },

    /** W7-FIN-2: Digital Infrastructure sets Contacts.Originating_IR = Origin_Lead.Owner, on DI's own token. Empty field only. */
    async fixOriginatingIr(principal: unknown, contactId: unknown, signal?: AbortSignal): Promise<FixResult> {
      const p = trusted(principal);
      const refuse = (me: string, code: OriginRefusal, ids: readonly unknown[] = []): FixResult => {
        note(me, code, ids);
        return { ok: false, kind: "refused", reasonCode: code, message: ORIGIN_MESSAGES[code] };
      };
      if (!p) return refuse("unrecognised", "invalid-request");
      const cred = p.credential, me = cred.userId;
      let may = false;
      try { may = !!deps.authority && (await deps.authority.mayFixOriginatingIr(cred, p.sessionId, signal)) === true; } catch { may = false; }
      if (!may || typeof deps.crm.update !== "function") return refuse(me, "not-allowed", [contactId]);
      if (!validId(contactId)) return refuse(me, "invalid-request");
      const c = await contactOf(cred, contactId, signal);
      if (c === null) return refuse(me, "not-visible", [contactId]);
      if ("error" in c) return { ok: false, kind: "source-error", errorKind: c.error, retryable: retryable(c.error) };
      if (!c.irRead) return refuse(me, "not-written", [contactId]);   // DI cannot even read it: Zoho's field security, not ours
      const have = idOf(c.row.Originating_IR);
      if (have) return { ok: true, value: { contactId, originatingIrId: have, already: true } };
      const leadId = idOf(c.row.Origin_Lead);
      if (!leadId) return refuse(me, "no-origin", [contactId]);
      const l = await crm.getRecord(cred, LEADS, leadId, { fields: ["Owner"], signal }).catch(() => null);
      if (!l) return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true };
      if (!l.ok) {
        if (l.error.kind === "not-found" || l.error.kind === "forbidden") return refuse(me, "lead-not-visible", [contactId, leadId]);
        return { ok: false, kind: "source-error", errorKind: l.error.kind, retryable: retryable(l.error.kind) };
      }
      const owner = l.value && l.value.id === leadId ? idOf(l.value.Owner) : null;
      if (!owner) return refuse(me, "no-owner", [contactId, leadId]);
      const mt = typeof c.row.Modified_Time === "string" && ZDT.test(c.row.Modified_Time) ? c.row.Modified_Time : null;
      if (!mt) return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true };
      const w = await deps.crm.update(cred, CONTACTS, contactId, { Originating_IR: { id: owner } }, { ifUnmodifiedSince: mt, signal })
        .catch(() => ({ ok: false as const, error: { kind: "unexpected" as const, status: 0 } }));
      if (!w.ok) {
        const k = w.error.kind as string;
        if (k === "conflict") return refuse(me, "changed", [contactId]);
        if (k === "forbidden" || (k === "invalid-data" && fieldOf(w.error) === "Originating_IR")) return refuse(me, "not-written", [contactId]);
        if (k === "not-found") return refuse(me, "not-visible", [contactId]);
        note(me, "write-failed-" + k, [contactId]);
        return { ok: false, kind: "source-error", errorKind: k as ZohoFailureKind, retryable: retryable(k) };
      }
      /* Zoho accepts a write naming a field the profile may not edit and drops it: done only when it reads back */
      const back = await contactOf(cred, contactId, signal);
      if (!back || "error" in back || idOf(back.row.Originating_IR) !== owner) return refuse(me, "not-written", [contactId]);
      note(me, "set-from-lead-owner", [contactId, leadId]);
      return { ok: true, value: { contactId, originatingIrId: owner, already: false } };
    },
  });
}
export type Origin = ReturnType<typeof createOrigin>;
