/**
 * M12-S11-T02 / M12-S12-T01 — THE IR'S PAPERWORK BEATS on the lead page row: told, reminded (chase), "they say
 * it's signed" (said), and on the supplementary round the draft, the re-draft and the agreed final draft.
 *
 * The order is the front end's own rule, imported, not re-ported: `prNext` (src/lib/selectors/paper.ts) over the
 * round as Zoho holds it. A beat is written only when it is the one that is next and the next move is the IR's;
 * Finance's beats (send for signature, verify, bounce) are never written here — they are refused with a Plane B
 * line (D61). Only a seat that can work the lead (owner, live cover, team) writes, on its own token (D53), and
 * a told or a reminder only on a channel the investor consented to.
 *
 * "From the lead page row only" (TC-E09-006): the row's read (`read`) hands a short-lived signed row token per
 * beat it offers — bound to the person, the sign-in, the lead, the round, the beat and the Lead's Modified_Time.
 * A write without it, or after the lead changed, is refused and nothing is written.
 *
 * One write is: the Lead's round fields FIRST (If-Unmodified-Since); a reminder then adds one Touch (D76) and one
 * Note (the interaction). A failure after the Lead write takes back what was written. Undo is a signed token for
 * 10 seconds (the follow-up writer's pattern and secret): it puts the round fields back and deletes what was made.
 *
 * WHERE THE BEATS LIVE (PROPOSED — the org has none of these fields yet; M12-S11-T01 is Sahil's Zoho config):
 * every IR beat of both rounds is on the Lead (jev 0.73 — the IR owns the Lead and no allotment exists at rung 5);
 * a reminder is a count and a last-reminder stamp per round with the detail in the Touch (jev 0.26, PROVISIONAL).
 * Finance's side is read where it already lives: NDA_Sign_Req_Id / NDA_Verified_At on the Lead,
 * Supplementary_Sign_Req_Id / Supplementary_Verified_At on the allotment (Lead ─Origin_Lead─ Contact ─Customer─).
 *
 * G1 (owner workflow, 8 Oct; D136 proposed): "the IR asks Finance to send it". When a round's next step is Finance's send
 * ("Send it for signature"), the row offers the IR one more beat, `request` — "Ask Finance to send the NDA" / "…the
 * supplementary" — which writes Lead.<NDA|Supp>_Requested_At / _Requested_By on the IR's own token (same row token, same
 * If-Unmodified-Since, same 10 s Undo). It is idempotent: a round already asked for answers `already` and writes nothing;
 * a paper Finance has already sent or verified is refused (`already-sent`). Finance's side stays Finance's (D61): the
 * request only puts the round on Finance's to-do (server/queues "Send the NDA — requested by <IR> n days ago").
 *
 * Plane B gets ids and codes only — never a link, a note or a name.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { Ctx } from "../../lib/selectors/ctx";
import { prNext } from "../../lib/selectors/paper";
import type { Lead, PaperNext, PaperRound } from "../../domain";
import { LEADS_MODULE } from "./capture";
import type { FollowupAccessAuthority } from "./followup";
import { RUNGS, doneOf } from "./journey";

export const PAPER_UNDO_MS = 10_000;
export const ROW_TOKEN_MS = 15 * 60_000;
export const ALLOTMENTS = "LLP_UnitAllocation_Module";
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
/** A pasted draft link: a Zoho Writer / WorkDrive document (TC-E09-011/013). */
const DRAFT_LINK = /^https:\/\/(?:writer|workdrive|docs)\.zoho\.(?:in|com)\/[A-Za-z0-9._~\/?#=&%-]{1,400}$/;

export type RoundKey = "nda" | "supp";
export type IrBeat = "told" | "chase" | "said" | "draft" | "redraft" | "agreed" | "request";
export type Channel = "call" | "msg" | "email";
/** Finance's beats, named every way the prototype and the queue call them — refused here, always. */
export const FINANCE_BEATS: ReadonlySet<string> = new Set(["sent", "send", "ok", "verify", "back", "bounce", "block"]);
const IR_BEATS: ReadonlySet<string> = new Set(["told", "chase", "said", "draft", "redraft", "agreed", "request"]);
const CHANNEL_VALUE: Readonly<Record<Channel, string>> = Object.freeze({ call: "Call", msg: "WhatsApp", email: "Email" });
const CHANNEL_OF: Readonly<Record<string, Channel>> = Object.freeze({ Call: "call", WhatsApp: "msg", Email: "email" });
const CONSENT: Readonly<Record<Channel, string>> = Object.freeze({ call: "Consent_Call", msg: "Consent_WhatsApp", email: "Consent_Email" });
const ROUND_TITLE: Readonly<Record<RoundKey, string>> = Object.freeze({ nda: "NDA", supp: "Supplementary agreement" });

/** The Lead fields each round's IR beats are written to (PROPOSED names — see the header). */
export const ROUND_FIELDS = Object.freeze({
  nda: Object.freeze({
    toldVia: "NDA_Told_Via", toldAt: "NDA_Told_At", toldBy: "NDA_Told_By",
    chaseCount: "NDA_Chase_Count", lastChaseAt: "NDA_Last_Chase_At", lastChaseVia: "NDA_Last_Chase_Via",
    saidAt: "NDA_Said_At", saidBy: "NDA_Said_By",
  }),
  supp: Object.freeze({
    toldVia: "Supp_Told_Via", toldAt: "Supp_Told_At", toldBy: "Supp_Told_By",
    chaseCount: "Supp_Chase_Count", lastChaseAt: "Supp_Last_Chase_At", lastChaseVia: "Supp_Last_Chase_Via",
    saidAt: "Supp_Said_At", saidBy: "Supp_Said_By",
    draftVersion: "Supp_Draft_Version", draftRef: "Supp_Draft_Ref", draftAt: "Supp_Draft_At", draftBy: "Supp_Draft_By",
    agreedRef: "Supp_Agreed_Ref", agreedVersion: "Supp_Agreed_Version", agreedAt: "Supp_Agreed_At", agreedBy: "Supp_Agreed_By",
  }),
});
/** Finance's "not signed after all" (the bounce of a paper the IR said was signed): read here, never written here
 *  (PROPOSED names, M12-S11-T01 — Finance's own write is its beat, D61). Read-only, so not in PROPOSED_LEAD_FIELDS. */
export const BACK_FIELDS = Object.freeze({
  nda: Object.freeze({ at: "NDA_Back_At", by: "NDA_Back_By", why: "NDA_Back_Why" }),
  supp: Object.freeze({ at: "Supp_Back_At", by: "Supp_Back_By", why: "Supp_Back_Why" }),
});
/** G1: the IR's ask that Finance send the round's paper (PROPOSED names, D136) — written here by the IR, read by Finance's queue. */
export const REQUEST_FIELDS = Object.freeze({
  nda: Object.freeze({ at: "NDA_Requested_At", by: "NDA_Requested_By" }),
  supp: Object.freeze({ at: "Supp_Requested_At", by: "Supp_Requested_By" }),
});
export const REQUEST_LEAD_FIELDS: readonly string[] = Object.freeze(Object.values(REQUEST_FIELDS).flatMap((f) => [f.at, f.by]));
type AnyRoundFields = { readonly [k: string]: string };
const fieldsOf = (rk: RoundKey): AnyRoundFields => ROUND_FIELDS[rk] as AnyRoundFields;
/** Every proposed field, for the report and the field-contract test. */
export const PROPOSED_LEAD_FIELDS: readonly string[] = Object.freeze([...Object.values(ROUND_FIELDS.nda), ...Object.values(ROUND_FIELDS.supp)]);

const LEAD_READ = ["Modified_Time", "Owner", "Cover_By", "Cover_Until", "Lost_At", "Consent_Call", "Consent_WhatsApp", "Consent_Email",
  "NDA_Sign_Req_Id", "NDA_Verified_At", ...RUNGS.map((r) => r.field), ...PROPOSED_LEAD_FIELDS,
  ...Object.values(BACK_FIELDS).flatMap((f) => [f.at, f.by, f.why]),
  /* G1: the stamp only — the row reads 50 fields, Zoho's ceiling (lib/zoho/client MAX_FIELDS); who asked is Finance's queue's read */
  ...Object.values(REQUEST_FIELDS).map((f) => f.at)];

export interface FinanceSide { readonly sentAt: string | null; readonly okAt: string | null }
export interface RoundView {
  readonly round: RoundKey;
  readonly title: string;
  readonly next: PaperNext;
  readonly told: { readonly channel: Channel | null; readonly at: string } | null;
  readonly reminders: number;
  readonly said: { readonly by: string | null; readonly at: string } | null;
  readonly draft: { readonly version: number; readonly ref: string; readonly at: string | null } | null;
  readonly agreed: { readonly version: number | null; readonly ref: string; readonly at: string } | null;
  /** Finance found nothing signed after the IR said it was ("Not signed after all"); null once the IR says it again. */
  readonly back: { readonly by: string | null; readonly at: string; readonly why: string | null } | null;
  /** G1: the IR asked Finance to send it (who, when); null when nobody has. */
  readonly requested: { readonly at: string } | null;
  /** Finance's side, read here, never written here. */
  readonly sent: boolean;
  readonly verified: boolean;
}
export interface Offer { readonly round: RoundKey; readonly beat: IrBeat; readonly channels: readonly Channel[]; readonly rowToken: string }
export interface PaperworkRow {
  readonly leadId: string;
  readonly modifiedTime: string;
  readonly rounds: readonly RoundView[];
  /** Only what this person may press now, on the lead page row. Empty when it is nobody's move or not theirs. */
  readonly offers: readonly Offer[];
  /** The supplementary round's Finance side could not be read: its state is shown as unknown, nothing offered. */
  readonly suppUnread: boolean;
}

export interface PaperworkCommand {
  readonly leadId: string;
  readonly round: string;
  readonly beat: string;
  readonly channel?: string | null;
  /** The token the lead page row got with its read. */
  readonly rowToken: string;
  /** draft / redraft / agreed: a file uploaded to the Lead's Attachments through /api/documents/upload (M12-S02)… */
  readonly attachmentId?: string | null;
  /** …or the pasted Zoho Writer / WorkDrive link. */
  readonly link?: string | null;
}

export type PaperworkRefusal = "invalid-request" | "session-changed" | "capability-missing" | "not-visible" | "not-in-book"
  | "not-from-row" | "lead-changed" | "finance-beat" | "out-of-order" | "no-consent" | "lead-lost" | "draft-needed"
  | "draft-not-on-lead" | "undo-expired" | "undo-invalid" | "source-invalid" | "partial" | "already-sent";
export type PaperworkResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: PaperworkRefusal; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export const PAPERWORK_REASON: Readonly<Record<PaperworkRefusal, string>> = Object.freeze({
  "invalid-request": "Not saved — the step is incomplete.",
  "session-changed": "Not saved — the sign-in session changed.",
  "capability-missing": "Not saved — this seat does not work leads.",
  "not-visible": "Not saved — the lead is unavailable.",
  "not-in-book": "Not saved — this lead is not in your book.",
  "not-from-row": "Not saved — paperwork is recorded from the lead page's Paperwork row. Reload the lead.",
  "lead-changed": "Not saved — the lead changed in Zoho since it was opened. Reload it.",
  "finance-beat": "Finance sends it for signature and verifies the signed copy in the Investors pages; it is not recorded here.",
  "out-of-order": "Not saved — that is not the next step on this paperwork.",
  "no-consent": "Not saved — the investor has not given permission for that channel.",
  "lead-lost": "Not saved — this lead is closed as lost.",
  "draft-needed": "Upload the draft or paste its Zoho link first.",
  "draft-not-on-lead": "Not saved — that file is not on this lead. Upload it again.",
  "undo-expired": "Undo is no longer offered.",
  "undo-invalid": "This Undo does not match a step of yours.",
  "source-invalid": "Zoho returned a record this console cannot read.",
  "partial": "The step could not be completed and could not be fully taken back; it has been reported.",
  "already-sent": "Not saved — Finance has already sent it for signature.",
});

export interface PaperworkDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert" | "deleteRecord" | "coql" | "getRelated">;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  /** FOLLOWUP_UNDO_SECRET (32+ characters): signs the row tokens and the Undo tokens, each with its own tag. */
  readonly undoSecret: string;
  readonly clock?: () => number;
}

interface RowClaims { readonly v: 1; readonly k: "row"; readonly actor: string; readonly session: string; readonly lead: string;
  readonly round: RoundKey; readonly beat: IrBeat; readonly mod: string; readonly exp: number }
interface UndoClaims { readonly v: 1; readonly k: "undo"; readonly actor: string; readonly session: string; readonly lead: string;
  readonly round: RoundKey; readonly beat: IrBeat; readonly exp: number; readonly leadModified: string;
  readonly snapshot: Readonly<Record<string, string | number | null | { id: string }>>; readonly created: readonly { readonly module: string; readonly id: string }[] }

const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
const idOf = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const stamp = (v: unknown): string | null => (typeof v === "string" && DATETIME.test(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,6}$/.test(v) ? Number(v) : 0);
const isRound = (v: unknown): v is RoundKey => v === "nda" || v === "supp";
const isChannel = (v: unknown): v is Channel => v === "call" || v === "msg" || v === "email";

/** The round as Zoho holds it, in the prototype's PaperRound shape, so `prNext` reads it unchanged. */
export function roundOf(L: ZohoRecord, rk: RoundKey, fin: FinanceSide): PaperRound {
  const f = fieldsOf(rk);
  const who = (v: unknown) => (idOf(v) ?? "") as never;
  const p: PaperRound = { chase: [] };
  if (rk === "supp") {
    const ref = str(L[f.draftRef!]);
    if (ref && int(L[f.draftVersion!]) > 0) p.draft = { by: who(L[f.draftBy!]), at: (stamp(L[f.draftAt!]) ?? "") as never, link: ref, v: int(L[f.draftVersion!]) } as never;
    const agreedAt = stamp(L[f.agreedAt!]);
    if (agreedAt) p.agreed = { by: who(L[f.agreedBy!]), at: agreedAt as never, link: str(L[f.agreedRef!]) ?? "" };
  }
  if (fin.sentAt !== null) p.sent = { by: "" as never, at: fin.sentAt as never, via: "Zoho Sign" };
  const toldAt = stamp(L[f.toldAt]);
  if (toldAt) p.told = { by: who(L[f.toldBy]), at: toldAt as never, ch: (CHANNEL_OF[String(L[f.toldVia])] ?? "call") as never };
  const n = int(L[f.chaseCount]);
  for (let i = 0; i < n; i++) p.chase!.push({ by: "" as never, at: (stamp(L[f.lastChaseAt]) ?? "") as never, ch: (CHANNEL_OF[String(L[f.lastChaseVia])] ?? "call") as never, phase: "sign" });
  const saidAt = stamp(L[f.saidAt]);
  if (saidAt) p.said = { by: who(L[f.saidBy]), at: saidAt as never };
  if (fin.okAt !== null) p.ok = { by: "" as never, at: fin.okAt as never };
  return p;
}

/** `prNext` from the front end's rules, over Zoho's record: the order check is the same code the screen runs. */
export function nextOf(L: ZohoRecord, done: number, rounds: { readonly nda: PaperRound; readonly supp: PaperRound }, rk: RoundKey): PaperNext {
  // Zoho Sign's completion (or Finance's verification) is the signature: the round is done whatever the IR said.
  if (rounds[rk].ok && !L.Lost_At) return { k: "done", t: "Signed and verified", who: null };
  // W3-E2E-4: once Finance has sent the paper it is out, whatever came before it: the IR's moves are to tell and to chase, and the lead
  // must show it (the investor holds a live signing link). The order of the rounds is held at the send (zoho-sign/send), not here.
  const r = rounds[rk];
  if (r.sent && !L.Lost_At) {
    if (!r.told) return { k: "told", t: "Tell them it is there", who: "IR" };
    if (!r.said) return { k: "said", t: "Chase the signature", who: "IR" };
    return { k: "ok", t: "Verify the signed copy", who: "Finance" };
  }
  const lead = { id: L.id, done, lost: !!L.Lost_At } as unknown as Lead;
  const ctx = { PAPER: { [L.id]: rounds } } as unknown as Ctx;
  return prNext(ctx, lead, rk);
}

/** The IR beats that answer a `prNext` step. Chasing and "they say it's signed" both answer "said". */
export function beatsFor(next: PaperNext, round: PaperRound): readonly IrBeat[] {
  if (next.who !== "IR") return [];
  switch (next.k) {
    case "told": return ["told"];
    case "said": return ["chase", "said"];
    case "draft": return ["draft"];
    case "agreed": return round.draft ? ["redraft", "agreed"] : [];
    default: return [];
  }
}

/** Finance's bounce on this round, while it still stands: not once the paper is verified, and not after the IR has said
 *  "it's signed" again (a newer word than the bounce). */
export function backOf(L: ZohoRecord, rk: RoundKey, verified: boolean): RoundView["back"] {
  const b = BACK_FIELDS[rk];
  const at = stamp(L[b.at]);
  if (!at || verified) return null;
  const said = stamp(L[fieldsOf(rk).saidAt!]);
  if (said && Date.parse(said) >= Date.parse(at)) return null;
  const why = str(L[b.why]);
  return Object.freeze({ by: idOf(L[b.by]), at, why: why ? why.slice(0, 300) : null });
}

/** G1: the IR's ask, as Zoho holds it (its stamp); null when the round was never asked for. */
export function requestedOf(L: ZohoRecord, rk: RoundKey): RoundView["requested"] {
  const at = stamp(L[REQUEST_FIELDS[rk].at]);
  return at ? Object.freeze({ at }) : null;
}
/** G1: the request is offered while the round waits on Finance's send, has not been asked for, and is not out or verified. */
export const requestOffered = (v: Pick<RoundView, "next" | "requested" | "sent" | "verified">): boolean =>
  v.next.k === "sent" && v.next.who === "Finance" && !v.requested && !v.sent && !v.verified;

export function createPaperwork(deps: PaperworkDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.crm?.deleteRecord !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.crm?.getRelated !== "function"
    || typeof deps.access?.recheck !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)
    || typeof deps.undoSecret !== "string" || deps.undoSecret.length < 32) {
    throw new TypeError("Paperwork needs crm get/update/insert/delete/coql/getRelated, the access authority, the ops log, the record-id prefix and a 32+ character secret.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = <T>(userId: string, code: PaperworkRefusal, ids: readonly string[] = []): PaperworkResult<T> => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-paperwork", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, reason: PAPERWORK_REASON[code] };
  };
  const zoho = <T>(k: ZohoFailureKind | "unexpected"): PaperworkResult<T> => ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: false });
  const mac = (tag: string, body: string) => createHmac("sha256", deps.undoSecret).update(`${tag}.${body}`).digest();
  const sign = (c: RowClaims | UndoClaims): string => {
    const body = Buffer.from(JSON.stringify(c)).toString("base64url");
    return `${body}.${mac(c.k, body).toString("base64url")}`;
  };
  function verify<C extends RowClaims | UndoClaims>(token: unknown, k: C["k"]): C | null {
    if (typeof token !== "string" || token.length > 8_000) return null;
    const [body, m] = token.split(".");
    if (!body || !m) return null;
    const want = mac(k, body), got = Buffer.from(m, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    try { const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as C; return c && c.v === 1 && c.k === k ? c : null; } catch { return null; }
  }
  type Principal = { credential: UserCredential; sessionId: string };
  const principalOk = (p: Principal | undefined): p is Principal =>
    !!p && isUserCredential(p.credential) && validId(p.credential.userId) && typeof p.sessionId === "string" && SESSION_ID.test(p.sessionId);

  const recheck = async (p: Principal, signal?: AbortSignal) => {
    try {
      const a = await access.recheck(p.credential, p.sessionId, signal);
      if (!a || a.actor?.userId !== p.credential.userId) return refuse<never>(p.credential.userId, "session-changed");
      if (!a.mayRecordFollowup) return refuse<never>(p.credential.userId, "capability-missing");
      return a;
    } catch {
      return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true } as PaperworkResult<never>;
    }
  };

  /** The supplementary round's Finance side, from the live allotment(s) of the lead's Contact. */
  async function suppFinance(cred: UserCredential, leadId: string, signal?: AbortSignal): Promise<FinanceSide | null> {
    try {
      const c = await crm.coql(cred, `select id, Origin_Lead from Contacts where Origin_Lead = '${leadId}' limit 0, 2`, { signal });
      if (!c.ok || c.value.invalidRecordIds) return null;
      const contact = c.value.records.find((r) => idOf(r.Origin_Lead) === leadId && validId(r.id));
      if (!contact) return { sentAt: null, okAt: null };
      const al = await crm.coql(cred, `select id, Supplementary_Sign_Req_Id, Supplementary_Verified_At from ${ALLOTMENTS} where Customer = '${contact.id}' limit 0, 100`, { signal });
      if (!al.ok || al.value.invalidRecordIds) return null;
      let sentAt: string | null = null, okAt: string | null = null;
      for (const a of al.value.records) {
        if (typeof a.Supplementary_Sign_Req_Id === "string" && /^\d{10,25}$/.test(a.Supplementary_Sign_Req_Id.trim())) sentAt ??= "sent";
        const v = stamp(a.Supplementary_Verified_At);
        if (v) okAt = v;
      }
      // A verified copy was sent even when the request id was cleared after filing.
      if (okAt && !sentAt) sentAt = "sent";
      return { sentAt, okAt };
    } catch { return null; }
  }

  type Loaded = { L: ZohoRecord; done: number; rounds: { nda: PaperRound; supp: PaperRound }; suppUnread: boolean; inBook: boolean };
  async function load(p: Principal, leadId: string, teamOwnerIds: readonly string[], needSupp: boolean, signal?: AbortSignal)
    : Promise<Loaded | PaperworkResult<never>> {
    const me = p.credential.userId;
    let got: Awaited<ReturnType<typeof crm.getRecord>>;
    try { got = await crm.getRecord(p.credential, LEADS_MODULE, leadId, { fields: LEAD_READ, signal }); } catch { return zoho("unexpected"); }
    if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [leadId]) : zoho(got.error.kind);
    if (!got.value || got.value.id !== leadId || typeof got.value.Modified_Time !== "string" || !DATETIME.test(got.value.Modified_Time)) return refuse(me, "not-visible", [leadId]);
    const L = got.value;
    const done = doneOf(L);
    if (done === null) return refuse(me, "source-invalid", [leadId]);
    const owner = idOf(L.Owner), today = zohoTime(clock()).slice(0, 10);
    const inBook = owner === me /* D44: only a live cover admits a second person (server/leads/cover.ts) */
      || (idOf(L.Cover_By) === me && typeof L.Cover_Until === "string" && L.Cover_Until >= today)
      || (owner !== null && teamOwnerIds.includes(owner));
    const ndaFin: FinanceSide = { sentAt: str(L.NDA_Sign_Req_Id) || stamp(L.NDA_Verified_At) ? "sent" : null, okAt: stamp(L.NDA_Verified_At) };
    const nda = roundOf(L, "nda", ndaFin);
    let supp = roundOf(L, "supp", { sentAt: null, okAt: null });
    let suppUnread = false;
    // Finance's supplementary side is read whenever it is asked for: a paper that is out shows as out on the lead, in whatever order it
    // went (W3-E2E-4: it used to be read only once the NDA was verified and the draft agreed, so an early send never showed).
    if (needSupp) {
      const f = await suppFinance(p.credential, leadId, signal);
      if (f) supp = roundOf(L, "supp", f); else suppUnread = true;
    }
    return { L, done, rounds: { nda, supp }, suppUnread, inBook };
  }

  const consented = (L: ZohoRecord): Channel[] => (["call", "msg", "email"] as const).filter((c) => L[CONSENT[c]] === true);

  function view(x: Loaded, rk: RoundKey): RoundView {
    const L = x.L, f = fieldsOf(rk), r = x.rounds[rk];
    const next = rk === "supp" && x.suppUnread ? { k: "none" as const, t: "The Finance side could not be read", who: null } : nextOf(L, x.done, x.rounds, rk);
    return Object.freeze({
      round: rk, title: ROUND_TITLE[rk], next,
      told: r.told ? { channel: CHANNEL_OF[String(L[f.toldVia])] ?? null, at: r.told.at as string } : null,
      reminders: int(L[f.chaseCount]),
      said: r.said ? { by: idOf(L[f.saidBy]), at: r.said.at as string } : null,
      draft: r.draft ? { version: int(L[f.draftVersion!]), ref: r.draft.link, at: stamp(L[f.draftAt!]) } : null,
      agreed: r.agreed ? { version: int(L[f.agreedVersion!]) || null, ref: r.agreed.link, at: r.agreed.at as string } : null,
      back: backOf(L, rk, !!r.ok),
      requested: requestedOf(L, rk),
      sent: !!r.sent, verified: !!r.ok,
    });
  }

  /** Takes back what a step wrote: the made records, then (if given) the round fields. Returns ids not taken back. */
  async function takeBack(cred: UserCredential, lead: string, created: readonly { module: string; id: string }[],
    restore: { fields: ZohoFields; modified: string } | null, signal?: AbortSignal): Promise<string[]> {
    const left: string[] = [];
    for (const c of [...created].reverse()) {
      try { const r = await crm.deleteRecord(cred, c.module, c.id, { signal }); if (!r.ok) left.push(c.id); } catch { left.push(c.id); }
    }
    if (restore) {
      try { const r = await crm.update(cred, LEADS_MODULE, lead, restore.fields, { ifUnmodifiedSince: restore.modified, signal }); if (!r.ok) left.push(lead); }
      catch { left.push(lead); }
    }
    return left;
  }

  return Object.freeze({
    /** The lead page's Paperwork row: both rounds' state, and the beats this person may press now, each with its row token. */
    async read(principal: Principal, leadId: string, signal?: AbortSignal): Promise<PaperworkResult<PaperworkRow>> {
      if (!principalOk(principal)) return refuse("unrecognised", "invalid-request");
      const me = principal.credential.userId;
      if (!validId(leadId)) return refuse(me, "invalid-request");
      const a = await recheck(principal, signal);
      if (!("actor" in a)) return a;
      const x = await load(principal, leadId, a.teamOwnerIds, true, signal);
      if (!("L" in x)) return x;
      const rounds = (["nda", "supp"] as const).map((rk) => view(x, rk));
      const offers: Offer[] = [];
      if (x.inBook && !x.L.Lost_At) {
        const exp = clock() + ROW_TOKEN_MS;
        const chans = consented(x.L);
        for (const v of rounds) {
          const beats: IrBeat[] = [...beatsFor(v.next, x.rounds[v.round]), ...(requestOffered(v) ? ["request" as const] : [])];
          for (const beat of beats) {
            const channels = beat === "told" || beat === "chase" ? chans : [];
            if ((beat === "told" || beat === "chase") && !channels.length) continue;
            offers.push(Object.freeze({ round: v.round, beat, channels: Object.freeze(channels),
              rowToken: sign({ v: 1, k: "row", actor: me, session: principal.sessionId, lead: leadId, round: v.round, beat, mod: x.L.Modified_Time as string, exp }) }));
          }
        }
      }
      return { ok: true, value: Object.freeze({ leadId, modifiedTime: x.L.Modified_Time as string, rounds: Object.freeze(rounds), offers: Object.freeze(offers), suppUnread: x.suppUnread }) };
    },

    /** Record one IR beat from the row. */
    async step(principal: Principal, c: PaperworkCommand, signal?: AbortSignal): Promise<PaperworkResult<{
      readonly round: RoundKey; readonly beat: IrBeat; readonly modifiedTime: string | null; readonly touchId: string | null; readonly noteId: string | null;
      readonly draftVersion: number | null; readonly undoToken: string | null; readonly undoUntil: number; readonly already?: boolean }>> {
      if (!principalOk(principal)) return refuse("unrecognised", "invalid-request");
      const cred = principal.credential, me = cred.userId;
      const lead = c && validId(c.leadId) ? c.leadId : null;
      if (!c || !lead) return refuse(me, "invalid-request");
      // Finance's beats are never typed on this side (D61), whatever else the request says.
      if (typeof c.beat === "string" && FINANCE_BEATS.has(c.beat)) return refuse(me, "finance-beat", [lead]);
      if (!isRound(c.round) || typeof c.beat !== "string" || !IR_BEATS.has(c.beat)) return refuse(me, "invalid-request", [lead]);
      const rk = c.round, beat = c.beat as IrBeat;
      const needsChannel = beat === "told" || beat === "chase";
      const isRequest = beat === "request";
      if (needsChannel ? !isChannel(c.channel) : c.channel !== undefined && c.channel !== null) return refuse(me, "invalid-request", [lead]);
      if (rk === "nda" && (beat === "draft" || beat === "redraft" || beat === "agreed")) return refuse(me, "out-of-order", [lead]);
      const hasFile = c.attachmentId !== undefined && c.attachmentId !== null;
      const hasLink = c.link !== undefined && c.link !== null && c.link !== "";
      if (hasFile && hasLink) return refuse(me, "invalid-request", [lead]);
      if (hasFile && !validId(c.attachmentId)) return refuse(me, "invalid-request", [lead]);
      if (hasLink && (typeof c.link !== "string" || !DRAFT_LINK.test(c.link.trim()))) return refuse(me, "invalid-request", [lead]);
      if ((beat === "draft" || beat === "redraft") && !hasFile && !hasLink) return refuse(me, "draft-needed", [lead]);
      if (!(beat === "draft" || beat === "redraft" || beat === "agreed") && (hasFile || hasLink)) return refuse(me, "invalid-request", [lead]);
      if (isRequest && c.channel !== undefined && c.channel !== null) return refuse(me, "invalid-request", [lead]);

      // ---- only from the lead page row: its token names this lead, this round, this beat, this person and sign-in
      const row = verify<RowClaims>(c.rowToken, "row");
      if (!row || row.actor !== me || row.session !== principal.sessionId || row.lead !== lead || row.round !== rk || row.beat !== beat
        || clock() > row.exp) return refuse(me, "not-from-row", [lead]);

      const a = await recheck(principal, signal);
      if (!("actor" in a)) return a;
      const x = await load(principal, lead, a.teamOwnerIds, rk === "supp", signal);
      if (!("L" in x)) return x;
      const L = x.L;
      if (!x.inBook) return refuse(me, "not-in-book", [lead]);
      if (rk === "supp" && x.suppUnread) return zoho("unexpected");
      if (isRequest) {
        /* G1: out or verified already → nothing to ask; asked already (a second press, or another IR) → `already`, no write.
           Both are decided before the row's Modified_Time, so a double press answers the same thing twice. */
        if (x.rounds[rk].sent || x.rounds[rk].ok) return refuse(me, "already-sent", [lead]);
        if (requestedOf(L, rk)) {
          return { ok: true, value: Object.freeze({ round: rk, beat, modifiedTime: L.Modified_Time as string, touchId: null, noteId: null, draftVersion: null,
            undoToken: null, undoUntil: 0, already: true }) };
        }
      }
      if (L.Modified_Time !== row.mod) return refuse(me, "lead-changed", [lead]);
      if (L.Lost_At) return refuse(me, "lead-lost", [lead]);
      const next = nextOf(L, x.done, x.rounds, rk);
      if (isRequest ? !requestOffered({ next, requested: null, sent: !!x.rounds[rk].sent, verified: !!x.rounds[rk].ok })
        : !beatsFor(next, x.rounds[rk]).includes(beat)) return refuse(me, !isRequest && next.who === "Finance" ? "finance-beat" : "out-of-order", [lead]);
      if (needsChannel && L[CONSENT[c.channel as Channel]] !== true) return refuse(me, "no-consent", [lead]);

      // ---- the draft file must be on this lead (uploaded through M12-S02 to its Attachments)
      let ref: string | null = null;
      if (hasFile) {
        let at: Awaited<ReturnType<typeof crm.getRelated>>;
        try { at = await crm.getRelated(cred, LEADS_MODULE, lead, "Attachments", { fields: ["id"], perPage: 200, signal }); } catch { return zoho("unexpected"); }
        if (!at.ok) return at.error.kind === "not-found" ? refuse(me, "draft-not-on-lead", [lead]) : zoho(at.error.kind);
        if (!at.value.records.some((r) => r.id === c.attachmentId)) return refuse(me, "draft-not-on-lead", [lead, c.attachmentId as string]);
        ref = `attachment:${c.attachmentId}`;
      } else if (hasLink) ref = (c.link as string).trim();

      // ---- what changes on the lead
      const f = fieldsOf(rk), now = zohoTime(clock()), meRef = { id: me };
      const fields: Record<string, ZohoFields[string]> = {};
      let draftVersion: number | null = null;
      switch (beat) {
        case "told": Object.assign(fields, { [f.toldVia]: CHANNEL_VALUE[c.channel as Channel], [f.toldAt]: now, [f.toldBy]: meRef }); break;
        case "chase": Object.assign(fields, { [f.chaseCount]: int(L[f.chaseCount]) + 1, [f.lastChaseAt]: now, [f.lastChaseVia]: CHANNEL_VALUE[c.channel as Channel] }); break;
        case "said": Object.assign(fields, { [f.saidAt]: now, [f.saidBy]: meRef }); break;
        case "draft": case "redraft":
          draftVersion = int(L[f.draftVersion!]) + 1;
          Object.assign(fields, { [f.draftVersion!]: draftVersion, [f.draftRef!]: ref, [f.draftAt!]: now, [f.draftBy!]: meRef });
          break;
        case "agreed":
          draftVersion = int(L[f.draftVersion!]) || null;
          Object.assign(fields, { [f.agreedAt!]: now, [f.agreedBy!]: meRef, [f.agreedVersion!]: draftVersion, [f.agreedRef!]: ref ?? str(L[f.draftRef!]) });
          break;
        case "request": Object.assign(fields, { [REQUEST_FIELDS[rk].at]: now, [REQUEST_FIELDS[rk].by]: meRef }); break;
      }
      const snapshot: Record<string, string | number | null | { id: string }> = {};
      for (const k of Object.keys(fields)) {
        const v = L[k];
        snapshot[k] = typeof v === "string" || typeof v === "number" ? v : idOf(v) ? { id: idOf(v)! } : null;
      }

      // ---- 1. the lead, guarded: a 412 means nothing was written
      let put: Awaited<ReturnType<typeof crm.update>>;
      try { put = await crm.update(cred, LEADS_MODULE, lead, fields, { ifUnmodifiedSince: row.mod, signal }); } catch { return zoho("unexpected"); }
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "lead-changed", [lead]) : zoho(put.error.kind);
      const leadModified = put.value.modifiedTime && DATETIME.test(put.value.modifiedTime) ? put.value.modifiedTime : null;

      // ---- 2. a reminder is also a contact: one Touch (D76) and one Note (the interaction)
      const created: { module: string; id: string }[] = [];
      let touchId: string | null = null, noteId: string | null = null;
      if (beat === "chase") {
        const insertOne = async (module: string, rowData: ZohoFields): Promise<string | null> => {
          try {
            const r = await crm.insert(cred, module, [rowData], { signal });
            const o = r.ok && r.value.length === 1 ? r.value[0] : null;
            if (!o || !o.ok || !validId(o.id)) return null;
            created.push({ module, id: o.id });
            return o.id;
          } catch { return null; }
        };
        const words = `${ROUND_TITLE[rk]} reminder by ${CHANNEL_VALUE[c.channel as Channel]}`;
        touchId = await insertOne("Touches", { Name: `${CHANNEL_VALUE[c.channel as Channel]} ${now}`, Lead: { id: lead },
          Channel: CHANNEL_VALUE[c.channel as Channel], Occurred_At: now, Is_Reply: false, Note: words });
        if (touchId) noteId = await insertOne("Notes", { Note_Title: words, Note_Content: `${words} — asked for the signed copy.`,
          Parent_Id: { module: { api_name: LEADS_MODULE }, id: lead } });
        if (!touchId || !noteId) {
          const left = await takeBack(cred, lead, created, leadModified ? { fields: snapshot as ZohoFields, modified: leadModified } : null, signal);
          if (left.length || !leadModified) return refuse(me, "partial", [lead, ...left]);
          return zoho("unexpected");
        }
      }
      try { log.event?.({ at: clock(), actor: { kind: "user", userId: me }, action: "lead-paperwork", reason: `${rk}-${beat}`, recordIds: [lead, ...created.map((x) => x.id)] }); } catch { /* never blocks */ }
      const undoUntil = clock() + PAPER_UNDO_MS;
      const undoToken = sign({ v: 1, k: "undo", actor: me, session: principal.sessionId, lead, round: rk, beat, exp: undoUntil,
        leadModified: leadModified ?? "", snapshot, created });
      return { ok: true, value: Object.freeze({ round: rk, beat, modifiedTime: leadModified, touchId, noteId, draftVersion, undoToken, undoUntil }) };
    },

    /** Undo within 10 seconds: the round fields back (only if nobody touched the lead since), then what the step made. */
    async undo(principal: Principal, token: string, signal?: AbortSignal): Promise<PaperworkResult<{ readonly undone: true; readonly round: RoundKey; readonly beat: IrBeat }>> {
      if (!principalOk(principal)) return refuse("unrecognised", "invalid-request");
      const me = principal.credential.userId;
      const u = verify<UndoClaims>(token, "undo");
      if (!u || u.actor !== me || u.session !== principal.sessionId || !validId(u.lead) || !isRound(u.round)) return refuse(me, "undo-invalid");
      if (clock() > u.exp) return refuse(me, "undo-expired", [u.lead]);
      const a = await recheck(principal, signal);
      if (!("actor" in a)) return a;
      if (!u.leadModified) return refuse(me, "lead-changed", [u.lead]);
      let put: Awaited<ReturnType<typeof crm.update>>;
      try { put = await crm.update(principal.credential, LEADS_MODULE, u.lead, { ...u.snapshot } as ZohoFields, { ifUnmodifiedSince: u.leadModified, signal }); }
      catch { return zoho("unexpected"); }
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "lead-changed", [u.lead]) : zoho(put.error.kind);
      const created = (u.created ?? []).filter((x) => (x.module === "Touches" || x.module === "Notes") && validId(x.id));
      const left = await takeBack(principal.credential, u.lead, created, null, signal);
      if (left.length) return refuse(me, "partial", [u.lead, ...left]);
      try { log.event?.({ at: clock(), actor: { kind: "user", userId: me }, action: "lead-paperwork", reason: `${u.round}-${u.beat}-undone`, recordIds: [u.lead] }); } catch { /* never blocks */ }
      return { ok: true, value: Object.freeze({ undone: true as const, round: u.round, beat: u.beat }) };
    },
  });
}
export type Paperwork = ReturnType<typeof createPaperwork>;
