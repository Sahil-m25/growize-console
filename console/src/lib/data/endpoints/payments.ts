/* M10-S01-W1 / M10-S08-W1 / M10-S09-W1 — the money reads on the Investors side:
     GET /api/payments                    the Payments register (server/money/register; matched-only totals, D21)
     GET /api/investors/[id]/money        the Money section per allotment (server/money/by-allotment)
     GET /api/investors/[id]/holdings     ARL holdings and their transactions, read-only (server/investors/holdings)
   Live: the routes, on the person's own token. Fixture: the same answer projected from the demo book. */

import type { RegisterResult } from "@/server/money/register";
import type { MoneyByAllotment, MoneyBlock } from "@/server/money/by-allotment";
import type { ArlHoldingLine } from "@/server/investors/holdings";
import {
  I, allotOf, allotOfTxn, allotPayStatus, allotsOf, arlTxnsOf, holdingsOf, isAM, isSuper, llpOf, may, mayHoldings,
  pageReadable, UNIT,
} from "@/lib/im";
import type { ImAllot, ImTxn } from "@/lib/im";
import { fail, ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";

/* ── the register ─────────────────────────────────────────────────────────────────────────── */
export type RegisterView = Extract<RegisterResult, { ok: true }>["value"];
export type RegisterRowView = RegisterView["rows"][number];
export type RegisterArgs = { kind?: "advance" | "full" | "out"; farm?: string; reconciled?: boolean };

const qs = (a: RegisterArgs): string => {
  const p = new URLSearchParams();
  if (a.kind) p.set("kind", a.kind);
  if (a.farm) p.set("farm", a.farm);
  if (a.reconciled !== undefined) p.set("reconciled", String(a.reconciled));
  const s = p.toString();
  return s ? "?" + s : "";
};

const INBOUND = (t: ImTxn) => t.kind === "advance" || t.kind === "balance" || t.kind === "full";
const CUT: Record<NonNullable<RegisterArgs["kind"]>, (t: ImTxn) => boolean> = {
  advance: t => t.kind === "advance",
  full: t => t.kind === "full" || t.kind === "balance",
  out: t => t.kind === "refund" || t.kind === "forfeit",
};

/** The register's answer from the demo book. The UTR follows the route: only a Finance seat that records reads it whole —
 *  the super user (an identity-wall seat, rule 7 / D13) and read-only seats get null and the page says "Finance only".
 *  `receivedOn` carries the demo book's own stamp ("02 Sep 10:00"); the route sends "YYYY-MM-DD". */
export const paymentsRegister: ReadEndpoint<ImBook, RegisterArgs, RegisterView> = {
  path: a => "/api/payments" + qs(a),
  pick: j => j as RegisterView,
  fixture({ s, me }, a) {
    if (!pageReadable(s, me, "txn")) return fail(403, "capability-missing", "This page is not part of your seat.");
    const seesUtr = may(s, me, "pay") && !isSuper(s, me);
    const rowOf = (t: ImTxn): RegisterRowView => {
      const al = allotOf(s, allotOfTxn(s, t)), l = al ? llpOf(s, al.LLP_Lookup) : null;
      const x = s.data.INV.find(y => y.id === t.inv);
      const blk = x ? Object.keys(x.blocks)[0] : undefined;
      return {
        id: t.id, kind: t.kind, amount: t.amt, mode: t.mode || null, utr: seesUtr ? t.utr : null, utrHidden: !seesUtr,
        receivedOn: t.on, matchState: t.rec === "matched" ? "Matched" : "Pending", reconciled: t.rec === "matched",
        allotmentId: al ? al.id : "", investor: { id: t.inv, name: x ? x.n : null },
        farm: l ? { id: l.id, name: l.Name } : { id: blk || "", name: blk ? "Block " + blk : null },
        recordedById: t.by || null, reversalOf: null,
      };
    };
    const all = s.data.TXN.map(t => ({ t, r: rowOf(t) })).filter(({ r }) => !a.farm || r.farm.id === a.farm);
    const sum = (keep: (t: ImTxn) => boolean) => all.filter(({ t }) => keep(t)).reduce((n, { t }) => n + t.amt, 0);
    const matched = (t: ImTxn) => t.rec === "matched", pending = (t: ImTxn) => t.rec === "pending";
    const received = sum(t => INBOUND(t) && matched(t)), refunded = sum(t => t.kind === "refund" && matched(t));
    const recIn = sum(t => INBOUND(t) && pending(t)), recOut = sum(t => t.kind === "refund" && pending(t));
    /* still due: Reserved investors' commitment less what stands on them (matched net, never below 0) */
    const standing = (id: string) => s.data.TXN.filter(t => t.inv === id && matched(t))
      .reduce((n, t) => n + (INBOUND(t) ? t.amt : t.kind === "refund" ? -t.amt : 0), 0);
    const stillDue = s.data.INV.filter(x => x.st === "reserved")
      .reduce((n, x) => n + Math.max(0, x.units * UNIT - Math.max(0, standing(x.id))), 0);
    const cnt = (f: (t: ImTxn) => boolean) => all.filter(({ t }) => f(t)).length;
    const shown = all.filter(({ t, r }) => (!a.kind || CUT[a.kind](t)) && (a.reconciled === undefined || r.reconciled === a.reconciled)).map(({ r }) => r);
    const farms = new Map<string, string | null>();
    for (const { r } of all) if (r.farm.id && !farms.has(r.farm.id)) farms.set(r.farm.id, r.farm.name);
    return ok({
      rows: shown,
      counts: { all: all.length, advance: cnt(CUT.advance), full: cnt(CUT.full), out: cnt(CUT.out), pending: cnt(t => t.rec !== "matched") },
      totals: { received, refunded, netBanked: received - refunded, stillDue, recorded: { received: recIn, refunded: recOut, net: recIn - recOut } },
      farms: [...farms].map(([id, name]) => ({ id, name })),
      readOnly: !may(s, me, "pay"),
    });
  },
};

/* ── the Money section per allotment ──────────────────────────────────────────────────────── */
export type MoneyView = { money: MoneyByAllotment };

/** One allotment as the route's MoneyBlock: paid / due from MATCHED receipts, Pending apart as `recorded` (D21).
 *  `receipts[].note` is not in the route's ReceiptRow, so the notes the demo receipts carry are not shown here. */
export function fixtureMoneyBlock({ s }: ImBook, a: ImAllot): MoneyBlock {
  const mine = s.data.TXN.filter(t => t.inv === a.Customer && allotOfTxn(s, t) === a.id);
  const isIn = INBOUND, isOut = (t: ImTxn) => t.kind === "refund";
  const paid = mine.filter(t => t.rec === "matched" && isIn(t)).reduce((n, t) => n + t.amt, 0);
  const out = mine.filter(t => t.rec === "matched" && isOut(t)).reduce((n, t) => n + t.amt, 0);
  const recorded = mine.filter(t => t.rec === "pending").reduce((n, t) => n + (isIn(t) ? t.amt : isOut(t) ? -t.amt : 0), 0);
  const amount = a.Committed_Units * a.Unit_Price;
  const l = llpOf(s, a.LLP_Lookup);
  return {
    allotmentId: a.id, llp: { id: a.LLP_Lookup, name: l ? l.Name : null }, status: a.Allocation_Status, units: a.Committed_Units,
    issuedUnits: a.Issued_Units, unitPrice: a.Unit_Price, amount, paid, recorded,
    due: a.Allocation_Status === "Reserved" ? Math.max(0, amount - Math.max(0, paid - out)) : 0,
    paymentStatus: allotPayStatus(s, a), countsInTotal: a.Allocation_Status !== "Cancelled",
    receipts: mine.map(t => ({ id: t.id, allotmentId: a.id, kind: t.kind, amount: t.amt, mode: t.mode || null, utr: t.utr,
      on: t.on, byId: t.by || null, matched: t.rec === "matched", matchState: t.rec === "matched" ? "Matched" : "Pending", reversalOf: null })),
  };
}

export const moneyBlocks: ReadEndpoint<ImBook, string | null, MoneyView> = {
  path: id => (id ? `/api/investors/${encodeURIComponent(id)}/money` : null),
  pick: j => j as MoneyView,
  fixture(b, id) {
    const { s, me } = b;
    if (!I(s, me, id) || isAM(s, me) || !id) return fail(403, "refused", "This investor is not part of your book.");
    const blocks = allotsOf(s, me, id).map(a => fixtureMoneyBlock(b, a));
    const counted = blocks.filter(x => x.countsInTotal);
    const investorRow = { paid: counted.reduce((n, x) => n + x.paid, 0), due: counted.reduce((n, x) => n + x.due, 0) };
    const ids = new Set(blocks.map(x => x.allotmentId));
    return ok({ money: { contactId: id, blocks, total: blocks.length > 1 ? investorRow : null, investorRow,
      unlinked: s.data.TXN.filter(t => t.inv === id && !ids.has(allotOfTxn(s, t) || "")).map(t => ({ id: t.id, allotmentId: null, kind: t.kind,
        amount: t.amt, mode: t.mode || null, utr: t.utr, on: t.on, byId: t.by || null, matched: t.rec === "matched",
        matchState: t.rec === "matched" ? "Matched" : "Pending", reversalOf: null })) } });
  },
};

/* ── ARL holdings (read-only, D70) ────────────────────────────────────────────────────────── */
export type HoldingsView = { contactId: string; holdings: ArlHoldingLine[]; readOnly: true; truncated: boolean };
export const arlHoldings: ReadEndpoint<ImBook, string | null, HoldingsView> = {
  path: id => (id ? `/api/investors/${encodeURIComponent(id)}/holdings` : null),
  pick: j => j as HoldingsView,
  fixture({ s, me }, id) {
    if (!id) return fail(403, "refused", "This investor is not part of your book.");
    if (!mayHoldings(s, me)) return fail(403, "seat-denied", "This investor is not part of your book.");
    if (!I(s, me, id)) return fail(403, "not-visible", "This investor is not part of your book.");
    return ok({ contactId: id, readOnly: true, truncated: false, holdings: holdingsOf(s, me, id).map(h => ({
      id: h.id, name: null, instrument: h.Instrument_Type, amount: h.Amount_Invested, currentValue: null, interestAccrued: null,
      investedOn: h.Invested_On, maturesOn: h.Maturity_On, interestRatePct: h.Interest_Rate, units: null, faceValue: null,
      conversionStatus: null, certificateNo: null,
      transactions: arlTxnsOf(s, h).map(t => ({ id: t.id, type: t.Type, date: t.Date, amount: t.Amount, reference: null })),
    })) });
  },
};
