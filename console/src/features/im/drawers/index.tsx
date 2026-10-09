"use client";

/* THE INVESTORS DRAWERS — imx.js section 15 (DRAWERS, lines 2592–2893) and section 16's vDrawer()
   frame (2918–2933). Detail and every write that needs more than a click, in one place, so a screen
   never has to grow a form.

   The prototype's form globals (PUTR, DREF, DTPL, DSIG, PKIND, PMODE, DET, KSEL, TK, CT, UP, FD) are
   s.ui.drafts; every input writes them with {type:"setDraft"}. Stashing and activating a draft per
   person/drawer/record (stashDrawerDraft / activateDrawerDraft) is done by the core on openDrawer
   and closeDrawer, so a drawer here only reads the active draft. drawerReadable gates the whole
   frame, exactly as the prototype wrapped every body/sub/foot in it. */

import { SignRowCell } from "../paper2/SignCell";
import { AgreedDraftOffer, SUPP_TEMPLATE, useAgreedDraft } from "../paper2/AgreedDraft";
import { TemplatePick, useTemplatePick } from "../paper2/TemplatePick";
import { TestSigningMark } from "../paper2/TestSigningMark";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { newIdempotencyKey, runWrite, useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { dayOf, documentUpload, documentsList } from "@/lib/data/endpoints/documents";
import { leadHints, NO_WORD } from "@/lib/data/endpoints/paperwork";
import { allotmentOf, HAND_METHODS, METHOD_OF, NOTHING_CAME_BACK, PAPER_OF_TEMPLATE, signBlock, signPrefill, signSend, signVerify, type HandMethod } from "@/lib/data/endpoints/sign";
import type { Paper } from "@/server/documents/list";
import {
  CHANS, FSTATE, I, fmtDate, MOODS, PMODES, primaryDoer, SIGS, TIERS, TKCATS, TKPRI, TPL, UNIT, UPCATS, UPTO,
  aged, cadence, docRefOf, drawerReadable, dueBy, freeUnits, gotBy, isSuper, may, mayCare,
  mayDetails, mayCareOn, mayDetailsOn, money, notFin, plusDays, readBook, roundOf, safeNote, tierOf, who,
  fileKind, llpOf, UPLOAD_ACCEPT, uploadCheck, uploadKey,
} from "@/lib/im";
import type { ImDrafts, ImDrawerKey, ImInvestor, ImScope } from "@/lib/im";
import { Icon } from "@/components/ui/Icon";
import { caseOpen } from "@/lib/data/endpoints/cases";
import { audienceOf, updateList, updatePublish } from "@/lib/data/endpoints/updates";
import { ImPname, KycTag, Pii, type ImPageProps } from "../common";
import { AllotPick, MONEY_DRAWER_DEFS, pickedAllot } from "../money/drawers";
import { receiptPrepare, receiptRecord, type Recorded } from "@/lib/data/endpoints/claims";
import { claimConfirm, claimNotThere, claimOne } from "@/lib/data/endpoints/receipts";
import { useReload, useSaveQueue, type ConsoleState } from "@/lib/store";
import { NOT_SAVED_WAITING, offlineGate, PREPARE_RENEW_MS, receiptQueueKey, receiptSave, type HeldPrepare } from "@/lib/receipt-queue";
import type { Prepared } from "@/server/money/record-receipt";
import { amManagers, investorRecord, kamAssign } from "@/lib/data/endpoints/investors";
import { careContact, careDetails, careKyc, liveDetailChanges } from "@/lib/data/endpoints/care";
import { investorAllot } from "@/lib/data/endpoints/allotments";

type Ctx = ImPageProps & { id: string | null };
type Part = (c: Ctx) => ReactNode;
interface DrawerDef { w: number; t: string; sub: Part; body: Part; foot: Part }

const nameOf = ({ s, me, id }: Ctx): string => (I(s, me, id) || { n: "" }).n || "";
const draft = (c: Ctx): ImDrafts => c.s.ui.drafts;
const set = (c: Ctx, patch: Partial<ImDrafts>) => c.dispatch({ type: "setDraft", patch });
const TagDot = ({ c, children }: { c: string; children: ReactNode }) =>
  <span className={`tag ${c}`}><span className="dot" />{children}</span>;

/* ---- kam — imx.js 2597–2637 ----
   M09-S04-W2: the manager dropdown, what a manager carries today and the load are GET /api/investors/am/managers, so the
   drawer no longer counts the book. Live the option's value is the Zoho user id; the fixture's is the demo seat key. */
function KamBody(c: Ctx) {
  const { s, me, id } = c; const x = I(s, me, id);
  const mg = useApiRead(amManagers, { s, me }, true);
  if (!x) return null;
  const { KSEL } = draft(c);
  const T = tierOf(x) || TIERS[TIERS.length - 1];
  const list = mg.state === "ok" ? mg.data.managers : [];
  const sel = KSEL ? list.find(m => m.id === KSEL) ?? null : null;
  const nameOfM = (k: string | null | undefined) => (k ? list.find(m => m.id === k)?.name || s.data.P[k]?.n : "") || "a manager";
  const carried = sel ? TIERS.map(t => {
    const n = sel.tiers[t.k as "A" | "B" | "C"];
    return n ? (
      <div className="led" key={t.k}><span className={`tag ${t.k === "A" ? "br" : ""}`}>{t.t}</span>
        <span style={{ minWidth: 0 }}><span className="sm">{t.t2}</span></span>
        <span className="amt">{n}</span></div>
    ) : null;
  }).filter(Boolean) : [];
  const loadLine = sel ? "About " + sel.perMonth + " conversation" + (Math.round(sel.perMonth) === 1 ? "" : "s") + " a month at the cadences they are already promised"
    + (x.kam === KSEL ? "" : ", before this one.") : "";
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>A {T.t} holding gets {T.t2}. Naming
        somebody is a promise about how often this investor hears from us, so it is worth checking the
        load before making it.</p>
      <p className="lbl">The manager</p>
      {mg.state === "error" ? <div className="note bad" role="alert">{mg.err.error}</div> : null}
      <select className="selw" aria-label="The manager" value={KSEL || ""} onChange={e => set(c, { KSEL: e.target.value || null })}>
        <option value="">The shared pool — no named manager</option>
        {list.filter(m => !m.left).map(m => (
          <option key={m.id} value={m.id}>{m.name ?? "A manager"} — {m.accounts} account{m.accounts === 1 ? "" : "s"}{m.goneQuiet ? ", " + m.goneQuiet + " gone quiet" : ""}</option>))}
      </select>
      {KSEL ? (
        <div className="drwsec"><p className="lbl">What {nameOfM(KSEL).split(" ")[0]} carries today</p>
          {carried.length ? carried : <p className="sm" style={{ margin: 0 }}>Nothing yet — this would be their first.</p>}
          <p className="sm" style={{ margin: "9px 0 0" }}>{loadLine}</p>
        </div>
      ) : (
        <div className="drwsec"><p className="sm" style={{ margin: 0 }}>{T.pool
          ? "Single-unit holdings sit in the pool by design — three people cannot name themselves against two hundred accounts and mean it."
          : "Returning a " + T.t + " holding to the pool means nobody is answerable for it by name. Do it deliberately."}</p></div>
      )}
      {x.kam && x.kam !== KSEL ? (
        <div className="note warn" style={{ marginTop: 12 }}><b>Moving an account is a
          new introduction.</b> {nameOfM(x.kam)} holds it now. Whoever takes it should call within
          the week — a handover nobody mentions reads to the investor as being forgotten.</div>
      ) : null}
    </>
  );
}
/* M09-S04-W1: naming or moving a manager is PUT /api/investors/[id]/kam (lib/data/endpoints/investors), guarded by the
   record's version. The reducer's own note still speaks in fixture mode; a live refusal lands in the same note. */
function KamHand({ c, id, same }: { c: Ctx; id: string; same: boolean }) {
  const { s, me, dispatch } = c; const { KSEL } = draft(c);
  const mode = useApiMode();
  const rec = useApiRead(investorRecord, { s, me }, id);
  const assign = useApiWrite(kamAssign, { s, me }, dispatch);
  const press = async () => {
    const r = await assign({ id, kam: KSEL, expectedModifiedTime: rec.state === "ok" ? rec.data.record.version : null });
    if (r.ok && mode === "live") dispatch({ type: "closeDrawer" });
  };
  return (
    <button className="act" disabled={same} title={same ? "That is who holds it already" : undefined}
      onClick={same ? undefined : () => void press()}>
      {KSEL ? "Hand it to them" : "Return it to the pool"}</button>
  );
}
function kamFoot(c: Ctx): ReactNode {
  const { s, me, id } = c; const x = I(s, me, id); const { KSEL } = draft(c);
  if (!may(s, me, "assign") || !x || !id) return null;
  return <KamHand c={c} id={id} same={KSEL === (x.kam || null)} />;
}

/* ---- talk — imx.js 2639–2672 ---- */
const NEXTS: [string, string][] = [["", "On the cadence"], ["14", "In a fortnight"], ["30", "In a month"], ["90", "In three months"]];
/* D132: the investor a care drawer works on — the demo book's (fixture) or the live record (GET /api/investors/[id]/record),
   with the version a write is guarded by. Live, the demo book holds no investors, so I() would find none. */
function useCareInvestor(c: Ctx): { x: ImInvestor | null; version: string | null; loading: boolean; err: string | null } {
  const live = useApiMode() === "live";
  const rec = useApiRead(investorRecord, { s: c.s, me: c.me }, live ? c.id : null);
  if (!live) return { x: I(c.s, c.me, c.id), version: null, loading: false, err: null };
  if (rec.state === "ok") return { x: rec.data.record.investor, version: rec.data.record.version, loading: false, err: null };
  return { x: null, version: null, loading: rec.state === "loading", err: rec.state === "error" ? rec.err.error : null };
}
function CareName(c: Ctx) { const { x } = useCareInvestor(c); return <>{x ? x.n : ""}</>; }
function CareWait({ loading, err }: { loading: boolean; err: string | null }) {
  return err ? <div className="note bad" role="alert">{err}</div> : loading ? <p className="sm" style={{ margin: 0 }}>Reading the record…</p> : null;
}
/** A write's in-flight and refusal state, and the press key a retry after an unreachable console reuses. */
function usePress() {
  const [pending, setPending] = useState(false), [err, setErr] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const run = async <T,>(f: (k: string) => Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }>): Promise<boolean> => {
    setPending(true); setErr(null);
    key.current ??= newIdempotencyKey();
    const r = await f(key.current);
    setPending(false);
    if (r.ok) { key.current = null; return true; }
    if (r.status !== 0) key.current = null;   /* only an unreached console retries the same press */
    setErr(r.error); return false;
  };
  return { pending, err, run };
}
const PressErr = ({ err }: { err: string | null }) => err ? <div className="note bad" role="alert" style={{ marginTop: 8, width: "100%" }}>{err}</div> : null;
const NOT_YET_NEXT = "Not available yet — Zoho has no next-contact field, so live the next one is always on the cadence.";

function TalkBody(c: Ctx) {
  const { s, me } = c;
  const live = useApiMode() === "live";
  const { x, loading, err } = useCareInvestor(c);
  if (!x) return <CareWait loading={loading} err={err} />;
  const { CT } = draft(c);
  const first = !x.intro && x.kam === me;
  const T = tierOf(x) || TIERS[TIERS.length - 1];
  return (
    <>
      {first ? (
        <div className="note"><b>This is the introduction.</b> They were brought in by
          {" "}{who(s, x.ir).n} and handed over at allotment. Both names stay on the record afterwards, so nobody
          is passed to a stranger and then forgotten.</div>
      ) : null}
      <p className="lbl" style={{ marginTop: first ? "14px" : "0" }}>How</p>
      <div className="chips" style={{ marginBottom: 14 }}>{(Object.entries(CHANS) as [keyof typeof CHANS, string][]).map(([k, t]) =>
        <button key={k} className={`chip ${CT.ch === k ? "on" : ""}`} onClick={() => set(c, { CT: { ...CT, ch: k } })}>{t}</button>)}</div>
      <p className="lbl">How it felt</p>
      <div className="chips" style={{ marginBottom: 14 }}>{(Object.entries(MOODS) as [keyof typeof MOODS, string][]).map(([k, t]) =>
        <button key={k} className={`chip ${CT.mood === k ? "on" : ""}`} onClick={() => set(c, { CT: { ...CT, mood: k } })}>{t}</button>)}</div>
      <label className="fi"><span>What was actually said</span>
        <textarea className="nta" id="ct-note" rows={4} placeholder="Their words where you have them. This is the part somebody reads a year from now."
          value={CT.note} onChange={e => set(c, { CT: { ...CT, note: e.target.value } })} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>Three words for how it felt, not a score out of ten. A
        number would be averaged, and an average of feelings is a figure nobody can act on — whereas
        “a concern” on a Tier A account is a phone call tomorrow.</p>
      <div className="drwsec"><p className="lbl">The next one</p>
        <p className="sm" style={{ margin: "0 0 8px" }}>The {T.t} cadence puts it
          {" "}{T.every} days out on its own. Override it only if they asked you to{x.nextOn
            ? <>, and note that &quot;on the cadence&quot; clears the {x.nextOn} standing now</> : null}.</p>
        <div className="chips">{NEXTS.map(([v, t]) =>
          <button key={v} className={`chip ${String(CT.next) === v ? "on" : ""}`} disabled={live && v !== ""} title={live && v !== "" ? NOT_YET_NEXT : undefined}
            onClick={() => set(c, { CT: { ...CT, next: v } })}>{t}</button>)}</div>
        {live ? <p className="sm" style={{ margin: "7px 0 0" }}>{NOT_YET_NEXT}</p> : null}
      </div>
    </>
  );
}
/* D132: "Record it" is POST /api/investors/[id]/contact (lib/data/endpoints/care): one Touch on the investor's origin lead, on
   the person's own token; fixture mode still runs the reducer's logContact. */
function TalkFoot(c: Ctx) {
  const { s, me, id, dispatch } = c; const { CT } = draft(c);
  const live = useApiMode() === "live";
  const { x, version } = useCareInvestor(c);
  const write = useApiWrite(careContact, { s, me }, dispatch);
  const press = usePress();
  if (!id || !(live ? mayCareOn(s, me, x) : mayCare(s, me, I(s, me, id)))) return null;
  const go = () => press.run(k => write({ id, version, ch: CT.ch, mood: CT.mood, note: CT.note, nextDays: live ? "" : String(CT.next ?? "") }, { idempotencyKey: k }))
    .then(saved => { if (saved && live) { set(c, { CT: { ch: "call", mood: "good", note: "", next: "" } }); dispatch({ type: "closeDrawer" }); } });
  return (
    <>
      <button className="act" disabled={press.pending || (live && !version)} aria-busy={press.pending} onClick={() => { void go(); }}>
        {press.pending ? "Saving…" : "Record it"}</button>
      <PressErr err={press.err} />
    </>
  );
}

/* ---- claim — imx.js 2674–2710 ----
   M10-S03-W1: the report is GET /api/claims/[id]; "Confirm and record it" is POST /api/claims/[id]/confirm (Idempotency-Key per
   press, the bank reference Finance found) and "Not there yet" is POST /api/claims/[id]/not-there { reason }. */
const mxv = (c: Ctx, k: string): string => (c.s.ui.MX || {})[k] || "";
const setMxv = (c: Ctx, k: string, v: string) => c.dispatch({ type: "mset", k, v });
/** "2026-09-23" → "23 Sep"; the demo book's own "23 Sep" stays as it is */
const dayOfIso = (v: string | null): string => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDate(v).slice(0, 6) : v || "—");
function ClaimSub(c: Ctx) {
  const r = useApiRead(claimOne, { s: c.s, me: c.me }, c.id);
  const inv = useApiRead(investorRecord, { s: c.s, me: c.me }, r.state === "ok" ? r.data.claim.investorId : null);
  return <>{inv.state === "ok" ? inv.data.record.investor.n : r.state === "ok" ? r.data.claim.investorId : ""}</>;
}
function ClaimBody(c: Ctx) {
  const r = useApiRead(claimOne, { s: c.s, me: c.me }, c.id);
  const inv = useApiRead(investorRecord, { s: c.s, me: c.me }, r.state === "ok" ? r.data.claim.investorId : null);
  if (r.state === "idle") return null;
  if (r.state === "loading") return <p className="sm" style={{ margin: 0 }}>Reading the report…</p>;
  if (r.state === "error") return <div className="note bad" role="alert">{r.err.error}</div>;
  const cl = r.data.claim, x = inv.state === "ok" ? inv.data.record.investor : null;
  return (
    <>
      {cl.superUserNote ? <div className="note su" style={{ marginBottom: 12 }}>{cl.superUserNote}</div> : null}
      <div className="note ir"><b>{cl.byName || cl.byId} wrote this on the lead side</b>
        {" "}<span className="mono">{cl.saidOn}</span>. <span className="sm">Written in the IR console.</span><br />{cl.words}</div>
      <p className="sm" style={{ margin: "12px 0 0" }}>It is not a receipt and it has moved nothing. You are the
        only person who can say whether the money is actually in the account, and saying so here is
        what writes the receipt — the IR never types one and never will.</p>
      <div className="drwsec"><dl className="kv" style={{ marginTop: 0 }}>
        <dt>Investor</dt><dd><b>{x ? x.n : cl.investorId}</b> <span className="mono sm">{cl.investorId}</span></dd>
        <dt>Holding</dt><dd>{x ? x.units + " unit" + (x.units > 1 ? "s" : "") + " · " + money(x.units * UNIT) : "—"}</dd>
        <dt>Already in</dt><dd className="mono">{money(cl.alreadyInRupees)}</dd>
        <dt>Outstanding</dt><dd className="mono"><b>{money(cl.outstandingRupees)}</b></dd>
        {cl.holdUntil ? <><dt>Hold ends</dt><dd className="mono">{dayOfIso(cl.holdUntil)}</dd></> : null}
      </dl></div>
      {cl.offers.includes("confirm") ? (
        <div className="drwsec">
          <label className="fi"><span>Bank reference you found</span>
            <input className="inp" id="cl-ref" placeholder={cl.refLastFour ? "ends " + cl.refLastFour : "the reference on the statement"}
              value={mxv(c, "cl:ref:" + c.id)} onChange={e => setMxv(c, "cl:ref:" + c.id, e.target.value)} /></label>
          <label className="fi" style={{ marginTop: 12 }}><span>If it is not there yet — why</span>
            <textarea className="nta" id="cl-why" rows={2} maxLength={500} placeholder="the IR sees this on the lead"
              value={mxv(c, "cl:why:" + c.id)} onChange={e => setMxv(c, "cl:why:" + c.id, e.target.value)} /></label>
        </div>
      ) : null}
    </>
  );
}
function ClaimFoot(c: Ctx) {
  const { s, me, dispatch } = c;
  const r = useApiRead(claimOne, { s, me }, c.id);
  const confirm = useApiWrite(claimConfirm, { s, me }, dispatch);
  const notThere = useApiWrite(claimNotThere, { s, me }, dispatch);
  const key = useRef(newIdempotencyKey());
  if (!c.id || r.state !== "ok" || !r.data.claim.offers.includes("confirm")) return null;
  const done = (ok: boolean) => { if (!ok) return; key.current = newIdempotencyKey(); dispatch({ type: "closeDrawer" }); };
  return (
    <>
      <button className="act" onClick={() => void confirm({ id: c.id!, ref: mxv(c, "cl:ref:" + c.id).trim() }, { idempotencyKey: key.current }).then(x => done(x.ok))}>Confirm and record it</button>{" "}
      <button className="act ghost" onClick={() => void notThere({ id: c.id!, reason: mxv(c, "cl:why:" + c.id).trim() }).then(x => done(x.ok))}>Not there yet</button>
    </>
  );
}

/* ---- pay — imx.js 2712–2746 ---- */
function payBody(c: Ctx): ReactNode {
  const { s, me, id } = c; const x = I(s, me, id); if (!x || !id) return null;
  const { PKIND, PMODE, PUTR } = draft(c);
  const adv = Math.round(x.units * UNIT * 0.1), due = dueBy(s, me, id), got = gotBy(s, me, id);
  const supp = roundOf(s, me, id, "supp");
  return (
    <>
      <p className="lbl">What has landed</p>
      <div className="chips" style={{ marginBottom: 14 }}>
        {got === 0 ? (
          <button className={`chip ${PKIND === "advance" ? "on" : ""}`} onClick={() => set(c, { PKIND: "advance" })}>
            The 10% advance <span className="u">{money(adv)}</span></button>
        ) : null}{" "}
        <button className={`chip ${PKIND !== "advance" ? "on" : ""}`} onClick={() => set(c, { PKIND: "balance" })}>
          {got ? "The balance" : "Paid in full"} <span className="u">{money(due)}</span></button>
      </div>
      <p className="lbl">How</p>
      <div className="chips" style={{ marginBottom: 14 }}>{PMODES.map(m =>
        <button key={m} className={`chip ${PMODE === m ? "on" : ""}`} onClick={() => set(c, { PMODE: m })}>{m}</button>)}</div>
      <label className="fi"><span>Reference</span>
        <input className="inp mono" id="p-utr" placeholder="UTR or cheque number" value={PUTR}
          onChange={e => set(c, { PUTR: e.target.value })} /></label>
      <AllotPick s={s} me={me} dispatch={c.dispatch} id={id} />
      <div className="drwsec"><dl className="kv" style={{ marginTop: 0 }}>
        <dt>Agreement</dt><dd>{supp.state === "done"
          ? <TagDot c="go">signed and verified</TagDot>
          : <TagDot c="late">{supp.t}</TagDot>}</dd>
        <dt>Land</dt><dd>{Object.entries(x.blocks).map(([k, n]) => "Block " + k + " ×" + n).join(", ") || "—"}
          {" "}<span className="sm">· {freeUnits(s)} free on the shelf</span></dd>
        <dt>After this</dt><dd>{PKIND === "advance"
          ? `Reserved, with a 30-day clock to ${plusDays(s.data.NOW, 30)}`
          : "Paid in full — allotment is the next step"}</dd>
      </dl>
        <p className="sm" style={{ margin: "10px 0 0" }}>The receipt is written here and appears on the IR&apos;s lead
          within the minute. They do not record it and cannot.</p></div>
    </>
  );
}
/* M08-S03-W1: Record it is POST /api/receipts/prepare, then POST /api/receipts with one Idempotency-Key per press
   (lib/data/endpoints/claims). Recording is never refused for unsigned paper — the answer says matching waits (D21).
   M01-S08 (D41, NOTE-8): the press goes through the console's one save queue in both modes. The preparation is renewed
   while the drawer is open and online (every 4 minutes); offline it is queued only while that preparation is under 5
   minutes old, with queuedAt = the server's preparedAt + monotonic elapsed time; the drawer stays open saying "Not saved
   yet" and nothing on the record changes until the queue replays it. A retry is a new press (new key, fresh preparation). */
const mono = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
function PayFoot(c: Ctx) {
  const { s, me, id, dispatch } = c; const { PKIND, PMODE, PUTR } = draft(c);
  const prepare = useApiWrite(receiptPrepare, { s, me }, dispatch), record = useApiWrite(receiptRecord, { s, me }, dispatch);
  const reloadData = useReload();
  const q = useSaveQueue();
  const apiMode = useApiMode();
  const live = apiMode === "live";
  const [busy, setBusy] = useState(false);
  const allot = id ? pickedAllot(s, me, id) || null : null;
  const book = useRef({ s, me }); book.current = { s, me };
  const held = useRef<HeldPrepare<Prepared> | null>(null);
  const mayPay = may(s, me, "pay") && !!id;
  /* keep a preparation: now, and again every four minutes, while this footer is up and the browser can reach the server.
     A renewal is quiet — it never raises a note (an offline press says why itself). */
  useEffect(() => {
    held.current = null;
    if (!mayPay || !q) return;
    const run = async () => {
      if (live && !q.isOnline()) return;
      const r = await runWrite(apiMode, receiptPrepare, book.current, () => {}, { allotmentId: allot });
      if (r.ok) held.current = { p: r.data, preparedAt: r.data.preparedAt, mono: mono() };
    };
    void run();
    const t = setInterval(() => void run(), PREPARE_RENEW_MS);
    return () => clearInterval(t);
  }, [mayPay, allot, apiMode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mayPay || !id) return null;
  const say = (msg: string) => dispatch({ type: "note", msg });
  const press = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!q) { /* no console around it (a bare render): the direct two calls */
        const key = newIdempotencyKey();
        const p = await prepare({ allotmentId: allot });
        if (!p.ok) return;
        const r = await record({ inv: id, allotmentId: allot, kind: PKIND, mode: PMODE, ref: PUTR, prepared: p.data }, { idempotencyKey: key });
        if (r.ok && r.data.matchNote) say(r.data.matchNote);
        return;
      }
      const offline = !q.isOnline();
      let h = held.current;
      if (offline && !live && !h) { /* the demo has no network to wait for: prepare against the book */
        const p = await runWrite(apiMode, receiptPrepare, book.current, () => {}, { allotmentId: allot });
        if (p.ok) h = { p: p.data, preparedAt: p.data.preparedAt, mono: mono() };
      }
      if (offline) { const why = offlineGate(h, mono()); if (why) { say(why); return; } }
      const intent = { inv: id, allotmentId: allot, kind: PKIND, mode: PMODE, ref: PUTR };
      const r = q.enqueueSave(receiptSave<Prepared, Recorded, ConsoleState>({
        key: receiptQueueKey({ actor: me, session: "receipt" }, intent), inv: id, offline, held: h, mono, newKey: newIdempotencyKey,
        prepare: async () => { const p = await runWrite(apiMode, receiptPrepare, book.current, dispatch, { allotmentId: allot }); return p.ok ? p : { ok: false, error: p.error }; },
        record: async (prepared, extra) => {
          const x = await runWrite(apiMode, receiptRecord, book.current, dispatch, { ...intent, kind: PKIND, prepared, queuedAt: extra.queuedAt },
            { idempotencyKey: extra.idempotencyKey });
          return x.ok ? x : { ok: false, error: x.error };
        },
        validate: st => { const cs = { data: st.IM, ui: st.IMUI }; return may(cs, st.WHO, "pay") && (live || !!I(cs, st.WHO, id)); }, /* live: the route checks the record on the person's own token */
        saved: (data, read) => {
          /* fixture: the reducer's recordPay has closed the drawer and cleared the draft; live: the page does — only if that
             same drawer is still the one open (a replay may land after the person has moved on) */
          const cur = read().IMUI.DRW;
          if (live && cur && cur.k === "pay" && cur.id === id) { dispatch({ type: "setDraft", patch: { PUTR: "" } }); dispatch({ type: "closeDrawer" }); }
          if (live) reloadData();
          if (data.matchNote) say(data.matchNote);
        },
      }));
      if (!r || r.status === "rejected") say("Not saved yet — this change could not be queued. Nothing on the record changed.");
    } finally { setBusy(false); }
  };
  /* the honest state of THIS press, from the queue itself: waiting for a connection, or failed (the top bar offers Retry) */
  const mine = q?.saves.find(e => e.key === receiptQueueKey({ actor: me, session: "receipt" }, { inv: id, allotmentId: allot, kind: PKIND, mode: PMODE, ref: PUTR }));
  const status = mine?.status === "pending" ? NOT_SAVED_WAITING
    : mine?.status === "failed" ? `Not saved yet — ${mine.error || "the save was not confirmed."} Use Retry in the top bar.` : null;
  return (
    <div style={{ flex: "1 1 100%" }}>
      <button className="act" disabled={busy} onClick={() => void press()}>Record it</button>
      {status ? <p className="sm" role="status" style={{ margin: "8px 0 0" }}><b>Not saved yet.</b> {status.replace(/^Not saved yet — /, "")}</p> : null}
    </div>
  );
}
const payFoot = (c: Ctx): ReactNode => <PayFoot {...c} />;

/* ---- send — imx.js 2748–2776 ----
   M12-S04-W1: the facts are GET /api/documents/sign/prefill (recipient, NRI, what is already out) and Send is
   POST /api/documents/sign/send with one Idempotency-Key per press; a plain function part renders a component so it may read. */
const sendBlocked = (x: ImInvestor | null, DSIG: string): boolean => !!x && x.nri && DSIG === "Aadhaar OTP";
function useSendFacts(c: Ctx) {
  const { s, me, id } = c; const x = I(s, me, id);
  const d = draft(c), { DSIG, DTID } = d;
  /* M12-S12-NOTE-2: an agreed supplementary draft makes the Supplementary agreement the default document of the send */
  const ag = useAgreedDraft(s, me, id);
  const DTPL = d.DTPL || (ag.offered ? SUPP_TEMPLATE : d.DTPL);
  const paper = DTPL ? PAPER_OF_TEMPLATE[DTPL] ?? null : null;
  const rid = paper && x ? (paper === "fema" ? x.id : paper === "nda" ? x.lead ?? x.id : allotmentOf({ s, me }, x.id) ?? x.id) : null;
  const pre = useApiRead(signPrefill, { s, me }, { paper: paper as Paper, id: rid });
  /* Aadhaar is offered only where the route says so; a template that is not one of the four papers has no prefill: the book's NRI flag */
  const off = paper ? pre.state === "ok" && !pre.data.methods.includes("aadhaar") : !!(x && x.nri);
  const pick = useTemplatePick(s, me, paper, DTID);
  return { x, DTPL, DSIG, DTID, paper, rid, pre, pick, ag, blocked: !!x && off && DSIG === "Aadhaar OTP" };
}
function SendBody(c: Ctx) {
  const { s, id } = c; const f = useSendFacts(c); const { x, DTPL, DSIG, DTID, blocked, pre, paper, pick, ag } = f;
  if (!x || !id) return null;
  const t = TPL.find(y => y.t === DTPL);
  return (
    <>
      <p className="lbl">Template</p>
      <div className="chips" style={{ marginBottom: 14 }}>{TPL.map(y => {
        const out = s.data.DOCS.some(d => d.inv === id && d.t === y.t && d.state !== "blocked");
        return (
          <button key={y.t} className={`chip ${DTPL === y.t ? "on" : ""}`} disabled={out} title={out ? "Already out or signed" : undefined}
            onClick={out ? undefined : () => set(c, { DTPL: y.t })}>{y.t}{out ? <span className="u">on file</span>
              : y.wet ? <span className="u">wet sign</span> : null}</button>
        );
      })}</div>
      {t && t.noSign ? <p className="sm" style={{ margin: "0 0 12px" }}>A receipt is issued, not signed.</p>
        : <><p className="lbl">Signing</p><div className="chips" style={{ marginBottom: 14 }}>{SIGS.map(sg =>
          <button key={sg} className={`chip ${DSIG === sg ? "on" : ""}`} onClick={() => set(c, { DSIG: sg })}>{sg}</button>)}</div></>}
      <TestSigningMark on={!!paper && pre.state === "ok" && pre.data.testSigning} />
      {paper === "supplementary" && ag.draft ? <AgreedDraftOffer draft={ag.draft} /> : null}
      <TemplatePick paper={paper} pick={pick} DTID={DTID} onPick={v => set(c, { DTID: v })} />
      {paper && pre.state === "error" ? <div className="note bad" role="alert" style={{ marginBottom: 12 }}>{pre.err.error}</div> : null}
      {paper && pre.state === "ok" && pre.data.recipient
        ? <p className="sm" style={{ margin: "0 0 12px" }}>{"To " + pre.data.recipient.name + " · " + pre.data.recipient.email}</p> : null}
      {blocked ? (
        <div className="note bad"><b>{x.n} is an NRI.</b> Aadhaar OTP needs an Aadhaar
          linked to a live Indian mobile. Use a Class 3 DSC or a wet signature.</div>
      ) : null}
      <div className="drwsec"><p className="sm" style={{ margin: 0 }}>It goes from the finance mailbox as a link
        that expires in a fortnight, filed under <span className="mono">{id}</span>. The IR sees
        that it went and it becomes their job to tell the investor and chase the signature — that
        half is theirs and is never typed on this side.</p></div>
    </>
  );
}
function SendFoot(c: Ctx) {
  const { s, me, id, dispatch } = c; const f = useSendFacts(c); const { x, DTPL, DSIG, blocked, pre, paper, rid, pick } = f;
  const send = useApiWrite(signSend, { s, me }, dispatch);
  const press = useRef<string | null>(null);
  if (!may(s, me, "doc") || !id) return null;
  const ok = !!DTPL && !blocked && pick.ready && (!paper || (pre.state === "ok" && pre.data.maySend));
  const go = () => {
    if (!x || !DTPL) return;
    press.current ??= newIdempotencyKey();
    void send({ paper: paper ?? "other", recordId: rid || x.id, method: METHOD_OF[DSIG] ?? "email-otp", templateId: pick.tid,
      expectedModifiedTime: pre.state === "ok" ? pre.data.modifiedTime ?? "" : "", book: { inv: id, tpl: DTPL, sig: DSIG } },
    { idempotencyKey: press.current }).then(r => { if (r.ok) press.current = null; });
  };
  return (
    <button className="act" disabled={!ok} title={ok ? undefined : pick.ready ? "Pick a template" : "Pick the Zoho Sign template"} onClick={ok ? go : undefined}>Send it</button>
  );
}

/* ---- verify — imx.js 2778–2805 ----
   M12-S06-W1: paper signed outside Zoho Sign. The signed copy is first filed to the paper's slot (POST /api/documents/upload),
   then POST /api/documents/sign/verify names the method and the reference. M12-S07-W1: "Nothing has come back" is
   POST /api/documents/sign/block with its reason. M12-S11-W1: the IR's word on THIS paper is GET /api/leads/[id]/hints?paper=
   — a hint, never a signature, and never a note about another paper. The buttons live in the body (they share the file). */
const PAPER_FILING: Record<string, { scope: "personal" | "allotment"; slot: string; type: string; Scope: "Personal" | "Allotment" }> = {
  fema: { scope: "personal", slot: "fema-declaration", type: "FEMA declaration", Scope: "Personal" },
  supplementary: { scope: "allotment", slot: "supplementary-agreement", type: "Supplementary agreement", Scope: "Allotment" },
  "allocation-letter": { scope: "allotment", slot: "allocation-letter", type: "Allocation letter", Scope: "Allotment" },
};
function VerifyBody(c: Ctx) {
  const { s, me, id, dispatch } = c;
  const mode = useApiMode();
  const list = useApiRead(documentsList, { s, me }, "all");
  const row = list.state === "ok" ? list.data.rows.find(r => r.recordId === id || r.key === id) ?? null : null;
  const rec = useApiRead(investorRecord, { s, me }, row ? row.contactId : null);
  const leadId = rec.state === "ok" ? rec.data.record.origin.leadId : null;
  const hints = useApiRead(leadHints, { s, me }, { leadId, paper: row ? row.paper : "nda" });
  const pre = useApiRead(signPrefill, { s, me }, { paper: row ? row.paper : "nda", id: row ? row.recordId : null });
  const upload = useApiWrite(documentUpload, { s, me }, dispatch);
  const verify = useApiWrite(signVerify, { s, me }, dispatch);
  /* M11-S05-W1: the Allocation letter's "signed copy is here" verifies AND allots through POST /api/investors/[id]/allot */
  const allot = useApiWrite(investorAllot, { s, me }, dispatch);
  const block = useApiWrite(signBlock, { s, me }, dispatch);
  const [method, setMethod] = useState<HandMethod | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const idem = useRef<string | null>(null);
  const { DREF } = draft(c);
  if (list.state === "loading") return <p className="sm" style={{ margin: 0 }}>Reading the document…</p>;
  if (list.state === "error") return <p className="sm" role="alert" style={{ margin: 0 }}>{list.err.error}</p>;
  /* W3-E2E-5: the drawer now opens on the route's word, so a paper that is not on this person's list says so */
  if (!row) return <p className="sm" role="alert" style={{ margin: 0 }}>This paper is not on your list any more. Reload Documents.</p>;
  const modified = pre.state === "ok" ? pre.data.modifiedTime ?? "" : "";
  const how: HandMethod = method ?? ((HAND_METHODS as readonly string[]).includes(row.method || "") ? (row.method as HandMethod) : "Uploaded");
  const sg = row.sign, age = sg ? aged(s.data.NOW, sg.sentAt) : null;
  const h = hints.state === "ok" ? hints.data.hints[0] ?? null : null;
  const filing = PAPER_FILING[row.paper];
  const acting = may(s, me, "doc");
  const done = (ok: boolean) => { if (ok && mode === "live") dispatch({ type: "closeDrawer" }); };
  const isLive = mode === "live";
  /* the demo book files each paper under a class (Regulatory, Contractual…); the route has no such field */
  const bookCls = (s.data.DOCS.find(x => x.id === row.recordId) || { cls: "" }).cls;

  const verifyIt = async () => {
    setErr(null);
    if (file && filing) {
      const chk = uploadCheck({ name: file.name, size: file.size, type: file.type });
      if (!chk.ok) { setErr(chk.msg || "That cannot be uploaded."); return; }
      const kind = fileKind(file.name, file.type);
      const llp = row.llpId ? (llpOf(s, row.llpId) || { Block_Code: null }).Block_Code : null;
      const target = { Scope: filing.Scope as ImScope, Doc_Type: filing.type, Investor: row.contactId, LLP: filing.scope === "personal" ? null : llp };
      idem.current ??= newIdempotencyKey();
      const up = await upload({ scope: filing.scope, recordId: row.recordId, slot: filing.slot, name: file.name, expected: modified || null,
        bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type || (kind === "PDF" ? "application/pdf" : kind === "PNG" ? "image/png" : "image/jpeg"),
        book: { key: uploadKey(file, target), ...target, File_Size: file.size, File_Type: file.type } }, { idempotencyKey: idem.current });
      if (!up.ok) { if (isLive) setErr(up.error); return; }
      idem.current = null;
    }
    /* the Allocation letter is verified by the allot route (M11-S05-W1): it verifies the letter and allots in one guarded write, and
       refuses (facts missing, oversell, balance outstanding) in the page note. Live, the letter's record is the allotment itself;
       the fixture half runs the reducer's verifyDoc, which allots. Every other paper is POST /api/documents/sign/verify (M12-S06-W1). */
    const r = row.paper === "allocation-letter" && row.contactId
      ? await allot({ id: row.contactId, did: row.recordId, allotmentId: isLive ? row.recordId : allotmentOf({ s, me }, row.contactId) ?? "",
        reference: DREF, expectedModifiedTime: modified || null })
      : await verify({ paper: row.paper, recordId: row.recordId, method: how, reference: DREF.trim(), expectedModifiedTime: modified, did: row.recordId });
    done(r.ok);
  };

  return (
    <>
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Document</dt><dd><b>{row.label}</b>{mode === "fixture" && bookCls ? <> <span className="sm">{bookCls}</span></> : null}</dd>
        <dt>Sent</dt><dd>{sg && sg.sentBy ? sg.sentBy.split(" ")[0] + " " : ""}<span className="mono">{sg ? dayOf(sg.sentAt) : "—"}</span></dd>
        <dt>Signing</dt><dd>{row.method || "—"}</dd>
        <dt>Out for</dt><dd>{age == null ? "—" : age + " day" + (age === 1 ? "" : "s")}{sg && sg.expiresAt ? ` · link expires ${dayOf(sg.expiresAt)}` : ""}</dd>
      </dl>
      {/* M12-S05 — the request's Zoho Sign status, a reminder and a recall (not in the prototype) */}
      <SignRowCell s={s} me={me} dispatch={dispatch} row={row} actions />
      {h ? (
        <div className="note ir" style={{ marginTop: 12 }}><b>{(h.by && h.by.name) || "The IR"} says the
          investor has signed and sent it</b> <span className="mono">{h.at}</span>.
          <br />{hints.state === "ok" ? hints.data.note : ""} This is where it becomes one.</div>
      ) : hints.state === "error" ? (
        <p className="sm" role="alert" style={{ margin: "12px 0 0" }}>{hints.err.error}</p>
      ) : (
        <p className="sm" style={{ margin: "12px 0 0" }}>{NO_WORD} Verifying now is fine if the
          signed copy is in front of you — the relay does not require their beat first.</p>
      )}
      {acting && row.state !== "verified" ? (
        <>
          <p className="lbl" style={{ marginTop: 14 }}>How it was signed</p>
          <div className="chips" role="group" aria-label="How it was signed">
            {HAND_METHODS.map(m => <button key={m} type="button" className={`chip ${how === m ? "on" : ""}`} aria-pressed={how === m}
              onClick={() => setMethod(m)}>{m}</button>)}</div>
          <label className="fi" style={{ marginTop: 14 }}><span>The signed copy (PDF, JPG or PNG)</span>
            <input type="file" accept={UPLOAD_ACCEPT} onChange={e => { setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null); setErr(null); idem.current = null; }} /></label>
        </>
      ) : null}
      <label className="fi" style={{ marginTop: 14 }}><span>e-Mudhra reference</span>
        <input className="inp mono" id="d-ref" placeholder="EMU-…" value={DREF}
          onChange={e => set(c, { DREF: e.target.value })} /></label>
      <p className="sm" style={{ margin: "8px 0 0" }}>Leave it blank and one is generated from today&apos;s date —
        but the reference is what makes the signature provable, so it is worth pasting.</p>
      {err ? <div className="note bad" role="alert" style={{ marginTop: 10 }}>{err}</div> : null}
      {acting ? (
        <div style={{ marginTop: 14 }}>
          <button className="act" onClick={() => { void verifyIt(); }}>The signed copy is here</button>{" "}
          <button className="act ghost" onClick={() => { void block({ paper: row.paper, recordId: row.recordId, reason: NOTHING_CAME_BACK, expectedModifiedTime: modified, did: row.recordId }).then(r => done(r.ok)); }}>Nothing has come back</button>
        </div>) : null}
    </>
  );
}

/* ---- kyc — imx.js 2807–2834 ---- */
function KycBody(c: Ctx) {
  const { s, me, dispatch } = c;
  const live = useApiMode() === "live";
  const { x, loading, err } = useCareInvestor(c);
  if (!x) return <CareWait loading={loading} err={err} />;
  if (notFin(s, me)) return <p className="sm" style={{ margin: 0 }}>Identity is Finance&apos;s. There is nothing on
    this drawer you can see.</p>;
  const bank = x.bank || { ifsc: "", name: "", drop: "" };
  return (
    <>
      {live ? (
        <dl className="kv" style={{ marginTop: 0 }}>
          <dt>Identity</dt><dd><span className="sm">Pass checks that a PAN — and, for a resident, an Aadhaar reference — is on
            file in Zoho. The values are never read for it, and never shown here.</span></dd>
          <dt>Residency</dt><dd>{x.nri ? "Non-resident — FEMA applies" : "Resident"}</dd>
          <dt>Now</dt><dd><KycTag x={x} />{x.kycOn ? <> <span className="sm mono">{x.kycOn}</span></> : null}</dd>
        </dl>
      ) : <dl className="kv" style={{ marginTop: 0 }}>
        <dt>PAN</dt><dd><Pii s={s} me={me} dispatch={dispatch} x={x} f="pan" /></dd>
        <dt>Aadhaar</dt><dd>{x.aadh ? <><span className="mono">•••• •••• {x.aadh}</span>
          <div className="sm mono">{x.aref}</div></>
          : x.nri ? <span className="sm">Non-resident — passport and visa route, no Aadhaar</span>
            : <span className="tag late">no verification on file</span>}</dd>
        <dt>Bank</dt><dd><Pii s={s} me={me} dispatch={dispatch} x={x} f="acct" /><div className="sm">{may(s, me, "bank")
          ? (bank.ifsc || "—") + " · " + (bank.name || "—") + " · " : ""}name match {bank.drop || "—"}</div></dd>
        <dt>Residency</dt><dd>{x.nri ? "Non-resident — FEMA applies" : "Resident"}</dd>
        <dt>Now</dt><dd><KycTag x={x} />{x.kycWhy ? <> <span className="sm">{x.kycWhy}</span></> : null}</dd>
      </dl>}
      <div className={`note ${x.nri ? "warn" : ""}`} style={{ marginTop: 12 }}>{x.nri
        ? `An NRI holding cannot be allotted without a signed FEMA declaration, however much money has
         arrived. Passing KYC does not clear that — it is a separate document and a separate check.`
        : `Passing KYC unblocks allotment. It does not unblock money: the agreement does that, and the
         agreement is checked separately when a receipt is recorded.`}</div>
    </>
  );
}
/* D132: Pass it / Fail it are POST /api/investors/[id]/kyc (lib/data/endpoints/care): Contacts.KYC and KYC_Completed_On on
   Compliance's own token; fixture mode still runs the reducer's passKyc / failKyc. */
function KycFoot(c: Ctx) {
  const { s, me, id, dispatch } = c;
  const live = useApiMode() === "live";
  const { version } = useCareInvestor(c);
  const write = useApiWrite(careKyc, { s, me }, dispatch);
  const press = usePress();
  if (!may(s, me, "kyc") || !id) return null;
  const go = (result: "passed" | "failed") => press.run(() => write({ id, version, result, ...(result === "failed" ? { why: "Documents do not match" } : {}) }))
    .then(saved => { if (saved && live) dispatch({ type: "closeDrawer" }); });
  const off = press.pending || (live && !version);
  return (
    <>
      <button className="act" disabled={off} aria-busy={press.pending} onClick={() => { void go("passed"); }}>{press.pending ? "Saving…" : "Pass it"}</button>{" "}
      <button className="act ghost" disabled={off} onClick={() => { void go("failed"); }}>Fail it</button>
      <PressErr err={press.err} />
    </>
  );
}

/* ---- tkt — imx.js 2836–2861 ---- */
function tktBody(c: Ctx): ReactNode {
  const { s, me } = c; const { TK } = draft(c);
  return (
    <>
      <label className="fi"><span>Investor</span>
        <select className="selw" value={TK.inv || ""} onChange={e => set(c, { TK: { ...TK, inv: e.target.value } })}>
          {readBook(s, me).map(x => <option key={x.id} value={x.id}>{x.n} — {x.id}</option>)}
        </select></label>
      <label className="fi" style={{ marginTop: 12 }}><span>What they want</span>
        <input className="inp" id="tk-t" placeholder="e.g. change the bank account for payouts"
          value={TK.t} onChange={e => set(c, { TK: { ...TK, t: e.target.value } })} /></label>
      <p className="lbl" style={{ marginTop: 14 }}>Kind</p>
      <div className="chips">{TKCATS.map(k =>
        <button key={k} className={`chip ${TK.cat === k ? "on" : ""}`} onClick={() => set(c, { TK: { ...TK, cat: k } })}>{k}</button>)}</div>
      <p className="lbl" style={{ marginTop: 14 }}>Priority</p>
      <div className="chips">{TKPRI.map(([k, t]) =>
        <button key={k} className={`chip ${TK.pri === k ? "on" : ""}`} onClick={() => set(c, { TK: { ...TK, pri: k } })}>{t}</button>)}</div>
      <label className="fi" style={{ marginTop: 14 }}><span>Detail</span>
        <textarea className="nta" id="tk-d" rows={3} placeholder="What they actually asked for, in their words"
          value={TK.d} onChange={e => set(c, { TK: { ...TK, d: e.target.value } })} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>A bank change is a compliance job — it needs a fresh name
        match before any payout uses it. That is why the kind is asked for before the detail.</p>
    </>
  );
}
function tktFoot(c: Ctx): ReactNode { return <TktFoot {...c} />; }
/* M13-S03-W1: 'Open it' is POST /api/cases; a refusal lands in the page note, and the drawer closes on success */
function TktFoot(c: Ctx) {
  const { s, me, dispatch } = c; const { TK } = draft(c);
  const open = useApiWrite(caseOpen, { s, me }, dispatch);
  if (!may(s, me, "tkt")) return null;
  const ok = !!I(s, me, TK.inv) && !!TK.t.trim();
  const go = async () => {
    if (!ok || !TK.inv) return;
    const r = await open({ investorId: TK.inv, category: TK.cat, subject: TK.t, description: TK.d, priority: TK.pri, ownerId: me });
    if (r.ok) { set(c, { TK: { inv: null, cat: "Query", t: "", d: "", pri: "normal" } }); dispatch({ type: "closeDrawer" }); }
  };
  return (
    <button className="act" disabled={!ok} title={ok ? undefined : "An investor and a line saying what they want"}
      onClick={ok ? () => { void go(); } : undefined}>
      Open it</button>
  );
}

/* ---- upd — imx.js 2863–2885 ---- */
function updBody(c: Ctx): ReactNode { return <UpdBody {...c} />; }
/* M13-S06-W1: the kinds this seat may publish are what GET /api/updates answers (a KAM: Produce, Notice) */
function UpdBody(c: Ctx) {
  const { s, me } = c; const { UP } = draft(c); const INV = s.data.INV;
  const r = useApiRead(updateList, { s, me }, undefined);
  const kinds = r.state === "ok" ? UPCATS.filter(k => (r.data.kinds as string[]).includes(k)) : UPCATS;
  return (
    <>
      <label className="fi"><span>Headline</span>
        <input className="inp" id="up-t" placeholder="e.g. Block A — year-3 flowering ahead of schedule"
          value={UP.t} onChange={e => set(c, { UP: { ...UP, t: e.target.value } })} /></label>
      <p className="lbl" style={{ marginTop: 14 }}>Kind</p>
      <div className="chips">{kinds.map(k =>
        <button key={k} className={`chip ${UP.cat === k ? "on" : ""}`} onClick={() => set(c, { UP: { ...UP, cat: k } })}>{k}</button>)}</div>
      <p className="lbl" style={{ marginTop: 14 }}>Who sees it</p>
      <div className="chips">{UPTO.map(([k, t]) =>
        <button key={k} className={`chip ${UP.to === k ? "on" : ""}`} onClick={() => set(c, { UP: { ...UP, to: k } })}>{t} <span className="u">{
          k === "all" ? INV.length : k === "nri" ? INV.filter(x => x.nri).length : INV.filter(x => x.st === "allocated").length}</span></button>)}</div>
      <label className="fi" style={{ marginTop: 14 }}><span>The update</span>
        <textarea className="nta" id="up-d" rows={4} placeholder="Plain words. This is what the investor reads."
          value={UP.d} onChange={e => set(c, { UP: { ...UP, d: e.target.value } })} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>Every segment here can be reconstructed from the book, so
        six months from now it is still possible to say exactly who was told what.</p>
    </>
  );
}
function updFoot(c: Ctx): ReactNode { return <UpdFoot {...c} />; }
/* M13-S06-W1: 'Publish it' is POST /api/updates {headline, kind, audience, llpId, body}; the drawer closes on success */
function UpdFoot(c: Ctx) {
  const { s, me, dispatch } = c; const { UP } = draft(c);
  const publish = useApiWrite(updatePublish, { s, me }, dispatch);
  const ok = !!UP.t.trim();
  const go = async () => {
    const r = await publish({ headline: UP.t, kind: UP.cat, audience: audienceOf(UP.to), body: UP.d });
    if (r.ok) { set(c, { UP: { t: "", cat: "Produce", d: "", to: "all" } }); dispatch({ type: "closeDrawer" }); }
  };
  return (
    <button className="act" disabled={!ok} title={ok ? undefined : "A headline at least"}
      onClick={ok ? () => { void go(); } : undefined}>Publish it</button>
  );
}

/* ---- field — imx.js 2887–2912 ---- */
function fieldBody(c: Ctx): ReactNode {
  const { s } = c; const { FD } = draft(c);
  return (
    <>
      <p className="lbl">Which block</p>
      <div className="chips">{s.data.FARMS.map(f =>
        <button key={f.k} className={`chip ${FD.blk === f.k ? "on" : ""}`} onClick={() => set(c, { FD: { ...FD, blk: f.k } })}>
          Block {f.k} <span className="u">{f.crop}</span></button>)}</div>
      <label className="fi" style={{ marginTop: 14 }}><span>What happened</span>
        <input className="inp" id="fd-h" placeholder="e.g. flowering nine days early on the north half"
          value={FD.head} onChange={e => set(c, { FD: { ...FD, head: e.target.value } })} /></label>
      <p className="lbl" style={{ marginTop: 14 }}>Where the block is now</p>
      <div className="chips">{FSTATE.map(st =>
        <button key={st} className={`chip ${FD.st === st ? "on" : ""}`} onClick={() => set(c, { FD: { ...FD, st } })}>{st}</button>)}</div>
      <p className="sm" style={{ margin: "7px 0 0" }}>Leave this alone unless the block has actually moved on —
        it changes what every screen says the block is doing, and it is on the record when it does.
        Currently <b>{(s.data.FARMS.find(f => f.k === FD.blk) || { crop: "" }).crop || "—"}</b>.</p>
      <label className="fi" style={{ marginTop: 14 }}><span>The detail</span>
        <textarea className="nta" id="fd-d" rows={4} placeholder="Plain words, and no number you would not repeat to an investor standing in the row."
          value={FD.d} onChange={e => set(c, { FD: { ...FD, d: e.target.value } })} /></label>
      <div className="note" style={{ marginTop: 12 }}><b>This is not a release.</b> Recording progress says
        what is growing; it does not put a single unit on the shelf, and it cannot. Releasing land is
        Finance&apos;s, on the same page, and the two are separate rights precisely because one of them
        is a promise to sell something.</div>
    </>
  );
}
function fieldFoot(c: Ctx): ReactNode { return <FieldFoot {...c} />; }
/* D132: no Zoho module holds a field note (farm progress) in the sandbox schema, so live the button is disabled with the
   "Not available yet" pattern rather than changing only this browser's copy. Fixture mode runs the reducer's logField. */
function FieldFoot(c: Ctx) {
  const { s, me, dispatch } = c; const { FD } = draft(c);
  const live = useApiMode() === "live";
  if (!may(s, me, "field")) return null;
  if (live) return (
    <><button className="act" disabled title={NOT_YET_FIELD}>Record it</button>
      <p className="sm" style={{ margin: "6px 0 0", width: "100%" }}>{NOT_YET_FIELD}</p></>
  );
  const ok = !!FD.head.trim();
  return (
    <button className="act" disabled={!ok} title={ok ? undefined : "Say what happened"}
      onClick={ok ? () => dispatch({ type: "logField", blk: FD.blk, st: FD.st, head: FD.head, d: FD.d }) : undefined}>Record it</button>
  );
}
const NOT_YET_FIELD = "Not available yet — recording farm progress in Zoho is still to be decided (no module holds it).";

/* ---- details — imx.js 2914–2931 ---- */
const DETFIELDS: [keyof ImDrafts["DET"], string][] = [["n", "Name"], ["ph", "Phone"], ["em", "Email"], ["city", "City"],
  ["addr", "Address"], ["nominee", "Nominee"]];
/** D132: live, the name (a change also opens a bank re-match ticket nobody has routed yet) and the address (six Mailing_*
 *  fields) are not saved — offered read-only with "Not available yet". */
const NOT_YET_DETAIL: Partial<Record<keyof ImDrafts["DET"], string>> = {
  n: "Not available yet — a name change also has to open a bank name re-match for Finance, which is still to be decided.",
  addr: "Not available yet — the address is six fields in Zoho; change it there or ask Digital Infrastructure.",
};
function DetailsBody(c: Ctx) {
  const live = useApiMode() === "live";
  const { x, loading, err } = useCareInvestor(c);
  if (!x) return <CareWait loading={loading} err={err} />;
  const { DET } = draft(c);
  return (
    <>
      <p className="sm" style={{ margin: "0 0 13px" }}>What the investor asked to change about themselves.
        Not their PAN, not their Aadhaar, not the account money leaves — those are identity and they
        are Finance&apos;s, on this same record, behind the same wall as always.</p>
      {DETFIELDS.map(([k, t]) => {
        const notYet = live ? NOT_YET_DETAIL[k] : undefined;
        return (
          <label key={k} className="fi" style={{ marginBottom: 11 }}><span>{t}</span>
            <input className="inp" value={DET[k] != null ? DET[k] : x[k] || ""} disabled={!!notYet} title={notYet}
              onChange={e => set(c, { DET: { ...DET, [k]: e.target.value } })} />
            {notYet ? <span className="sm">{notYet}</span> : null}</label>
        );
      })}
      <div className="note" style={{ marginTop: 2 }}><b>A name change is not free.</b> If the name on the
        record stops matching the name on the bank account, the next payout fails and Finance has to
        re-run the match — so a name edit opens a compliance ticket by itself rather than quietly
        breaking something a month from now.</div>
    </>
  );
}
/* D132: "Save the changes" is PUT /api/investors/[id]/details (lib/data/endpoints/care) on the person's own token, guarded by
   the record's version; fixture mode still runs the reducer's saveDetails. */
function DetailsFoot(c: Ctx) {
  const { s, me, id, dispatch } = c; const { DET } = draft(c);
  const live = useApiMode() === "live";
  const { x, version } = useCareInvestor(c);
  const write = useApiWrite(careDetails, { s, me }, dispatch);
  const press = usePress();
  if (!id || !(live ? mayDetailsOn(s, me, x) : mayDetails(s, me, I(s, me, id)))) return null;
  const changes = live && x ? liveDetailChanges(DET, x as unknown as Record<string, unknown>) : {};
  const none = live && !Object.keys(changes).length;
  const go = () => press.run(() => write({ id, version, changes }))
    .then(saved => { if (saved && live) { set(c, { DET: {} }); dispatch({ type: "closeDrawer" }); } });
  return (
    <>
      <button className="act" disabled={press.pending || none || (live && !version)} title={none ? "Nothing has been changed" : undefined}
        aria-busy={press.pending} onClick={() => { void go(); }}>{press.pending ? "Saving…" : "Save the changes"}</button>
      <PressErr err={press.err} />
    </>
  );
}

/* ---- the registry — imx.js 2592 `const DRAWERS = {…}` ---- */
export const DRAWERS: Record<ImDrawerKey, DrawerDef> = {
  kam: { w: 430, t: "Who looks after this account", sub: nameOf, body: c => <KamBody {...c} />, foot: kamFoot },
  talk: { w: 450, t: "Log a conversation", sub: c => <CareName {...c} />, body: c => <TalkBody {...c} />, foot: c => <TalkFoot {...c} /> },
  claim: {
    w: 450, t: "An IR says the money has arrived",
    sub: c => <ClaimSub {...c} />,
    body: c => <ClaimBody {...c} />, foot: c => <ClaimFoot {...c} />,
  },
  pay: { w: 430, t: "Record a receipt", sub: nameOf, body: payBody, foot: payFoot },
  send: { w: 440, t: "Send for signature", sub: nameOf, body: c => <SendBody {...c} />, foot: c => <SendFoot {...c} /> },
  verify: {
    w: 430, t: "Verify the signed copy",
    sub: ({ s, me, id }) => { const d = id ? s.data.DOCS.find(y => y.id === docRefOf(id)) : null; return d ? (I(s, me, d.inv) || { n: "" }).n || d.inv : ""; },
    body: c => <VerifyBody {...c} />, foot: () => null,
  },
  kyc: { w: 430, t: "KYC", sub: c => <CareName {...c} />, body: c => <KycBody {...c} />, foot: c => <KycFoot {...c} /> },
  tkt: { w: 440, t: "Open a ticket", sub: () => "raised on behalf of an investor", body: tktBody, foot: tktFoot },
  upd: { w: 440, t: "Publish an update", sub: () => "it appears in the investor's app", body: updBody, foot: updFoot },
  field: { w: 450, t: "Record farm progress", sub: () => "what the investors will be told", body: fieldBody, foot: fieldFoot },
  details: { w: 450, t: "Change their details", sub: c => <CareName {...c} />, body: c => <DetailsBody {...c} />, foot: c => <DetailsFoot {...c} /> },
  ...MONEY_DRAWER_DEFS,                /* later decisions: Mark paid, LLP, Add investor, app access (../money) */
};

/* superNote(k) — imx.js 79 */
function SuperNote({ s, me, k }: { s: ImPageProps["s"]; me: string; k: ImDrawerKey }) {
  return isSuper(s, me) && primaryDoer(s.data, k) ? (
    <div className="note su" style={{ marginBottom: 12 }}><b>Super user.</b> The primary doer of this
      step is {primaryDoer(s.data, k)}. You can do it here to test it; it is recorded as yours.</div>
  ) : null;
}

/* D132: live, the record a care drawer works on is GET /api/investors/[id]/record, not the demo book drawerReadable looks in;
   the seat's right opens the drawer, and the route re-derives it (and a KAM's own-account rule) on the press. */
const LIVE_RECORD_DRAWERS: Partial<Record<ImDrawerKey, (s: ImPageProps["s"], me: string) => boolean>> = {
  talk: (s, me) => may(s, me, "care"), details: (s, me) => may(s, me, "details"), kyc: (s, me) => !notFin(s, me),
};
function readableIn(live: boolean, s: ImPageProps["s"], me: string, k: ImDrawerKey, id: string | null | undefined): boolean {
  const f = live ? LIVE_RECORD_DRAWERS[k] : undefined;
  return f ? !!id && !!s.data.P[me] && may(s, me, "view") && f(s, me) : drawerReadable(s, me, k, id);
}

/** the open drawer's title, or null when no readable drawer is open (for the console's focus handling) */
export function imDrawerTitle(s: ImPageProps["s"], me: string, live = false): string | null {
  const D = s.ui.DRW;
  if (!D || !DRAWERS[D.k] || !readableIn(live, s, me, D.k, D.id)) return null;
  return DRAWERS[D.k].t;
}

/* vDrawer() — imx.js 2918–2933 */
export function ImDrawer({ s, me, dispatch, docked }: ImPageProps & { docked: boolean }) {
  const D = s.ui.DRW;
  const live = useApiMode() === "live";
  if (!D) return null;
  const d = DRAWERS[D.k];
  if (!d || !readableIn(live, s, me, D.k, D.id)) return null;
  const c: Ctx = { s, me, dispatch, id: D.id };
  const t = d.t;
  const sub = d.sub(c), ft = d.foot(c);
  const close = () => dispatch({ type: "closeDrawer" });
  return (
    <>
      {docked ? null : <div className="scrim" onClick={close} />}
      <aside className="drw" id="drw" role="dialog" aria-modal={docked ? "false" : "true"}
        aria-label={t} style={{ ["--dw" as string]: `${d.w || 440}px` }}>
        <header className="drwh"><div className="drw-heading"><h2>{t}</h2>{sub ? <div className="sub">{sub}</div> : null}</div>
          <div className="drw-header-actions"><button className="drwx" id="drwx" onClick={close} aria-label={`Close “${t}”`}
            title={`Close “${t}” (Esc)`}><Icon name="x" /></button></div></header>
        <div className="drwb"><SuperNote s={s} me={me} k={D.k} />{d.body(c)}</div>
        {ft ? <footer className="drwf">{ft}</footer> : null}
      </aside>
    </>
  );
}
