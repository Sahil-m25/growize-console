/**
 * "Show the reference" on the Payments register (TC-E11-016, D13/D22/D68/D110, rule 7).
 *
 * The register sends every row masked ("••• 8119", register.ts). This is the second, logged call: it reads ONE
 * Receipt's Mode and UTR on the person's own token (D53) and answers the full reference to a seat that holds the
 * reveal right (the "bank" capability: Head of Finance, Finance Operations, the super user). The route wraps it in
 * step-up "reveal"; this module writes the Plane C line (action reveal, reason bank-account, the receipt id — never
 * the value) whether the reveal was given or refused. Nothing is kept (D45): the answer goes to the one caller.
 */
import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";

const RECEIPT_ID = /^\d{15,22}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

const RETRY: ReadonlySet<string> = new Set(["network", "server", "busy", "aborted", "rate-limited-unclassified", "concurrency-exceeded"]);
export type RevealRefusal = "invalid-request" | "not-allowed" | "not-visible" | "source-invalid";
const MESSAGE: Readonly<Record<RevealRefusal, string>> = Object.freeze({
  "invalid-request": "Reload the page and try again.",
  "not-allowed": "Showing a bank reference is for Finance and Digital Infrastructure.",
  "not-visible": "This payment is not available to you.",
  "source-invalid": "Zoho returned something the console cannot read. Digital Infrastructure has been told.",
});

export interface RevealSeat { readonly seat: string | null; readonly mayReveal: boolean }
export interface RevealRefDeps {
  readonly crm: Pick<ZohoClient, "getRecord">;
  /** The seat the live session holds now (a fresh check on every press); null when the session changed. */
  readonly seatNow: (credential: UserCredential, sessionId: string) => Promise<RevealSeat | null>;
  /** Plane C: data/events.ts InvestorEvents.reveal — ids and codes only. */
  readonly events: { reveal(userId: string, seat: string | null, field: "bank_account", recordId: string, outcome: "ok" | "refused"): void };
}
export type RevealRefResult =
  | { readonly ok: true; readonly value: { readonly receiptId: string; readonly mode: string | null; readonly utr: string } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: RevealRefusal; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind; readonly message: string; readonly retryable: boolean };

export function createRevealRef(deps: RevealRefDeps) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.seatNow !== "function" || typeof deps.events?.reveal !== "function") {
    throw new TypeError("The reference reveal needs crm.getRecord, the seat check and the Plane C events.");
  }
  const { crm, seatNow, events } = deps;
  const refuse = (code: RevealRefusal): RevealRefResult => ({ ok: false, kind: "refused", reasonCode: code, message: MESSAGE[code], retryable: false });
  return Object.freeze({
    async reveal(principal: { readonly credential: UserCredential; readonly sessionId: string }, receiptId: string, signal?: AbortSignal): Promise<RevealRefResult> {
      if (!isUserCredential(principal?.credential) || !SESSION_ID.test(principal.sessionId) || typeof receiptId !== "string" || !RECEIPT_ID.test(receiptId)) return refuse("invalid-request");
      const me = principal.credential.userId;
      const s = await seatNow(principal.credential, principal.sessionId);
      if (!s) return refuse("invalid-request");
      if (!s.mayReveal) { events.reveal(me, s.seat, "bank_account", receiptId, "refused"); return refuse("not-allowed"); }
      const r = await crm.getRecord(principal.credential, "Receipts", receiptId, { fields: ["Mode", "UTR"], signal });
      if (!r.ok) {
        if (r.error.kind === "refused") { events.reveal(me, s.seat, "bank_account", receiptId, "refused"); return refuse("not-visible"); }
        return { ok: false, kind: "source-error", errorKind: r.error.kind, retryable: RETRY.has(r.error.kind), message: "Not shown — Zoho is not answering. Press again." };
      }
      const rec = r.value;
      if (!rec) { events.reveal(me, s.seat, "bank_account", receiptId, "refused"); return refuse("not-visible"); }
      if (rec.id !== receiptId || typeof rec.UTR !== "string" || !rec.UTR) return refuse("source-invalid");
      events.reveal(me, s.seat, "bank_account", receiptId, "ok");
      return { ok: true, value: { receiptId, mode: typeof rec.Mode === "string" ? rec.Mode : null, utr: rec.UTR.slice(0, 80) } };
    },
  });
}
export type RevealRef = ReturnType<typeof createRevealRef>;
