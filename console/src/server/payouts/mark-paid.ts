/**
 * M10-S20-T02 — FINANCE MARKS A PAYOUT PAID (D45, D53, D82, D84): one guarded write to Investor_Payouts on the
 * person's own token — Payout_State Paid, Paid_On, Payout_Mode, Payout_UTR, Paid_By (the token user),
 * TDS_Amount as Finance typed it (default 0; never computed) and Net_Amount = Gross_Amount − TDS_Amount.
 *
 * The front end's gate (lib/im/money markPaidGate), asked of live Zoho:
 *   - only the "pay" capability (./authority; a fresh check on the live session);
 *   - a payout is paid once: already Paid → refused, naming when (a lost reply to the same press, same UTR,
 *     is answered as that success instead); Cancelled → refused;
 *   - the bank UTR is required, and one transfer pays one payout (a UTR already on another payout is refused);
 *   - 0 ≤ TDS ≤ gross, whole rupees; the paid-on date is a real day and not in the future (IST).
 * The double-press guard: one Idempotency-Key per press; a second press with the same key joins the first and
 * gets its answer (held ten minutes, ids only); the same key with a different payment is refused. The key is
 * claimed in SharedState (../state/idempotent), so a second press landing on another instance joins too; the
 * stored answer carries no UTR (it is re-masked from the replayed press). One payout is marked by one press at
 * a time, across instances (a claim on the payout id).
 * The write carries If-Unmodified-Since (the Modified_Time the screen loaded, else the one just read):
 * someone else's change in between is a 409, never an overwrite.
 * The UTR is never logged and comes back masked ("••••1234"). Logs carry the payout id and a code.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { PAYOUT_MODES, payoutNet } from "../../lib/im/money";
import { dayOf, lookupId, numOf, PAYOUTS_MODULE } from "./schedule";
import { maskUtr } from "./queue";
import { createMemoryState } from "../state/memory";
import { createIdempotency } from "../state/idempotent";
import type { SharedState } from "../state/shared-state";

export const MARK_PAID_TTL_MS = 10 * 60 * 1_000;
/** How long one press may hold a payout (a crashed instance's lock frees itself). */
const PAYOUT_LOCK_S = 120;
const RECORD_ID = /^\d{15,22}$/;
const OPAQUE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const UTR = /^[A-Z0-9][A-Z0-9._/-]{2,39}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZOHO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;
export const READ_FIELDS = Object.freeze(["id", "Allotment", "Payout_State", "Gross_Amount", "Payout_UTR", "Paid_On", "Modified_Time"]);

export const MARK_PAID_TEXT: Readonly<Record<string, string>> = Object.freeze({
  "read-only": "Read only — the Head of Finance and Finance Operations mark payouts paid.",
  "invalid-request": "Not saved yet — reload the page and try again.",
  "idempotency-key-invalid": "Not saved yet — reload the page and try again.",
  "idempotency-key-reused": "Not saved yet — this press was already used for a different payment. Reload and mark it again.",
  "utr-required": "A payout is marked paid with the bank's UTR, so the statement can be matched to it.",
  fields: "Not saved yet — check the payment details.",
  "tds-out-of-range": "TDS has to be between ₹0 and the gross amount. The console never works it out — type what was deducted.",
  "paid-on-future": "The paid-on date cannot be in the future.",
  "not-visible": "Not saved yet — this payout is not available to you.",
  "already-paid": "This payout was already marked paid. Nothing was changed — a payout is paid once.",
  cancelled: "This payout is cancelled. A cancelled payout is not paid.",
  "utr-reused": "That UTR is already on another payout. One bank transfer pays one payout.",
  changed: "Not saved yet — the payout changed while you were entering this. Reload and try again.",
  busy: "Not saved yet — the console is busy. Try again in a minute.",
  "source-invalid": "Not saved yet — Zoho returned something the console cannot read. Digital Infrastructure has been told.",
});
const RETRY_SAME_KEY = "Not saved yet — Zoho has not confirmed it. Press again; it will not be recorded twice.";
const istDate = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

export interface PaidPayout {
  readonly payoutId: string;
  readonly allotmentId: string | null;
  readonly state: "Paid";
  readonly paidOn: string;
  readonly mode: string;
  readonly utrMasked: string;
  readonly gross: number;
  readonly tds: number;
  readonly net: number;
  readonly paidBy: string;
  readonly modifiedTime: string | null;
  readonly duplicate: boolean;
}
type Fail =
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: string; readonly message: string; readonly retryable: false; readonly paidOn?: string | null }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly message: string; readonly retryable: boolean }
  | { readonly ok: false; readonly kind: "unknown-outcome"; readonly message: string; readonly retryable: true };
export type MarkPaidResult = { readonly ok: true; readonly value: PaidPayout } | Fail;

export interface MarkPaidDeps {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "update">;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  /** Fresh check on the live session: does the seat hold "pay"? (./authority pay) */
  readonly mayPay: (cred: UserCredential, signal?: AbortSignal) => Promise<boolean>;
  readonly clock?: () => number;
  /** Where the double-press guard lives (runtime: sharedState()); default an in-process store. */
  readonly state?: SharedState;
}

interface Intent { readonly payoutId: string; readonly paidOn: string; readonly mode: string; readonly utr: string; readonly tds: number; readonly modifiedTime: string | null }

export function createMarkPaid(deps: MarkPaidDeps) {
  if (!deps || typeof deps.crm?.update !== "function" || typeof deps.mayPay !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string") throw new TypeError("Marking a payout paid needs the Zoho client, the pay check, the ops log and the record-id prefix.");
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const valid = (id: unknown): id is string => typeof id === "string" && RECORD_ID.test(id) && id.startsWith(deps.recordIdPrefix);
  const state = deps.state ?? createMemoryState({ clock });
  const isBusy = (r: MarkPaidResult) => !r.ok && r.kind === "refused" && r.reasonCode === "busy";
  const presses = createIdempotency<MarkPaidResult>({
    state, ns: "mark-paid", ttlSeconds: MARK_PAID_TTL_MS / 1_000, clock,
    // Only a confirmed answer is held; anything retryable (or "busy") may be pressed again with the same key.
    keep: (r) => r.ok || (!r.retryable && !isBusy(r)),
    save: (r) => JSON.stringify(r.ok ? { ...r, value: { ...r.value, utrMasked: "" } } : r),
    load: (s) => { try { return JSON.parse(s) as MarkPaidResult; } catch { return null; } },
  });

  const at = () => { try { return clock(); } catch { return 0; } };
  const refuse = (me: string, code: string, ids: readonly unknown[] = [], extra: { paidOn?: string | null } = {}): Fail => {
    log.refusal({ at: at(), actor: { kind: "user", userId: me }, action: "payout-mark-paid", reason: code, recordIds: ids.filter(valid) });
    return { ok: false, kind: "refused", reasonCode: code, message: MARK_PAID_TEXT[code] ?? "Not saved yet — try again.", retryable: false, ...extra };
  };
  const done = (me: string, id: string, code: string) => log.event?.({ at: at(), actor: { kind: "user", userId: me }, action: "payout-mark-paid", reason: code, recordIds: [id] });

  function parse(me: string, body: unknown): Intent | Fail {
    const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (!b || !valid(b.payoutId)) return refuse(me, "invalid-request");
    const utr = typeof b.utr === "string" ? b.utr.replace(/\s+/g, "").toUpperCase() : "";
    if (!utr) return refuse(me, "utr-required", [b.payoutId]);
    if (!UTR.test(utr)) return refuse(me, "fields", [b.payoutId]);
    const mode = typeof b.mode === "string" ? b.mode : "";
    if (!(PAYOUT_MODES as readonly string[]).includes(mode)) return refuse(me, "fields", [b.payoutId]);
    const today = istDate(at());
    const day = b.paidOn === undefined || b.paidOn === null || b.paidOn === "" ? today : b.paidOn;
    if (typeof day !== "string" || !ISO_DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))
      || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return refuse(me, "fields", [b.payoutId]);
    if (day > today) return refuse(me, "paid-on-future", [b.payoutId]);
    let tds = 0;
    if (b.tds !== undefined && b.tds !== null && b.tds !== "") {
      const n = typeof b.tds === "number" ? b.tds : typeof b.tds === "string" && /^\d{1,12}$/.test(b.tds.trim()) ? Number(b.tds) : NaN;
      if (!Number.isSafeInteger(n) || n < 0) return refuse(me, "tds-out-of-range", [b.payoutId]);
      tds = n;
    }
    const mt = b.modifiedTime;
    if (mt !== undefined && mt !== null && (typeof mt !== "string" || !ZOHO_DATETIME.test(mt))) return refuse(me, "invalid-request", [b.payoutId]);
    return { payoutId: b.payoutId, paidOn: day, mode, utr, tds, modifiedTime: (mt as string | null | undefined) ?? null };
  }

  type Read = { readonly rec: ZohoRecord } | { readonly rec: null; readonly errorKind: string | null };
  const read = async (cred: UserCredential, id: string, signal?: AbortSignal): Promise<Read> => {
    try {
      const r = await crm.getRecord(cred, PAYOUTS_MODULE, id, { fields: READ_FIELDS, signal });
      if (!r.ok) return { rec: null, errorKind: r.error.kind === "not-found" || r.error.kind === "forbidden" ? null : r.error.kind };
      return r.value ? { rec: r.value } : { rec: null, errorKind: null };
    } catch { return { rec: null, errorKind: "unexpected" }; }
  };
  const paidValue = (me: string, i: Intent, r: ZohoRecord, gross: number, duplicate: boolean, modifiedTime: string | null): PaidPayout => Object.freeze({
    payoutId: i.payoutId, allotmentId: lookupId(r.Allotment), state: "Paid" as const, paidOn: i.paidOn, mode: i.mode,
    utrMasked: maskUtr(i.utr)!, gross, tds: i.tds, net: payoutNet(gross, i.tds), paidBy: me, modifiedTime, duplicate,
  });

  async function run(cred: UserCredential, i: Intent, signal?: AbortSignal): Promise<MarkPaidResult> {
    const me = cred.userId;
    const r = await read(cred, i.payoutId, signal);
    if (!r.rec) return r.errorKind === null ? refuse(me, "not-visible", [i.payoutId])
      : { ok: false, kind: "source-error", errorKind: r.errorKind, message: RETRY_SAME_KEY, retryable: true };
    const rec = r.rec;
    if (rec.id !== i.payoutId) return refuse(me, "source-invalid", [i.payoutId]);
    const gross = Math.round(numOf(rec.Gross_Amount) ?? 0);
    const sameUtr = typeof rec.Payout_UTR === "string" && rec.Payout_UTR.toUpperCase() === i.utr;
    if (rec.Payout_State === "Paid") {
      // A lost reply to this same payment: answer it as the success it was.
      if (sameUtr && dayOf(rec.Paid_On) === i.paidOn) return { ok: true, value: paidValue(me, i, rec, gross, true, typeof rec.Modified_Time === "string" ? rec.Modified_Time : null) };
      return refuse(me, "already-paid", [i.payoutId], { paidOn: dayOf(rec.Paid_On) });
    }
    if (rec.Payout_State === "Cancelled") return refuse(me, "cancelled", [i.payoutId]);
    if (!(gross > 0) || i.tds > gross) return refuse(me, "tds-out-of-range", [i.payoutId]);

    // One bank transfer pays one payout (UTR matches [A-Z0-9._/-] only, so it is safe inside the quotes).
    let dup: Awaited<ReturnType<typeof crm.coql>>;
    try { dup = await crm.coql(cred, `select id from ${PAYOUTS_MODULE} where Payout_UTR = '${i.utr}' limit 0, 5`, { signal }); }
    catch { return { ok: false, kind: "source-error", errorKind: "unexpected", message: RETRY_SAME_KEY, retryable: true }; }
    if (!dup.ok && dup.error.kind !== "not-found") return { ok: false, kind: "source-error", errorKind: dup.error.kind, message: RETRY_SAME_KEY, retryable: true };
    if (dup.ok && dup.value.records.some((x) => x.id !== i.payoutId)) return refuse(me, "utr-reused", [i.payoutId]);

    const since = i.modifiedTime ?? (typeof rec.Modified_Time === "string" && ZOHO_DATETIME.test(rec.Modified_Time) ? rec.Modified_Time : null);
    const fields = {
      Payout_State: "Paid", Paid_On: i.paidOn, Payout_Mode: i.mode, Payout_UTR: i.utr, Paid_By: { id: me },
      TDS_Amount: i.tds, Net_Amount: payoutNet(gross, i.tds),
    };
    let w: Awaited<ReturnType<typeof crm.update>>;
    try { w = await crm.update(cred, PAYOUTS_MODULE, i.payoutId, fields, { ifUnmodifiedSince: since, signal }); }
    catch { w = { ok: false, error: { kind: "network", status: null }, creditsRemaining: null }; }
    if (w.ok) { done(me, i.payoutId, "paid"); return { ok: true, value: paidValue(me, i, rec, gross, false, w.value.modifiedTime) }; }
    if (w.error.kind === "conflict") return refuse(me, "changed", [i.payoutId]);
    if (w.error.kind === "forbidden" || w.error.kind === "not-found") return refuse(me, "not-visible", [i.payoutId]);
    if (w.error.kind === "invalid-data" || w.error.kind === "refused") return { ok: false, kind: "source-error", errorKind: w.error.kind, message: "Not saved yet — Zoho refused it. Try again later.", retryable: false };
    // Ambiguous (network, server, busy…): re-read before answering, so a landed write is never pressed twice.
    const again = await read(cred, i.payoutId, signal);
    if (again.rec) {
      const a = again.rec;
      if (a.Payout_State === "Paid" && typeof a.Payout_UTR === "string" && a.Payout_UTR.toUpperCase() === i.utr) {
        done(me, i.payoutId, "paid-recovered");
        return { ok: true, value: paidValue(me, i, a, gross, false, typeof a.Modified_Time === "string" ? a.Modified_Time : null) };
      }
      if (a.Payout_State !== "Paid") return { ok: false, kind: "source-error", errorKind: w.error.kind, message: RETRY_SAME_KEY, retryable: true };
    }
    return { ok: false, kind: "unknown-outcome", message: RETRY_SAME_KEY, retryable: true };
  }

  return Object.freeze({
    async commit(credential: unknown, body: unknown, idempotencyKey: unknown, signal?: AbortSignal): Promise<MarkPaidResult> {
      if (!isUserCredential(credential)) return refuse("unrecognised", "invalid-request");
      const cred = credential, me = cred.userId;
      if (typeof idempotencyKey !== "string" || !OPAQUE_KEY.test(idempotencyKey)) return refuse(me, "idempotency-key-invalid");
      let may = false;
      try { may = (await deps.mayPay(cred, signal)) === true; } catch { may = false; }
      if (!may) return refuse(me, "read-only");
      const i = parse(me, body);
      if ("ok" in i) return i;

      const slot = `${me}\u0000${idempotencyKey}`;
      const fingerprint = JSON.stringify([i.payoutId, i.paidOn, i.mode, i.utr, i.tds]);
      const lock = `mark-paid-payout|${i.payoutId}`;
      const o = await presses.once(slot, fingerprint, async () => {
        if (!(await state.claim(lock, PAYOUT_LOCK_S))) return refuse(me, "busy", [i.payoutId]);
        try { return await run(cred, i, signal); } finally { await state.release(lock).catch(() => { /* the TTL frees it */ }); }
      });
      if (o.kind === "reused") return refuse(me, "idempotency-key-reused", [i.payoutId]);
      if (o.kind === "busy" || o.kind === "unavailable") return refuse(me, "busy", [i.payoutId]);
      const r = o.result;
      if (o.kind === "ran") return r;
      return r.ok ? { ok: true, value: Object.freeze({ ...r.value, utrMasked: maskUtr(i.utr)!, duplicate: true }) } : r;
    },
  });
}
export type MarkPaid = ReturnType<typeof createMarkPaid>;
