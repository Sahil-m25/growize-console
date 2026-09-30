"use client";

/* Investors side — section 9, DASHBOARD (imx.js lines 1367–1466): vDash, vDashAM, amCards,
   vDashFin, qRow. Not a wall of figures — a worklist. The first thing on it is the thing that will
   cost money if nobody does it today, and every row carries the control that does it. */

import type { KeyboardEvent, MouseEvent } from "react";
import {
  careQueue, holdDays, inr, isAM, isSuper, isSys, KAMS, kamLoad,
  money, pageReadable, poolBook, tierOf, TIERS, who, FORFEIT, primaryName,
} from "@/lib/im";
import type { ImInvestor } from "@/lib/im";
import { useApiRead, type Read } from "@/lib/data/api";
import { careRowOf, investorQueue, type MoneyRowView } from "@/lib/data/endpoints/queues";
import { investorsToday } from "@/lib/data/endpoints/today";
import type { CareRow } from "@/server/queues/rules";
import type { AmToday } from "@/server/queues/queue";
import type { InvestorsToday } from "@/server/numbers/investors-today";
import { ProvIR } from "../common";
import type { ImPageProps } from "../common";

const enterOrSpace = (run: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
};

/* vDash — imx.js 1371 */
export function ImDash(p: ImPageProps) {
  const { s, me } = p;
  if (!pageReadable(s, me, "dash")) return null;
  return isAM(s, me) ? <VDashAM {...p} /> : <VDashFin {...p} />;
}

/* One quiet line while a live read is on its way, and the route's own words when it refuses (WIRING.md step 3). */
function Wait({ r }: { r: Read<unknown> }) {
  if (r.state === "error") return <div className="note" role="alert">{r.err.error}</div>;
  return <p className="sm" style={{ margin: "8px 0" }}>Loading…</p>;
}

/* "as of HH:MM", Asia/Kolkata (rule 9): the route's asOf is an instant */
const IST_MS = 5.5 * 3_600_000;
const asOfText = (ms: number) => new Date(ms + IST_MS).toISOString().slice(11, 16);

/* vDashAM — imx.js 1376–1393. Account Management's day. Rows, tiles, cadence and last-heard: GET /api/queues/investors. */
function VDashAM({ s, me, dispatch }: ImPageProps) {
  const r = useApiRead(investorQueue, { s, me }, undefined);
  if (!pageReadable(s, me, "dash") || !isAM(s, me)) return null;
  const head = <div className="ph"><h1>{who(s, me).n.split(" ")[0]}&apos;s day</h1>
    {r.state === "ok" && r.data.side === "am" ? <span className="sub">{(r.data.book === "kam"
      ? r.data.tiles.accountsHeld + " account" + (r.data.tiles.accountsHeld === 1 ? "" : "s") : "the whole book")
      + (r.data.waiting ? " · " + r.data.waiting + " waiting on you" : " · nothing waiting on you")}</span> : null}</div>;
  if (r.state !== "ok" || r.data.side !== "am") return <>{head}<Wait r={r} /></>;
  const d: AmToday = r.data, q = d.rows;
  const n = (v: number | null) => (v === null ? "—" : v);
  return (
    <>
      {head}
      <div className="stats" aria-label="Your day in four figures">
        <div className={`stat ${d.tiles.goneQuiet ? "bad" : ""}`}><b>{d.tiles.goneQuiet}</b><span>Gone quiet</span></div>
        <div className="stat"><b>{d.tiles.accountsHeld}</b><span>Accounts you hold</span></div>
        <div className="stat"><b>{n(d.tiles.ticketsOpenOnYou)}</b><span>Tickets open on you</span></div>
        <div className="stat"><b>{n(d.tiles.conversationsLogged)}</b><span>Conversations logged</span></div>
      </div>
      <div><div>
        <div className="card fill"><div className="ch"><h3>Waiting on you</h3><div className="sp" />
          {d.today ? <span className="tag late"><span className="dot" />{d.today} today</span>
            : <span className="tag go"><span className="dot" />clear</span>}</div>
          <div className="cb">{q.length ? <div className="q">{q.map(x => <QRow key={x.key} s={s} me={me} dispatch={dispatch} x={x} />)}</div>
            : <div className="empty">Every account you hold has been spoken to inside its cadence, and no ticket is open on you.</div>}</div></div>
        {d.accounts.length ? <LastHeard d={d} /> : null}
      </div></div>
    </>
  );
}

/* the cadence and last-heard card: each account's tier, when it was last spoken to and how far past its cadence it is */
function LastHeard({ d }: { d: AmToday }) {
  return (
    <div className="card" style={{ marginTop: 12 }}><div className="ch"><h3>Last heard</h3><div className="sp" />
      <span className="sm">each account, against its cadence</span></div><div className="cb">
      {d.accounts.map(a => (
        <div className="led" key={a.id}><span className={`tag ${a.tier === "A" ? "br" : ""}`}>Tier {a.tier}</span>
          <span style={{ minWidth: 0 }}><b>{a.name}</b>
            <div className="sm">{a.lastHeardAt ? "last heard " + a.lastHeardAt + (a.lastMood ? " · " + a.lastMood : "") : "never spoken to"}</div></span>
          <span className={`tag ${a.overdue !== null && a.overdue > 0 ? "late" : "go"}`}>{a.overdue === null ? "no date"
            : a.overdue > 0 ? a.overdue + " day" + (a.overdue === 1 ? "" : "s") + " past" : "in " + (-a.overdue) + " day" + (a.overdue === -1 ? "" : "s")}</span></div>
      ))}
    </div></div>
  );
}

/* amCards(book, mine) — imx.js 1394–1411. Rendered by the Teams page for an AM seat; lives here
   because the prototype defines it in section 9. */
export function AmCards({ s, me, book, mine }: { s: ImPageProps["s"]; me: string; book: ImInvestor[]; mine: boolean }) {
  const n = KAMS(s).length;
  const l = kamLoad(book);
  const pl = kamLoad(poolBook(s, me));
  return (
    <div>
      <div className="card"><div className="ch"><h3>The cadence</h3><div className="sp" />
        <span className="sm">{mine ? "your book, by tier" : "the whole book, by tier"}</span></div><div className="cb">
        {TIERS.map(t => {
          const c = book.filter(x => tierOf(x)!.k === t.k).length;
          return (
            <div className="led" key={t.k}><span className={`tag ${t.k === "A" ? "br" : ""}`}>{t.t}</span>
              <span style={{ minWidth: 0 }}><b>{`${t.min}${t.k === "A" ? "+" : t.k === "B" ? "–3" : ""} unit${t.min > 1 ? "s" : ""}`}</b>
                <div className="sm">{t.t2}</div></span><span className="amt">{c}</span></div>
          );
        })}
        <p className="sm" style={{ margin: "10px 0 0" }}>{"A tier is not a judgement about the investor. It is a statement about what "
          + n + " " + (n === 1 ? "person" : "people") + " can deliver, written down before it is promised — which is the only version of a service promise anybody keeps. "
          + (mine ? "That is" : "Across the whole book that is") + " "
          + l + " conversation" + (l === 1 ? "" : "s") + " a month" + (mine ? " of yours" : "") + "."
          + (mine ? "" : " " + pl + " of them sit in the pool, which means they belong to whoever is free — the arrangement that works until it does not.")}</p>
      </div></div>
    </div>
  );
}

/* the four headline figures, each with its own state (D41): a failed read says so rather than showing an old number */
function Tile({ label, state, text }: { label: string; state: "fresh" | "stale-but-refreshing" | "error" | "hidden"; text: string }) {
  if (state === "hidden") return null;
  return state === "error" ? <div className="stat bad"><b>—</b><span>{label} · could not be read</span></div>
    : <div className="stat"><b>{text}</b><span>{label}</span></div>;
}
function Tiles({ r }: { r: Read<InvestorsToday> }) {
  if (r.state !== "ok") return <Wait r={r} />;
  const { money: m, units: u, tickets: k, asOf, stale } = r.data;
  return (
    <>
      <div className="stats" aria-label="Headline figures">
        <Tile label="Banked to date" state={m.state} text={m.state === "fresh" || m.state === "stale-but-refreshing" ? money(m.value.banked) : ""} />
        <Tile label="Balance outstanding" state={m.state} text={m.state === "fresh" || m.state === "stale-but-refreshing" ? money(m.value.outstanding) : ""} />
        <Tile label="Units held of released" state={u.state} text={u.state === "fresh" || u.state === "stale-but-refreshing" ? u.value.held + " / " + u.value.released : ""} />
        <Tile label="Tickets open" state={k.state} text={k.state === "fresh" || k.state === "stale-but-refreshing" ? String(k.value.open) : ""} />
      </div>
      <p className="sm" style={{ margin: "-4px 0 10px" }} role="status">
        {asOf === null ? "Nothing has been read yet." : "as of " + asOfText(asOf)}
        {stale ? " · some figures are past their time or could not be read — they are shown as they were last read" : ""}</p>
    </>
  );
}

/* vDashFin — imx.js 1413–1445. Finance's day, and the super user's view of both queues. */
function VDashFin({ s, me, dispatch }: ImPageProps) {
  const r = useApiRead(investorQueue, { s, me }, undefined);
  const today = useApiRead(investorsToday, { s, me }, undefined);
  if (!pageReadable(s, me, "dash") || isAM(s, me) || isSys(s, me)) return null;
  const sup = isSuper(s, me);
  const head = (sub: string) => <div className="ph"><h1>{who(s, me).n.split(" ")[0]}&apos;s day</h1><span className="sub">{sub}</span></div>;
  if (r.state !== "ok" || r.data.side !== "money") return <>{head("")}<Wait r={r} /></>;
  const d = r.data, q = d.rows;
  /* The super user's second queue (Account Management's) has no route — the money route serves one queue per seat —
     so it is still read from the book (PROVISIONAL, see the report). */
  const c = sup ? careQueue(s, me).flatMap(x => careRowOf({ s, me }, x) ?? []) : [];
  const holds = s.data.INV.filter(x => x.st === "reserved" && x.hold), soon = holds.filter(x => (holdDays(s, x) ?? 0) <= 30).length;
  const forfeit = holds.reduce((a, x) => a + FORFEIT * x.units, 0);
  const fin = primaryName(s.data, "head"), comp = primaryName(s.data, "comp"), aml = primaryName(s.data, "amlead");
  const sig = (k: string, t: string, run: () => void, warn: boolean) => (
    <a key={k} className={`chip sig ${warn ? "warn" : ""}`} role="button" tabIndex={0} onClick={run} onKeyDown={enterOrSpace(run)}>
      {t}<span className="sigto" aria-hidden="true">→</span></a>
  );
  const t = today.state === "ok" ? today.data : null;
  const tk = t && (t.tickets.state === "fresh" || t.tickets.state === "stale-but-refreshing") ? t.tickets.value.open : null;
  const un = t && (t.units.state === "fresh" || t.units.state === "stale-but-refreshing") ? t.units.value : null;
  const mo = t && (t.money.state === "fresh" || t.money.state === "stale-but-refreshing") ? t.money.value : null;
  return (
    <>
      {head((sup ? q.length + " in Finance's queue · " + c.length + " in Account Management's"
        : d.waiting ? d.waiting + " waiting on you" : "nothing waiting on you") + (d.today ? " · " + d.today + " today" : ""))}
      <Tiles r={today} />
      <div className="sigs" role="list" aria-label="Elsewhere today — each opens its page">
        {sig("txn", (mo ? money(mo.banked) + " banked · " + money(mo.outstanding) + " outstanding · " : "") + "Payments", () => dispatch({ type: "go", v: "txn" }), false)}
        {holds.length ? sig("hold", soon + " hold" + (soon === 1 ? "" : "s") + " ending within 30 days · " + inr(forfeit) + " at risk · Investors",
          () => { dispatch({ type: "setFilter", patch: { IFILT: "hold" } }); dispatch({ type: "go", v: "inv" }); }, soon > 0) : null}
        {sig("farms", (un ? (un.released - un.held) + " units free to sell · " : "") + "Farms", () => dispatch({ type: "go", v: "farms" }), false)}
        {sig("tkt", (tk !== null ? tk + " ticket" + (tk === 1 ? "" : "s") + " open · " : "") + "Tickets", () => dispatch({ type: "go", v: "tkt" }), (tk ?? 0) > 0)}
      </div>
      {sup ? <div className="note su" style={{ marginBottom: 12 }}><b>Super user.</b> These are other people&apos;s queues. Finance{fin ? " (primary doer: " + fin + ")" : ""} owns money and paper; Compliance{comp ? " (" + comp + ")" : ""} owns KYC; Account Management{aml ? " (" + aml + ")" : ""} owns care. Every button works for you so you can test it, and what you do is recorded as yours.</div> : null}
      <div className="card fill"><div className="ch"><h3>{sup ? "Finance's queue" + (fin ? " · primary: " + fin : "") : "Waiting on you"}</h3><div className="sp" />
        {d.today ? <span className="tag late"><span className="dot" />{d.today} today</span>
          : <span className="tag go"><span className="dot" />clear</span>}</div>
        <div className="cb">{q.length ? <div className="q">{q.map(x => <QRow key={x.key} s={s} me={me} dispatch={dispatch} x={x} />)}</div>
          : <div className="empty">Nothing is waiting on this seat.<br />
            <span className="sm">{!d.readOnly
              ? "Every document is out or signed, every claim is answered and no hold is close."
              : "This is a read-only seat — the queue belongs to the people who can act on it."}</span></div>}
        </div></div>
      {sup ? (
        <div className="card fill" style={{ marginTop: 12 }}><div className="ch"><h3>Account Management&apos;s queue{aml ? " · primary: " + aml : ""}</h3>
          <div className="sp" /><span className={`tag ${c.length ? "due" : "go"}`}><span className="dot" />{c.length || "clear"}</span></div>
          <div className="cb">{c.length ? <div className="q">{c.map(x => <QRow key={x.key} s={s} me={me} dispatch={dispatch} x={x} />)}</div>
            : <div className="empty">Nothing is owed.</div>}</div></div>
      ) : null}
    </>
  );
}

/* qRow(x) — imx.js 1447–1466. One queue row, carrying the control that does it — the route's `action` names it. */
export function QRow({ dispatch, x }: ImPageProps & { x: MoneyRowView | CareRow }) {
  const id = x.investor.id;
  const stop = (run: () => void) => (e: MouseEvent) => { e.stopPropagation(); run(); };
  const talk = () => dispatch({ type: "openDrawer", k: "talk", id, seed: { CT: { ch: "call", mood: "good", note: "", next: "" } } });
  const ref = "ref" in x ? x.ref : {};
  const b =
    x.action === "Assign manager" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "kam", id, seed: { KSEL: null } }))}>Assign manager</button>
      : x.action === null ? <span className="tag late">no manager</span>
        : x.action === "Record the introduction" || x.action === "Log a conversation" ? <button className="act" onClick={stop(talk)}>{x.action}</button>
          : x.action === "Answer it" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "claim", id: ref.claimId ?? null }))}>Answer it</button>
            : x.action === "Verify it" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "verify", id: ref.paper ?? null, seed: { DREF: "" } }))}>Verify it</button>
              : x.action === "Check it" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "kyc", id }))}>Check it</button>
                : x.action === "Remind" ? <button className="act" onClick={stop(() => { dispatch({ type: "go", v: "inv", id }); dispatch({ type: "setSec", v: "inv:" + id, k: "paper" }); })}>Remind</button>
                  : <button className="act ghost" onClick={stop(() => dispatch({ type: "go", v: "inv", id }))}>Open the record</button>;
  const open = () => dispatch({ type: "go", v: "inv", id });
  const from = "from" in x ? x.from : null;
  return (
    <div className={`qc ${x.urg === "now" ? "now" : "soon"}`} role="button" tabIndex={0}
      onClick={open} onKeyDown={e => { if (e.key === "Enter") open(); }}>
      <div className="who2"><b>{x.investor.name ?? id}</b><span>{x.text}{x.kind === "claim" && from ? <>{" · "}<ProvIR t={"from " + from} /></> : null}
        {" · "}<span className="mono">{id}</span></span></div>{b}</div>
  );
}
