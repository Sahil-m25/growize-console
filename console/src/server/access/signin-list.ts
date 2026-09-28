/**
 * THE STAGING SIGN-IN LIST (M03-S01-T02, TC-E03-001..005 on staging).
 *
 * Given a Zoho Users API answer (GET /crm/v8/users?type=AllUsers, decoded), the people the sign-in
 * screen may offer: each user resolved to a seat exactly as the OAuth callback resolves the
 * CurrentUser (seat.ts — role/profile ids, active, confirmed, human), then admitted by the same door
 * (admitZohoSeat). Nobody is listed whom the callback would refuse.
 *
 * Demo/staging only: `signInListAllowed` is false in a production build unless the deployment says
 * it is staging (GZ_SIGNIN_LIST=staging — PROVISIONAL name). Production shows only "Continue with Zoho".
 */

import type { ZohoSeat, ZohoSeatDirectory } from "../oauth/seat";
import { admitZohoSeat, readGrants, ZOHO_SEAT_SIDES, type GrantReader } from "./policy";

export interface SignInRow {
  readonly userId: string;
  readonly name: string;
  readonly seat: ZohoSeat;
}

export const signInListAllowed = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.NODE_ENV !== "production" || env.GZ_SIGNIN_LIST === "staging";

export async function signInList(usersBody: unknown, seats: ZohoSeatDirectory, grants: GrantReader): Promise<SignInRow[]> {
  const users = typeof usersBody === "object" && usersBody !== null && Array.isArray((usersBody as { users?: unknown }).users)
    ? (usersBody as { users: unknown[] }).users : [];
  const out: SignInRow[] = [];
  for (const u of users) {
    const r = seats.resolveCurrentUser({ users: [u] });
    if (!r.ok) continue;
    const g = await readGrants(grants, r.value.userId, ZOHO_SEAT_SIDES[r.value.seat].lead);
    if (!admitZohoSeat(r.value.seat, r.value.userId, g).ok) continue;
    const n = (u as { full_name?: unknown }).full_name;
    out.push(Object.freeze({ userId: r.value.userId, name: typeof n === "string" ? n : "", seat: r.value.seat }));
  }
  return out;
}
