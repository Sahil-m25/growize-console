/* M10-S21-W1 / M10-S22-W1 / M10-S23-W1 — the investor's app, run from the console (D93).
     /api/investors/[id]/unlock      GET the App account card · POST { expectedModifiedTime } unlock + welcome · DELETE { reason, expectedModifiedTime } lock
     /api/investors/[id]/preview     GET the preview mock-up's data (read-only)
     /api/investors/[id]/test-link   GET this investor's links · POST { why, confirm } a one-time link (409 confirm-needed carries `ask`)
   Live: the routes on the person's own token. Fixture: the demo book's ACCESS / TESTLINK records and the reducer's
   sendWelcome / lockApp / createTestLink. */

import type { AppAccessCard } from "@/server/investors/unlock";
import type { AppPreview, PreviewPayout } from "@/server/investors/preview";
import type { TestLinkEntry, TestLinkState } from "@/server/investors/test-link";
import {
  I, PREVIEW_TABS, accessOf, accessView, allotPayStatus, docOf, isAM, llpName, llpOf, mayAccess, mayTestLink, newTestLink,
  nowFull, portfolioOf, testLinkGate, testLinkState, testLinks,
} from "@/lib/im";
import type { ImAccess, ImTestLink } from "@/lib/im";
import { fail, ok, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

const NOT_VISIBLE = () => fail(403, "not-visible", "This investor is not visible to you.");
const enc = encodeURIComponent;

/* ── the App account card (M10-S21) ───────────────────────────────────────────────────────── */
export type CardAnswer = { card: AppAccessCard; already: boolean; noteSaved?: boolean };

const cardOf = (b: ImBook, id: string, a: ImAccess | null): AppAccessCard => {
  const v = accessView(a);
  return {
    contactId: id, code: null, access: a ? a.App_Access : null, state: v.k, text: v.t,
    welcomeAt: a ? a.App_Welcome_At : null, welcomeChannel: a ? a.App_Welcome_Channel : null,
    /* the demo book has no Modified_Time; live sends it back as expectedModifiedTime (D44) */
    modifiedTime: null,
    history: a && a.Locked_At ? [{ at: a.Locked_At, byId: a.Locked_By ?? null }] : [],
    mayChange: mayAccess(b.s, b.me), historyRead: true,
  };
};

export const appCard: ReadEndpoint<ImBook, string | null, CardAnswer> = {
  path: id => (id ? `/api/investors/${enc(id)}/unlock` : null),
  pick: j => j as CardAnswer,
  fixture(b, id) {
    if (!id || !I(b.s, b.me, id)) return NOT_VISIBLE();
    return ok({ card: cardOf(b, id, accessOf(b.s, b.me, id)), already: false });
  },
};

export type UnlockArgs = { id: string; expectedModifiedTime: string | null };
export type LockArgs = UnlockArgs & { reason: string };
export type CardChanged = Pick<CardAnswer, "card" | "already">;

export const appUnlock: WriteEndpoint<ImBook, UnlockArgs, CardChanged, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${enc(a.id)}/unlock`,
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as CardChanged,
  fixture(b, d, a): ApiResult<CardChanged> {
    const acc = accessOf(b.s, b.me, a.id);
    const now: ImAccess = { App_Access: "Invite", App_Welcome_At: null, App_Welcome_Channel: null };
    return imFixtureWrite(b, d, { type: "sendWelcome", id: a.id }, { card: cardOf(b, a.id, acc ? now : null), already: false });
  },
  onLiveError: imLiveError,
};

export const appLock: WriteEndpoint<ImBook, LockArgs, CardChanged, ImDispatch> = {
  method: "DELETE",
  path: a => `/api/investors/${enc(a.id)}/unlock`,
  body: a => ({ reason: a.reason, expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as CardChanged,
  fixture(b, d, a): ApiResult<CardChanged> {
    const acc = accessOf(b.s, b.me, a.id);
    const now: ImAccess = { App_Access: "Hold", App_Welcome_At: null, App_Welcome_Channel: null, Locked_Reason: a.reason.trim(), Locked_By: b.me };
    return imFixtureWrite(b, d, { type: "lockApp", id: a.id, why: a.reason }, { card: cardOf(b, a.id, acc ? now : null), already: false });
  },
  onLiveError: imLiveError,
};

/* ── the app preview (M10-S22) ────────────────────────────────────────────────────────────── */
export type PreviewAnswer = { preview: AppPreview };

export const appPreview: ReadEndpoint<ImBook, string | null, PreviewAnswer> = {
  path: id => (id ? `/api/investors/${enc(id)}/preview` : null),
  pick: j => j as PreviewAnswer,
  fixture({ s, me }, id) {
    const P = id ? portfolioOf(s, me, id) : null;
    if (!id || !P) return NOT_VISIBLE();
    const { x } = P;
    const amounts = !isAM(s, me);          /* amounts only for a seat whose record has Money; documents only where it has Paper */
    const poRows: PreviewPayout[] = P.payouts.map(p => ({ id: p.id, allotmentId: p.Allotment, kind: p.Payout_Kind, instalment: p.Instalment_No,
      month: p.Period_Month, dueOn: p.Due_On, state: p.Payout_State, paidOn: p.Paid_On, net: amounts ? p.Net_Amount : null,
      gross: amounts ? p.Gross_Amount : null, tds: amounts ? p.TDS_Amount : null })).sort((a, b) => ((a.dueOn ?? "") < (b.dueOn ?? "") ? -1 : 1));
    const paid = poRows.filter(p => p.state === "Paid"), next = P.next;
    const docs = amounts ? docOf(s, me, id).filter(d => d.state === "signed" || d.state === "issued")
      .map(d => ({ id: d.id, name: d.t, at: d.on || d.sent || null, scope: "personal" as const })) : null;
    const activity = paid.filter(p => p.paidOn).map(p => ({ at: p.paidOn!, t: `Payout paid${p.month ? " for " + p.month.slice(0, 7) : ""}` }))
      .concat((docs ?? []).filter(d => d.at).map(d => ({ at: d.at!, t: `Document added: ${d.name}` })))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 20);
    return ok({ preview: {
      investorId: id, label: "Preview — mock-up, not the live app", readOnly: true, tabs: [...PREVIEW_TABS], amounts,
      home: { name: x.n, firstName: x.n.split(" ")[0] ?? x.n, units: P.units, invested: amounts ? P.invested : null,
        paidOut: paid.reduce((n, p) => n + (p.net ?? 0), 0),
        nextPayout: next ? { dueOn: next.Due_On, net: amounts ? next.Net_Amount : null } : null,
        stages: [{ t: "Reserved", done: P.al.length > 0 || Object.keys(x.blocks).length > 0 }, { t: "Paid in full", done: x.st === "paid" || x.st === "allocated" },
          { t: "Allotted", done: x.st === "allocated" }, { t: "Monthly payouts", done: paid.length > 0 }] },
      projects: P.al.map(a => ({ allotmentId: a.id, llpId: a.LLP_Lookup, name: llpName(s, a), block: (llpOf(s, a.LLP_Lookup) || { Block_Code: "" }).Block_Code,
        units: a.Committed_Units, issued: a.Issued_Units, status: a.Allocation_Status, paymentStatus: allotPayStatus(s, a), holdUntil: x.hold ?? null })),
      financials: { invested: amounts ? P.invested : null, due: amounts ? Math.max(0, P.al.reduce((n, a) => n + a.Ticket_Snapshot, 0) - P.invested) : null,
        paidOut: paid.reduce((n, p) => n + (p.net ?? 0), 0), payouts: poRows },
      documents: docs, activity,
      profile: { name: x.n, city: x.city, nominee: x.nominee, email: x.em, mobile: x.ph, pan: "Finance only", bank: "Finance only" },
    } });
  },
};

/* ── the test sign-in link (M10-S23) ──────────────────────────────────────────────────────── */
const IST_MS = 5.5 * 3_600_000;
export type TestLinkRow = TestLinkEntry & { state: TestLinkState };
export type MadeLink = TestLinkRow & { url: string };
export type TestLinkList = { links: TestLinkRow[] };

/** The demo book stamps naive "YYYY-MM-DDTHH:MM" IST times; the route sends real epoch ms. */
const ms = (iso: string): number => Date.parse(iso + ":00Z") - IST_MS;
const rowOf = (l: ImTestLink, now: number): TestLinkRow => ({ id: l.id, contactId: l.inv, by: l.by, why: l.why, at: ms(l.at), expiresAt: ms(l.expires),
  usedAt: l.usedAt ? ms(l.usedAt) : null, real: true, state: testLinkState(l, now) });

export const testLinkList: ReadEndpoint<ImBook, string | null, TestLinkList> = {
  path: id => (id ? `/api/investors/${enc(id)}/test-link` : null),
  pick: j => j as TestLinkList,
  fixture({ s, me }, id) {
    if (!mayTestLink(s, me)) return fail(403, "seat-denied", "Only the super user can make a test sign-in link.");
    const now = nowFull(s.data.NOW);
    return ok({ links: testLinks(s).filter(l => l.inv === id).map(l => rowOf(l, now)) });
  },
};

export type TestLinkArgs = { id: string; why: string; confirm: boolean };
const CONFIRM_NEEDED = "Confirm to make a link for a real investor.";

export const testLinkMake: WriteEndpoint<ImBook, TestLinkArgs, MadeLink, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${enc(a.id)}/test-link`,
  body: a => ({ why: a.why, confirm: a.confirm }),
  pick: j => (j as { link: MadeLink }).link,
  fixture(b, d, a): ApiResult<MadeLink> {
    const g = testLinkGate(b.s, b.me, a.id, a.why);
    /* a refusal (no seat, no reason) is the reducer's own note; the question is the route's 409 with the warning */
    if (!g.ok) {
      if (g.msg) d({ type: "createTestLink", id: a.id, why: a.why });
      return fail(g.msg ? 422 : 403, g.msg ? "refused" : "seat-denied", g.msg || "Only the super user can make a test sign-in link.");
    }
    if (g.ask && !a.confirm) return { ok: false, status: 409, code: "confirm-needed", error: CONFIRM_NEEDED, ask: g.ask };
    const l = newTestLink(b.s, b.me, a.id, a.why);
    d({ type: "createTestLink", id: a.id, why: a.why });
    if (g.ask) d({ type: "confirmYes" });
    return ok({ ...rowOf(l, nowFull(b.s.data.NOW)), real: !!g.ask, url: l.url });
  },
  onLiveError: imLiveError,
};

