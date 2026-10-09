/* ── im/app-activity.ts — GC-1525 "App activity": what the investor app wrote back about sign-ins (D52, D73) ──────────
   Pure and client-safe (no server imports): the shapes the route answers with, and the plain-language lines the card and
   the list badge print. Every clock is read and formatted through lib/im/dates (Asia/Kolkata, rule 9).
   The facts are Contacts fields written by the investor app on the same Zoho org (docs/specs/app-sign-in-writeback.md);
   the console never writes them. Timestamps and counts only — no IP, device, e-mail or any other identity. */
import { DAY } from "./constants";
import { fmtDay, fmtStamp, isoWall } from "./dates";

/** the five fields the investor app writes (to be created in Zoho) */
export const APP_SIGN_IN_FIELDS = Object.freeze([
  "App_First_Sign_In_At", "App_Last_Sign_In_At", "App_Sign_In_Count", "App_Last_Failed_Sign_In_At", "App_Failed_Sign_In_Count",
] as const);
/** the three that already exist (unlock.ts) */
export const APP_ACCOUNT_FIELDS = Object.freeze(["App_Access", "App_Welcome_At", "App_Welcome_Channel"] as const);

export type AppActivityAccess = "Hold" | "Invite";

export interface AppActivity {
  readonly contactId: string;
  readonly access: AppActivityAccess | null;
  readonly welcomeAt: string | null;
  readonly welcomeChannel: string | null;
  readonly firstSignInAt: string | null;
  readonly lastSignInAt: string | null;
  readonly signInCount: number | null;
  readonly lastFailedAt: string | null;
  /** failed sign-ins since the last success: the app resets it to 0 on a successful sign-in (spec) */
  readonly failedCount: number | null;
}

/** GET /api/investors/app-activity?ids=… — `activityUnavailable`: Zoho has no sign-in fields yet, so only the account facts came back */
export interface AppActivityAnswer { readonly rows: readonly AppActivity[]; readonly activityUnavailable: boolean }

export type Tone = "go" | "due" | "late" | "";
export interface Line { readonly tone: Tone; readonly text: string }

const plural = (n: number, one: string, many: string): string => n + " " + (n === 1 ? one : many);

/** the account has been invited and the app has never seen a successful sign-in */
export const neverSignedIn = (a: AppActivity): boolean =>
  a.access === "Invite" && !a.firstSignInAt && !a.lastSignInAt && !(a.signInCount && a.signInCount > 0);

const signedIn = (a: AppActivity): boolean => !!a.lastSignInAt || !!a.firstSignInAt || (a.signInCount ?? 0) > 0;

/** failed attempts that happened after the last success (or with no success at all) */
export function failedSinceSuccess(a: AppActivity): number {
  const n = a.failedCount ?? 0;
  if (n <= 0) return 0;
  const f = isoWall(a.lastFailedAt), l = isoWall(a.lastSignInAt);
  return f != null && l != null && f < l ? 0 : n;
}

/** calendar days (IST midnights) between two IST wall times, never negative: 23:00 yesterday is "yesterday" at 10:00 */
const daysBetween = (from: number, now: number): number => Math.max(0, Math.floor(now / DAY) - Math.floor(from / DAY));
const agoText = (d: number): string => (d === 0 ? "today" : d === 1 ? "yesterday" : d + " days ago");

/** "16 Oct 14:05" or "—" — a Zoho datetime in IST */
export function stampIst(t: string | null): string {
  const w = isoWall(t);
  return w == null ? "—" : fmtStamp(w);
}
/** "08 Oct" or "—" */
export function dayIst(t: string | null): string {
  const w = isoWall(t);
  return w == null ? "—" : fmtDay(w);
}

/** The health line: one plain sentence on where the account stands. `now` is IST wall time in epoch ms (nowFull(NOW)). */
export function activityHealth(a: AppActivity, now: number, unavailable = false): Line {
  if (!a.access) return { tone: "", text: "No app account yet" };
  if (a.access === "Hold") {
    const seen = signedIn(a);
    return seen
      ? { tone: "late", text: "Locked — sign-in blocked" + (a.lastSignInAt ? ", last signed in " + dayIst(a.lastSignInAt) : "") }
      : { tone: "due", text: "On hold — no invite sent" };
  }
  if (unavailable) return { tone: "", text: "Invited — sign-in activity is not recorded yet" };
  const bad = failedSinceSuccess(a);
  const failed = bad > 0 ? plural(bad, "failed sign-in", "failed sign-ins") + " since last success" : "";
  if (neverSignedIn(a)) {
    const w = isoWall(a.welcomeAt);
    const head = w == null ? "Invited — welcome not delivered yet" : "Invited " + agoText(daysBetween(w, now)) + " — never signed in";
    return { tone: bad > 0 || (w != null && daysBetween(w, now) >= 3) ? "late" : "due", text: failed ? head + " · " + failed : head };
  }
  const n = a.signInCount ?? 0;
  const head = (n > 0 ? "Signed in " + plural(n, "time", "times") : "Signed in") + (a.lastSignInAt ? ", last " + dayIst(a.lastSignInAt) : "");
  return { tone: bad > 0 ? "late" : "go", text: failed ? head + " · " + failed : head };
}

/** The list badge: "App: never signed in" / "App: last seen 08 Oct". `nudge`: the one a KAM or IR should chase. */
export function activityBadge(a: AppActivity | undefined, unavailable = false): Line & { readonly nudge: boolean } {
  if (!a) return { tone: "", text: "App: —", nudge: false };
  if (!a.access) return { tone: "", text: "App: no account", nudge: false };
  if (a.access === "Hold") return { tone: "", text: "App: on hold", nudge: false };
  if (unavailable) return { tone: "", text: "App: —", nudge: false };
  if (neverSignedIn(a)) return { tone: "late", text: "App: never signed in", nudge: true };
  return { tone: failedSinceSuccess(a) > 0 ? "due" : "go", text: "App: last seen " + dayIst(a.lastSignInAt ?? a.firstSignInAt), nudge: false };
}

/** the list filter "Invited but never signed in" */
export const nudgeIds = (rows: readonly AppActivity[], unavailable: boolean): Set<string> =>
  new Set(unavailable ? [] : rows.filter(neverSignedIn).map(r => r.contactId));
