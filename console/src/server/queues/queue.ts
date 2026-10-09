/**
 * M05-S07-T01/T03 and M05-S08-T01 — "WAITING ON YOU", THE INVESTORS SIDE OF TODAY, PER SEAT (D12, D21, D40, D45, D53).
 *
 * One read builds the seat's queue from the readers that already exist, each on the signed-in person's own token:
 *
 *   money seats ("pay")   open IR payment claims across the org     ../money/claim-answer waiting()  (Receipts, Match_State = Claimed)
 *                         + the investor of each claim               one COQL on the claims' allotments (AM projection: no money)
 *                         reservations ending within 21 days         ../holds/holds list()
 *   paper seats ("doc")   papers out for signature / back to verify  ../documents/list read("out")
 *   the KYC owner ("kyc") KYC not passed, FEMA declaration outstanding  COQL on Contacts (status fields only) on a live allotment
 *   viewers               nothing — "read-only seat"
 *   KAM / Head of AM      the care queue (./rules careRows) from ../investors/book list() and Touches, plus the tiles
 *                         (gone quiet, accounts held, tickets open on you from ../cases/register, conversations logged)
 *
 * Which rows a seat gets is the front end's mineQueue (claim/hold → pay, send/verify → doc, kyc/fema → kyc; an AM
 * seat → careQueue); the capabilities come from the seat (./runtime), never from the request. The readers run one
 * after another (one Zoho call in flight per read — inside the per-user sub-concurrency budget). A reader that fails
 * leaves its rows out and names itself in `problems` (codes only); the rest of the queue is still served.
 * Nothing is cached (rows live for one response, D45) — so a row that is done is gone on the next read. The AM side
 * carries no money field at all; the money side carries no amount either (the row words need none). Logs: ids/codes.
 */
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { ImCan } from "../../lib/im/types";
import { idOf, inClause, IN_CHUNK, istStamp, pagedSelect, str } from "../cases/predicate";
import type { CasesRegister } from "../cases/register";
import { amScopeOf } from "../data/am-scope";
import { checkAmProjection, MODULES } from "../data/projections";
import { FINANCE_CONTACT_FIELDS } from "../investors/finance-list";
import { scopesFor } from "../data/scope";
import { SIGN_CLOSED, type DocumentsList } from "../documents/list";
import type { Holds } from "../holds/holds";
import { daysLeft } from "../holds/rules";
import type { KamBookService } from "../investors/book";
import type { ClaimAnswers } from "../money/claim-answer";
import {
  careRows, claimText, femaText, goneQuiet, overdueDays, holdText, isReadOnly, kycText, remindText, REMIND_AFTER_DAYS, sortQueue, tierFor, verifyText,
  sendText, REQUESTS_NO_FIELDS_TEXT, REQUESTS_PARTIAL_TEXT, REQUESTS_UNREAD_TEXT,
  type CareAccount, type CareRow, type MoneyRow, type Tier,
} from "./rules";
import { coqlAll } from "../../lib/zoho/coql";

export const TOUCHES_MODULE = "Touches";
const TOUCH_FIELDS = Object.freeze(["id", "Lead", "Occurred_At", "Owner", "Mood"]);
/** The claim's investor: allotment → Customer, never a price or an amount (the AM projection's wall). */
const CLAIM_ALLOT_FIELDS = checkAmProjection(MODULES.amAllotments, ["id", "Customer", "Customer.Full_Name", "Allocation_Status"]);
const LIVE_ALLOT_FIELDS = checkAmProjection(MODULES.amAllotments, ["id", "Customer", "Allocation_Status"]);
/** Status fields only (finance-list.ts FINANCE_CONTACT_FIELDS): never PAN, bank or Aadhaar. */
const KYC_FIELDS: readonly string[] = (() => {
  const f = ["id", "First_Name", "Last_Name", "KYC", "FEMA_Applicable", "FEMA_Verified_At"];
  const off = f.filter((x) => !FINANCE_CONTACT_FIELDS.includes(x));
  if (off.length) throw new TypeError(`The KYC queue selects only Finance's status fields (${off.join(", ")}) — D52/D53.`);
  return Object.freeze(f);
})();
/* G1 (D136 proposed): the IRs' "ask Finance to send it" (Leads.*_Requested_At / _Requested_By, written by server/leads/paperwork). */
export const LEADS_MODULE = "Leads";
const NDA_REQUEST_FIELDS = Object.freeze(["id", "First_Name", "Last_Name", "NDA_Requested_At", "NDA_Requested_By", "NDA_Sign_Req_Id", "NDA_Verified_At"]);
const SUPP_REQUEST_FIELDS = Object.freeze(["id", "First_Name", "Last_Name", "Supp_Requested_At", "Owner"]);   // the requester is the lead's Owner: Leads has no room for a Supp_Requested_By user lookup
const NDA_REQUEST_WHERE = coqlAll(["NDA_Requested_At is not null", "NDA_Sign_Req_Id is null", "NDA_Verified_At is null", "Lost_At is null"]);
const SUPP_REQUEST_WHERE = coqlAll(["Supp_Requested_At is not null", "Lost_At is null"]);
const KYC_WHERE ="(KYC not in ('Completed', 'NA') or KYC is null) or (FEMA_Applicable = true and FEMA_Verified_At is null)";

export interface QueuePrincipal {
  readonly credential: UserCredential;
  readonly sessionId: string;
  readonly seat: string;
  /** The seat's Investors-side capabilities, decided by the server from the live session (./runtime). */
  readonly can: (c: ImCan) => boolean;
}
export interface QueueDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly log: OpsLog;
  readonly holds: Pick<Holds, "list">;
  readonly claims: Pick<ClaimAnswers, "waiting"> | null;
  readonly documents: Pick<DocumentsList, "read">;
  readonly cases: Pick<CasesRegister, "list">;
  readonly amBook: Pick<KamBookService, "list">;
  readonly clock?: () => number;
  readonly maxPages?: number;
  /** G1: Digital Infrastructure has confirmed the Finance sharing rule on Leads (GZ_FINANCE_LEADS_SHARED=1). Until then the
   *  queue says that requests on leads not shared with Finance cannot be listed (Zoho returns them as absent, not refused). */
  readonly financeLeadsShared?: boolean;
}

export interface MoneyQueue {
  readonly side: "money";
  readonly readOnly: boolean;
  readonly rows: readonly MoneyRow[];
  readonly waiting: number;
  readonly today: number;
  readonly problems: readonly string[];
  readonly asOf: number;
  /** G1: why the IRs' "send it" requests may be missing from the rows (unread, or the Leads sharing rule not confirmed); null: complete. */
  readonly requestsNote?: string | null;
}
export interface AmAccount {
  readonly id: string;
  readonly name: string;
  readonly tier: Tier["k"];
  readonly kamUserId: string | null;
  readonly lastHeardAt: string | null;
  readonly lastMood: string | null;
  /** days past the cadence (negative: days until the next conversation) */
  readonly overdue: number | null;
}
export interface AmTicket { readonly id: string; readonly number: string | null; readonly investorId: string; readonly subject: string; readonly priority: "high" | "normal"; readonly sla: string }
export interface AmToday {
  readonly side: "am";
  readonly readOnly: false;
  /** "kam": this person's own accounts; "head": the whole book (allotted accounts and the pool). */
  readonly book: "kam" | "head";
  readonly rows: readonly CareRow[];
  readonly waiting: number;
  readonly today: number;
  readonly tiles: { readonly goneQuiet: number; readonly accountsHeld: number; readonly ticketsOpenOnYou: number | null; readonly conversationsLogged: number | null };
  readonly accounts: readonly AmAccount[];
  readonly tickets: readonly AmTicket[];
  readonly problems: readonly string[];
  readonly asOf: number;
}
export type QueueResult =
  | { readonly ok: true; readonly queue: MoneyQueue | AmToday }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "invalid-request" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "unexpected";

export function createInvestorQueues(deps: QueueDeps) {
  const clock = deps.clock ?? Date.now;
  const refuse = (me: string, reason: "no-book" | "invalid-request"): QueueResult => {
    deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "queue-read", reason, recordIds: [] });
    return { ok: false, kind: "refused", reason };
  };

  /** Rows of `fields` from `module` whose `field` is one of `ids`, ≤100 per IN (COQL). */
  async function byIds(cred: UserCredential, module: string, fields: readonly string[], field: string, ids: readonly string[], extra: string | null, signal?: AbortSignal) {
    const rows: ZohoRecord[] = [];
    let truncated = false;
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const inc = inClause(field, ids.slice(i, i + IN_CHUNK));
      if (!inc) continue;
      const r = await pagedSelect(deps.crm, cred, fields, module, extra ? `${inc} and ${extra}` : inc, "id asc", signal, deps.maxPages);
      if (!r.ok) return r;
      truncated ||= r.truncated;
      rows.push(...r.rows);
    }
    return { ok: true as const, rows, truncated };
  }

  /* ------------------------------------------------ money side ------------------------------------------------ */
  async function money(p: QueuePrincipal, signal?: AbortSignal): Promise<MoneyQueue> {
    const now = clock();
    if (isReadOnly(p.can)) return Object.freeze({ side: "money", readOnly: true, rows: [], waiting: 0, today: 0, problems: [], asOf: now });
    const cred = p.credential;
    const claimRows: MoneyRow[] = [], out: MoneyRow[] = [], problems: string[] = [];
    let requestsNote: string | null = null;
    const failed = (src: string, k: string) => problems.push(`${src}:${k}`);

    if (p.can("pay")) {
      // T03: the IRs' payment claims, across the org, answered in ../money/claim-answer (not here).
      if (!deps.claims) failed("claims", "not-configured");
      else {
        const c = await deps.claims.waiting({ credential: cred, sessionId: p.sessionId }, signal);
        if (!c.ok) failed("claims", c.kind === "refused" ? c.reasonCode : c.kind === "source-error" ? c.errorKind : c.kind);
        else if (c.value.claims.length) {
          const a = await byIds(cred, MODULES.amAllotments, CLAIM_ALLOT_FIELDS, "id", [...new Set(c.value.claims.map((x) => x.allotmentId))], null, signal);
          if (!a.ok) failed("claims", a.kind === "refused" ? a.reason : a.errorKind);
          else {
            const byId = new Map(a.rows.map((r) => [r.id, r]));
            for (const x of c.value.claims) {
              const al = byId.get(x.allotmentId);
              const inv = al ? idOf(al.Customer) : null;
              if (!al || !inv || str(al, "Allocation_Status", 20) === "Cancelled") continue; // a lapsed holding is off the queue
              claimRows.push(Object.freeze({ key: `claim:${x.claimId}`, kind: "claim", investor: Object.freeze({ id: inv, name: str(al, "Customer.Full_Name", 120) }),
                text: claimText, urg: "now", days: null, action: "Answer it", ref: Object.freeze({ claimId: x.claimId, allotmentId: x.allotmentId }) }));
            }
          }
        }
      }
      const h = await deps.holds.list({ credential: cred, seat: p.seat }, signal);
      if (!h.ok) failed("holds", h.kind === "refused" ? h.reason : h.errorKind);
      else for (const x of h.holds) {
        const t = holdText(x.daysLeft);
        out.push(Object.freeze({ key: `hold:${x.allotmentId}`, kind: "hold", investor: Object.freeze({ id: x.investor.id, name: x.investor.name }),
          text: t.text, urg: t.urg, days: x.daysLeft, action: "Open the record", ref: Object.freeze({ allotmentId: x.allotmentId }) }));
      }
    }

    if (p.can("doc")) {
      const d = await deps.documents.read(cred, p.seat, "out", signal);
      if (!d.ok) failed("documents", d.kind === "refused" ? d.reason : d.errorKind);
      else {
      // "Remind" rows oldest-first (most days out first; no sent time from Zoho Sign last), after the Verify rows.
      const reminds: { row: MoneyRow; days: number | null }[] = [];
      for (const r of d.page.rows) {
        if (!r.contactId || r.state === "verified") continue;
        const who = Object.freeze({ id: r.contactId, name: r.party });
        const ref = Object.freeze({ paper: r.paper, recordId: r.recordId });
        if (r.state === "signed") {
          out.push(Object.freeze({ key: `verify:${r.key}`, kind: "verify", investor: who, text: verifyText(r.label), urg: "now", days: null, action: "Verify it", ref }));
          continue;
        }
        if (r.sign && SIGN_CLOSED.test(r.sign.status)) continue; // declined / recalled / expired: nothing to remind (a new request is sent from Documents)
        const sent = r.sign?.sentAt ? istStamp(r.sign.sentAt) : null;
        const days = sent ? -daysLeft(sent.slice(0, 10), clock()) : null;
        if (days !== null && days < REMIND_AFTER_DAYS) continue;
        reminds.push({ days, row: Object.freeze({ key: `remind:${r.key}`, kind: "remind", investor: who, text: remindText(r.label, days), urg: "soon", days, action: "Remind", ref }) });
      }
      reminds.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
      for (const x of reminds) out.push(x.row);
      }
      // G1: the IRs' "ask Finance to send it" — NDA and supplementary rounds asked for and not yet out.
      const sr = await sendRequests(cred, now, signal);
      out.push(...sr.rows);
      problems.push(...sr.problems);
      requestsNote = sr.note;
    }

    if (p.can("kyc")) {
      const k = await pagedSelect(deps.crm, cred, KYC_FIELDS, MODULES.contacts, KYC_WHERE, "id asc", signal, deps.maxPages);
      if (!k.ok) failed("kyc", k.kind === "refused" ? k.reason : k.errorKind);
      else {
        if (k.truncated) failed("kyc", "truncated");
        const ids = k.rows.map((r) => idOf(r.id)).filter((x): x is string => !!x);
        const live = ids.length ? await byIds(cred, MODULES.amAllotments, LIVE_ALLOT_FIELDS, "Customer", ids, "Allocation_Status != 'Cancelled'", signal)
          : { ok: true as const, rows: [], truncated: false };
        if (!live.ok) failed("kyc", live.kind === "refused" ? live.reason : live.errorKind);
        else {
          const held = new Set(live.rows.map((r) => idOf(r.Customer)).filter(Boolean));
          for (const c of k.rows) {
            if (!idOf(c.id) || !held.has(c.id)) continue;
            const who = Object.freeze({ id: c.id, name: [str(c, "First_Name", 60), str(c, "Last_Name", 80)].filter(Boolean).join(" ") || null });
            const kyc = str(c, "KYC", 40);
            if (kyc !== "Completed" && kyc !== "NA") {
              out.push(Object.freeze({ key: `kyc:${c.id}`, kind: "kyc", investor: who, text: kycText(kyc === "Failed" ? "failed" : "pending"), urg: "now", days: null, action: "Check it", ref: Object.freeze({ recordId: c.id }) }));
            }
            if (c.FEMA_Applicable === true && !str(c, "FEMA_Verified_At", 40)) {
              out.push(Object.freeze({ key: `fema:${c.id}`, kind: "fema", investor: who, text: femaText, urg: "now", days: null, action: "Open the record", ref: Object.freeze({ recordId: c.id }) }));
            }
          }
        }
      }
    }

    // finQueue: the per-investor rows, then the claims, sorted now → soon (stable).
    const rows = Object.freeze(sortQueue([...out, ...claimRows]));
    return Object.freeze({ side: "money", readOnly: false, rows, waiting: rows.length, today: rows.filter((r) => r.urg === "now").length,
      problems: Object.freeze(problems), asOf: now, ...(p.can("doc") ? { requestsNote } : {}) });
  }

  /* ------------------------------------- G1: the IRs' "send it" requests ------------------------------------- */
  /** One Leads select; with the requester's name through the user lookup when Zoho takes the column, else without it. */
  async function requestedLeads(cred: UserCredential, fields: readonly string[], byField: string, where: string, signal?: AbortSignal) {
    const named = await pagedSelect(deps.crm, cred, [...fields, `${byField}.full_name`], LEADS_MODULE, where, "id asc", signal, deps.maxPages);
    if (named.ok || named.kind !== "source-error" || named.errorKind !== "invalid-data") return named;
    return pagedSelect(deps.crm, cred, fields, LEADS_MODULE, where, "id asc", signal, deps.maxPages);
  }
  const daysSince = (at: string | null, now: number): number | null => {
    const s = istStamp(at);
    return s ? 0 - daysLeft(s.slice(0, 10), now) : null;   // 0 - x: today is 0, never -0
  };
  const byName = (r: ZohoRecord, f: string): string | null => {
    const n = str(r, `${f}.full_name`, 80);
    if (n) return n;
    const v = r[f] && typeof r[f] === "object" ? (r[f] as { name?: unknown }).name : undefined;
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null;
  };
  const leadName = (r: ZohoRecord): string | null => [str(r, "First_Name", 60), str(r, "Last_Name", 80)].filter(Boolean).join(" ") || null;

  async function sendRequests(cred: UserCredential, now: number, signal?: AbortSignal): Promise<{ rows: MoneyRow[]; problems: string[]; note: string | null }> {
    const rows: MoneyRow[] = [], problems: string[] = [];
    let unread: string | null = null;
    const failedOn = (k: string) => { problems.push(`send-requests:${k}`); unread ??= k === "invalid-data" ? REQUESTS_NO_FIELDS_TEXT : REQUESTS_UNREAD_TEXT; };

    // NDA: asked for, not sent (no Zoho Sign request on the Lead), not verified, lead not lost.
    const nda = await requestedLeads(cred, NDA_REQUEST_FIELDS, "NDA_Requested_By", NDA_REQUEST_WHERE, signal);
    if (!nda.ok) failedOn(nda.kind === "refused" ? nda.reason : nda.errorKind);
    else {
      if (nda.truncated) problems.push("send-requests:truncated");
      for (const r of nda.rows) {
        if (!idOf(r.id) || str(r, "NDA_Sign_Req_Id", 40) || str(r, "NDA_Verified_At", 40)) continue;
        const at = str(r, "NDA_Requested_At", 40), days = daysSince(at, now);
        rows.push(Object.freeze({ key: `send:nda:${r.id}`, kind: "send", investor: Object.freeze({ id: r.id, name: leadName(r) }),
          text: sendText("nda", byName(r, "NDA_Requested_By"), days), urg: "now", days, action: "Send it",
          ref: Object.freeze({ leadId: r.id, paper: "nda" }) }));
      }
    }

    // Supplementary: asked for on the Lead; it is sent on the investor's allotment, so a live allotment carrying a Sign request
    // (or a verified copy) means it is out. A read that cannot say is a problem, never a row and never a silent "nothing".
    const sp = await requestedLeads(cred, SUPP_REQUEST_FIELDS, "Owner", SUPP_REQUEST_WHERE, signal);
    if (!sp.ok) failedOn(sp.kind === "refused" ? sp.reason : sp.errorKind);
    else if (sp.rows.length) {
      if (sp.truncated) problems.push("send-requests:truncated");
      const leadIds = sp.rows.map((r) => idOf(r.id)).filter((x): x is string => !!x);
      const c = await byIds(cred, MODULES.contacts, ["id", "Origin_Lead", "First_Name", "Last_Name"], "Origin_Lead", leadIds, null, signal);
      if (!c.ok) failedOn(c.kind === "refused" ? c.reason : c.errorKind);
      else {
        const contactOf = new Map<string, ZohoRecord>();
        for (const x of c.rows) { const l = idOf(x.Origin_Lead); if (l && idOf(x.id) && !contactOf.has(l)) contactOf.set(l, x); }
        const cids = [...contactOf.values()].map((x) => x.id);
        const a = cids.length ? await byIds(cred, MODULES.amAllotments, ["id", "Customer", "Supplementary_Sign_Req_Id", "Supplementary_Verified_At"], "Customer", cids,
          "Allocation_Status != 'Cancelled'", signal) : { ok: true as const, rows: [] as ZohoRecord[], truncated: false };
        if (!a.ok) failedOn(a.kind === "refused" ? a.reason : a.errorKind);
        else {
          const out = new Set(a.rows.filter((x) => str(x, "Supplementary_Sign_Req_Id", 40) || str(x, "Supplementary_Verified_At", 40))
            .map((x) => idOf(x.Customer)).filter(Boolean));
          for (const r of sp.rows) {
            if (!idOf(r.id)) continue;
            const ct = contactOf.get(r.id) ?? null;
            if (ct && out.has(ct.id)) continue;
            const at = str(r, "Supp_Requested_At", 40), days = daysSince(at, now);
            rows.push(Object.freeze({ key: `send:supp:${r.id}`, kind: "send",
              investor: Object.freeze({ id: ct ? ct.id : r.id, name: (ct && leadName(ct)) || leadName(r) }),
              text: sendText("supplementary", byName(r, "Owner"), days), urg: "now", days, action: "Send it",
              ref: Object.freeze({ leadId: r.id, ...(ct ? { contactId: ct.id } : {}), paper: "supplementary" }) }));
          }
        }
      }
    }
    // Oldest request first.
    rows.sort((x, y) => (y.days ?? -1) - (x.days ?? -1));
    return { rows, problems, note: unread ?? (deps.financeLeadsShared ? null : REQUESTS_PARTIAL_TEXT) };
  }

  /* ------------------------------------------------- AM side ------------------------------------------------- */
  async function am(p: QueuePrincipal, kind: "kam" | "head", signal?: AbortSignal): Promise<QueueResult> {
    const me = p.credential.userId, now = clock(), problems: string[] = [];
    const b = await deps.amBook.list({ credential: p.credential, sessionId: p.sessionId }, signal);
    if (!b.ok) return b.kind === "refused" ? refuse(me, "no-book") : { ok: false, kind: "source-error", errorKind: b.errorKind, retryable: b.retryable };
    const book = kind === "kam" ? b.value.filter((e) => e.kamUserId === me) : b.value;

    // The last conversation per account and this person's conversations: Touches hang off the account's origin Lead.
    const leads = [...new Set(book.map((e) => e.originLeadId).filter((x): x is string => !!x))];
    const last = new Map<string, { at: string; mood: string | null }>();
    // "Last heard" is the KAM's own logged conversations: a touch counts only when its owner is the account's KAM (a lead-side IR touch is not one).
    const kamOfLead = new Map<string, string | null>();
    for (const e of book) if (e.originLeadId && !kamOfLead.has(e.originLeadId)) kamOfLead.set(e.originLeadId, e.kamUserId);
    let logged: number | null = 0;
    const t = leads.length ? await byIds(p.credential, TOUCHES_MODULE, TOUCH_FIELDS, "Lead", leads, null, signal) : { ok: true as const, rows: [], truncated: false };
    if (!t.ok) { problems.push(`touches:${t.kind === "refused" ? t.reason : t.errorKind}`); logged = null; }
    else {
      if (t.truncated) problems.push("touches:truncated");
      for (const r of t.rows) {
        const lead = idOf(r.Lead), at = str(r, "Occurred_At", 40);
        if (!lead || !at || !Number.isFinite(Date.parse(at))) continue;
        if (idOf(r.Owner) === me) logged!++;
        if (!kamOfLead.get(lead) || idOf(r.Owner) !== kamOfLead.get(lead)) continue;
        const prev = last.get(lead);
        if (!prev || Date.parse(at) > Date.parse(prev.at)) last.set(lead, { at, mood: str(r, "Mood", 20) });
      }
    }

    const accounts: CareAccount[] = book.map((e) => ({
      id: e.id, code: e.investorCode, name: [e.firstName, e.lastName].filter(Boolean).join(" "), units: e.issuedUnits, kamUserId: e.kamUserId,
      introducedAt: e.introductionAt, since: e.kamSince ?? e.saidYesAt, lastHeardAt: e.originLeadId ? last.get(e.originLeadId)?.at ?? null : null,
    }));
    const rows = Object.freeze(careRows(accounts, now, { kamOnly: kind === "kam" ? me : null, mayAssign: p.can("assign") }));

    let tickets: AmTicket[] | null = [];
    const c = await deps.cases.list({ credential: p.credential, seat: p.seat }, signal);
    if (!c.ok) { problems.push(`cases:${c.kind === "refused" ? c.reason : c.errorKind}`); tickets = null; }
    else {
      if (c.truncated) problems.push("cases:truncated");
      tickets = c.rows.filter((x) => x.own === me && x.state !== "closed").map((x) => Object.freeze({
        id: x.id, number: x.number, investorId: x.inv, subject: x.t, priority: x.pri, sla: x.sla }));
    }

    const queue: AmToday = Object.freeze({
      side: "am", readOnly: false, book: kind, rows, waiting: rows.length, today: rows.filter((r) => r.urg === "now").length,
      tiles: Object.freeze({
        goneQuiet: accounts.filter((a) => goneQuiet(a, now)).length,
        accountsHeld: accounts.length,
        ticketsOpenOnYou: tickets ? tickets.length : null,
        conversationsLogged: logged,
      }),
      accounts: Object.freeze(accounts.map((a) => {
        const e = book.find((x) => x.id === a.id)!;
        const l = e.originLeadId ? last.get(e.originLeadId) : undefined;
        return Object.freeze({ id: a.id, name: a.name, tier: tierFor(a.units).k, kamUserId: a.kamUserId, lastHeardAt: l ? istStamp(l.at) : null,
          lastMood: l?.mood ?? null, overdue: overdueDays(a, now) });
      })),
      tickets: Object.freeze(tickets ?? []),
      problems: Object.freeze(problems), asOf: now,
    });
    return { ok: true, queue };
  }

  return Object.freeze({
    /** The Investors side of Today for the signed-in seat: an AM seat's care day, or everyone else's "Waiting on you". */
    async today(p: QueuePrincipal, signal?: AbortSignal): Promise<QueueResult> {
      if (!p || !p.credential || typeof p.seat !== "string" || typeof p.can !== "function") return refuse("unrecognised", "invalid-request");
      const me = p.credential.userId;
      const amScope = amScopeOf(p.seat, me);
      if (amScope) return am(p, amScope.kind === "kam" ? "kam" : "head", signal);
      const inv = scopesFor(p.seat, me).investors;
      if (inv.kind !== "org" && inv.kind !== "all") return refuse(me, "no-book");
      try { return { ok: true, queue: await money(p, signal) }; }
      catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: retryable("unexpected") }; }
    },
  });
}
export type InvestorQueues = ReturnType<typeof createInvestorQueues>;

