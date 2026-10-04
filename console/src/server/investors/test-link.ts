/**
 * M10-S23-T02 — THE TEST SIGN-IN LINK: a one-time link to open the real investor app as one investor on
 * another device, made by the super user only, with a reason, never emailed to the investor.
 *
 * No test-link contract exists in contracts/ and the investor app is not in this repo (MA1). Jev (0.25,
 * PROVISIONAL, choice b): the console defines the gate, the audit and the register, and asks the app for
 * the link through `TestLinkIssuer` (the app's Supabase admin generate-link behind a server route). Until
 * MA1 names that endpoint the runtime issuer is null and the route answers 503 "not-configured".
 *
 * The gate: the super user seat (`di`, or the lead-side DI token `ops` — lib/im isSuper), a reason in words
 * (Jev 0.54, PROVISIONAL: the words stay in the in-process register shown on System and the investor's
 * Activity; Plane B keeps only `why-given.len-<n>`), the investor in the viewer's own scope (the record read,
 * ./record.ts, on their own token), and — for a real investor, not a listed test account — an explicit
 * confirmation after the warning. Every link lives ten minutes or until first use, whichever is first.
 *
 * Audit: Plane B `event` lines test-link-created / test-link-used (who, the Contact id, a code); a refused
 * attempt is a Plane B refusal. Each issued link is also a Plane C authority line `test-link-issued` (who, seat, the
 * Contact id, ttlMinutes — M15-S05-NOTE-1), never the URL, the token or the reason's words. The register holds ids, the reason, times and the link id — never the URL
 * after it was handed over once, and never the token.
 */

import { randomUUID } from "node:crypto";
import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { InvestorEvents } from "../data/events";
import type { PlaneCRefusal } from "../data/ir-guard";
import { createInvestorRecordReader, type RecordResult } from "./record";

export const TEST_LINK_MINUTES = 10;
export const WHY_MIN = 8;
export const WHY_MAX = 500;
const RECORD_ID = /^\d{15,22}$/;
const LINK_ID = /^[0-9a-f-]{36}$/;
const MAX_REGISTER = 1_000;

/** The investor app's side (MA1): mint a one-time sign-in link for this Contact, valid until `expiresAt`. */
export interface TestLinkIssuer {
  mint(req: { readonly linkId: string; readonly contactId: string; readonly expiresAt: number }, signal?: AbortSignal)
    : Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false; readonly code: string }>;
}

export interface TestLinkEntry {
  readonly id: string;
  readonly contactId: string;
  /** Zoho user id of the super user who made it */
  readonly by: string;
  readonly why: string;
  readonly at: number;
  readonly expiresAt: number;
  readonly usedAt: number | null;
  /** a real investor (not a listed test account): made after the warning was confirmed */
  readonly real: boolean;
}

export type TestLinkState = "live" | "used" | "expired";
export const testLinkState = (e: Pick<TestLinkEntry, "usedAt" | "expiresAt">, now: number): TestLinkState =>
  e.usedAt !== null ? "used" : now >= e.expiresAt ? "expired" : "live";

export const realInvestorWarning = (name: string): string =>
  `${name} is a real investor, not a test account.\n\nThe link opens the full app as ${name} — their money, their documents, their messages. `
  + `It works once, for ${TEST_LINK_MINUTES} minutes, and nothing is emailed to them. Make it?`;

export type TestLinkRefusal = "seat-denied" | "why-missing" | "confirm-needed" | "not-configured" | "issuer-failed";

export type CreateResult =
  | { readonly ok: true; readonly link: TestLinkEntry & { readonly url: string; readonly state: TestLinkState } }
  | { readonly ok: false; readonly kind: "test-link"; readonly reason: TestLinkRefusal; readonly ask?: string }
  | Exclude<RecordResult, { ok: true }>;

export interface TestLinkDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRecord" | "getRelated">;
  readonly events: InvestorEvents;
  readonly log: Pick<OpsLog, "refusal" | "event">;
  readonly issuer: TestLinkIssuer | null;
  /** Contact ids of the app's test accounts (no warning for these). */
  readonly testAccounts?: ReadonlySet<string>;
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
  readonly clock?: () => number;
  readonly newId?: () => string;
}

/** lib/im isSuper: the Investors `di` role; `ops` is the same person's lead-side token (D68, data/scope.ts). */
export const isSuperUserSeat = (seat: string): boolean => seat === "di" || seat === "ops";

export interface TestLinkRegister {
  add(e: TestLinkEntry): void;
  get(id: string): TestLinkEntry | null;
  markUsed(id: string, at: number): TestLinkEntry | null;
  list(contactId?: string): readonly TestLinkEntry[];
}

export function createTestLinkRegister(): TestLinkRegister {
  const m = new Map<string, TestLinkEntry>();
  return Object.freeze({
    add(e: TestLinkEntry) {
      m.set(e.id, Object.freeze({ ...e }));
      while (m.size > MAX_REGISTER) m.delete(m.keys().next().value!);
    },
    get: (id: string) => m.get(id) ?? null,
    markUsed(id: string, at: number) {
      const e = m.get(id);
      if (!e) return null;
      const next = Object.freeze({ ...e, usedAt: at });
      m.set(id, next);
      return next;
    },
    list: (contactId?: string) => Object.freeze([...m.values()].filter((e) => !contactId || e.contactId === contactId).sort((a, b) => b.at - a.at)),
  });
}

export function createTestLinks(deps: TestLinkDeps, register: TestLinkRegister = createTestLinkRegister()) {
  const records = createInvestorRecordReader({ crm: deps.crm, events: deps.events, planeCRefusal: deps.planeCRefusal });
  const clock = deps.clock ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const tests = deps.testAccounts ?? new Set<string>();
  const ids = (contactId: string) => (RECORD_ID.test(contactId) ? [contactId] : []);
  const refuse = (me: string, contactId: string, reason: TestLinkRefusal, ask?: string): CreateResult => {
    deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "test-link", reason, recordIds: ids(contactId) });
    return { ok: false, kind: "test-link", reason, ...(ask ? { ask } : {}) };
  };

  async function create(cred: UserCredential, seat: string, contactId: string, ask: { readonly why?: unknown; readonly confirm?: unknown }, signal?: AbortSignal): Promise<CreateResult> {
    const me = cred.userId;
    if (!isSuperUserSeat(seat)) return refuse(me, contactId, "seat-denied");
    const why = typeof ask.why === "string" ? ask.why.trim() : "";
    if (why.length < WHY_MIN || why.length > WHY_MAX) return refuse(me, contactId, "why-missing");
    const r = await records.read(cred, seat, contactId, signal);
    if (!r.ok) return r;
    const real = !tests.has(r.record.id);
    if (real && ask.confirm !== true) return { ok: false, kind: "test-link", reason: "confirm-needed", ask: realInvestorWarning(r.record.investor.n) };
    if (!deps.issuer) return refuse(me, contactId, "not-configured");
    const at = clock();
    const entry: TestLinkEntry = { id: newId(), contactId: r.record.id, by: me, why, at, expiresAt: at + TEST_LINK_MINUTES * 60_000, usedAt: null, real };
    let minted: Awaited<ReturnType<TestLinkIssuer["mint"]>>;
    try { minted = await deps.issuer.mint({ linkId: entry.id, contactId: entry.contactId, expiresAt: entry.expiresAt }, signal); } catch { minted = { ok: false, code: "unexpected" }; }
    if (!minted.ok || !/^https:\/\/[^\s]+$/.test(minted.url)) return refuse(me, contactId, "issuer-failed");
    register.add(entry);
    deps.log.event?.({ at, actor: { kind: "user", userId: me }, action: "test-link-created", reason: `${real ? "real" : "test"}.why-given.len-${why.length}`, recordIds: [entry.contactId] });
    /* M15-S05-NOTE-1: the authority line — who issued it, for which Contact, from which seat, and how long it lives */
    try { deps.events.testLinkIssued(me, seat, entry.contactId, TEST_LINK_MINUTES, real); } catch { /* the link stands */ }
    return { ok: true, link: Object.freeze({ ...entry, url: minted.url, state: "live" as const }) };
  }

  /** The app reports the link was opened (MA1: its receiver is not wired yet). First use only, while live. */
  function used(linkId: string, at: number = clock()): { readonly ok: true; readonly entry: TestLinkEntry } | { readonly ok: false; readonly reason: "unknown" | TestLinkState } {
    const e = LINK_ID.test(linkId) ? register.get(linkId) : null;
    if (!e) return { ok: false, reason: "unknown" };
    const s = testLinkState(e, at);
    if (s !== "live") return { ok: false, reason: s };
    const next = register.markUsed(linkId, at)!;
    deps.log.event?.({ at, actor: { kind: "service", job: "investor-app" }, action: "test-link-used", reason: "first-use", recordIds: [e.contactId] });
    return { ok: true, entry: next };
  }

  /** The audit rows for System (all) and the investor's Activity (one Contact). Super user only. */
  function list(seat: string, contactId?: string, now: number = clock()): readonly (TestLinkEntry & { readonly state: TestLinkState })[] | null {
    if (!isSuperUserSeat(seat)) return null;
    return Object.freeze(register.list(contactId).map((e) => Object.freeze({ ...e, state: testLinkState(e, now) })));
  }

  return Object.freeze({ create, used, list });
}
export type TestLinks = ReturnType<typeof createTestLinks>;

const G = globalThis as typeof globalThis & { __gzTestLinkRegister?: TestLinkRegister };
/** The process's register (kept across dev reloads). */
export const sharedTestLinkRegister = (): TestLinkRegister => (G.__gzTestLinkRegister ??= createTestLinkRegister());

/** Contact ids of the app's test accounts: ZOHO_TEST_INVESTOR_IDS, comma-separated. */
export const testAccountsFromEnv = (env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> =>
  new Set((env.ZOHO_TEST_INVESTOR_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => RECORD_ID.test(s)));

/** MA1: the investor app's generate-link endpoint is not known yet — no issuer, the route answers 503. */
export const testLinkIssuer = (): TestLinkIssuer | null => null;
