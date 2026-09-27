/**
 * M17-S05 — my profile: change my own display name and mobile in my own Zoho user, on my own
 * token (D53). The sign-in email is Zoho's and is never changed here. A name under two characters
 * or a mobile that is not a phone number is refused with the form's own words and nothing is
 * written. Initials and the badge live in the console's access store (not Zoho) and are not here.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { mobileToE164, splitName } from "../leads/capture";

const RECORD_ID = /^\d{15,22}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

export interface ProfileSession { recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean> }
export type ProfileResult =
  | { readonly ok: true; readonly value: { readonly name: string; readonly mobile: string | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "name-too-short" | "invalid-mobile" | "email-read-only"; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

const REASON = {
  "invalid-request": "the request is invalid",
  "session-changed": "the sign-in session changed",
  "name-too-short": "a display name needs at least two characters",
  "invalid-mobile": "write the mobile as ten Indian digits, or + and the country code",
  "email-read-only": "your sign-in email is your Zoho account's and cannot be changed here",
} as const;

export function createProfile(deps: { readonly crm: Pick<ZohoClient, "updateOwnUser">; readonly session: ProfileSession; readonly log: OpsLog; readonly clock?: () => number }) {
  const { crm, session, log } = deps;
  const clock = deps.clock ?? Date.now;
  const refuse = (userId: string, code: keyof typeof REASON): ProfileResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "own-profile", reason: code, recordIds: [] });
    return { ok: false, kind: "refused", reasonCode: code, reason: REASON[code] };
  };
  return Object.freeze({
    async update(principal: { credential: UserCredential; sessionId: string }, change: { readonly name: string; readonly mobile?: string | null; readonly email?: unknown }, signal?: AbortSignal): Promise<ProfileResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !RECORD_ID.test(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)
        || !change || typeof change !== "object") return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      if (change.email !== undefined) return refuse(cred.userId, "email-read-only");
      const name = typeof change.name === "string" ? splitName(change.name) : null;
      if (!name) return refuse(cred.userId, "name-too-short");
      let mobile: string | null = null;
      if (change.mobile !== undefined && change.mobile !== null && change.mobile !== "") {
        mobile = mobileToE164(change.mobile);
        if (!mobile) return refuse(cred.userId, "invalid-mobile");
      }
      let live = false;
      try { live = await session.recheck(cred, principal.sessionId, signal); } catch { live = false; }
      if (!live) return refuse(cred.userId, "session-changed");
      const fields = { ...(name.First_Name ? { first_name: name.First_Name } : {}), last_name: name.Last_Name,
        ...(change.mobile !== undefined ? { mobile } : {}) };
      let r: Awaited<ReturnType<typeof crm.updateOwnUser>>;
      try { r = await crm.updateOwnUser(cred, fields, { signal }); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: false }; }
      if (!r.ok) return { ok: false, kind: "source-error", errorKind: r.error.kind, retryable: false };
      return { ok: true, value: { name: [name.First_Name, name.Last_Name].filter(Boolean).join(" "), mobile } };
    },
  });
}
