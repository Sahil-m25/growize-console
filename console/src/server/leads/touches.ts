/**
 * Record one touch with no next step: the quick log ("I messaged / called them now") and the backdated entry (a past
 * attempt, or an inbound reply). The follow-up save (./followup) refuses when no next step is set; this one does not.
 *
 * One record is: the Lead's touch stamps (written FIRST when one changes, with If-Unmodified-Since, so a lead edited
 * since the page read it is refused before anything is created), then one Touch (D76: the contact log). The only thing
 * that can fail after the Lead write is the single Touch insert, so taking back needs no delete: the Lead's two stamps
 * are written as they were (a human token holds no Delete, and Touches has no Voided_At yet).
 *
 * Rules, the same as the follow-up save's:
 *  - consent is checked per channel (Consent_WhatsApp / _Email / _Call; a farm visit has none), except for a reply,
 *    which is inbound and is the one thing recordable on a lead that gave no consent;
 *  - a touch cannot be in the future, nor before the lead was captured, nor on a lead closed as lost;
 *  - a reply stamps Last_Reply_At, but never moves it backwards;
 *  - First_Touch_At is stamped (once, when empty) by a HUMAN touch only: a message or an email, or a call or visit that
 *    REACHED the investor. An unreached call is still a Touch, and never ticks the rung (rule 6 and D76).
 * Every write is the person's own token (D53).
 */

import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { LEADS_MODULE } from "./capture";
import {
  CONSENT, DATETIME, GUARD_FIELDS, REASON, RECORD_ID, RECORD_PREFIX, SESSION_ID, TOUCH_CHANNEL, idOf, text, zohoTime,
  type FollowupAccessAuthority, type FollowupRefusal, type FollowupResult,
} from "./followup";

export type TouchChannel = "msg" | "email" | "call" | "visit" | "reply";
const CHANNELS: ReadonlySet<string> = new Set(["msg", "email", "call", "visit", "reply"]);
/** What a touch says when the caller gave no words of its own. */
const DEFAULT_OUTCOME: Readonly<Record<string, string>> = {
  msg: "Message sent", email: "Email sent", reply: "Reply received",
};
const outcomeFor = (ch: string, reached: boolean): string =>
  ch === "call" ? (reached ? "Connected" : "No answer") : ch === "visit" ? (reached ? "Visit completed" : "Investor unavailable") : DEFAULT_OUTCOME[ch]!;

export interface TouchCommand {
  readonly leadId: string;
  readonly expectedModifiedTime: string;
  readonly channel: TouchChannel;
  /** When it happened; the server's clock when omitted (the quick log). */
  readonly occurredAt?: string;
  /** A call answered / a visit held. Only a reached contact counts toward First touch. Default false. */
  readonly reached?: boolean;
  /** Short words for what happened ("Left a voicemail"); the default names the channel. */
  readonly outcome?: string;
  readonly note?: string;
}
export interface TouchRecorded {
  readonly touchId: string;
  readonly modifiedTime: string | null;
  /** This touch stamped First_Touch_At. */
  readonly firstTouch: boolean;
}

/** One touch as the history reads it back (W3-E2E-7). `channel` is the channel the IR picked, "reply" only for a bare inbound reply. */
export interface TouchRow {
  readonly id: string;
  readonly channel: TouchChannel | null;
  /** Touches.Note up to " — ": "Interested", "Reply received", "Connected". */
  readonly outcome: string;
  /** The words after " — ", if any. */
  readonly note: string | null;
  readonly at: string | null;
  readonly byId: string | null;
  readonly reply: boolean;
}
export interface TouchList { readonly leadId: string; readonly touches: readonly TouchRow[]; readonly truncated: boolean }
export type TouchListResult = FollowupResult<TouchList>;
const TOUCH_LIST_MAX = 100;
const CHANNEL_CODE: Readonly<Record<string, TouchChannel>> = Object.freeze({ WhatsApp: "msg", Email: "email", Call: "call", "Farm visit": "visit" });

export interface TouchesDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert"> & Partial<Pick<ZohoClient, "coql">>;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export function createTouches(deps: TouchesDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.access?.recheck !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Touches need crm get/update/insert, the access authority, the ops log and the record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = <T>(userId: string, code: FollowupRefusal, ids: readonly string[] = []): FollowupResult<T> => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-touch", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, reason: REASON[code] };
  };
  const zoho = <T>(k: ZohoFailureKind | "unexpected"): FollowupResult<T> => ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: false });

  return Object.freeze({
    /** The lead's logged touches, newest first, on the person's own token (D53): the Investor file's conversation history. A
     *  voided touch is left out. Nothing is cached (D45). */
    async list(principal: { credential: UserCredential; sessionId: string }, leadId: unknown, signal?: AbortSignal): Promise<TouchListResult> {
      if (!principal || !isUserCredential(principal.credential) || !validId(principal.credential.userId)
        || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) return refuse("unrecognised", "invalid-request");
      const cred = principal.credential, me = cred.userId;
      if (!validId(leadId) || typeof crm.coql !== "function") return refuse(me, "invalid-request", validId(leadId) ? [leadId] : []);
      try {
        const r = await access.recheck(cred, principal.sessionId, signal);
        if (!r || r.actor?.userId !== me) return refuse(me, "session-changed");
      } catch { return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true }; }
      let got: Awaited<ReturnType<typeof crm.getRecord>>;
      try { got = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: ["Owner"], signal }); } catch { return zoho("unexpected"); }
      if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [leadId]) : zoho(got.error.kind);
      if (!got.value || got.value.id !== leadId) return refuse(me, "not-visible", [leadId]);
      let q: Awaited<ReturnType<NonNullable<typeof crm.coql>>>;
      try {
        q = await crm.coql(cred, `select id, Channel, Occurred_At, Is_Reply, Note, Owner, Created_Time, Voided_At from Touches where Lead = '${leadId}' order by Occurred_At desc limit 0, ${TOUCH_LIST_MAX + 1}`, { signal });
      } catch { return zoho("unexpected"); }
      if (!q.ok) return zoho(q.error.kind);
      /* W5-2: touches are stamped to the minute; two in the same minute come back in no fixed order, so the later-entered
       one (Created_Time) goes first; otherwise Zoho's order is kept (stable sort) — the same tie-break Last contact uses (W4-E-3). */
    const ms = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : 0);
    const ordered = [...q.value.records].sort((a, b) => ms(b.Occurred_At) - ms(a.Occurred_At) || ms(b.Created_Time) - ms(a.Created_Time));
    const touches = ordered.filter((t) => validId(t.id) && !(typeof t.Voided_At === "string" && t.Voided_At)).slice(0, TOUCH_LIST_MAX).map((t): TouchRow => {
        const words = typeof t.Note === "string" ? t.Note.trim() : "";
        const cut = words.indexOf(" — ");
        const reply = t.Is_Reply === true;
        const channel = typeof t.Channel === "string" ? CHANNEL_CODE[t.Channel] ?? null : reply ? "reply" : null;
        return {
          id: t.id, channel, outcome: (cut < 0 ? words : words.slice(0, cut)).slice(0, 80), note: cut < 0 ? null : words.slice(cut + 3).slice(0, 1_800) || null,
          at: typeof t.Occurred_At === "string" ? t.Occurred_At : null, byId: idOf(t.Owner), reply,
        };
      });
      return { ok: true, value: { leadId, touches, truncated: q.value.records.length > TOUCH_LIST_MAX } };
    },

    async record(principal: { credential: UserCredential; sessionId: string }, c: TouchCommand, signal?: AbortSignal): Promise<FollowupResult<TouchRecorded>> {
      if (!principal || !isUserCredential(principal.credential) || !validId(principal.credential.userId)
        || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) return refuse("unrecognised", "invalid-request");
      const cred = principal.credential, me = cred.userId;
      // ---- shape
      const outcome = c?.outcome === undefined || c.outcome === "" ? null : text(c.outcome, 80);
      const note = c?.note === undefined || c.note === "" ? null : text(c.note, 1_800);
      if (!c || !validId(c.leadId) || typeof c.expectedModifiedTime !== "string" || !DATETIME.test(c.expectedModifiedTime)
        || !CHANNELS.has(c.channel) || (c.occurredAt !== undefined && (typeof c.occurredAt !== "string" || !DATETIME.test(c.occurredAt)))
        || (c.reached !== undefined && typeof c.reached !== "boolean") || (c.outcome !== undefined && c.outcome !== "" && !outcome)
        || (c.note !== undefined && c.note !== "" && !note)) {
        return refuse(me, "invalid-request", validId(c?.leadId) ? [c.leadId] : []);
      }
      const now = clock();
      const occurredAt = c.occurredAt ?? zohoTime(now);
      const occurred = Date.parse(occurredAt);
      if (occurred > now) return refuse(me, "contact-in-future", [c.leadId]);
      const ch = c.channel, reply = ch === "reply", reached = c.reached === true;

      const a = await (async () => {
        try {
          const r = await access.recheck(principal.credential, principal.sessionId, signal);
          if (!r || r.actor?.userId !== me) return refuse<never>(me, "session-changed");
          if (!r.mayRecordFollowup) return refuse<never>(me, "capability-missing");
          return r;
        } catch { return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true } as FollowupResult<never>; }
      })();
      if (!("actor" in a)) return a;

      // ---- the lead as it is now
      let got: Awaited<ReturnType<typeof crm.getRecord>>;
      try { got = await crm.getRecord(cred, LEADS_MODULE, c.leadId, { fields: GUARD_FIELDS, signal }); } catch { return zoho("unexpected"); }
      if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [c.leadId]) : zoho(got.error.kind);
      if (!got.value || got.value.id !== c.leadId) return refuse(me, "not-visible", [c.leadId]);
      const L = got.value as ZohoRecord;
      if (L.Modified_Time !== c.expectedModifiedTime) return refuse(me, "lead-changed", [c.leadId]);
      const owner = idOf(L.Owner), today = zohoTime(now).slice(0, 10);
      const inBook = owner === me /* D44: a named secondary is dormant; only a live cover admits (server/leads/cover.ts) */
        || (idOf(L.Cover_By) === me && typeof L.Cover_Until === "string" && L.Cover_Until >= today)
        || (owner !== null && a.teamOwnerIds.includes(owner));
      if (!inBook) return refuse(me, "not-in-book", [c.leadId]);
      if (L.Lost_At) return refuse(me, "lead-lost", [c.leadId]);
      if (typeof L.Created_Time === "string" && occurred < Date.parse(L.Created_Time)) return refuse(me, "contact-before-capture", [c.leadId]);
      if (!reply && !!CONSENT[ch] && L[CONSENT[ch]] !== true) return refuse(me, "no-consent", [c.leadId]);

      // ---- what changes on the lead
      const humanTouch = !reply && (ch === "msg" || ch === "email" || ((ch === "call" || ch === "visit") && reached));
      const prevReply = typeof L.Last_Reply_At === "string" ? L.Last_Reply_At : null;
      const prevFirst = typeof L.First_Touch_At === "string" ? L.First_Touch_At : null;
      const leadFields: Record<string, ZohoFields[string]> = {};
      const was: Record<string, ZohoFields[string]> = {};
      if (reply && (!prevReply || occurred > Date.parse(prevReply))) { leadFields.Last_Reply_At = occurredAt; was.Last_Reply_At = prevReply; }
      const firstTouch = humanTouch && !prevFirst;
      if (firstTouch) { leadFields.First_Touch_At = occurredAt; was.First_Touch_At = prevFirst; }

      let leadModified: string | null = null;
      if (Object.keys(leadFields).length) {
        // ---- 1. the lead, guarded: a 412 here means nothing has been written
        let put: Awaited<ReturnType<typeof crm.update>>;
        try { put = await crm.update(cred, LEADS_MODULE, c.leadId, leadFields, { ifUnmodifiedSince: c.expectedModifiedTime, signal }); } catch { return zoho("unexpected"); }
        if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "lead-changed", [c.leadId]) : zoho(put.error.kind);
        leadModified = put.value.modifiedTime && DATETIME.test(put.value.modifiedTime) ? put.value.modifiedTime : null;
      }

      // ---- 2. the touch
      const words = outcome ?? outcomeFor(ch, reached);
      let touchId: string | null = null;
      try {
        const r = await crm.insert(cred, "Touches", [{
          Name: `${TOUCH_CHANNEL[ch] ?? "Reply"} ${occurredAt}`,
          Lead: { id: c.leadId },
          ...(TOUCH_CHANNEL[ch] ? { Channel: TOUCH_CHANNEL[ch] } : {}),
          Occurred_At: occurredAt,
          Is_Reply: reply,
          Note: note ? `${words} — ${note}` : words,
        }], { signal });
        const o = r.ok && r.value.length === 1 ? r.value[0] : null;
        touchId = o && o.ok && validId(o.id) ? o.id : null;
      } catch { touchId = null; }
      if (!touchId) {
        // Put the two stamps back as they were (an update). Nothing else was written.
        if (Object.keys(leadFields).length) {
          let ok = false;
          if (leadModified) {
            try { ok = (await crm.update(cred, LEADS_MODULE, c.leadId, was, { ifUnmodifiedSince: leadModified, signal })).ok; } catch { ok = false; }
          }
          if (!ok) return refuse(me, "followup-partial", [c.leadId]);
        }
        return zoho("unexpected");
      }
      return { ok: true, value: { touchId, modifiedTime: leadModified, firstTouch } };
    },
  });
}
