"use client";

/* Investors side — section 10, INVESTORS (imx.js lines 1468–1843): vInv, the list, and vOne(x), the
   record. The record is built as one page with sections rather than a wall: who they are, what
   they hold, what they have paid, what paper exists, and the journey that got them here. */

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { StepUp } from "../stepup";
import {
  ago, APPLOCK, appOf, cared, CHANS, cOf, day6, docOf, dueBy, gotBy, holdDays, I, inr, invExceptions,
  isAM, isSys, journey, KAMS, kamGone, lastC, markAge, markLeft, markLocked, may, mayCare,
  mayDetails, mayCareOn, mayDetailsOn, money, MOODS, myBook, notFin, overdue, pageReadable, quiet, roundsFor, secOf, tierOf,
  tkOf, txOf, leadWords, originNote, UNIT, allocated, reserved, who, FORFEIT, IR_COLS, accessOf, accessView, fmtAt, fmtDay, fmtStamp, mid, nowDay, when, DAY,
} from "@/lib/im";
import { EXTDAYS } from "@/domain";
import type { ImInvestor } from "@/lib/im";
import { DocTag, ImPname, ImSecBar, KycTag, Pii, ProvIR, StTag } from "../common";
import type { ImPageProps, ImSec } from "../common";
import { TkRow } from "./TkRow";
import { KamControl } from "./KamControl";
import { AppActivityCard, AppBadge, useAppActivity } from "./AppActivity";
import { nudgeIds } from "@/lib/im/app-activity";
import { journeyFirst, StoryJourney } from "./Story";   /* GC-1524 */
import { AllotCard, AppAccessCard, ArlHoldings, MoneyBlocks } from "../money/record";
import { AddInvestorButton } from "../money/pages";
import { InvEmails } from "../paper2/Emails";
import { SignCell } from "../paper2/SignCell";
import { BlockIt } from "../paper2/BlockIt";
import { InvUploads } from "../paper2/Upload";
import { useApiMode, useApiRead, useApiWrite, type Read } from "@/lib/data/api";
import { appCard } from "@/lib/data/endpoints/app";
import { amBook, amManagers, financeInvestors, investorRecord, investorSearch, irInvestorList, type AmManagers } from "@/lib/data/endpoints/investors";
import { caseList } from "@/lib/data/endpoints/cases";
import { dayOf as docDay, documentsList } from "@/lib/data/endpoints/documents";
import type { DocRow } from "@/server/documents/list";
/* the same closed-state test as server/documents/list (kept here so the client bundle never imports server code) */
const SIGN_CLOSED = /^(declined|recalled|expired)$/i;
import { useGoLead } from "@/features/leads/nav";
import type { NavKey } from "@/domain";
import type { IrInvestorRow } from "@/server/investors/ir-list";
import type { FinanceInvestorRow } from "@/server/investors/finance-list";
import { holdExtend, holdOne, holdRelease, type HoldOne } from "@/lib/data/endpoints/holds";
import type { InvestorRecord, RecordSection } from "@/server/investors/record";

const blocksText = (x: ImInvestor) => Object.entries(x.blocks).map(([k, n]) => "Block " + k + " ×" + n).join(", ");

/* ImInv — vInv: the record when SEL names a readable investor, otherwise the list */
export function ImInv(p: ImPageProps) {
  const { s, me } = p;
  /* M09-S03-W1: the record is GET /api/investors/[id]/record (lib/data/endpoints/investors) */
  const one = useApiRead(investorRecord, { s, me }, s.ui.SEL);
  /* M09-S08 (D113 ruling 2): an IR holds this same page on the investors of their own leads — the same record, read-only */
  if (!p.irSeat && !pageReadable(s, me, "inv")) return null;
  if (one.state === "ok") return <VOne {...p} x={one.data.record.investor} rec={one.data.record} />;
  if (one.state === "loading") return <div className="empty">Reading the record…</div>;
  if (p.irSeat) return (
    <>
      {one.state === "error" ? <div className="note bad" role="alert" style={{ marginBottom: 8 }}>
        {one.err.status === 404 || one.err.status === 403
          ? <><b>Not opened.</b> That is not an investor from one of your own leads, so nothing on that record was read.</>
          : one.err.error}
        {" "}<button type="button" className="chip" onClick={() => p.dispatch({ type: "go", v: "inv", id: null })}>OK</button></div> : null}
      <VIrInv {...p} />
    </>
  );
  if (one.state === "error" && one.err.status !== 404 && one.err.status !== 403) return (
    <><div className="note bad" role="alert" style={{ marginBottom: 8 }}>{one.err.error}</div><VInv {...p} /></>
  );
  return <VInv {...p} />;
}

/* W2-KAM-3: live, "Last heard" and "next owed" are the route's (GET /api/investors/am/managers: the KAM's own logged
   conversations, the same answer Today's card gives), printed with fmtAt, never raw. The demo book keeps its own contacts.
   `undefined`: the demo book answers; `null`: the route has not answered yet; a Map: its rows by Contact id. */
type AmRow = AmManagers["accounts"][number];
function useAmRows(p: ImPageProps, on: boolean): Map<string, AmRow> | null | undefined {
  const live = useApiMode() === "live";
  const r = useApiRead(amManagers, { s: p.s, me: p.me }, on && live);
  if (!on || !live) return undefined;
  return r.state === "ok" ? new Map(r.data.accounts.map(a => [a.id, a])) : null;
}
/** the heard line shared by the list and the Care tab: "08 Oct 22:05 · Warm" / "never" / "…" while the route answers */
function heardText(a: AmRow | undefined, rows: Map<string, AmRow> | null): ReactNode {
  if (rows === null) return <span className="sm">…</span>;
  return a?.lastHeardAt ? fmtAt(a.lastHeardAt) + (a.lastMood ? " · " + a.lastMood : "") : <span className="tag late">never</span>;
}

/* vInv — imx.js 1474–1529 */
/** a value that follows `v` after it has stood still for `ms` (the search box's 200 ms debounce, M09-S07-W1) */
function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]);
  return d;
}

/* M09-S01-W1: Finance's cuts, over the rows of GET /api/investors/finance (the same four, in the words of invExceptions) */
const FIN_EXC: Record<string, [string, (r: FinanceInvestorRow) => boolean]> = {
  kyc: ["KYC not passed", r => r.kyc !== "passed" && r.kyc !== "na" && r.kyc !== "hidden"],
  hold: ["Balance outstanding", r => r.due > 0],
  nri: ["NRI", r => r.nri],
  fema: ["FEMA outstanding", r => r.fema === "outstanding"],
};
const farmsText = (r: FinanceInvestorRow) => r.farms.map(f => "Block " + f.block + " ×" + f.units).join(", ");

function VInv({ s, me, dispatch }: ImPageProps) {
  const am = isAM(s, me), base = am ? myBook(s, me).filter(cared) : [];
  /* M09-S02-W1: "N under care" and "No manager" are GET /api/investors/am; M09-S07-W1: the box is GET /api/investors/search;
     M09-S01-W1: Finance's rows, counts and units are GET /api/investors/finance */
  const amR = useApiRead(amBook, { s, me }, am);
  const fin = useApiRead(financeInvestors, { s, me }, !am);
  const heard = useAmRows({ s, me, dispatch } as ImPageProps, am);
  const dq = useDebounced(s.ui.IQ, 200);
  const sr = useApiRead(investorSearch, { s, me }, { q: dq, farm: null });
  const frows = fin.state === "ok" ? fin.data.rows : [];
  /* GC-1525: the "App:" column and the "Invited, never signed in" cut come from what the investor app wrote back */
  const act = useAppActivity({ s, me }, am ? base.map(x => x.id) : null);
  /* each cut is its title and the ids it holds (the AM seat's over the book, Finance's over the route's rows) */
  const EXC: Record<string, [string, Set<string>]> = {};
  if (am) for (const [k, [t, f]] of Object.entries(invExceptions(s, me))) EXC[k] = [t, new Set(base.filter(f).map(x => x.id))];
  else for (const [k, [t, f]] of Object.entries(FIN_EXC)) EXC[k] = [t, new Set(frows.filter(f).map(x => x.id))];
  if (am && act.map) EXC.appnever = ["Invited, never signed in", nudgeIds([...act.map.values()], act.unavailable)];
  /* the prototype clears an IFILT this seat has no cut for; the render simply reads it as none */
  const IFILT = s.ui.IFILT && EXC[s.ui.IFILT] ? s.ui.IFILT : null;
  const cut = IFILT ? EXC[IFILT][1] : null;
  const hits = sr.state === "ok" ? sr.data.hits : null;
  /* a term the route finds too short is no search at all; anything else it refuses is said in the page */
  const searchErr = sr.state === "error" && sr.err.status !== 400 ? sr.err.error : null;
  const pick = <T extends { id: string }>(l: readonly T[]) => l.filter(x => (!cut || cut.has(x.id)) && (!hits || hits.some(h => h.id === x.id)));
  const rows = pick(base), finShown = pick(frows);
  /* hits the book does not hold (live: the Investors book is not read yet) still open their record */
  const stubs = hits && !cut ? hits.filter(h => !(am ? base : frows).some(x => x.id === h.id)) : [];
  const shown = amR.state === "ok" ? amR.data.summary : null;
  const count = (k: string, n: number) => (k === "nokam" && shown ? shown.noManager : n);
  const go = (id: string) => dispatch({ type: "go", v: "inv", id });
  const finSum = fin.state === "ok" ? fin.data.summary : null;
  const total = am ? (shown ? shown.underCare : "…") : finSum ? finSum.onBook : "…";
  return (
    <>
      <div className="ph"><h1>{am ? (who(s, me).r === "kam" ? "My accounts" : "Accounts") : "Investors"}</h1>
        <span className="sub" id="inv-sub">{total + " " + (am ? "under care" : "on the book") + (am ? "" : " · " + (finSum ? finSum.units : "…") + " units")}</span>
        <div className="sp" />
        <AddInvestorButton s={s} me={me} dispatch={dispatch} />
        <input className="inp" style={{ width: 210 }} placeholder="Name, ARL ID, city…" value={s.ui.IQ}
          /* named by the heading row's own subtitle, as the prototype's unlabeled box is read */
          aria-labelledby="inv-sub"
          id="iq" onChange={e => dispatch({ type: "setFilter", patch: { IQ: e.target.value } })} /></div>
      {searchErr ? <div className="note bad" role="alert" style={{ marginBottom: 8 }}>{searchErr}</div> : null}
      {fin.state === "error" && fin.err.status !== 403 ? <div className="note bad" role="alert" style={{ marginBottom: 8 }}>{fin.err.error}</div> : null}
      {fin.state === "ok" && fin.data.statusHidden ? <div className="note" role="status" style={{ marginBottom: 8 }}>KYC and FEMA are not visible to your seat in Zoho, so KYC reads “not visible” and FEMA is not counted. Tell Digital Infrastructure.</div> : null}
      <div className="secbar">
        <button className={`sc ${IFILT ? "" : "on"}`} onClick={() => dispatch({ type: "setFilter", patch: { IFILT: null } })}>Everyone <i>{am ? (shown ? shown.underCare : base.length) : frows.length}</i></button>
        {Object.entries(EXC).map(([k, [t, f]]) => {
          const n = count(k, f.size);
          return n ? (
            <button key={k} className={`sc ${IFILT === k ? "on" : ""}`} onClick={() => dispatch({ type: "setFilter", patch: { IFILT: k } })}>{t}{" "}
              <i className={["kyc", "fema", "quiet", "nokam", "conc", "appnever"].includes(k) ? "warn" : ""}>{n}</i></button>
          ) : null;
        })}
      </div>
      <div className="secw"><div className="card fill"><div className="tw"><table>
        <thead><tr><th>Investor</th><th>ARL ID</th><th className="n">Units</th>
          {am ? <><th>Tier</th><th>Manager</th><th>Last heard</th><th>Next owed</th><th>Land</th><th>App</th></>
            : <><th>Land</th><th>State</th><th>KYC</th><th className="n">Paid</th><th className="n">Due</th><th>IR</th></>}
        </tr></thead>
        <tbody>{(am ? rows.length : finShown.length) || stubs.length ? (am ? rows.map(x => {
          const l = lastC(s, me, x.id), T = tierOf(x)!, hr = heard?.get(x.id), o = heard === undefined ? overdue(s, me, x) : hr?.overdue ?? null;
          return (
            <tr key={x.id} className="k" tabIndex={0} onClick={() => go(x.id)} onKeyDown={e => { if (e.key === "Enter") go(x.id); }}>
              <td><b>{x.n}</b><div className="sm">{x.city + (x.nri ? " · NRI" : "")}</div></td>
              <td className="mono sm">{x.code ?? x.id}</td>
              <td className="n">{x.units}</td>
              <td><span className={`tag ${T.k === "A" ? "br" : ""}`}>{T.t}</span></td>
              <td className="sm">{x.kam ? <ImPname s={s} k={x.kam} first /> : <span className="tag late">nobody</span>}</td>
              <td className="sm">{heard !== undefined ? heardText(hr, heard) : l ? CHANS[l.ch] + " · " + ago(s.data.NOW, l.at) : <span className="tag late">never</span>}</td>
              <td>{o == null ? <span className="sm">—</span>
                : o > 0 ? <span className="tag late"><span className="dot" />{o}d overdue</span>
                  : <span className={`tag ${o > -14 ? "due" : ""}`}>in {-o}d</span>}</td>
              <td className="sm">{blocksText(x) || "—"}</td>
              <td><AppBadge a={act.map?.get(x.id)} loaded={!!act.map} unavailable={act.unavailable} /></td>
            </tr>
          );
        }) : finShown.map(x => (
          <tr key={x.id} className="k" tabIndex={0} onClick={() => go(x.id)} onKeyDown={e => { if (e.key === "Enter") go(x.id); }}>
            <td><b>{x.name}</b><div className="sm">{x.city + (x.nri ? " · NRI" : "")}</div></td>
            <td className="mono sm">{x.code}</td>
            <td className="n">{x.units}</td>
            <td className="sm">{x.farms.length ? farmsText(x) : "—"}</td>
            <td><StTag x={null} st={x.stateLabel} /></td><td><KycTag x={x} /></td>
            <td className="n mono">{money(x.paid)}</td>
            <td className={`n mono ${x.due ? "" : "sm"}`}>{x.due ? money(x.due) : "—"}</td>
            <td className="sm">{x.ir ? <ImPname s={s} k={x.ir} first /> : "—"}</td>
          </tr>))).concat(stubs.map(h => (
          <tr key={h.id} className="k" tabIndex={0} onClick={() => go(h.id)} onKeyDown={e => { if (e.key === "Enter") go(h.id); }}>
            <td><b>{h.name}</b><div className="sm">{h.city ?? ""}</div></td>
            <td className="mono sm">{h.code}</td>
            <td className="sm" colSpan={7}>{h.phoneLast4 ? "mobile ····" + h.phoneLast4 : "—"}</td>
          </tr>))) : sr.state === "loading" ? <tr><td colSpan={9}><div className="empty">Searching…</div></td></tr>
        : <tr><td colSpan={9}><div className="empty">Nobody matches that.{s.ui.IQ.trim()
          ? <div className="sm">{"No investor you can open matches “" + s.ui.IQ.trim() + "”"
            + (IFILT ? " under " + EXC[IFILT][0] : "") + "."}</div> : null}</div></td></tr>}
        </tbody></table></div></div></div>
    </>
  );
}

/* M09-S08 (D113 ruling 2) — the Investors page for an IR: the same page, rows scoped to the investors who came from this IR's
   own leads, read-only, in the columns of M09-S08-NOTE-3 (IR_COLS: Investor, ARL ID, Farms, State, Lead). It shares the page's table,
   section bar, search box, state tag and record opening; it is its own function because VInv's rows, subtitle, filter cuts and
   "Add investor" all read the whole book (Paid, Due, KYC, KAM tiers). The rows are GET /api/investors/mine — never the book. */
const irText = (r: IrInvestorRow) => [r.name, r.code, r.state ?? "", ...r.farms.map(f => "Block " + f.block + " " + f.name)].join(" ").toLowerCase();
const irFarms = (r: IrInvestorRow) => r.farms.map(f => "Block " + f.block + " ×" + f.units).join(", ") || "—";

/** the lead an investor came from: opens that lead (the lead page decides whether it is still yours to open) */
function LeadLink({ id, name }: { id: string; name: string }) {
  const goLead = useGoLead("inv" as NavKey);
  return <button type="button" className="chip" aria-label={"Open lead for " + name}
    onClick={e => { e.stopPropagation(); goLead(id); }}>Open lead ›</button>;
}

function VIrInv({ s, me, dispatch }: ImPageProps) {
  const r = useApiRead(irInvestorList, { s, me }, true);
  const q = s.ui.IQ.trim().toLowerCase();
  const all = r.state === "ok" ? r.data.rows : [];
  /* GC-1525: "App:" per investor, and the cut "Invited, never signed in" — who still needs a nudge until they convert */
  const act = useAppActivity({ s, me }, all.map(x => x.id));
  const never = act.map ? nudgeIds([...act.map.values()], act.unavailable) : new Set<string>();
  const cut = s.ui.IFILT === "appnever" && never.size ? never : null;
  const rows = (q ? all.filter(x => irText(x).includes(q)) : all).filter(x => !cut || cut.has(x.id));
  const go = (id: string) => dispatch({ type: "go", v: "inv", id });
  return (
    <>
      <div className="ph"><h1>Investors</h1>
        <span className="sub" id="inv-sub">{(r.state === "ok" ? all.length : "…") + " from your leads"}</span>
        <div className="sp" />
        <input className="inp" style={{ width: 210 }} placeholder="Name, ARL ID, farm…" value={s.ui.IQ} aria-labelledby="inv-sub"
          id="iq" onChange={e => dispatch({ type: "setFilter", patch: { IQ: e.target.value } })} /></div>
      {r.state === "error" ? <div className="note bad" role="alert" style={{ marginBottom: 8 }}>{r.err.error}</div> : null}
      <div className="secbar">
        <button className={`sc ${cut ? "" : "on"}`} onClick={() => dispatch({ type: "setFilter", patch: { IFILT: null } })}>Everyone <i>{all.length}</i></button>
        {never.size ? <button className={`sc ${cut ? "on" : ""}`} onClick={() => dispatch({ type: "setFilter", patch: { IFILT: "appnever" } })}>
          Invited, never signed in <i className="warn">{never.size}</i></button> : null}
      </div>
      <div className="secw"><div className="card fill"><div className="tw"><table>
        <thead><tr>{IR_COLS.map(c => <th key={c}>{c}</th>)}<th>App</th></tr></thead>
        <tbody>{rows.length ? rows.map(x => (
          <tr key={x.id} className="k" tabIndex={0} onClick={() => go(x.id)} onKeyDown={e => { if (e.key === "Enter") go(x.id); }}>
            <td><b>{x.name}</b></td>
            <td className="mono sm">{x.code}</td>
            <td className="sm">{irFarms(x)}</td>
            <td>{x.state ? <StTag x={{ st: x.state } as ImInvestor} st={x.state} /> : <span className="sm">—</span>}</td>
            <td>{x.leadId ? <LeadLink id={x.leadId} name={x.name} /> : <span className="sm">—</span>}</td>
            <td><AppBadge a={act.map?.get(x.id)} loaded={!!act.map} unavailable={act.unavailable} /></td>
          </tr>
        )) : <tr><td colSpan={IR_COLS.length + 1}>{r.state === "loading" || r.state === "idle" ? <div className="empty">Reading your investors…</div>
          : <div className="empty">{q ? "Nobody matches that." : "None of your leads has said yes yet."}
            {q ? <div className="sm">{"No investor from your leads matches “" + s.ui.IQ.trim() + "”."}</div> : null}</div>}</td></tr>}
        </tbody></table></div></div></div>
    </>
  );
}

/* the IR's record: who they are, what they hold, the journey — no money, paper or care, and no identity beyond the name and how to reach them */
function IrWho({ x }: { x: ImInvestor }) {
  return (
    <div className="card"><div className="ch"><h3>Who they are</h3><div className="sp" />
      <span className="sm">from your lead</span></div><div className="cb">
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Name</dt><dd><b>{x.n}</b></dd>
        <dt>ARL ID</dt><dd className="mono">{x.code ?? x.id}</dd>
        <dt>Mobile</dt><dd className="mono">{x.ph || "—"}</dd>
        <dt>Email</dt><dd className="mono" style={{ fontSize: "12.5px" }}>{x.em || "—"}</dd>
        <dt>Residency</dt><dd>{x.nri ? "Non-resident" : "Resident"}</dd>
        <dt>On the book</dt><dd className="mono">{x.since || "—"}</dd>
        <dt>Your lead</dt><dd>{x.lead ? <LeadLink id={x.lead} name={x.n} /> : "—"}</dd>
      </dl>
      <div className="note" style={{ marginTop: 12 }}><b>This is your own investor, read only.</b>{" "}
        The rest of their record — paperwork, payments and identity — belongs to the Investors side and is not on your screen.</div>
    </div></div>
  );
}

function IrHold({ s, x }: { s: ImPageProps["s"]; x: ImInvestor }) {
  return (
    <div className="card"><div className="ch"><h3>What they hold</h3><div className="sp" /><StTag x={x} /></div><div className="cb">
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Units</dt><dd><b>{x.units}</b></dd>
        <dt>Land</dt><dd>{Object.keys(x.blocks).length
          ? Object.entries(x.blocks).map(([k, n], i) => {
            const f = s.data.FARMS.find(y => y.k === k);
            return <Fragment key={k}>{i ? <br /> : null}<b>{n}</b> on {f ? f.n : "Block " + k}</Fragment>;
          })
          : <span className="tag late">none — the units went back on the shelf</span>}</dd>
        <dt>State</dt><dd>{x.st === "said yes" ? "Said yes. Nothing is reserved yet."
          : x.st === "allocated" ? "Allotted. The units are theirs."
            : x.st === "paid" ? "Paid in full and awaiting allotment."
              : x.st === "reserved" ? "Reserved. Not allotted until the balance lands."
                : "Lapsed. The reservation ran out and the land went back on the shelf."}</dd>
      </dl>
    </div></div>
  );
}

function IrJourney({ x }: { x: ImInvestor }) {
  return (
    <div className="card fill"><div className="ch"><h3>The journey</h3></div>
      <div className="cb"><div className="jrn">
        <div className="jev ir"><b>Said yes</b>
          <div className="m"><span className="mono">{x.since}</span>{" · Brought in by you" + (x.src ? " from " + x.src : "") + (leadWords(x) ? " · lead " + leadWords(x) : "")}</div></div>
      </div>
      <p className="sm" style={{ margin: "12px 0 0" }}>What happens after Said yes belongs to the Investors side and is not shown here.</p>
    </div></div>
  );
}

/* vOne(x) — imx.js 1531–1842 */
/* The record's header, banners and section bar come from the record the route answered (M09-S03-W1). The badge
   counts on Care, Paper and Tickets are still the book's until their own units wire them. */
function VOne(p: ImPageProps & { x: ImInvestor; rec: InvestorRecord }) {
  const { s, me, dispatch, x, rec } = p;
  /* M08-S04-W1: the hold clock is GET /api/holds/[allotmentId] on the record's Reserved allotment (lib/data/endpoints/holds) */
  /* an IR's record has no hold clock: its banner carries what a lapse forfeits (money) */
  const ho = useApiRead(holdOne, { s, me }, p.irSeat ? null : rec.holdings.find(h => h.status === "Reserved")?.id ?? null);
  const heard = useAmRows(p, isAM(s, me) && rec.sections.includes("care"));
  /* W3-E2E-3: live, the Paper tab reads the papers Zoho holds (GET /api/documents/list), not the demo book's DOCS (empty live) */
  const live = useApiMode() === "live";
  const papersRead = useApiRead(documentsList, { s, me }, live && rec.sections.includes("paper") ? "all" : null);
  const papers: PaperRows = !live ? null : papersRead.state === "ok" ? { rows: papersRead.data.rows.filter(d => d.contactId === rec.id || d.contactId === x?.id) }
    : papersRead.state === "error" ? { error: papersRead.err.error } : { loading: true };
  if (!x) return null;
  const am = isAM(s, me), due = rec.money?.due ?? 0, got = rec.money?.paid ?? 0;
  const hr = heard?.get(x.id), o = heard === undefined ? overdue(s, me, x) : hr?.overdue ?? null;
  const isQuiet = o != null && o > 0;
  const showMoney = rec.sections.includes("money");
  const SECT: Record<RecordSection, () => ImSec> = {
    who: () => ({ k: "who", t: "Who they are" }),
    hold: () => ({ k: "hold", t: "What they hold" }),
    care: () => ({ k: "care", t: "Care", n: isQuiet ? 1 : 0, warn: true }),
    money: () => ({ k: "money", t: "Money", n: due ? 1 : 0 }),
    paper: () => ({ k: "paper", t: "Paper", n: papers ? ("rows" in papers ? liveRounds(papers.rows).filter(r => r.tone !== "go").length : 0)
      : roundsFor(s, me, x.id).filter(r => r.state !== "done").length, warn: true }),
    jrn: () => ({ k: "jrn", t: "Journey" }),
    tkt: () => ({ k: "tkt", t: "Tickets", n: tkOf(s, me, x.id).filter(t => t.state !== "closed").length }),
  };
  /* GC-1524: Journey is the record's main view — first, so the record opens on it */
  const SECS: ImSec[] = journeyFirst(rec.sections).map(k => SECT[k]());
  const v = "inv:" + x.id;
  const S = secOf(s.ui.SEC, v, SECS);
  const T = tierOf(x)!;
  const lc = lastC(s, me, x.id);
  const plural = (n: number) => (n > 1 ? "s" : "");
  return (
    <>
      <div className="ph">
        <button className="btn" onClick={() => dispatch({ type: "go", v: "inv", id: null })} aria-label="Back to the list">←</button>
        <h1>{x.n}</h1><span className="mono sm">{x.code ?? x.id}</span>
        <StTag x={x} st={rec.state} />{showMoney ? <KycTag x={x} /> : null}{x.nri ? <span className="tag">NRI</span> : null}
        {!p.irSeat && cared(x) ? <span className={`tag ${T.k === "A" ? "br" : ""}`}>{T.t}</span> : null}
        <div className="sp" />
        <span className="sm">{x.units + " unit" + plural(x.units) + (showMoney ? " · " + money(x.units * UNIT) : "")}</span></div>

      {am && isQuiet ? <div className="note bad" style={{ marginBottom: 8 }}><b>{"Gone quiet — " + o + " day" + (o === 1 ? "" : "s") + " past the " + T.t + " cadence."}</b>
        {" " + (x.kam ? "" : "And nobody is named on it. ") + "An account nobody has spoken to since "
          + (lc ? day6(lc.at) : "it was allotted") + " is the one that is surprised by everything."}</div> : null}

      {rec.fema === "outstanding" ? <div className="note bad" style={{ marginBottom: 8 }}><b>FEMA declaration outstanding.</b> An NRI holding cannot be allotted without one, whatever the money says. The declaration is out for signature and <ProvIR t="the IR is chasing it" />.</div> : null}
      {ho.state === "ok" ? <HoldBanner h={ho.data.hold} /> : null}

      <ImSecBar s={s} dispatch={dispatch} v={v} list={SECS} />
      <div className="secw">
        {S === "who" ? (p.irSeat ? <IrWho x={x} /> : <SecWho {...p} />) : null}
        {/* M12-S09 — the record's emails sit under "Who they are" rather than as a section of their own,
            so the record keeps exactly the prototype's sections */}
        {S === "who" ? <InvEmails s={s} me={me} id={x.id} /> : null}
        {/* GC-1525 — App activity: what the investor app wrote back about sign-ins (KAM, Head of AM, Finance; the IR read-only) */}
        {S === "who" ? <AppActivityCard s={s} me={me} id={x.id} /> : null}
        {S === "hold" ? (p.irSeat ? <IrHold s={s} x={x} /> : <SecHold {...p} ho={ho} rec={rec} />) : null}
        {S === "care" ? <SecCare {...p} heard={heard} hr={hr} o={o} /> : null}
        {S === "money" ? (
          <div className="card"><div className="ch"><h3>Money</h3><div className="sp" />
            <span className="sm">{money(got) + " of " + money(x.units * UNIT) + (due ? " · " + money(due) + " due" : "")}</span></div><div className="cb">
            {rec.holdings.length > 1 ? <MoneyBlocks {...p} /> : txOf(s, me, x.id).length ? txOf(s, me, x.id).map(t => (
              <div className="led" key={t.id}>
                <span className={`tag ${t.kind === "refund" ? "late" : t.kind === "advance" ? "hold" : "go"}`}>{t.kind}</span>
                <span style={{ minWidth: 0 }}><b className="mono">{t.id}</b>
                  <div className="sm">{t.mode} <span className="mono">{t.utr}</span>{" · "}
                    <ImPname s={s} k={t.by} first />{" · "}<span className="mono">{day6(t.on)}</span>{t.note ? " · " + t.note : ""}
                    {t.rec === "pending" ? " · recorded, not matched yet" : ""}</div></span>
                <span className={`amt ${t.kind === "refund" ? "out" : ""}`}>{(t.kind === "refund" ? "−" : "") + money(t.amt)}</span>
              </div>
            )) : <p className="sm" style={{ margin: 0 }}>Nothing received yet.</p>}
            {may(s, me, "pay") && due > 0 ? (
              <div className="drwsec"><p className="lbl">Record a receipt</p>
                <div className="chips">
                  {got === 0 ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "pay", id: x.id, seed: { PUTR: "", PKIND: "advance" } })}>
                    The 10% advance <span className="u">{money(Math.round(x.units * UNIT * 0.1))}</span></button> : null}
                  <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "pay", id: x.id, seed: { PUTR: "", PKIND: "balance" } })}>
                    {got ? "The balance" : "Paid in full"} <span className="u">{money(due)}</span></button>
                </div>
                <p className="sm" style={{ margin: "9px 0 0" }}>An advance is a liability and is never shown as capital. Both receipts check the agreement, the land and the ledger before they are written.</p>
              </div>
            ) : null}
            {!may(s, me, "pay") ? <p className="sm" style={{ margin: "12px 0 0" }}>Read only — Finance Operations and the Head of Finance record money.</p> : null}
          </div></div>
        ) : null}
        {S === "paper" ? (papers ? <SecPaperLive {...p} papers={papers} /> : <SecPaper {...p} />) : null}
        {S === "jrn" && rec.story ? <StoryJourney s={s} me={me} x={x} rec={{ ...rec, story: rec.story }} irSeat={!!p.irSeat} /> : null}
        {S === "jrn" && !rec.story && p.irSeat ? <IrJourney x={x} /> : null}
        {S === "jrn" && !rec.story && !p.irSeat ? (
          <div className="card fill"><div className="ch"><h3>The journey</h3><div className="sp" />
            <span className="tag ir">Lead side</span><span className="tag br">Investors side</span></div>
            <div className="cb"><div className="jrn">{journey(s, me, x, money).map((e, i) => (
              <div key={i} className={`jev ${e.side === "ir" ? "ir" : ""}`}>
                <b>{e.t}</b>
                <div className="m"><span className="mono">{fmtAt(e.at)}</span>{(e.who ? " · " + (e.side === "ir" ? e.who : who(s, e.who).n) : "") + (e.m ? " · " + e.m : "")}</div>
              </div>
            ))}</div>
              <p className="sm" style={{ margin: "12px 0 0" }}>Two systems, one story, merged when it is read rather than copied when it is written. Blue is the lead side — captured, told, chased, said. Green is the Investors side — sent, verified, banked. Neither side holds the other&apos;s entries.</p>
            </div></div>
        ) : null}
        {S === "tkt" ? (
          <div className="card fill"><div className="ch"><h3>Tickets</h3><div className="sp" />
            {may(s, me, "tkt") ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "tkt", id: null,
              seed: { TK: { inv: x.id, cat: "Query", t: "", d: "", pri: "normal" } } })}>＋ Open one</button> : null}</div>
            <RecordTickets {...p} x={x} /></div>
        ) : null}
      </div>
    </>
  );
}

/* D132: the record's tickets. Fixture: the demo book's (tkOf). Live: the seat's register (GET /api/cases, the Tickets page's own
   read) for this investor — the same rows and versions the Tickets page works on, re-read after any live write. */
function RecordTickets(p: ImPageProps & { x: ImInvestor }) {
  const { s, me, dispatch, x } = p;
  const live = useApiMode() === "live";
  const reg = useApiRead(caseList, { s, me }, undefined);
  if (!live) return <div className="cb">{tkOf(s, me, x.id).length ? tkOf(s, me, x.id).map(t => <TkRow key={t.id} s={s} me={me} dispatch={dispatch} t={t} />)
    : <div className="empty">Nothing has been raised on this investor.</div>}</div>;
  if (reg.state === "idle" || reg.state === "loading") return <div className="cb"><div className="empty">Reading the tickets…</div></div>;
  if (reg.state === "error") return <div className="cb">{reg.err.status === 403 ? <div className="empty">Tickets are not part of this seat.</div>
    : <div className="note bad" role="alert">{reg.err.error}</div>}</div>;
  const rows = reg.data.rows.filter(t => t.inv === x.id);
  return <div className="cb">{rows.length ? rows.map(t => <TkRow key={t.id} s={s} me={me} dispatch={dispatch} t={t} investorName={x.n} watched={!!t.watched} />)
    : <div className="empty">Nothing has been raised on this investor.</div>}</div>;
}

/* vOne → "who" — imx.js 1568–1617 */
function SecWho(p: ImPageProps & { x: ImInvestor }) {
  const { s, me, dispatch, x } = p;
  /* D132: live, the record is not in the demo book; the details right is read off the live record (the route re-checks it) */
  const live = useApiMode() === "live";
  const nf = notFin(s, me);
  const bank = x.bank || { ifsc: "", name: "", drop: "", acct: "" };
  return (
    <div className="card"><div className="ch"><h3>Identity and contact</h3><div className="sp" />
      <span className="sm">masked by default — every reveal is logged</span></div><div className="cb">
      <div className="frow"><dl className="kv">
        <dt>Name</dt><dd><b>{x.n}</b></dd>
        <dt>Mobile</dt><dd className="mono">{x.ph}</dd>
        <dt>Email</dt><dd className="mono" style={{ fontSize: "12.5px" }}>{x.em}</dd>
        <dt>Address</dt><dd>{x.addr}</dd>
        <dt>Residency</dt><dd>{x.nri ? "Non-resident" : "Resident"}</dd>
        <dt>Nominee</dt><dd>{x.nominee || "—"}</dd>
      </dl><dl className="kv">
        <dt>PAN</dt><dd>{nf ? <span className="sm">Finance only</span> : <Pii {...p} f="pan" />}</dd>
        <dt>Aadhaar</dt><dd>{nf ? <span className="sm">Finance only</span>
          : x.aadh ? <>
            <span className="pii"><span className="v">{"•••• •••• " + x.aadh}</span>{" "}
              <span className="sm">last four only</span></span>
            <div className="sm mono">{x.aref}</div></>
            : <span className="sm">{x.nri ? "not applicable — non-resident" : live ? "not read by the console" : "not on file"}</span>}</dd>
        <dt>KYC</dt><dd>{nf ? (x.kyc === "passed"
          ? <span className="tag go"><span className="dot" />clear</span>
          : <span className="tag due"><span className="dot" />with Finance</span>)
          : <KycTag x={x} />}{" "}{x.kycOn && !nf ? <span className="sm mono">{x.kycOn}</span> : null}
          {x.kyc !== "passed" && may(s, me, "kyc") ? <div style={{ marginTop: 6 }}>
            <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "kyc", id: x.id })}>Work the KYC</button></div> : null}</dd>
        <dt>Bank</dt><dd>{nf ? <span className="sm">Finance only</span> : <Pii {...p} f="acct" />}
          {nf ? null : <div className="sm">{may(s, me, "bank")
            ? (bank.ifsc || "—") + " · " + (bank.name || "—") + " · name match " + (bank.drop || "—")
            : "name match " + (bank.drop || "—")}</div>}</dd>
        <dt>On the book</dt><dd className="mono">{x.since}</dd>
      </dl>
        {(live ? mayDetailsOn(s, me, x) : mayDetails(s, me, x)) ? <div className="drwsec">
          <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "details", id: x.id, seed: { DET: {} } })}>Change their details</button>
          <p className="sm" style={{ margin: "9px 0 0" }}>Name, phone, email, address, nominee — the things that are theirs to change and that they tell whoever they talk to. Identity and the bank account are not on this list and are not yours.</p></div> : null}</div>
      {nf ? <div className="note" style={{ marginTop: 12 }}><b>Identity and bank details are Finance&apos;s.</b>{" "}
        {isSys(s, me)
          ? "Administration runs the software; it does not read the people in it. You can create the seat that sees a PAN and you cannot see one yourself — which is the whole reason the reveal log below is worth anything."
          : "You are talking to this person every month and you need their name, their number and where they live. You do not need their PAN, their Aadhaar reference or the account money leaves from — and the person who calls an investor about the weather on Block A is not the person who should be able to read that."}
        {" It is on their record; it is not on your screen."}</div> : null}
      <p className="sm" style={{ margin: "12px 0 0" }}><b>Why the Aadhaar number is not here.</b> It is never stored. What is kept is the last four digits and the reference the verification agency returned — enough to recognise a document and to prove the check happened, and the only shape of it that cannot leak. A PAN and a bank account are held in full because filings and transfers need them, so they are masked instead, and revealing one is an action with your name on it.</p>
    </div></div>
  );
}

const dayMon = (iso: string) => fmtDay(Date.parse(iso + "T00:00:00Z"));
const plural1 = (n: number) => (n > 1 ? "s" : "");

/* the record's hold banner, from the route's clock (M08-S04-T03): days left and the hold's end by the one IST function */
function HoldBanner({ h }: { h: HoldOne["hold"] }) {
  const d = h.daysLeft;
  return (
    <div className={`note ${d <= 7 ? "bad" : "warn"}`} style={{ marginBottom: 8 }}>
      <b>{h.due != null ? money(h.due) + " " + (d < 0 ? "is overdue — the hold ran out " + (-d) + " day" + (d === -1 ? "" : "s") + " ago" : "due in " + d + " day" + (d === 1 ? "" : "s")) + "."
        : d < 0 ? "The hold ran out " + (-d) + " day" + (d === -1 ? "" : "s") + " ago." : "The hold has " + d + " day" + (d === 1 ? "" : "s") + " left."}</b>
      {" The hold " + (d < 0 ? "ended" : "ends") + " " + dayMon(h.holdEnds) + ". A lapse forfeits " + inr(h.forfeit)
        + " and puts " + h.units + " unit" + plural1(h.units) + " back on the shelf."}</div>
  );
}

/* Extend the hold / Release the reservation, each confirmed in the page, never confirm() (M08-S04-T03).
   Which of the two the seat is offered is the route's answer (`offers`), not a rule read off the book. */
function HoldActions({ s, me, dispatch, h }: ImPageProps & { h: HoldOne["hold"] }) {
  /* M01-S10-W1: a release is behind a fresh step-up (the route requires one): "stepup" asks for it, saying what the
     release does; once a step-up is open the page's own confirmation follows, then the route */
  const [step, setStep] = useState<"" | "stepup" | "release" | "extend">("");
  const [days, setDays] = useState<number>(EXTDAYS[0]);
  const [why, setWhy] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const release = useApiWrite(holdRelease, { s, me }, dispatch), extend = useApiWrite(holdExtend, { s, me }, dispatch);
  if (!h.offers.release && !h.offers.extend && !done) return null;
  /* a refusal (fixture: the reducer's, live: the route's) lands in the in-page note through the endpoint */
  return (
    <div className="drwsec">
      {step === "" && h.offers.release ? <button className="chip" onClick={() => setStep("stepup")}>Release the reservation</button> : null}
      {step === "" && h.offers.extend ? <button className="chip" onClick={() => setStep("extend")}>Extend the hold</button> : null}
      <StepUp action={step === "stepup" ? "release" : null} onOpen={() => setStep("release")} onCancel={() => setStep("")}
        lead={<b>{"Release " + h.units + " unit" + plural1(h.units) + "? " + inr(h.onLapse?.forfeit ?? h.forfeit) + " is forfeit and " + inr(h.onLapse?.refund ?? 0) + " is refunded."}</b>} />
      {step === "release" ? (
        <div className="note warn" role="alertdialog" aria-label="Release the reservation">
          <b>{"Release " + h.units + " unit" + plural1(h.units) + "?"}</b>
          {" " + inr(h.onLapse?.forfeit ?? h.forfeit) + " is forfeit and " + inr(h.onLapse?.refund ?? 0) + " is refunded. The account stays open — they paid money and part of it was kept."}
          <div className="chips" style={{ marginTop: 8 }}>
            <button className="chip on" onClick={() => void release({ id: h.allotmentId }).then(r => { if (r.ok) { setStep(""); setDone(r.data.state === "released" ? "Released." : "Release sent for approval."); }; })}>Yes, release it</button>
            <button className="chip" onClick={() => setStep("")}>Leave it</button></div></div>
      ) : null}
      {step === "extend" ? (
        <div className="note" role="group" aria-label="Extend the hold">
          <b>Extend the hold</b> — the new day is the old deadline plus the days you pick; Zoho&apos;s approval process holds it.
          <div className="chips" style={{ margin: "8px 0" }}>{EXTDAYS.map(d => (
            <button key={d} className={`chip ${days === d ? "on" : ""}`} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>))}</div>
          <label className="fi"><span>Reason</span>
            <input className="inp" value={why} maxLength={500} onChange={e => setWhy(e.target.value)} /></label>
          <div className="chips" style={{ marginTop: 8 }}>
            <button className="chip on" disabled={!why.trim()} onClick={() => void extend({ id: h.allotmentId, days, reason: why.trim(), expectedModifiedTime: h.modifiedTime }).then(r => {
              if (r.ok) { setStep(""); setWhy(""); setDone(r.data.state === "extended" ? "Extended to " + dayMon(r.data.to) + "." : "Extension to " + dayMon(r.data.to) + " sent for approval."); }; })}>Ask for the extension</button>
            <button className="chip" onClick={() => setStep("")}>Leave it</button></div></div>
      ) : null}
      {done ? <p className="sm" style={{ margin: "8px 0 0" }} role="status">{done}</p> : null}
    </div>
  );
}

/* The app account's mark — imx.js 1619–1681. M08-S08-W2 (D93): the account opens On hold with a Tentative mark at the first matched
   receipt; what the panel reads (opened, the welcome line, the mark and when it was set) is GET /api/investors/[id]/unlock, the
   same card App access draws. Permanent is Zoho's to set (the console writes Tentative, once, at the first match), so live there is
   no button for it; the demo's reducer still offers the two buttons in the fixture. */
const IST_MS = 5.5 * 3_600_000;
/** a card time: Zoho's datetime ("2026-09-28T14:05:00+05:30") or the demo's own "28 Sep 14:05", as the page prints it */
const wall = (s: ImPageProps["s"], at: string | null): number | null => (!at ? null : /^\d{4}-\d{2}-\d{2}/.test(at) ? (Number.isNaN(Date.parse(at)) ? null : Date.parse(at) + IST_MS) : when(s.data.NOW, at));
const stampText = (s: ImPageProps["s"], at: string | null): string => { const w = wall(s, at); return w == null ? (at ?? "—") : fmtStamp(w); };

function AppAccount({ s, me, dispatch, x, due }: ImPageProps & { x: ImInvestor; due: number | null }) {
  const r = useApiRead(appCard, { s, me }, x.id);
  const mode = useApiMode();
  const card = r.state === "ok" ? r.data.card : null;
  if (r.state === "idle" || r.state === "loading") return <p className="sm" style={{ margin: "8px 0" }}>Reading the app account…</p>;
  if (!card) return r.state === "error" && r.err.status !== 403 ? <p className="sm" role="alert" style={{ margin: "8px 0" }}>The app account: {r.err.error}</p> : null;
  if (!card.access && !card.mark) return <p className="sm" style={{ margin: "8px 0" }}>No app account yet. It is created on hold, and sign-in stays locked until Finance presses Send welcome and unlock — a match never unlocks it.</p>;
  const perm = card.mark === "Permanent";
  const w = wall(s, card.markAt), age = w == null ? null : Math.floor((nowDay(s.data.NOW) - mid(w)!) / DAY);
  const lock = perm && age != null && age >= APPLOCK, left = age == null ? null : Math.max(0, APPLOCK - age);
  return (
    <div className="card fill" style={{ marginTop: 8 }}><div className="ch"><h3>The app account</h3>
      <div className="sp" /><span className={`tag ${perm ? "go" : "due"}`}><span className="dot" />{perm ? "permanent" : "tentative"}</span></div><div className="cb">
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Created</dt><dd><span className="mono">{stampText(s, card.openedAt)}</span>{" "}
          <span className="sm">automatically, on the first confirmed receipt</span></dd>
        <dt>Welcome</dt><dd>{card.access === "Hold" || !card.welcomeAt
          ? <span className="sm">{card.text}</span> /* D93: the welcome waits for Finance */
          : <><span className="tag go"><span className="dot" />sent</span>{" "}
            <span className="mono">{stampText(s, card.welcomeAt)}</span> <span className="sm">by {(card.welcomeChannel || "Email").toLowerCase()}, with the login</span></>}</dd>
        <dt>How sure</dt><dd><b>{perm ? "Permanent" : "Tentative"}</b>{" "}
          <span className="sm">{card.markAt ? <>since <span className="mono">{stampText(s, card.markAt)}</span> · automatic</> : null}</span>
          <div className="sm">{perm
            ? (lock ? "Locked — it stood for " + age + " days and cannot be taken back."
              : left == null ? "" : left + " day" + (left === 1 ? "" : "s") + " left in which this can be taken back.")
            : due == null ? "It turns permanent by itself when the balance is confirmed."
              : due > 0 ? money(due) + " outstanding. It turns permanent by itself when the balance is confirmed."
                : "Nothing outstanding — this should be permanent."}</div></dd>
      </dl>
      {mode === "live" ? <p className="sm" style={{ margin: "11px 0 0" }}>The console marks an account Tentative once, at the first matched receipt. Permanent is set in Zoho, not here.</p>
        : may(s, me, "pay") ? (
          <div className="drwsec"><div className="chips">
            <button className={`chip ${perm ? "" : "on"}`} disabled={!perm || lock} title={perm && lock ? `Locked after ${APPLOCK} days` : undefined}
              onClick={perm && !lock ? () => dispatch({ type: "setMark", id: x.id, to: "tentative" }) : undefined}>Take it back to tentative</button>
            <button className={`chip ${perm ? "on" : ""}`} disabled={perm}
              onClick={perm ? undefined : () => dispatch({ type: "setMark", id: x.id, to: "permanent" })}>Mark it permanent</button>
          </div>
            <p className="sm" style={{ margin: "9px 0 0" }}>The week exists because the week after a large payment is when a mistake surfaces — the wrong investor, the wrong amount, a transfer the bank reverses. After it, the record stands: a thing that can always be un-made is not a record, and putting it right becomes a correction with a reason and a refund behind it.</p></div>
        ) : <p className="sm" style={{ margin: "11px 0 0" }}>Finance sets this. It says what the app shows this investor and what a report counts them as, which is why it is not a note.</p>}
    </div></div>
  );
}

/* vOne → "hold", and the app account — imx.js 1619–1681 */
function SecHold(p: ImPageProps & { x: ImInvestor; ho: Read<HoldOne>; rec: InvestorRecord }) {
  const { s, me, dispatch, x, ho, rec } = p;
  return (
    <>
      <div className="card"><div className="ch"><h3>What they hold</h3><div className="sp" />
        <StTag x={x} /></div><div className="cb">
        <dl className="kv" style={{ marginBottom: 12 }}>
          <dt>Units</dt><dd><b>{x.units}</b>{" · " + money(x.units * UNIT) + " at " + money(UNIT) + " a unit"}</dd>
          <dt>Land</dt><dd>{Object.keys(x.blocks).length
            ? Object.entries(x.blocks).map(([k, n], i) => {
              const f = s.data.FARMS.find(y => y.k === k);
              return (
                <Fragment key={k}>{i ? <br /> : null}<b>{n}</b> on <span style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 600 }}
                  role="button" tabIndex={0} onClick={() => dispatch({ type: "go", v: "farms" })}>{f ? f.n : "Block " + k}</span></Fragment>
              );
            })
            : <span className="tag late">none — the units went back on the shelf</span>}</dd>
          <dt>State</dt><dd>{x.st === "said yes" ? "Said yes. Nothing is reserved yet — the supplementary agreement is the next step, then the advance."
            : x.st === "allocated"
            ? "Allotted. The units are theirs and the allocation letter is on file."
            : x.st === "paid" ? "Paid in full and awaiting allotment — the letter is the last step."
              : x.st === "reserved" ? "Reserved against the advance. Not allotted until the balance lands."
                : "Lapsed. The reservation ran out and the land went back on the shelf."}</dd>
        </dl>
        <div className="note">An advance reserves; it does not allot. Until the balance is in, these units are held against a liability and the portal says so on every screen that shows them — which is why <b>reserved</b> and <b>allocated</b> are different words here and never used loosely.</div>
        {ho.state === "ok" ? <HoldActions {...p} h={ho.data.hold} /> : null}
      </div></div>
      <AllotCard {...p} />
      <AppAccount {...p} due={rec.money ? rec.money.due : null} />
      <AppAccessCard {...p} />
      <ArlHoldings {...p} />
    </>
  );
}

/* vOne → "care" — imx.js 1683–1739 */
function SecCare({ s, me, dispatch, x, heard, hr, o }: ImPageProps & { x: ImInvestor; heard: Map<string, AmRow> | null | undefined; hr: AmRow | undefined; o: number | null }) {
  const live = useApiMode() === "live";   /* D132: the care right off the live record (the route re-checks it) */
  const l = lastC(s, me, x.id), T = tierOf(x)!, cs = cOf(s, me, x.id);
  const moodTag = (m: string) => `tag ${m === "concern" ? "late" : m === "ok" ? "due" : "go"}`;
  const talk = { ch: "call" as const, mood: "good" as const, note: "", next: "" };
  return (
    <>
      <div className="card"><div className="ch"><h3>Who looks after them</h3><div className="sp" />
        <span className={`tag ${T.k === "A" ? "br" : ""}`}>{T.t + " · " + T.t2}</span></div><div className="cb">
        <dl className="kv" style={{ marginTop: 0 }}>
          <dt>Manager</dt><dd>{kamGone(s, x)
            ? <><span className="tag late"><span className="dot" />nobody</span> <span className="sm">{who(s, x.kam).n + " held it and has left the team"}</span></>
            : x.kam ? <><ImPname s={s} k={x.kam} b /> <span className="sm">{"since " + (x.kamOn || "—")}</span></>
              : T.pool ? <><span className="tag">the shared pool</span> <span className="sm">single-unit holdings are not individually named</span></>
                : <><span className="tag late"><span className="dot" />nobody</span>{" "}
                  <span className="sm">{"a " + T.t + " holding should have a name on it"}</span></>}
            <KamControl s={s} me={me} dispatch={dispatch} x={x} /></dd>
          <dt>Handed over</dt><dd>{x.intro
            ? <><span className="tag go"><span className="dot" />introduced</span>{" "}
              <span className="sm mono">{fmtAt(x.intro)}</span> <span className="sm">{"— " + who(s, x.ir).n.split(" ")[0] + " stayed on the first call"}</span></>
            : x.kam ? <><span className="tag late"><span className="dot" />never introduced</span>{" "}
              <span className="sm">they were handed to a stranger</span></>
              : <span className="sm">nothing to hand over yet</span>}</dd>
          <dt>Cadence</dt><dd>{x.nextOn
            ? <><span className="tag br">{"asked for " + x.nextOn}</span> <span className="sm">{"the " + T.t + " cadence of " + T.every + " days is set aside until that call"}</span>{" · "}</>
            : "every " + T.every + " days · "}
            {o == null ? <span className="sm">starts at the first conversation</span>
              : o > 0 ? <span className="tag late"><span className="dot" />{o + " day" + (o === 1 ? "" : "s") + " overdue"}</span>
                : <span className={`tag ${o > -14 ? "due" : "go"}`}><span className="dot" />{"next in " + (-o) + " day" + (o === -1 ? "" : "s")}</span>}</dd>
          <dt>Last heard</dt><dd>{heard !== undefined ? heardText(hr, heard) : l ? <>{CHANS[l.ch] + " · "}<ImPname s={s} k={l.by} first />{" · "}
            <span className="mono">{day6(l.at)}</span>{" · "}<span className={moodTag(l.mood)}>{MOODS[l.mood]}</span></>
            : <span className="tag late">never</span>}</dd>
          <dt>Brought in by</dt><dd><ImPname s={s} k={x.ir} /> <span className="sm">{(originNote(x) ? "· " + originNote(x) : "") + " "}<ProvIR t="on the lead side" /></span></dd>
        </dl>
        {(live ? mayCareOn(s, me, x) : mayCare(s, me, x)) ? <div className="drwsec">
          <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "talk", id: x.id, seed: { CT: talk } })}>Log a conversation</button>
          <p className="sm" style={{ margin: "9px 0 0" }}>Recorded by hand, one line each, the way a touch is recorded on a lead — because a count of real conversations is the only measure of a relationship anybody trusts.</p></div>
          : may(s, me, "care") && who(s, me).r === "kam" ? <div className="drwsec"><p className="sm" style={{ margin: 0 }}>{x.kam
            ? "This is " + who(s, x.kam).n + "'s account. You can read it — a colleague covering a call needs to know what was said — but the conversation goes on their record, not yours."
            : "Nobody holds this account yet, so there is no cadence for a conversation to count against. It needs a name on it first."}</p></div> : null}
      </div></div>
      <div className="card fill"><div className="ch"><h3>Every conversation</h3><div className="sp" />
        <span className="sm">{cs.length} on file</span></div><div className="cb">
        {cs.length ? cs.map((c, i) => (
          <div className="led" style={{ alignItems: "flex-start" }} key={i}>
            <span className={moodTag(c.mood)}>{MOODS[c.mood]}</span>
            <span style={{ minWidth: 0 }}><b>{CHANS[c.ch]}</b>
              <div className="sm"><ImPname s={s} k={c.by} first />{" · "}<span className="mono">{fmtAt(c.at)}</span></div>
              {c.note ? <div className="sm" style={{ marginTop: 4, color: "var(--ink-2)" }}>{c.note}</div> : null}</span>
          </div>
        )) : <div className="empty">Nobody has spoken to them since they were allotted.</div>}
      </div></div>
    </>
  );
}

/* ---- W3-E2E-3: the Paper tab, live. Rounds and documents come from the rows GET /api/documents/list answers for this investor:
   the supplementary round is the allotment's Supplementary_Sign_Req_Id (the same field Documents > Out for signature and the Send
   panel's prefill read), so the three screens say one thing. The NDA is the lead side's round (the IR's lead page shows it). ---- */
export type PaperRows = null | { rows: readonly DocRow[] } | { error: string } | { loading: true };
type LiveRound = { key: string; title: string; tone: "go" | "late" | "due" | "ir"; tag: string; line: string; row: DocRow | null };

/** The sender (Sign's owner name, or the user id resolved from the people directory) and the day it went, as one line. */
const sentLine = (d: DocRow): string => (d.sign?.sentAt ? "sent " + docDay(d.sign.sentAt) : "");
export function liveRounds(rows: readonly DocRow[]): LiveRound[] {
  const supp = rows.filter(d => d.paper === "supplementary");
  if (!supp.length) return [{ key: "supp", title: "Supplementary agreement", tone: "due", tag: "not sent", line: "Not sent yet", row: null }];
  return supp.map((d): LiveRound => {
    if (d.state === "verified") return { key: d.key, title: "Supplementary agreement", tone: "go", tag: "signed", line: "Signed and verified", row: d };
    if (d.state === "signed") return { key: d.key, title: "Supplementary agreement", tone: "late", tag: "verify it", line: "Signed in Zoho Sign — verify it", row: d };
    if (d.sign && SIGN_CLOSED.test(d.sign.status)) return { key: d.key, title: "Supplementary agreement", tone: "due", tag: "send again", line: (d.sign.label || d.sign.status) + " — send a new one", row: d };
    return { key: d.key, title: "Supplementary agreement", tone: "ir", tag: "with the IR", line: "Out for signature — the IR is chasing", row: d };
  });
}

export function SecPaperLive({ s, me, dispatch, x, papers }: ImPageProps & { x: ImInvestor; papers: NonNullable<PaperRows> }) {
  if ("loading" in papers) return <div className="card"><div className="cb"><p className="sm" style={{ margin: 0 }}>Reading the papers…</p></div></div>;
  if ("error" in papers) return <div className="note bad" role="alert">{papers.error}</div>;
  const rows = papers.rows, rounds = liveRounds(rows);
  const sender = (d: DocRow) => (d.sign?.sentBy ? d.sign.sentBy.split(" ")[0] : d.sign?.sentById ? <ImPname s={s} k={d.sign.sentById} first /> : null);
  return (
    <>
      <div className="card"><div className="ch"><h3>The two rounds</h3><div className="sp" />
        <span className="prov here">the Investors side sends and verifies</span></div><div className="cb">
        <div className="led" style={{ alignItems: "flex-start" }}>
          <span className="tag ir"><span className="dot" />lead side</span>
          <span style={{ minWidth: 0 }}><b>NDA</b>
            <div className="sm">The NDA is the IR&apos;s round, on the lead — its state is on the lead page, not here.</div></span>
        </div>
        {rounds.map(r => (
          <div className="led" style={{ alignItems: "flex-start" }} key={r.key}>
            <span className={`tag ${r.tone}`}><span className="dot" />{r.tag}</span>
            <span style={{ minWidth: 0 }}><b>{r.title}</b>
              <div className="sm">{r.line}{r.row && sentLine(r.row) ? <>{" · " + sentLine(r.row)}{sender(r.row) ? <>{" by "}{sender(r.row)}</> : null}</> : null}
                {r.row && r.row.method ? " · " + r.row.method : ""}</div>
              {r.tone === "ir" ? <div className="sm"><ProvIR />{" the investor has been told and is being chased — that half is theirs and is not re-typed here."}</div> : null}</span>
            {may(s, me, "doc") && (r.tone === "due") ? <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "send", id: x.id, seed: { DTPL: "Supplementary agreement" } })}>Send it</button> : null}
            {may(s, me, "doc") && r.tone === "late" && r.row ? <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "verify", id: r.row!.recordId, seed: { DREF: "" } })}>Verify it</button> : null}
          </div>
        ))}
      </div></div>
      <div className="card fill"><div className="ch"><h3>Everything on file</h3><div className="sp" />
        <span className="sm">{rows.length + " document" + (rows.length === 1 ? "" : "s") + " with a signing request, all under "}<span className="mono">{x.code ?? x.id}</span></span>
        {may(s, me, "doc") ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "send", id: x.id, seed: { DTPL: null } })}>＋ Send one</button> : null}</div>
        <div className="tw"><table><thead><tr><th>Document</th><th>Sent</th><th>Signing</th><th>State</th><th></th></tr></thead>
          <tbody>{rows.length ? rows.map(d => (
            <tr key={d.key}>
              <td><b>{d.label}</b><div className="sm">{d.module === "Contacts" ? "Personal" : "Allotment"}</div></td>
              <td className="sm">{sender(d)} <span className="mono">{docDay(d.sign?.sentAt)}</span></td>
              <td className="sm">{d.method || "—"}</td>
              <td><span className={`tag ${d.state === "verified" ? "go" : d.state === "signed" ? "late" : "due"}`}><span className="dot" />{
                d.state === "verified" ? "verified" : d.state === "signed" ? "signed — verify" : d.sign?.label || "out for signature"}</span>
                {d.state === "sent" && d.sign?.expiresAt ? <div className="sm">{"link expires " + docDay(d.sign.expiresAt)}</div> : null}</td>
              <td style={{ textAlign: "right" }}>{may(s, me, "doc") && d.state !== "verified"
                ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "verify", id: d.recordId, seed: { DREF: "" } })}>Verify</button> : null}</td>
            </tr>
          )) : <tr><td colSpan={5}><div className="empty">Nothing on file.</div></td></tr>}
          </tbody></table></div></div>
      <InvUploads s={s} me={me} dispatch={dispatch} inv={x.id} />
    </>
  );
}

/* vOne → "paper" — imx.js 1766–1798 */
function SecPaper({ s, me, dispatch, x }: ImPageProps & { x: ImInvestor }) {
  const rounds = roundsFor(s, me, x.id), docs = docOf(s, me, x.id);
  return (
    <>
      <div className="card"><div className="ch"><h3>The two rounds</h3><div className="sp" />
        <span className="prov here">the Investors side sends and verifies</span></div><div className="cb">
        {rounds.map((r, i) => (
          <div className="led" style={{ alignItems: "flex-start" }} key={i}>
            <span className={`tag ${r.state === "done" ? "go" : r.state === "said" ? "late" : r.state === "blocked" ? "late"
              : r.state === "none" ? "due" : "ir"}`}><span className="dot" />{r.state === "done" ? "signed" : r.state === "said" ? "verify it"
                : r.state === "blocked" ? "blocked" : r.state === "none" ? "not sent" : "with the IR"}</span>
            <span style={{ minWidth: 0 }}><b>{r.R ? r.R.t : ""}</b>
              <div className="sm">{r.t + (r.d ? " · sent " + day6(r.d.sent) + " by " + who(s, r.d.by).n.split(" ")[0] + (r.d.sig ? " · " + r.d.sig : "") : "")}
                {r.d && r.d.ref ? <>{" · "}<span className="mono">{r.d.ref}</span></> : null}</div>
              {r.state === "out" ? <div className="sm"><ProvIR />{" the investor has been told and is being chased — that half is theirs and is not re-typed here."}</div> : null}</span>
            {may(s, me, "doc") && r.state === "none" ? <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "send", id: x.id, seed: { DTPL: r.R ? r.R.tpl : null } })}>Send it</button> : null}
            {may(s, me, "doc") && r.state === "said" && r.d ? <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "verify", id: r.d!.id, seed: { DREF: "" } })}>Verify it</button> : null}
          </div>
        ))}
      </div></div>
      <div className="card fill"><div className="ch"><h3>Everything on file</h3><div className="sp" />
        <span className="sm">{docs.length + " document" + (docs.length === 1 ? "" : "s") + ", all under "}<span className="mono">{x.id}</span></span>
        {may(s, me, "doc") ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "send", id: x.id, seed: { DTPL: null } })}>＋ Send one</button> : null}</div>
        <div className="tw"><table><thead><tr><th>Document</th><th>Sent</th><th>Signing</th><th>State</th>
          <th>Reference</th><th></th></tr></thead>
          <tbody>{docs.length ? docs.map(d => (
            <tr key={d.id}>
              <td><b>{d.t}</b><div className="sm">{d.cls + " · "}<ImPname s={s} k={d.by} first /></div></td>
              <td className="sm mono">{day6(d.sent)}</td>
              <td className="sm">{d.sig || "—"}</td>
              <td><DocTag d={d} />{d.state === "awaiting" && d.exp ? <div className="sm">{"link expires " + d.exp}</div> : null}
                <SignCell s={s} me={me} dispatch={dispatch} d={d} /></td>
              <td className="sm mono">{d.ref || "—"}</td>
              <td style={{ textAlign: "right" }}>{may(s, me, "doc") && d.state === "awaiting"
                ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "verify", id: d.id, seed: { DREF: "" } })}>Verify</button>
                : <BlockIt s={s} me={me} dispatch={dispatch} d={d} />}</td>
            </tr>
          )) : <tr><td colSpan={6}><div className="empty">Nothing on file.</div></td></tr>}
          </tbody></table></div></div>
      <InvUploads s={s} me={me} dispatch={dispatch} inv={x.id} />
    </>
  );
}
