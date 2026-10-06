/**
 * C3 — the Add page's two writes, made safe to press twice: one lead (`add`) and a file of leads (`importRows`).
 *
 * Both go through capture's own gate (./capture createLeadCapture): the same validation, the same seat and owner rules,
 * the person's own token. This layer adds what a form press needs on top and capture should not carry:
 *
 *   Idempotency-Key  a press is scoped to person + key and fingerprinted by what it asks for (../state/idempotent). The
 *                    same key with the same request answers what the first press did (no second lead, no second
 *                    "duplicate" on the lead it just made); the same key with a different request is refused.
 *                    Only a lead that was made is kept; a refusal frees the key so the person may correct and press again.
 *   per-row import   each row is one capture with key `<key>|r<row index>`, so a retried file replays the rows that landed
 *                    and writes only the rest. Every row has its own verdict; a bad row never stops the good ones.
 *                    A file's consent is never taken (a file's "yes" is not the investor's): rows land with none,
 *                    source Events, tagged to the event.
 *
 * Nothing here is logged beyond what capture already logs (refusal codes and ids), and no value is stored: the stored
 * answer for a key is the lead id and its owner id.
 */

import type { UserCredential } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { SharedState } from "../state/shared-state";
import { createIdempotency } from "../state/idempotent";
import type { CaptureCommand, CapturePrincipal, CaptureRefusal, CaptureResult } from "./capture";
import { mobileToE164 } from "./capture";

export const MAX_IMPORT_ROWS = 200;
export const IDEMPOTENCY_TTL_S = 24 * 3_600;
const KEY = /^[A-Za-z0-9_.:|-]{8,160}$/;

export type IntakeRefusal = CaptureRefusal | "invalid-key" | "key-reused" | "in-progress" | "too-many-rows";
export type IntakeResult =
  | { readonly ok: true; readonly value: { readonly leadId: string; readonly ownerId: string | null }; readonly replayed: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: IntakeRefusal; readonly reason: string; readonly missingCapability?: "capture" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho" | "state"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

const OWN_REASON: Readonly<Record<"invalid-key" | "key-reused" | "in-progress" | "too-many-rows", string>> = Object.freeze({
  "invalid-key": "the request needs an idempotency key",
  "key-reused": "that key was already used for a different lead",
  "in-progress": "the first press of this is still being saved",
  "too-many-rows": `a file is loaded ${MAX_IMPORT_ROWS} rows at a time`,
});

export interface IntakeDependencies {
  readonly capture: { createLead(principal: CapturePrincipal, command: CaptureCommand, signal?: AbortSignal): Promise<CaptureResult> };
  readonly state: SharedState;
  readonly clock?: () => number;
}

export interface ImportInput {
  readonly eventId: string;
  /** Who carries every row. An IR's or partner's rows are always their own; null = the unassigned queue (a manager's choice). */
  readonly ownerId?: string | null;
  readonly rows: readonly { readonly name: string; readonly mobile: string; readonly email?: string; readonly city?: string; readonly units?: number | null }[];
}

export type RowVerdict =
  | { readonly row: number; readonly status: "added"; readonly leadId: string; readonly ownerId: string | null; readonly replayed: boolean }
  | { readonly row: number; readonly status: "refused"; readonly reason: IntakeRefusal | "duplicate-in-file" | "not-attempted" | "zoho"; readonly message: string };

export type ImportOutcome =
  | { readonly ok: true; readonly value: { readonly added: number; readonly refused: number; readonly rows: readonly RowVerdict[] } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: IntakeRefusal; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho" | "state"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

/** Failures that would repeat on every remaining row: stop and say so rather than hammer Zoho. */
const STOPS: ReadonlySet<string> = new Set(["capability-missing", "session-changed", "invalid-request"]);
const STOP_KINDS: ReadonlySet<string> = new Set(["auth-expired", "auth-rejected", "credits-exhausted", "forbidden", "busy", "network", "server"]);

const fromCapture = (r: CaptureResult): IntakeResult => (r.ok ? { ok: true, value: r.value, replayed: false } : r);

export function createIntake(deps: IntakeDependencies) {
  if (!deps || typeof deps.capture?.createLead !== "function" || typeof deps.state?.claim !== "function") {
    throw new TypeError("Intake needs capture.createLead and the shared state.");
  }
  const { capture, state } = deps;
  const presses = createIdempotency<IntakeResult>({
    state, ns: "lead-capture", ttlSeconds: IDEMPOTENCY_TTL_S, clock: deps.clock,
    keep: (r) => r.ok,
    save: (r) => JSON.stringify(r),
    load: (s) => { try { const r = JSON.parse(s) as IntakeResult; return r && typeof r === "object" && "ok" in r ? r : null; } catch { return null; } },
  });
  const own = (reasonCode: keyof typeof OWN_REASON): IntakeResult => ({ ok: false, kind: "refused", reasonCode, reason: OWN_REASON[reasonCode] });

  async function add(principal: CapturePrincipal, key: unknown, command: CaptureCommand, signal?: AbortSignal): Promise<IntakeResult> {
    const cred: UserCredential | undefined = principal?.credential;
    if (!isUserCredential(cred)) return fromCapture(await capture.createLead(principal, command, signal));
    if (typeof key !== "string" || !KEY.test(key)) return own("invalid-key");
    const once = await presses.once(`${cred.userId}|${key}`, JSON.stringify(command ?? null),
      async () => fromCapture(await capture.createLead(principal, command, signal)));
    switch (once.kind) {
      case "ran": return once.result;
      case "replay": return once.result.ok ? { ...once.result, replayed: true } : once.result;
      case "reused": return own("key-reused");
      case "busy": return own("in-progress");
      default: return { ok: false, kind: "source-error", source: "state", errorKind: "unexpected", retryable: true };
    }
  }

  async function importRows(principal: CapturePrincipal, key: unknown, input: ImportInput, signal?: AbortSignal): Promise<ImportOutcome> {
    const cred = principal?.credential;
    if (!isUserCredential(cred) || !input || typeof input.eventId !== "string" || !Array.isArray(input.rows)) {
      return { ok: false, kind: "refused", reasonCode: "invalid-request", reason: "the request is invalid" };
    }
    if (typeof key !== "string" || !KEY.test(key)) return { ok: false, kind: "refused", reasonCode: "invalid-key", reason: OWN_REASON["invalid-key"] };
    if (input.rows.length > MAX_IMPORT_ROWS) return { ok: false, kind: "refused", reasonCode: "too-many-rows", reason: OWN_REASON["too-many-rows"] };

    const verdicts: RowVerdict[] = [];
    const seen = new Set<string>();
    let stopped: string | null = null;
    for (let i = 0; i < input.rows.length; i++) {
      const r = input.rows[i];
      const mobile = r && typeof r === "object" ? mobileToE164(r.mobile) : null;
      if (mobile && seen.has(mobile)) {
        verdicts.push({ row: i, status: "refused", reason: "duplicate-in-file", message: "the same number is earlier in this file" });
        continue;
      }
      if (mobile) seen.add(mobile);
      if (stopped) { verdicts.push({ row: i, status: "refused", reason: "not-attempted", message: stopped }); continue; }
      const res = await add(principal, `${key}|r${i}`, {
        name: r?.name, mobile: r?.mobile, ...(r?.email ? { email: r.email } : {}), ...(r?.city ? { city: r.city } : {}),
        units: r?.units ?? null, source: "Events", eventId: input.eventId, ownerId: input.ownerId ?? null,
      } as CaptureCommand, signal);
      if (res.ok) {
        verdicts.push({ row: i, status: "added", leadId: res.value.leadId, ownerId: res.value.ownerId, replayed: res.replayed });
      } else if (res.kind === "refused") {
        verdicts.push({ row: i, status: "refused", reason: res.reasonCode, message: res.reason });
        if (STOPS.has(res.reasonCode)) stopped = "stopped: " + res.reason;
      } else {
        verdicts.push({ row: i, status: "refused", reason: "zoho", message: "Zoho did not answer for this row; load the file again to finish it" });
        if (STOP_KINDS.has(res.errorKind) || res.source !== "zoho") stopped = "stopped: Zoho stopped answering; load the file again to finish it";
      }
    }
    const added = verdicts.filter((v) => v.status === "added").length;
    return { ok: true, value: { added, refused: verdicts.length - added, rows: Object.freeze(verdicts) } };
  }

  return Object.freeze({ add, importRows });
}
