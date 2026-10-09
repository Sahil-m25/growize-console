/* ── im/selectors.ts — every read the Investors pages make, as pure functions ───────────────
   Ports imx.js sections 1–8 (lines 67–1342, the reads) and the reads section 14 needs
   (2474–2511, 2893–2903). A prototype global becomes a parameter: `s` is the state (`ImCtx`;
   `ImState` satisfies it) and `WHO` is the signed-in person — the prototype's `me()`.
   Every function keeps its prototype name and its prototype argument order after `(s, WHO)`.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import {
  APPLOCK, CAN, DAY, FORFEIT, KINDS, NAV, PRIMARY, ROLE, ROUNDS, SECRETS, TEAM, TIERS, UNIT,
  type ImNavItem, type ImTier,
} from "./constants";
import { aged, gap, isoWall, mid, nowDay, when } from "./dates";
import { invMatch } from "./search";
import type {
  ImApp, ImCan, ImContact, ImCtx, ImDoc, ImDrawerKey, ImInbox, ImInvestor, ImLogEntry, ImQ, ImRole,
  ImRoleKey, ImRound, ImState, ImTicket, ImTxn, ImView, ImWho, ImField, ImAns, ImData,
} from "./types";
import { MONEY_DRAWERS, moneyDrawerReadable } from "./money";

/* ============================ 1. the people ============================ */
/** The name of whoever holds seat `r` on the record (the first in sign-in order who can sign in),
 *  or null when nobody does — the prototype's "primary: Harsha Bhat" read from the data. */
export function primaryName(data: ImData, r: ImRoleKey): string | null {
  const k = [...data.SIGNINS, ...Object.keys(data.P)].find(x => data.P[x]?.r === r && has(data, x));
  return k ? data.P[k]!.n : null;
}
/** PRIMARY[k] as a sentence: "Finance — <name>" per team, the bare team when that seat is empty. */
export function primaryDoer(data: ImData, k: string): string | null {
  const p = PRIMARY[k];
  if (p == null) return null;
  if (typeof p === "string") return p;
  return p.map(([t, r]) => { const n = primaryName(data, r); return n ? t + " — " + n : t; }).join(" or ");
}

export function who(s: ImCtx, k: string | null | undefined): ImWho {
  const p = k ? s.data.P[k] : undefined;
  if (p) return p;
  const x = k ? s.data.IRN[k] : undefined;
  if (x) return Object.assign({ r: "audit" as ImRoleKey, c: 0 }, x);
  return { n: k || "—", i: "—", r: "audit", c: 0 };
}
export const role = (s: ImCtx, k: string | null | undefined): ImRole => ROLE[who(s, k).r] || ROLE.audit;
export const may = (s: ImCtx, WHO: string, c: ImCan): boolean => role(s, WHO).can.includes(c);
export const teamOf = (s: ImCtx, k: string): string => TEAM[(ROLE[who(s, k).r] || ROLE.audit).tm] || "—";
export const isAM = (s: ImCtx, WHO: string): boolean => (ROLE[who(s, WHO).r] || {}).tm === "am";
export const isSys = (s: ImCtx, WHO: string): boolean => (ROLE[who(s, WHO).r] || {}).tm === "sys";
/** Identity belongs to Finance (and the super user); everybody else is on the far side of the wall. */
export const notFin = (s: ImCtx, WHO: string): boolean =>
  (ROLE[who(s, WHO).r] || {}).tm !== "fin" && who(s, WHO).r !== "di";
export const isSuper = (s: ImCtx, WHO: string): boolean => who(s, WHO).r === "di";
export const KAMS = (s: ImCtx): string[] =>
  Object.keys(s.data.P).filter(k => (ROLE[s.data.P[k].r] || {}).tm === "am" && s.data.P[k].r === "kam");
/** IMX.has — a person who signs in here and may open the pages */
export const has = (data: ImData, k: string): boolean =>
  !!data.P[k] && data.SIGNINS.includes(k) && (ROLE[data.P[k].r] || { can: [] }).can.includes("view");

/* ============================ 2. identity ============================ */
export const maskPan = (p: string | null | undefined): string => (p ? p.slice(0, 3) + "•••••" + p.slice(-1) : "—");
export const maskAcct = (a: string | null | undefined): string => (a ? "•••• •••• " + String(a).slice(-4) : "—");
/** has this person revealed this field this session (and do they still hold the right) */
export const shown = (s: ImState, WHO: string, id: string, f: "pan" | "acct"): boolean =>
  !!I(s, WHO, id) && (f === "pan" ? may(s, WHO, "pii") : f === "acct" && may(s, WHO, "bank"))
  && !!s.ui.SHOWN[WHO + "|" + id + ":" + f];

/** the register's "••• 8119" — the last four and no more (lib/format maskRef, kept in step) */
export const maskRefTail = (r: string | null | undefined): string => { const v = String(r ?? "").trim(); return !v ? "—" : v.length <= 4 ? "••••" : "••• " + v.slice(-4); };
/** has this person shown this receipt's bank reference this session (and do they still hold the right) */
export const refShown = (s: ImState, WHO: string, tid: string): boolean => may(s, WHO, "bank") && !!s.ui.SHOWN[WHO + "|" + tid + ":ref"];

export function withholdKnown(value: unknown, values: (string | null | undefined)[], marker: string): string {
  let out = String(value == null ? "" : value);
  values.filter((v): v is string => !!v && String(v).length >= 4).map(String).sort((a, b) => b.length - a.length).forEach(v => {
    const needle = v.toLowerCase(); let start = out.toLowerCase().indexOf(needle);
    while (start >= 0) {
      out = out.slice(0, start) + marker + out.slice(start + v.length);
      start = out.toLowerCase().indexOf(needle, start + marker.length);
    }
  });
  return out;
}
/** Identity stays behind a logged reveal even when it was pasted into a note. */
export function safeNote(s: ImCtx, WHO: string, t: unknown): string {
  let out = withholdKnown(t, s.data.INV.flatMap(x => [x.pan, x.aref, (x.bank || {}).acct]), "••••••");
  (notFin(s, WHO) ? SECRETS : SECRETS.slice(0, 2)).forEach(re => { out = out.replace(re, "••••••"); });
  return out;
}
export function auditText(s: ImCtx, WHO: string, value: unknown): string {
  const out = safeNote(s, WHO, value);
  const privateValues = s.data.INV.flatMap(x => [x.id, x.n, x.ph, x.em, x.addr, x.nominee, x.pan, x.aref, (x.bank || {}).acct])
    .concat(s.data.TXN.map(t => t.utr), s.data.DOCS.map(d => d.ref));
  return withholdKnown(out, privateValues, "[withheld]");
}

/* ============================ 3. the book ============================ */
/** The origin lead in words: its name (live) or its code (the demo book); a bare Zoho record id is never words, so it reads as nothing (W3-2, B-16). */
export const leadWords = (x: Pick<ImInvestor, "lead" | "leadName"> | null | undefined): string | null =>
  x?.leadName || (x?.lead && !/^\d{10,}$/.test(x.lead) ? x.lead : null);

export const tierOf = (x: ImInvestor | null | undefined): ImTier | null =>
  !x ? null : TIERS.find(t => x.units >= t.min) || TIERS[TIERS.length - 1];
export const cadence = (x: ImInvestor | null | undefined): number => (tierOf(x) || { every: 180 }).every || 180;
/** only an allotted holding is under care */
export const cared = (x: ImInvestor | null | undefined): x is ImInvestor => !!x && x.st === "allocated";
export const needsKam = (x: ImInvestor | null | undefined): boolean =>
  cared(x) && !x.kam && !(tierOf(x) || { pool: false }).pool;

/** Finance reads the book; AM leadership reads allotted accounts; a KAM reads their own; admin none. */
export function readBook(s: ImCtx, WHO: string): ImInvestor[] {
  if (!s.data.P[WHO] || !may(s, WHO, "view") || isSys(s, WHO)) return [];
  if (isAM(s, WHO)) return who(s, WHO).r === "kam" ? s.data.INV.filter(x => x.kam === WHO) : s.data.INV.filter(cared);
  return s.data.INV;
}
export const myBook = readBook;
export const I = (s: ImCtx, WHO: string, id: string | null | undefined): ImInvestor | null =>
  readBook(s, WHO).find(x => x.id === id) || null;

export const cOf = (s: ImCtx, WHO: string, id: string): ImContact[] =>
  I(s, WHO, id) ? s.data.CONTACT.filter(c => c.inv === id).map(c => Object.assign({}, c, { note: safeNote(s, WHO, c.note) })) : [];
export const cOf_all = (s: ImCtx, WHO: string): ImContact[] =>
  s.data.CONTACT.filter(c => I(s, WHO, c.inv)).map(c => Object.assign({}, c, { note: safeNote(s, WHO, c.note) }));
export const lastC = (s: ImCtx, WHO: string, id: string): ImContact | null => cOf(s, WHO, id)[0] || null;
/** when the next contact is owed (epoch ms) */
export function dueOn(s: ImCtx, WHO: string, x: ImInvestor): number | null {
  if (!cared(x)) return null;
  if (x.nextOn) { const o = when(s.data.NOW, x.nextOn); if (o) return o; }
  const l = lastC(s, WHO, x.id), base = l ? when(s.data.NOW, l.at) : when(s.data.NOW, x.since + " 09:00");
  if (!base) return null;
  return base + cadence(x) * DAY;
}
/** days past the cadence (negative: days until) — both sides floored to midnight */
export function overdue(s: ImCtx, WHO: string, x: ImInvestor): number | null {
  const d = mid(dueOn(s, WHO, x));
  return d == null ? null : Math.round((nowDay(s.data.NOW) - d) / DAY);
}
export const quiet = (s: ImCtx, WHO: string, x: ImInvestor): boolean => { const o = overdue(s, WHO, x); return o != null && o > 0; };
export const bookOf = (s: ImCtx, WHO: string, k: string): ImInvestor[] => readBook(s, WHO).filter(x => x.kam === k);
/** one predicate for the button and the handler: a KAM works their own book */
export const mayCare = (s: ImCtx, WHO: string, x: ImInvestor | null | undefined): boolean =>
  !!x && !!I(s, WHO, x.id) && may(s, WHO, "care") && cared(x) && (who(s, WHO).r !== "kam" || x.kam === WHO);
export const mayDetails = (s: ImCtx, WHO: string, x: ImInvestor | null | undefined): boolean =>
  !!x && !!I(s, WHO, x.id) && may(s, WHO, "details") && (who(s, WHO).r !== "kam" || x.kam === WHO);
/** D132: the same rights as mayCare / mayDetails for a record read live (GET /api/investors/[id]/record), which is not in the
 *  demo book `I()` looks in. The route re-derives the right and the KAM's own-account rule from the live session; this only
 *  decides whether the button is offered. */
export const mayCareOn = (s: ImCtx, WHO: string, x: ImInvestor | null | undefined): boolean =>
  !!x && may(s, WHO, "care") && cared(x) && (who(s, WHO).r !== "kam" || x.kam === WHO);
export const mayDetailsOn = (s: ImCtx, WHO: string, x: ImInvestor | null | undefined): boolean =>
  !!x && may(s, WHO, "details") && (who(s, WHO).r !== "kam" || x.kam === WHO);
export const kamGone = (s: ImCtx, x: ImInvestor): boolean => !!x.kam && !KAMS(s).includes(x.kam);
export const poolBook = (s: ImCtx, WHO: string): ImInvestor[] =>
  readBook(s, WHO).filter(x => cared(x) && (!x.kam || kamGone(s, x)));

export const held = (s: ImCtx, st: ImInvestor["st"]): number => s.data.INV.filter(x => x.st === st).reduce((a, x) => a + x.units, 0);
export const allocated = (s: ImCtx): number => held(s, "allocated");
/** paid, not yet allotted, is still held */
export const reserved = (s: ImCtx): number => held(s, "reserved") + held(s, "paid");
export const released = (s: ImCtx): number => s.data.FARMS.reduce((a, f) => a + f.released, 0);
export const freeUnits = (s: ImCtx): number => released(s) - allocated(s) - reserved(s);
export const blockUse = (s: ImCtx, k: string): number => s.data.INV.reduce((a, x) => a + (x.blocks[k] || 0), 0);

/* ---- money ---- */
export const txOf = (s: ImCtx, WHO: string, id: string): (ImTxn & { note: string })[] =>
  I(s, WHO, id) ? s.data.TXN.filter(t => t.inv === id).map(t => Object.assign({}, t,
    { utr: notFin(s, WHO) ? "Finance only" : t.utr, note: safeNote(s, WHO, t.note) })) : [];
export const gotBy = (s: ImCtx, WHO: string, id: string): number =>
  txOf(s, WHO, id).reduce((a, t) => a + (t.kind === "refund" || t.kind === "forfeit" ? 0 : t.amt), 0);
export const dueBy = (s: ImCtx, WHO: string, id: string): number => {
  const x = I(s, WHO, id);
  return x && x.st !== "lapsed" ? Math.max(0, x.units * UNIT - gotBy(s, WHO, id)) : 0;
};
/** only what has been reconciled counts as banked — a refund too */
export const banked = (s: ImCtx): number => s.data.TXN.filter(t => t.rec === "matched")
  .reduce((a, t) => a + (t.kind === "refund" ? -t.amt : t.amt), 0);

/* ---- paper ---- */
export const docOf = (s: ImCtx, WHO: string, id: string): ImDoc[] =>
  I(s, WHO, id) ? s.data.DOCS.filter(d => d.inv === id).map(d => (notFin(s, WHO) ? Object.assign({}, d, { ref: null }) : d)) : [];

/* ============================ 4. the link ============================ */
export const ansOf = (s: ImCtx, nid: string): ImAns | null => s.data.ANS[nid] || null;
export const nState = (s: ImCtx, n: ImInbox | null | undefined): string | null =>
  !n ? null : (s.data.ANS[n.id] || { state: undefined }).state || n.state;
export const nOpen = (s: ImCtx, n: ImInbox | null | undefined): boolean => nState(s, n) === "open";
export const inFor = (s: ImCtx, WHO: string, id: string): ImInbox[] =>
  I(s, WHO, id) ? s.data.INBOX.filter(x => x.inv === id).map(x => Object.assign({}, x, { d: safeNote(s, WHO, x.d) })) : [];
export const claimsOpen = (s: ImCtx): ImInbox[] => s.data.INBOX.filter(x => x.kind === "claim" && nOpen(s, x));

/* ---- tickets ---- */
export const tkOf = (s: ImCtx, WHO: string, id: string): ImTicket[] =>
  I(s, WHO, id) ? s.data.TKT.filter(t => t.inv === id).map(t => Object.assign({}, t, { d: safeNote(s, WHO, t.d) })) : [];
export const ticketBook = (s: ImCtx, WHO: string): ImTicket[] =>
  s.data.TKT.filter(t => I(s, WHO, t.inv) && (!isAM(s, WHO) || t.own === WHO || (t.handed || { by: "" }).by === WHO));
export const tkOpen = (s: ImCtx, WHO: string): ImTicket[] => ticketBook(s, WHO).filter(t => t.state !== "closed");

/* ---- the field log ---- */
export const fieldOf = (s: ImCtx, k: string): ImField[] => s.data.FIELD.filter(f => f.blk === k);

/* ============================ 5. the log ============================ */
export const logFor = (s: ImCtx, WHO: string, id: string): ImLogEntry[] =>
  I(s, WHO, id) ? s.data.LOG.filter(e => e.inv === id).map(e => Object.assign({}, e,
    { what: safeNote(s, WHO, e.what), note: safeNote(s, WHO, e.note) })) : [];

/* ============================ 6. the round ============================ */
export function roundOf(s: ImCtx, WHO: string, inv: string, rk: string): ImRound {
  const R = ROUNDS.find(x => x.k === rk), d = R && docOf(s, WHO, inv).find(x => x.t === R.tpl);
  if (!d) return { R, state: "none", t: "Not sent yet", who: "Finance", d: null };
  if (d.state === "signed") return { R, state: "done", t: "Signed and verified", who: null, d };
  if (d.state === "blocked") return { R, state: "blocked", t: "Blocked", who: "Finance", d };
  const said = inFor(s, WHO, inv).find(x => x.kind === "signed" && (!x.doc || x.doc === R!.k || x.doc === R!.tpl));
  if (said) return { R, state: "said", t: "They say it is signed — verify it", who: "Finance", d };
  return { R, state: "out", t: "Out for signature — the IR is chasing", who: "IR", d };
}
export const roundsFor = (s: ImCtx, WHO: string, id: string): ImRound[] => ROUNDS.map(R => roundOf(s, WHO, id, R.k));
const URG = { now: 0, soon: 1, ok: 2 } as const;
/** what is waiting on Finance, across every investor */
export function finQueue(s: ImCtx, WHO: string): ImQ[] {
  const out: ImQ[] = [];
  s.data.INV.forEach(x => {
    if (x.st === "lapsed") return;
    roundsFor(s, WHO, x.id).forEach(r => {
      if (r.state === "none")
        out.push({ inv: x, kind: "send", r, t: "Send the " + r.R!.t + " for signature", urg: "soon" });
      else if (r.state === "said")
        out.push({ inv: x, kind: "verify", r, t: "Verify the signed " + r.R!.t.toLowerCase(), urg: "now" });
    });
    if (x.kyc !== "passed") out.push({ inv: x, kind: "kyc",
      t: x.kyc === "failed" ? "KYC failed — " + (x.kycWhy || "documents do not match") : "KYC is not passed",
      urg: "now" });
    if (x.fema === "outstanding") out.push({ inv: x, kind: "fema", t: "FEMA declaration outstanding", urg: "now" });
    const h = x.hold ? when(s.data.NOW, x.hold) : null;
    if (h && x.st === "reserved") {
      const d = gap(nowDay(s.data.NOW), h)!;
      if (d <= 21) out.push({ inv: x, kind: "hold", days: d,
        t: d < 0 ? "The hold ran out " + (-d) + " day" + (d === -1 ? "" : "s") + " ago — release it or extend it"
          : "Balance due — hold ends in " + d + " day" + (d === 1 ? "" : "s"),
        urg: d <= 7 ? "now" : "soon" });
    }
  });
  claimsOpen(s).forEach(c => {
    const x = I(s, WHO, c.inv);
    if (!x || x.st === "lapsed") return;
    out.push({ inv: x, kind: "claim", n: c, t: "An IR says the money has arrived — confirm it", urg: "now" });
  });
  /* M12-S05: a request the investor declined heads Finance's queue — it needs a fresh copy or a word */
  const declined: ImQ[] = s.data.DOCS.filter(d => d.state !== "signed" && ((s.data.SIGN || {})[d.id] || { st: "" }).st === "declined")
    .flatMap(d => { const x = I(s, WHO, d.inv); return x && x.st !== "lapsed" ? [{ inv: x, kind: "declined" as const, d,
      t: d.t + " declined — " + ((s.data.SIGN || {})[d.id].why || "no reason given"), urg: "now" as const }] : []; });
  return declined.concat(out.sort((a, b) => URG[a.urg] - URG[b.urg]));
}
/** what Account Management owes, in the same shape */
export function careQueue(s: ImCtx, WHO: string): ImQ[] {
  const out: ImQ[] = [], mine = who(s, WHO).r === "kam";
  readBook(s, WHO).filter(cared).forEach(x => {
    if (mine && x.kam !== WHO) return;
    if (needsKam(x)) out.push({ inv: x, kind: "nokam", t: (tierOf(x) || { t: "" }).t + " and nobody is looking after them", urg: "now" });
    else if (x.kam && !x.intro) out.push({ inv: x, kind: "intro", t: "Handed over and never introduced", urg: "now" });
    else {
      const o = overdue(s, WHO, x);
      if (o != null && o > -14) out.push({ inv: x, kind: "due", days: o,
        t: o > 0 ? "Gone quiet — " + o + " day" + (o === 1 ? "" : "s") + " past the " + (tierOf(x) || { t: "" }).t + " cadence"
          : "Due a conversation in " + (-o) + " day" + (o === -1 ? "" : "s"),
        urg: o > 0 ? "now" : "soon" });
    }
  });
  return out.sort((a, b) => URG[a.urg] - URG[b.urg]);
}
/** this seat's own queue */
export const mineQueue = (s: ImCtx, WHO: string): ImQ[] =>
  isAM(s, WHO) && (may(s, WHO, "care") || may(s, WHO, "assign"))
    ? careQueue(s, WHO)
    : finQueue(s, WHO).filter(q =>
      q.kind === "claim" || q.kind === "hold" ? may(s, WHO, "pay")
        : q.kind === "send" || q.kind === "verify" || q.kind === "declined" ? may(s, WHO, "doc")
          : q.kind === "kyc" || q.kind === "fema" ? may(s, WHO, "kyc") : false);

/* ============================ 7. the app account ============================ */
export const appOf = (s: ImCtx, WHO: string, id: string): ImApp | null => (I(s, WHO, id) ? s.data.APP[id] || null : null);
export const appMark = (s: ImCtx, WHO: string, id: string) => (appOf(s, WHO, id) || { mark: null }).mark || null;
/** how long the mark has stood, in whole days */
export function markAge(s: ImCtx, WHO: string, id: string): number | null {
  const a = appOf(s, WHO, id); if (!a || !a.markAt) return null;
  const d = when(s.data.NOW, a.markAt);
  return d == null ? null : Math.floor((nowDay(s.data.NOW) - mid(d)!) / DAY);
}
export function markLocked(s: ImCtx, WHO: string, id: string): boolean {
  const a = s.data.APP[id]; if (!a || a.mark !== "permanent") return false;
  const g = markAge(s, WHO, id); return g != null && g >= APPLOCK;
}
export const markLeft = (s: ImCtx, WHO: string, id: string): number | null => {
  const g = markAge(s, WHO, id); return g == null ? null : Math.max(0, APPLOCK - g);
};

/* ---- tickets and seats ---- */
export const mayTkt = (s: ImCtx, WHO: string, t: ImTicket | null | undefined): boolean =>
  !!t && !!I(s, WHO, t.inv) && may(s, WHO, "tkt") && (!isAM(s, WHO) || t.own === WHO);
export const watchedTkt = (s: ImCtx, WHO: string, t: ImTicket | null | undefined): boolean =>
  !!t && !!I(s, WHO, t.inv) && isAM(s, WHO) && (t.handed || { by: "" }).by === WHO && t.own !== WHO;
export const finSeats = (s: ImCtx): string[] =>
  Object.keys(s.data.P).filter(k => (ROLE[s.data.P[k].r] || {}).tm === "fin" && s.data.P[k].r !== "audit");
export const needsFin = (s: ImCtx, t: ImTicket | null | undefined): boolean =>
  !!t && ["Bank", "Compliance"].includes(t.cat) && (ROLE[(s.data.P[t.own] || { r: "audit" }).r] || {}).tm === "am";
/** may WHO move person k into seat r */
export function maySeat(s: ImCtx, WHO: string, k: string, r: ImRoleKey): boolean {
  if (!may(s, WHO, "team") || !ROLE[r] || !s.data.P[k] || k === WHO) return false;
  if (["head", "admin", "root", "di"].includes(who(s, WHO).r)) return true;
  const mine = (ROLE[who(s, WHO).r] || {}).tm;
  return (ROLE[who(s, k).r] || {}).tm === mine && ROLE[r].tm === mine;
}

/* ============================ 8. state and navigation ============================ */
export const navFor = (s: ImCtx, WHO: string): ImNavItem[] => NAV.filter(n => !(n.not === "sys" && isSys(s, WHO)))
  .filter(n => who(s, WHO).r === "di" || !n.needs || n.needs.some(c => may(s, WHO, c))
    || (who(s, WHO).r === "audit" && !n.needs.includes("sys")));
export const pageReadable = (s: ImCtx, WHO: string, v: string): boolean =>
  !!s.data.P[WHO] && may(s, WHO, "view") && navFor(s, WHO).some(n => n.k === v);
/** the rail badge */
export const count = (s: ImCtx, WHO: string, k: string): number =>
  !pageReadable(s, WHO, k) ? 0
    : k === "tkt" ? (isAM(s, WHO) ? ticketBook(s, WHO).filter(t => t.state !== "closed" && t.own === WHO).length : tkOpen(s, WHO).length)
      : k === "dash" ? mineQueue(s, WHO).filter(q => q.urg === "now").length
        : k === "inv" ? (isAM(s, WHO) ? myBook(s, WHO).filter(x => quiet(s, WHO, x)).length : 0)
          : k === "docs" ? s.data.DOCS.filter(d => I(s, WHO, d.inv) && d.state === "awaiting").length : 0;
/** the section tab a page is on (falls back to the first) */
export const secOf = (SEC: Record<string, string>, v: string, list: { k: string }[]): string => {
  const ok = list.map(x => x.k); return ok.indexOf(SEC[v]) >= 0 ? SEC[v] : ok[0];
};
/** days until the hold ends (negative: days since it ran out) */
export const holdDays = (s: ImCtx, x: ImInvestor): number | null =>
  x.hold ? gap(nowDay(s.data.NOW), when(s.data.NOW, x.hold)) : null;
/** IMX.readOnly — no write right beyond reading */
export const readOnlySeat = (s: ImCtx, WHO: string): boolean =>
  !(Object.keys(CAN) as ImCan[]).filter(c => !["view", "bank", "pii", "log"].includes(c)).some(c => may(s, WHO, c));

/* ---- the drawer gate ---- */
export function drawerReadable(s: ImCtx, WHO: string, k: ImDrawerKey, id: string | null | undefined): boolean {
  if (!s.data.P[WHO] || !may(s, WHO, "view")) return false;
  if (MONEY_DRAWERS.includes(k)) return moneyDrawerReadable(s, WHO, k, id);   /* M10/M11 later decisions: money.ts */
  if (["kam", "talk", "pay", "send", "kyc", "details"].includes(k)) {
    const x = I(s, WHO, id); if (!x) return false;
    return k === "kam" ? may(s, WHO, "assign") : k === "talk" ? mayCare(s, WHO, x) : k === "details" ? mayDetails(s, WHO, x)
      : k === "pay" ? may(s, WHO, "pay") : k === "send" ? may(s, WHO, "doc") : !notFin(s, WHO);
  }
  if (k === "verify") { const d = s.data.DOCS.find(x => x.id === id); return !!d && !!I(s, WHO, d.inv) && may(s, WHO, "doc"); }
  /* M10-S03-W1: whether the report exists is the route's answer (GET /api/claims/[id]), not the book's */
  if (k === "claim") return !!id && !notFin(s, WHO) && may(s, WHO, "pay");
  return k === "tkt" ? may(s, WHO, "tkt") && (!id || !!I(s, WHO, id)) : k === "upd" ? may(s, WHO, "upd") : k === "field" ? may(s, WHO, "field") : false;
}

/* ============================ 14. activity ============================ */
/** the read-only Auditor seat: sees the Finance trail, not the whole org log */
export const isAuditor = (s: ImCtx, WHO: string): boolean => !!s.data.P[WHO] && s.data.P[WHO].r === "audit";
export function activityActors(s: ImCtx, WHO: string): Set<string> {
  const actors = new Set<string>([WHO]);
  /* M15-S03 / D78: the Auditor reads the Finance trail, read only — no "log" right, but the Finance people's own work (TC-IM10-008) */
  if (isAuditor(s, WHO)) finSeats(s).forEach(k => actors.add(k));
  if (may(s, WHO, "log")) {
    if (isSys(s, WHO) || who(s, WHO).r === "di") s.data.SIGNINS.concat(s.data.LOG.map(e => e.who)).forEach(k => actors.add(k));
    else {
      const pending = [WHO];
      while (pending.length) {
        const manager = pending.shift();
        Object.keys(s.data.P).forEach(k => {
          if (s.data.P[k].mgr === manager && !actors.has(k)) { actors.add(k); pending.push(k); }
        });
      }
    }
  }
  return actors;
}
/** the log this seat may read; an administrator's copy has investor details withheld */
export function activityBase(s: ImCtx, WHO: string): ImLogEntry[] {
  if (!s.data.P[WHO] || !may(s, WHO, "view")) return [];
  const actors = activityActors(s, WHO), orgAudit = isSys(s, WHO) && may(s, WHO, "log");
  return s.data.LOG.filter(e => actors.has(e.who) && (orgAudit || !e.inv || !!I(s, WHO, e.inv))).map(e => orgAudit
    ? Object.assign({}, e, { inv: null, what: e.inv ? (KINDS[e.kind] || "Investor") + " event" : auditText(s, WHO, e.what),
      note: e.inv ? "Investor details withheld" : auditText(s, WHO, e.note) })
    : Object.assign({}, e, { what: safeNote(s, WHO, e.what), note: safeNote(s, WHO, e.note) }));
}
export const activityRows = (s: ImState, WHO: string): ImLogEntry[] => activityBase(s, WHO)
  .filter(e => (!s.ui.LOGWHO || e.who === s.ui.LOGWHO) && (!s.ui.LOGKIND || e.kind === s.ui.LOGKIND));

/* ============================ reads the pages compute inline (sections 9–14) ============================ */
/** conversations a month a book costs at its promised cadences (amCards, the kam drawer) */
export const kamLoad = (book: ImInvestor[]): number => Math.round(book.reduce((a, y) => a + 30 / cadence(y), 0) * 10) / 10;
/** money still due on reservations (vDashFin `risk`, vTxn "still due", vIns `due`) */
export const outstandingReserved = (s: ImCtx, WHO: string): number =>
  s.data.INV.filter(x => x.st === "reserved").reduce((a, x) => a + dueBy(s, WHO, x.id), 0);
/** what a lapse of every reservation would forfeit (vIns "forfeit exposure") */
export const forfeitExposure = (s: ImCtx): number =>
  s.data.INV.filter(x => x.st === "reserved").reduce((a, x) => a + FORFEIT * x.units, 0);
/** who an update reaches (publish, the upd drawer) */
export const publishCount = (s: ImCtx, to: string | undefined): number =>
  to === "all" ? s.data.INV.length : to === "nri" ? s.data.INV.filter(x => x.nri).length
    : s.data.INV.filter(x => x.st === "allocated").length;
/** the Investors list's cuts (vInv EXC): key → [label, predicate] */
export function invExceptions(s: ImCtx, WHO: string): Record<string, [string, (x: ImInvestor) => boolean]> {
  return isAM(s, WHO)
    ? { quiet: ["Gone quiet", x => quiet(s, WHO, x)],
      nokam: ["No manager", needsKam],
      conc: ["A concern last time", x => { const l = lastC(s, WHO, x.id); return !!l && l.mood === "concern"; }],
      a: ["Tier A", x => (tierOf(x) || { k: "" }).k === "A"] }
    : { kyc: ["KYC not passed", x => x.kyc !== "passed"],
      hold: ["Balance outstanding", x => x.st === "reserved"],
      nri: ["NRI", x => x.nri],
      fema: ["FEMA outstanding", x => x.fema === "outstanding"] };
}
/** the Investors list's rows for the current search and cut (vInv) */
export function invRows(s: ImState, WHO: string): ImInvestor[] {
  const base = isAM(s, WHO) ? myBook(s, WHO).filter(cared) : s.data.INV;
  const EXC = invExceptions(s, WHO), f = s.ui.IFILT && EXC[s.ui.IFILT] ? EXC[s.ui.IFILT][1] : null;
  const q = s.ui.IQ.trim().toLowerCase();
  return base.filter(x => (!f || f(x)) && (!q || invMatch(s, x, q)));   /* M09-S07: + phone digits and farm */
}
/** Payments' cuts (vTxn F) */
export const TXNF: Record<string, [string, (t: ImTxn) => boolean]> = {
  all: ["Everything", () => true], adv: ["Advances", t => t.kind === "advance"],
  full: ["Full and balance", t => t.kind === "full" || t.kind === "balance"],
  out: ["Refunds and forfeits", t => t.kind === "refund" || t.kind === "forfeit"],
  pend: ["Not reconciled", t => t.rec !== "matched"],
};
/** Tickets' cuts (vTkt F); an AM seat has no "Mine" */
export function tktFilters(s: ImCtx, WHO: string): Record<string, [string, (t: ImTicket) => boolean]> {
  const F: Record<string, [string, (t: ImTicket) => boolean]> = {
    open: ["Open", t => t.state !== "closed"], mine: ["Mine", t => t.state !== "closed" && t.own === WHO],
    all: ["Everything", () => true], closed: ["Closed", t => t.state === "closed"] };
  if (isAM(s, WHO)) delete F.mine;
  return F;
}
/** a block on the shelf (vFarms): allotted, paid, reserved and free units */
export function farmShelf(s: ImCtx, k: string): { used: number; al: number; pd: number; re: number; fr: number } {
  const f = s.data.FARMS.find(x => x.k === k);
  const u = blockUse(s, k);
  const al = s.data.INV.filter(i => i.st === "allocated").reduce((a, i) => a + (i.blocks[k] || 0), 0);
  const pd = s.data.INV.filter(i => i.st === "paid").reduce((a, i) => a + (i.blocks[k] || 0), 0);
  return { used: u, al, pd, re: u - al - pd, fr: Math.max(0, (f ? f.released : 0) - u) };
}
/** Numbers → At risk: reservations by days left on the hold (vIns ageing) */
export function ageing(s: ImCtx, WHO: string): { a: number; b: number; n: number; v: number }[] {
  const res = s.data.INV.filter(x => x.st === "reserved" && x.hold);
  return [[-9999, 0], [1, 7], [8, 14], [15, 30], [31, 9999]].map(([a, b]) => {
    const inBand = res.filter(x => { const d = holdDays(s, x); return d != null && d >= a && d <= b; });
    return { a, b, n: inBand.length, v: inBand.reduce((t, x) => t + dueBy(s, WHO, x.id), 0) };
  });
}
/** Numbers → Paper: out for signature, oldest first */
export const stuckDocs = (s: ImCtx): { d: ImDoc; age: number }[] => s.data.DOCS.filter(d => d.state === "awaiting")
  .map(d => ({ d, age: aged(s.data.NOW, d.sent) || 0 })).sort((a, b) => b.age - a.age);
/** System → Do the books agree (vSys) */
export function sysChecks(s: ImCtx) {
  const D = s.data;
  const ledgerGot = (id: string) => D.TXN.filter(t => t.inv === id && t.kind !== "refund" && t.kind !== "forfeit").reduce((n, t) => n + t.amt, 0);
  const ledgerDue = (x: ImInvestor) => Math.max(0, x.units * UNIT - ledgerGot(x.id));
  const inOpen = D.INBOX.filter(n => nOpen(s, n));
  const oldest = inOpen.slice().sort((a, b) => (when(D.NOW, a.at) || 0) - (when(D.NOW, b.at) || 0))[0] || null;
  const noAcct = D.INV.filter(x => ledgerGot(x.id) > 0 && !D.APP[x.id]);
  const orphanIn = D.INBOX.filter(n => !D.INV.some(x => x.id === n.inv));
  const marks = D.INV.filter(x => D.APP[x.id] && (D.APP[x.id].mark === "permanent") !== (ledgerDue(x) <= 0));
  const paid = D.INV.filter(x => ledgerGot(x.id) > 0).length, withApp = D.INV.filter(x => D.APP[x.id]).length;
  return { inOpen, oldest, noAcct, orphanIn, marks, paid, withApp, over: freeUnits(s) < 0,
    docsOwned: D.DOCS.every(d => D.INV.some(x => x.id === d.inv)) };
}
/** Investors → one record → Journey: both sides of the relay, newest first (vOne `jrn`) */
export type ImJev = { at: string; side: "fin" | "ir"; t: string; m: string; who: string | null };
export function journey(s: ImCtx, WHO: string, x: ImInvestor, money: (v: number) => string): ImJev[] {
  const DUP: Record<string, 1> = { doc: 1, money: 1 };
  const ev: ImJev[] = ([] as ImJev[])
    .concat(logFor(s, WHO, x.id).filter(e => !DUP[e.kind]).map(e => ({ at: e.at, side: "fin" as const, t: e.what, m: e.note, who: e.who })))
    .concat(inFor(s, WHO, x.id).map(n => ({ at: n.at, side: "ir" as const, t: n.t, m: n.d, who: n.ir })))
    .concat(docOf(s, WHO, x.id).map(d => ({ at: d.sent, side: "fin" as const, t: d.t + " sent for signature",
      m: (d.sig || "issued") + (d.ref ? " · " + d.ref : ""), who: d.by })))
    .concat(docOf(s, WHO, x.id).filter(d => d.state === "signed" && d.on)
      .map(d => ({ at: d.on!, side: "fin" as const, t: d.t + " — signed copy verified", m: d.ref || "", who: d.vby || d.by })))
    .concat(txOf(s, WHO, x.id).map(t => ({ at: t.on, side: "fin" as const,
      t: t.kind === "advance" ? "Advance received" : t.kind === "refund" ? "Refund issued" : t.kind === "forfeit" ? "Forfeit retained" : "Payment received",
      m: money(t.amt) + " · " + t.mode + " " + t.utr, who: t.by })))
    .concat([{ at: isoWall(x.since) != null ? x.since : x.since + " 00:00", side: "fin", t: "Account opened", who: null,
      m: "Brought in by " + who(s, x.ir).n + (x.src ? " from " + x.src : "") + (leadWords(x) ? " · lead " + leadWords(x) : "") }]);
  return ev.filter(e => e.at).sort((a, b) => (when(s.data.NOW, b.at) || 0) - (when(s.data.NOW, a.at) || 0));
}
