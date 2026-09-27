/* ── Transfers — the merged prototype's D60 transfer rules (ir-merged.js 6879–6905).
   One Zoho org: a lead becomes an investor record the moment it reaches "Investor said yes", so
   that rung IS the transfer and its stamp is the transfer date. A lead lost after saying yes still
   counts, on its said-yes date. Names are only ever leads this seat may already open. ────────── */

import { ST } from "@/domain";
import type { Lead } from "@/domain";
import { DAY, dayOf, whenT } from "@/lib/format";
import type { Ctx } from "./ctx";
import { P } from "./ctx";
import { may } from "./access";
import { lost, openable } from "./leads";

export const xfYes = (l: Lead | null | undefined, NOW: Date): Date | null =>
  (l && l.done >= ST.CONVERTED) ? whenT((l.at || [])[ST.CONVERTED - 1], NOW) : null;
export const xfMonthKey = (d: Date): string => d.getFullYear() + "-" + d.getMonth();

export const xfAfter = (l: Lead): { t: string; c: string } => lost(l) ? { t: "Lost after yes", c: "late" }
  : l.done >= ST.ALLOCATED ? { t: "Allocated", c: "go" }
  : l.done >= ST.PAID ? { t: "Fully paid", c: "go" }
  : l.done >= ST.RESERVED ? { t: "10% in", c: "br" }
  : { t: "Awaiting 10%", c: "" };

const partnerLabel = (ctx: Ctx, l: Lead): string => l && l.src === "Channel partner"
  ? (l.channelPartnerId ? P(ctx.PEOPLE, l.channelPartnerId).n : "Partner not recorded") : "";

export const xfHow = (ctx: Ctx, l: Lead): string => {
  const ev = l.ev ? ctx.EVENTS.find(e => e.id === l.ev) : undefined;
  return [l.src || "Source not recorded", ev ? ev.n : "", partnerLabel(ctx, l)].filter(Boolean).join(" · ");
};

export type XfRow = { l: Lead; yes: Date; days: number | null };
export function xfRows(ctx: Ctx): XfRow[] {
  if (!may(ctx, "xfer", "view")) return [];
  return openable(ctx).map(l => {
    const yes = xfYes(l, ctx.NOW), cap = whenT((l.at || [])[0], ctx.NOW);
    return yes ? { l, yes, days: cap ? Math.round((dayOf(yes).getTime() - dayOf(cap).getTime()) / DAY) : null } : null;
  }).filter((r): r is XfRow => !!r).sort((a, b) => b.yes.getTime() - a.yes.getTime());
}

export type XfMonth = { k: string; d: Date; rows: XfRow[] };
export function xfMonths(ctx: Ctx): XfMonth[] {
  const by: Record<string, XfMonth> = {};
  xfRows(ctx).forEach(r => {
    const k = xfMonthKey(r.yes);
    (by[k] = by[k] || { k, d: new Date(r.yes.getFullYear(), r.yes.getMonth(), 1), rows: [] }).rows.push(r);
  });
  return Object.values(by).sort((a, b) => b.d.getTime() - a.d.getTime()).slice(0, 6);
}
