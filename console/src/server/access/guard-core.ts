/**
 * ROUTE GUARD — the pure half (M01-S01-T04/T06, D60/D68).
 *
 * T04  Seat presets. The presets are NOT re-ported: SEATCAPS/NAV/PAGECAPS live in `@/domain` and the rail
 *      is `navFor` in `@/lib/selectors/access`. `reachForSides` asks those same functions over the
 *      one-person book `policy.ts` builds, so the server's idea of a seat's pages is the rail, exactly.
 *      `SEAT_PRESETS` is that answer for every Zoho seat, plus the super user's sides (D68).
 * T06  Refusal. `createGuard` decides a page or an API route for the signed-in session: a page outside
 *      the seat is refused with a named message and a landing page (the seat's first page, never an
 *      empty one), and one Plane C line is written: ids and short codes only — the Zoho user id, the
 *      seat token and the page id / `api-<route>` (see below). Never a name, an email or a body.
 *
 * Plane C: a refused page is `refused-page` (reason = the page id), a refused API route `refused-action`
 * (reason = `api-<route>`), through identity/authority.ts. A session the door no longer admits (no seat,
 * a grant taken back) stays `sign-in-refused` with the admission code.
 */

import type { CapGrid, NavKey, PersonKey } from "../../domain";
import { MERGE, NAV, PAGECAPS } from "../../domain";
import { signInAdmits } from "../../lib/data/admission";
import { canReach, navFor } from "../../lib/selectors/access";
import { createAuthorityEvents, type AuthorityEvents } from "../identity/authority";
import type { PlaneCLog } from "../identity/plane-c";
import { CONSOLE_SEAT, SIGNIN_REFUSALS, type ConsoleSession, type SignOutWhy } from "../oauth/user-session";
import type { ZohoSeat } from "../oauth/seat";
import { accessBook, accessCtx, admitZohoSeat, readGrants, ZOHO_SEAT_SIDES, NO_GRANTS, type GrantReader, type SeatSides } from "./policy";

/* ---- page ids ------------------------------------------------------------------------------------ */

/** Every page of the five bands: the lead rail (NAV) and the Investors pages the merge adds (MERGE). */
export const PAGE_IDS: readonly string[] = Object.freeze([...new Set([...NAV.map((n) => n.k as string), ...Object.keys(MERGE)])]);
/** Routes that resolve to a view but are not a page anyone reaches (PAGECAPS.nopage: `/add`). */
export const NOPAGE_IDS: readonly string[] = Object.freeze(
  Object.entries(PAGECAPS).filter(([, c]) => (c as { nopage?: boolean } | undefined)?.nopage).map(([k]) => k),
);

/** "/leads/123?x" → "leads"; "/" and anything that is not a console page → null (nothing to refuse). */
export function pageIdOf(pathname: string | null | undefined): string | null {
  if (typeof pathname !== "string") return null;
  const seg = pathname.split(/[?#]/)[0]!.split("/").filter(Boolean)[0] ?? "";
  return PAGE_IDS.includes(seg) || NOPAGE_IDS.includes(seg) ? seg : null;
}

/* ---- the seat's reach (T04) ------------------------------------------------------------------------ */

export interface SeatReach {
  readonly admitted: boolean;
  /** rail order, as navFor draws it (the bell and the Profile menu included) */
  readonly pages: readonly string[];
  /** where the person lands: Today when they hold it, else their first page, else Profile; null = none */
  readonly landing: string | null;
}

/** The pages a person on these sides reaches — the front end's navFor/canReach over the one-person book. */
export function reachForSides(sides: SeatSides, who: PersonKey, grants: CapGrid, now: Date = new Date(0)): SeatReach {
  const admitted = signInAdmits(accessBook(who, sides, grants, now.toISOString()), who);
  if (!admitted) return Object.freeze({ admitted, pages: Object.freeze([]), landing: null });
  const ctx = accessCtx(who, sides, grants, now);
  const nav = navFor(ctx);
  const pages = nav.map((n) => n.k as string);
  if (!pages.includes("me") && canReach(ctx, "me" as NavKey)) pages.push("me");
  const rail = nav.filter((n) => !(n as { bell?: boolean }).bell && !(n as { menu?: boolean }).menu).map((n) => n.k as string);
  const landing = rail.includes("today") ? "today" : rail[0] ?? (pages.includes("me") ? "me" : null);
  return Object.freeze({ admitted, pages: Object.freeze(pages), landing });
}

/** D68: Sahil, the super user — Digital Infrastructure on the lead side and the Investors `di` role. */
export const SUPER_USER_SIDES: SeatSides = Object.freeze({ lead: "ops", im: "di" });

/** Every seat's preset reach with no grant held (M03-S02 stores grants), keyed by Zoho seat; plus `super-user`. */
export function seatPresets(now: Date = new Date(0)): Readonly<Record<ZohoSeat | "super-user", SeatReach>> {
  const out: Record<string, SeatReach> = {};
  for (const seat of Object.keys(ZOHO_SEAT_SIDES) as ZohoSeat[]) {
    const a = admitZohoSeat(seat, "preset", {});
    out[seat] = a.ok ? reachForSides(ZOHO_SEAT_SIDES[seat], "preset", {}, now) : Object.freeze({ admitted: false, pages: Object.freeze([]), landing: null });
  }
  out["super-user"] = reachForSides(SUPER_USER_SIDES, "preset", {}, now);
  return Object.freeze(out) as Readonly<Record<ZohoSeat | "super-user", SeatReach>>;
}

/* ---- session → sides ------------------------------------------------------------------------------- */

/** The console seat token a Zoho session holds (CONSOLE_SEAT) back to its Zoho seat. Tokens are unique. */
export const ZOHO_SEAT_OF_TOKEN: Readonly<Record<string, ZohoSeat>> = Object.freeze(
  Object.fromEntries(Object.entries(CONSOLE_SEAT).filter(([, t]) => t !== null).map(([s, t]) => [t as string, s as ZohoSeat])),
);

/* ---- verdicts (T06) -------------------------------------------------------------------------------- */

export type GuardRefusal = "signed-out" | "no-seat" | "no-grant" | "page" | "not-configured";

/** The named message for each refusal (the no-seat/no-grant wording is the sign-in door's own). */
export const GUARD_REFUSALS: Readonly<Record<GuardRefusal, string>> = Object.freeze({
  "signed-out": "You are signed out. Sign in with Zoho to open the console.",
  "no-seat": SIGNIN_REFUSALS["no-seat"],
  "no-grant": SIGNIN_REFUSALS["no-grant"],
  page: "This page is not part of your seat. Digital Infrastructure can grant it.",
  "not-configured": "Zoho sign-in is not configured on this deployment.",
});

export type GuardVerdict =
  | { readonly ok: true; readonly page: string | null; readonly landing: string; readonly passThrough: boolean }
  | {
    readonly ok: false; readonly status: 401 | 403 | 503; readonly code: GuardRefusal; readonly message: string;
    /** where to send the person: their first page, or "/" (the sign-in screen) */
    readonly landing: string; readonly signedOut?: SignOutWhy | null;
  };

const pathOf = (landing: string | null): string => (landing ? "/" + landing : "/");

/** Decide one page for a person on these sides. Pure: no session read, no log. */
export function decidePage(sides: SeatSides, who: PersonKey, grants: CapGrid, page: string | null, now?: Date): GuardVerdict {
  const r = reachForSides(sides, who, grants, now);
  if (!r.admitted) return refuse("no-seat", 403, "/");
  const landing = pathOf(r.landing);
  if (page === null || NOPAGE_IDS.includes(page) || r.pages.includes(page)) return { ok: true, page, landing, passThrough: false };
  return refuse("page", 403, landing);
}

function refuse(code: GuardRefusal, status: 401 | 403 | 503, landing: string, signedOut?: SignOutWhy | null): GuardVerdict {
  return { ok: false, status, code, message: GUARD_REFUSALS[code], landing, ...(signedOut !== undefined ? { signedOut } : {}) };
}

/* ---- API routes ------------------------------------------------------------------------------------ */

/**
 * Every API handler under app/api (less test/** and auth/**) and what guards it. `session` = any admitted
 * console session; `page` = the session must reach that page; `open` = no person behind it, said why.
 * guard.test.cjs fails when a route file exists that this table does not name.
 */
export type ApiRule =
  | { readonly kind: "session" }
  | { readonly kind: "page"; readonly page: string }
  | { readonly kind: "open"; readonly why: string };

export const API_ROUTES: Readonly<Record<string, ApiRule>> = Object.freeze({
  "/api/data": { kind: "session" },
  "/api/data/version": { kind: "session" },
  "/api/leads": { kind: "page", page: "leads" },
  "/api/leads/search": { kind: "session" },   /* M06-S03-W2 (D110): the top-bar search follows the seat — server/leads/seat-search decides inside (Finance/KAM/Head of AM search investors and hold no Leads page) */
  "/api/leads/[id]/hints": { kind: "session" },   /* M12-S11-T03 the IR's word for Finance beside its queue: read on the viewer's own token (D53), Zoho sharing decides */
  "/api/grants": { kind: "page", page: "people" },
  "/api/users": { kind: "session" },   /* M03-S04-T02 seat change: maySeat (the Investors Team rule) decides inside */
  "/api/auth/step-up": { kind: "session" },
  "/api/farms": { kind: "page", page: "farms" },
  "/api/events": { kind: "page", page: "events" },
  "/api/events/[id]/sheet": { kind: "page", page: "events" },   /* M14-S03-W2 the loaded sheet's state (GET) and its one load (POST): the load right is decided inside */
  "/api/cases": { kind: "page", page: "tkt" },
  "/api/cases/deliveries": { kind: "page", page: "tkt" },   /* M13-S05-W1 the list form of a ticket's deliveries: one read for the register's open rows, scope decided inside */
  "/api/cases/[id]/messages": { kind: "page", page: "tkt" },   /* M13-S05-W1 the ticket thread: the Notes on a Case, same reach as the register */
  "/api/updates": { kind: "page", page: "invupd" },
  "/api/session": { kind: "open", why: "the sign-in door itself: GET answers who is signed in, DELETE signs out" },
  "/api/errors": { kind: "open", why: "the client error beacon: carries no data and reports from the sign-in screen too" },
  "/api/webhooks/zoho-sign": { kind: "open", why: "a provider callback: no person, authenticated by its HMAC signature" },
  "/api/webhooks/investor-app": { kind: "open", why: "the investor app's signed events (M13-S01): no person, authenticated by the contract HMAC" },
  "/api/jobs/sign-recheck": { kind: "open", why: "the platform scheduler's Zoho Sign re-check (M12-S05-T02): no person, authenticated by JOB_SECRET in X-Job-Secret" },
  "/api/jobs/outbox-drain": { kind: "open", why: "the platform scheduler's investor-app outbox drain (M13-S01): no person, authenticated by JOB_SECRET in X-Job-Secret" },
  "/api/sign/embed": { kind: "open", why: "the investor app's sign.embed request (M12-S08): no Zoho person, authenticated by the contract HMAC; the Contact must be the Sign recipient" },
  "/api/contracts": { kind: "session" },
  "/api/activity": { kind: "session" },
  "/api/investors": { kind: "session" },
  "/api/investors/search": { kind: "page", page: "inv" },   /* M09-S07 Investors search: scope decided inside (ir-guard contactsWhere) */
  "/api/investors/mine": { kind: "page", page: "inv" },   /* M09-S08 an IR's Investors list: the IR holds the Investors page (D113); server/investors/ir-list refuses any seat but the IR's own-lead scope inside */
  "/api/investors/add-paid": { kind: "page", page: "inv" },
  "/api/investors/[id]/unlock": { kind: "page", page: "inv" },
  "/api/investors/[id]/preview": { kind: "page", page: "inv" },   /* M10-S22 app preview: the record's own admission decides inside */
  "/api/investors/[id]/test-link": { kind: "page", page: "inv" }, /* M10-S23: super user only, decided inside */
  "/api/logs": { kind: "session" },   /* M15-S05 Planes B/C reader: server/logs/reader logAccessOf decides inside */
  "/api/system": { kind: "session" },   /* M15-S05 live checks: server/system/facts mayReadSystem (`sys` capability) decides inside */
  "/api/investors/[id]/kam": { kind: "page", page: "inv" },
  "/api/investors/am": { kind: "page", page: "inv" },   /* M09-S04/S02 the AM list (managers, pool, rows): the Investors page; server/investors/am-service refuses any seat but a KAM or the Head of AM inside */
  "/api/payments": { kind: "session" },   /* M10-S01-W1 the Payments register: the seat (Finance pay/bank, the read-only Auditor) decides inside; a KAM is refused 403 */
  "/api/receipts": { kind: "page", page: "pay" },
  "/api/statements": { kind: "page", page: "pay" },   /* M10-S05 bank statement upload on the Payments page: Finance ("pay") decided inside too */
  "/api/claims": { kind: "page", page: "pay" },          /* M10-S03 claim answers: Finance ("pay") decided inside too */
  "/api/teams": { kind: "session" },   /* M17-S01 Teams from Zoho: server/teams teamsAccess decides inside (IR refused, lead vs Investors side) */
  "/api/payouts": { kind: "page", page: "pay" },   /* M10-S20-T02 payouts: Finance pay/bank read, pay writes — server/payouts/authority decides inside */
  "/api/documents": { kind: "session" },   /* M12-S01-T03: not page "docs" — KAM/Head of AM (AC5) do not reach it; server/documents/scope + ir-guard decide inside */
  "/api/emails": { kind: "session" },   /* M12-S09-T01: a record's emails; server/emails/record-emails admits the record inside (ir-guard / lead book) */
  "/api/holds": { kind: "session" },   /* M08-S04 holds: server/holds decides inside (list: Money seats on the whole book; one: ir-guard scope; extend/release: the refund right) */
  "/api/numbers/investors-today": { kind: "session" },   /* M05-S06 headline figures: server/numbers/investors-today hides tiles a seat may not see */
  "/api/queues": { kind: "session" },   /* M05-S07/S08 Investors side of Today: server/queues decides inside (AM seats: care day; money/paper/KYC seats: their rows; viewers: empty; IR refused) */
  "/api/numbers/investors-side": { kind: "session" },   /* M16-S08/S09 Investors side of Numbers: server/numbers/investors-side refuses money sections to seats without Receipts read */
});

/** The rule for a route: the longest API_ROUTES prefix that matches ("/api/leads/123" → "/api/leads"). */
export function apiRuleOf(route: string): { readonly key: string; readonly rule: ApiRule } | null {
  const keys = Object.keys(API_ROUTES).filter((k) => route === k || route.startsWith(k + "/")).sort((a, b) => b.length - a.length);
  return keys[0] ? { key: keys[0], rule: API_ROUTES[keys[0]]! } : null;
}

const slug = (s: string): string => s.replace(/^\/api\//, "").replace(/\[[^\]]*\]/g, "id").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 30) || "root";

/* ---- the guard ------------------------------------------------------------------------------------- */

export type SessionRead =
  | { readonly ok: true; readonly session: ConsoleSession }
  | { readonly ok: false; readonly why: SignOutWhy | null };

export interface GuardDeps {
  /** "pass" = fixture mode or the phase-1 stub: the demo decides, the guard lets everything through */
  readonly mode: () => "enforce" | "pass" | "not-configured";
  readonly readSession: () => Promise<SessionRead>;
  readonly planeC: PlaneCLog;
  /** refused pages and API routes (authority.ts); defaults to a writer over `planeC` */
  readonly events?: AuthorityEvents;
  readonly grants?: GrantReader;
  readonly clock?: () => number;
}

export interface Guard {
  page(pageId: string | null): Promise<GuardVerdict>;
  api(route: string): Promise<GuardVerdict>;
}

export function createGuard(d: GuardDeps): Guard {
  const clock = d.clock ?? Date.now;
  const grantsOf = d.grants ?? NO_GRANTS;
  const events = d.events ?? createAuthorityEvents(d.planeC, clock);

  /** what was refused: a page (refusedPage, reason = the page id) or an API route (refusedAction, `api-<route>`) */
  type Refused = { readonly kind: "page"; readonly page: string } | { readonly kind: "api"; readonly code: string };

  async function decide(page: string | null, what: Refused): Promise<GuardVerdict> {
    const mode = d.mode();
    if (mode === "pass") return { ok: true, page, landing: "/", passThrough: true };
    if (mode === "not-configured") return refuse("not-configured", 503, "/");
    const s = await d.readSession();
    if (!s.ok) return refuse("signed-out", 401, "/", s.why);
    const { who, seat } = s.session;
    const zohoSeat = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_OF_TOKEN, seat) ? ZOHO_SEAT_OF_TOKEN[seat]! : null;
    const sides = zohoSeat ? ZOHO_SEAT_SIDES[zohoSeat] : null;
    const log = (code: string) => d.planeC.record({ at: clock(), who, action: "sign-in-refused", outcome: "refused", reason: code, seat });
    if (!zohoSeat || !sides) {
      log("no-seat");
      return refuse("no-seat", 403, "/");
    }
    const grants = await readGrants(grantsOf, who, sides.lead);
    const admission = admitZohoSeat(zohoSeat, who, grants);
    if (!admission.ok) {
      log(admission.code);
      return refuse(admission.code, 403, "/");
    }
    const v = decidePage(sides, who, grants, page, new Date(clock()));
    if (!v.ok) {
      if (what.kind === "page") events.refusedPage(who, seat, what.page);
      else events.refusedAction(who, seat, what.code);
    }
    return v;
  }

  return Object.freeze({
    page: (pageId: string | null) => decide(pageId, { kind: "page", page: pageId ?? "root" }),
    async api(route: string): Promise<GuardVerdict> {
      const r = apiRuleOf(route);
      /* an unlisted route is refused: every handler must be named in API_ROUTES (fail closed) */
      if (!r) return d.mode() === "pass" ? { ok: true, page: null, landing: "/", passThrough: true } : refuse("page", 403, "/");
      if (r.rule.kind === "open") return { ok: true, page: null, landing: "/", passThrough: true };
      return decide(r.rule.kind === "page" ? r.rule.page : null, { kind: "api", code: "api-" + slug(r.key) });
    },
  });
}

/** The refusal as an API answers it: the named message and where to go, never data. */
export function refusalResponse(v: Extract<GuardVerdict, { ok: false }>): Response {
  return Response.json(
    { error: v.message, code: v.code, landing: v.landing, ...(v.signedOut !== undefined ? { session: null, signedOut: v.signedOut } : {}) },
    { status: v.status, headers: { "Cache-Control": "no-store" } },
  );
}
