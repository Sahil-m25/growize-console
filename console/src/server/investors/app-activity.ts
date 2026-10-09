/**
 * GC-1525 — APP ACTIVITY: who has signed in to the investor app, and when (D52, D53, D73).
 *
 * The investor app is a separate product that writes back to the same Zoho org (D52): on the Contact it keeps
 *   App_First_Sign_In_At, App_Last_Sign_In_At, App_Sign_In_Count, App_Last_Failed_Sign_In_At, App_Failed_Sign_In_Count
 * (docs/specs/app-sign-in-writeback.md) beside the three the console already reads (App_Access, App_Welcome_At,
 * App_Welcome_Channel — server/investors/unlock). The console only READS them, on the viewer's own token, for the people
 * who look after an investor: the KAM (own accounts), the Head of AM, Finance, and an IR for their own leads (read only).
 *
 * One read serves the card (one id) and the list badge (a page of ids): `select … from Contacts where id in (…) and <scope>`.
 *   - the scope's own filter rides in the WHERE (ir-guard contactsWhere) and every row is re-admitted by admitContact; one row
 *     outside the scope refuses the whole read (never trimmed). Seats with no Investors book are refused, no Zoho call.
 *   - if Zoho refuses the new columns (not created yet, or hidden from the seat: COQL answers invalid-data) the read is
 *     repeated without them and the answer says `activityUnavailable` — the page never goes blank.
 * Timestamps and counts only; nothing is cached or kept (D45); logs carry ids and codes, never values.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { coqlAll, coqlWhere } from "../../lib/zoho/coql";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import { APP_ACCOUNT_FIELDS, APP_SIGN_IN_FIELDS, type AppActivity, type AppActivityAnswer } from "../../lib/im/app-activity";
import { IN_CHUNK, PAGE } from "../data/adapters";
import { idOf } from "../data/contact-row";
import type { InvestorEvents } from "../data/events";
import { admitContact, contactsWhere } from "../data/ir-guard";
import { checkAmProjection, MODULES } from "../data/projections";
import { scopesFor } from "../data/scope";

/** Checked against identity and money names when this module loads (an IR reads it too). */
export const APP_ACTIVITY_BASE_FIELDS: readonly string[] = checkAmProjection(MODULES.contacts, [
  "id", "ARL_ID", ...APP_ACCOUNT_FIELDS, "KAM", "Origin_Lead", "Originating_IR",
]);
export const APP_ACTIVITY_FIELDS: readonly string[] = checkAmProjection(MODULES.contacts, [...APP_ACTIVITY_BASE_FIELDS, ...APP_SIGN_IN_FIELDS]);

export const MAX_IDS = 200;
const RECORD_ID = /^\d{15,22}$/;
const ZOHO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/;
const CHANNELS: ReadonlySet<string> = new Set(["Email", "WhatsApp", "SMS", "App push"]);

export type AppActivityResult =
  | ({ readonly ok: true } & AppActivityAnswer)
  | { readonly ok: false; readonly kind: "refused"; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected" };

export interface AppActivityDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly events: Pick<InvestorEvents, "refusal">;
}

const when = (v: unknown): string | null => (typeof v === "string" && ZOHO_DATETIME.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const count = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : null;
};

/** Pure: one Contact row → what the card and the badge read. Anything Zoho sends that is not the expected shape reads as empty. */
export function parseActivity(r: ZohoRecord): AppActivity | null {
  const id = idOf(r.id);
  if (!id) return null;
  const channel = typeof r.App_Welcome_Channel === "string" && CHANNELS.has(r.App_Welcome_Channel) ? r.App_Welcome_Channel : null;
  return Object.freeze({
    contactId: id,
    access: r.App_Access === "Hold" || r.App_Access === "Invite" ? r.App_Access : null,
    welcomeAt: when(r.App_Welcome_At), welcomeChannel: channel,
    firstSignInAt: when(r.App_First_Sign_In_At), lastSignInAt: when(r.App_Last_Sign_In_At), signInCount: count(r.App_Sign_In_Count),
    lastFailedAt: when(r.App_Last_Failed_Sign_In_At), failedCount: count(r.App_Failed_Sign_In_Count),
  });
}

export function createAppActivity(deps: AppActivityDeps) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.events?.refusal !== "function") throw new TypeError("app activity needs a CRM client and the investor events");

  type Page = { ok: true; rows: ZohoRecord[] } | { ok: false; errorKind: ZohoFailureKind | "unexpected" };
  async function select(cred: UserCredential, fields: readonly string[], ids: readonly string[], scopeWhere: string, signal?: AbortSignal): Promise<Page> {
    const rows: ZohoRecord[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const where = coqlWhere(coqlAll([`id in (${ids.slice(i, i + IN_CHUNK).map((x) => `'${x}'`).join(", ")})`, scopeWhere]));
      for (let page = 0; ; page++) {
        let r: Awaited<ReturnType<typeof deps.crm.coql>>;
        try { r = await deps.crm.coql(cred, `select ${fields.join(", ")} from ${MODULES.contacts} where ${where} order by id asc limit ${page * PAGE}, ${PAGE}`, { signal }); } catch { return { ok: false, errorKind: "unexpected" }; }
        if (!r.ok) return { ok: false, errorKind: r.error.kind };
        rows.push(...r.value.records);
        if (!r.value.moreRecords) break;
      }
    }
    return { ok: true, rows };
  }

  /** The activity of up to MAX_IDS investors, those the signed-in person may see (others are simply absent). */
  async function read(cred: UserCredential, seat: string, wanted: readonly unknown[], signal?: AbortSignal): Promise<AppActivityResult> {
    const me = cred.userId;
    const scope = scopesFor(seat, me).investors;
    const scopeWhere = contactsWhere(scope);
    if (!scopeWhere) {
      deps.events.refusal(me, "app-activity", "seat-denied");
      return { ok: false, kind: "refused", reason: "seat-denied" };
    }
    if (!Array.isArray(wanted) || wanted.length > MAX_IDS || wanted.some((x) => typeof x !== "string" || !RECORD_ID.test(x))) {
      deps.events.refusal(me, "app-activity", "invalid-request");
      return { ok: false, kind: "refused", reason: "invalid-request" };
    }
    const ids = [...new Set(wanted as string[])];
    if (!ids.length) return { ok: true, rows: [], activityUnavailable: false };

    let unavailable = false;
    let got = await select(cred, APP_ACTIVITY_FIELDS, ids, scopeWhere, signal);
    if (!got.ok && got.errorKind === "invalid-data") {
      /* a sign-in column is not in Zoho yet (or hidden from this seat): the account facts still stand */
      unavailable = true;
      got = await select(cred, APP_ACTIVITY_BASE_FIELDS, ids, scopeWhere, signal);
    }
    if (!got.ok) return { ok: false, kind: "source-error", errorKind: got.errorKind };

    const rows: AppActivity[] = [];
    for (const raw of got.rows) {
      const a = parseActivity(raw);
      if (!a || !ids.includes(a.contactId)) return { ok: false, kind: "refused", reason: "source-invalid" };
      // One row outside the scope means sharing let through what the scope forbids: refuse the whole read, never trim.
      const adm = admitContact(scope, { originLeadId: idOf(raw.Origin_Lead), originatingIrId: idOf(raw.Originating_IR), kamId: idOf(raw.KAM) });
      if (!adm.ok) {
        deps.events.refusal(me, "app-activity", adm.reason, [a.contactId]);
        return { ok: false, kind: "refused", reason: adm.reason };
      }
      rows.push(a);
    }
    return { ok: true, rows: Object.freeze(rows), activityUnavailable: unavailable };
  }

  return Object.freeze({ read });
}
export type AppActivityService = ReturnType<typeof createAppActivity>;
