/**
 * M12-S07-T01 — BLOCK OR SUPERSEDE A PAPER, INCLUDING A SIGNED ONE (D19, D52, D72).
 *
 * `paper.blocked` reverses `paper.verified` (D19). On the person's own token (D53):
 *   1. The seat may act on the paper (Finance, Head of Finance, Finance Ops, DI; Compliance on the FEMA
 *      declaration — PROVISIONAL until OD8). A KAM or a viewer is refused. A reason is mandatory.
 *   2. The record is read. If a request is still out in Zoho Sign it is recalled first; if Zoho Sign cannot be
 *      read, or the recall fails, nothing is written ("Not done yet").
 *   3. ONE guarded write (If-Unmodified-Since) clears the slot's request id, method, *_Verified_At and
 *      *_Verified_By. For the supplementary that is the console's Agreement_Signed, so the lead's alloc gate
 *      (computed from it in server/leads/gates.ts) closes on its next read — in the same act.
 *   4. The reason is written to Zoho as a Note on the record ("Paper blocked — <paper>"): the org has no
 *      blocked/reason field (PROVISIONAL, Jev 0.78; FACT CHANGE proposed). The signed file stays in its slot
 *      as evidence of what was superseded.
 * Plane B: the calls (ids only) and one line with a code; the reason never enters a log.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { SignApi } from "./api";
import { addNote, cleanReason, DATETIME, isLive, isPaper, mayActOnPaper, PAPER_FIELDS, primaryDoerNote, RECORD_ID, reqIdOf, signStateOf, verifiedOf, type Paper } from "./papers";

export type BlockRefusal = "invalid-request" | "seat-denied" | "reason-required" | "not-visible" | "nothing-to-block" | "record-changed";
export const BLOCK_MESSAGE: Readonly<Record<BlockRefusal, string>> = Object.freeze({
  "invalid-request": "Not blocked — the request is incomplete.",
  "seat-denied": "Blocking a paper belongs to Finance, Compliance and the Head of Finance.",
  "reason-required": "Give the reason this paper is blocked.",
  "not-visible": "You cannot open this record in Zoho.",
  "nothing-to-block": "Nothing has been sent or verified for this paper.",
  "record-changed": "Not done yet — the record changed in Zoho. Reload and block again.",
});
export const NOTHING_CAME_BACK = "Nothing has come back signed";
export type BlockResult =
  | { readonly ok: true; readonly value: { readonly paper: Paper; readonly recordId: string; readonly recalled: boolean; readonly wasVerified: boolean; readonly gateCleared: boolean; readonly noteSaved: boolean; readonly reason: string; readonly note: string | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: BlockRefusal; readonly message: string }
  | { readonly ok: false; readonly kind: "not-saved"; readonly errorKind: string; readonly message: string; readonly recalled: boolean };

export interface BlockDeps {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert">;
  readonly sign: Pick<SignApi, "getRequest" | "recall">;
  readonly log: OpsLog;
  readonly clock?: () => number;
}

export function createPaperBlocker(deps: BlockDeps) {
  const clock = deps.clock ?? Date.now;
  const refuse = (userId: string, code: BlockRefusal, ids: readonly string[] = []): BlockResult => {
    deps.log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "paper-block", reason: code, recordIds: ids.filter((x) => RECORD_ID.test(x)) });
    return { ok: false, kind: "refused", reasonCode: code, message: BLOCK_MESSAGE[code] };
  };
  const notSaved = (errorKind: string, recalled: boolean): BlockResult => ({ ok: false, kind: "not-saved", errorKind, message: "Not done yet", recalled });

  return Object.freeze({
    async block(principal: { readonly credential: unknown; readonly seat: string },
      i: { readonly paper: unknown; readonly recordId: unknown; readonly reason: unknown; readonly expectedModifiedTime: unknown }, signal?: AbortSignal): Promise<BlockResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred)) return refuse("unrecognised", "invalid-request");
      const me = cred.userId, seat = String(principal.seat ?? "");
      if (!isPaper(i?.paper) || typeof i.recordId !== "string" || !RECORD_ID.test(i.recordId) || typeof i.expectedModifiedTime !== "string" || !DATETIME.test(i.expectedModifiedTime)) return refuse(me, "invalid-request");
      if (!mayActOnPaper(seat, i.paper)) return refuse(me, "seat-denied", [i.recordId]);
      const reason = cleanReason(i.reason);
      if (!reason) return refuse(me, "reason-required", [i.recordId]);
      const f = PAPER_FIELDS[i.paper];
      const cr = cred as UserCredential;
      let rec: ZohoRecord | null;
      try {
        const r = await deps.crm.getRecord(cr, f.module, i.recordId, { fields: ["id", f.req, f.verifiedAt], signal });
        if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? refuse(me, "not-visible", [i.recordId]) : notSaved(r.error.kind, false);
        rec = r.value;
      } catch { return notSaved("unexpected", false); }
      if (!rec || rec.id !== i.recordId) return refuse(me, "not-visible", [i.recordId]);
      const requestId = reqIdOf(rec, f);
      const wasVerified = verifiedOf(rec, f) !== null;
      if (!requestId && !wasVerified) return refuse(me, "nothing-to-block", [i.recordId]);

      let recalled = false;
      if (requestId && !wasVerified) {
        const g = await deps.sign.getRequest(cr, requestId, { signal });
        if (!g.ok && g.error.kind !== "not-found") return notSaved(`sign-${g.error.kind}`, false);
        if (g.ok && isLive(signStateOf(g.value)) && signStateOf(g.value) !== "draft") {
          const rc = await deps.sign.recall(cr, requestId, { signal });
          if (!rc.ok) return notSaved(`recall-${rc.error.kind}`, false);
          recalled = true;
        }
      }
      let put: Awaited<ReturnType<typeof deps.crm.update>>;
      try {
        put = await deps.crm.update(cr, f.module, i.recordId, { [f.req]: null, [f.via]: null, [f.verifiedAt]: null, [f.verifiedBy]: null }, { ifUnmodifiedSince: i.expectedModifiedTime, signal });
      } catch { return notSaved("unexpected", recalled); }
      if (!put.ok) {
        if (put.error.kind === "conflict") { refuse(me, "record-changed", [i.recordId]); return { ok: false, kind: "refused", reasonCode: "record-changed", message: BLOCK_MESSAGE["record-changed"] }; }
        return notSaved(put.error.kind, recalled);
      }
      const n = await addNote(deps.crm, cr, f.module, i.recordId, `Paper blocked — ${f.label}`, `Reason: ${reason}`, signal);
      if (!n.ok) deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "paper-block", reason: `note-not-saved.${n.errorKind}`, recordIds: [i.recordId] });
      deps.log.event?.({ at: clock(), actor: { kind: "user", userId: me }, action: "paper-block", reason: `blocked.${i.paper}${wasVerified ? ".was-verified" : ""}${recalled ? ".recalled" : ""}`, recordIds: [i.recordId] });
      return { ok: true, value: Object.freeze({
        paper: i.paper, recordId: i.recordId, recalled, wasVerified, gateCleared: wasVerified && (i.paper === "supplementary" || i.paper === "nda"),
        noteSaved: n.ok, reason, note: primaryDoerNote(seat),
      }) };
    },
  });
}
