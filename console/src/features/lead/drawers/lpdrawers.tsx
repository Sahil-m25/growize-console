"use client";

/* ── the D56 lead page's own drawers and the Investor file. ir-merged.js 9851–9920 (DRAWERS.rung,
   DRAWERS.commit, DRAWERS.undo) and 5320–5330 + 10500–10515 (FILETABS/fileTabs and the wrap that
   adds the file's tabs to the four drawers that already do each job).

   The file is not a new drawer: it is History, Owners, Material and Payments, each wearing the same
   tab row while `ui.FILEON` is set, so each tab IS the drawer that already did that job. Imported
   last by ./index.ts so it wraps the registrations the other modules made. */

import { useState, type ReactNode } from "react";
import { useApiMode } from "@/lib/data/api";
import { useJourneyWrites } from "@/lib/data/endpoints/journey";
import { useLeadNotes } from "@/lib/data/endpoints/record";
import { LADDER, PCH, PCHN, ROUNDS } from "@/domain";
import type { PersonKey } from "@/domain";
import { Pname } from "@/components/ui/Pname";
import { ProvL } from "@/features/pay/common";
import { DocumentHistoryBlock } from "./finance";
import type { DrawerKind } from "@/lib/store";
import { canReadFinance, canWork, P, gateWait, nxWhen, pr, prChases, prNext, seeMoney, stepOwner, undoStage } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { drawerDef, registerDrawer, type DrawerDef, type DrawerProps } from "@/components/shell/drawers/registry";
import { FILETABS, needOf, RUNGASK, UNDOWHY } from "../lp";


/* ---- DRAWERS.rung — what the Qualified rung says it needs ---- */
function RungBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!, st = LADDER[l.done], n = needOf(l);
  if (!st || !n) return null;
  const held = !!l.nx, said = !!state.ui.RUNGSAID;
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>Record <b>{st.ev || st.t}</b> after confirming the requirements.</p>
      <p className="lbl">Scheduled next step</p>
      <div className="nxc" style={{ marginBottom: "14px" }}>
        {held ? <><span className="tag go"><span className="dot" />{n.heldT}</span><span className="sm mono">{nxWhen(l)}</span></>
          : <span className="tag late"><span className="dot" />{n.heldNo}</span>}
        <div className="sp" />
        {held ? null : <button type="button" className="chip" onClick={() => { dispatch({ type: "seedNext", id: l.id }); dispatch({ type: "openDrawer", k: "next", id: l.id }); }}>{n.fix}</button>}
      </div>
      <p className="lbl">Your confirmation</p>
      <p className="sm" style={{ margin: "0 0 10px" }}>Confirm {n.t}. This is your recorded assessment.</p>
      <div className="chips">
        <button type="button" className={`chip ${said ? "on" : ""}`} aria-pressed={said} onClick={() => dispatch({ type: "setUi", patch: { RUNGSAID: !said } })}>{n.say}</button>
      </div>
      <p className="sm" style={{ margin: "10px 0 0" }}>{said
        ? "The history will read “" + st.t + " · " + n.note + "”, with your name and the time on it."
        : "Nothing is recorded until you say it."}</p>
    </>
  );
}
/* The ladder's three drawer presses (C2 useJourneyWrites): fixture runs the reducer's recordRung / tickCommit / undoRung as
   before; live POSTs /api/leads/[id]/journey, closes the drawer and re-reads on success, and says a refusal in the foot. */
function useLadderPress() {
  const { dispatch } = useConsole();
  const live = useApiMode() === "live";
  const [err, setErr] = useState<string | null>(null);
  const done = (r: { ok: true } | { ok: false; error: string }) => {
    if (!live) return;
    if (r.ok) { setErr(null); dispatch({ type: "closeDrawer" }); } else setErr(r.error);
  };
  return { done, err: err ? <p className="lp-err" role="alert" style={{ margin: "8px 0 0", flexBasis: "100%" }}>{err}</p> : null };
}
function RungFoot({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const jw = useJourneyWrites();
  const press = useLadderPress();
  const l = lead!, st = LADDER[l.done], n = needOf(l);
  if (!st || !n) return null;
  const held = !!l.nx, said = !!state.ui.RUNGSAID;
  const why = !held ? n.heldNo + " — set it first" : !said ? "Say the scorecard is done first" : "";
  return (
    <>
      <button type="button" className="act" disabled={!(held && said)} title={why || undefined}
        onClick={held && said ? () => { dispatch({ type: "setUi", patch: { RUNGSAID: false } }); void jw.tick(l, "recordRung").then(press.done); } : undefined}>
        {st.t} — {n.foot}
      </button>
      {press.err}
    </>
  );
}
registerDrawer("p:lead.rung" as DrawerKind, {
  lead: true, w: 440,
  ok: (state, id) => { const l = state.LEADS.find((x) => x.id === id); return !!l && !!needOf(l) && stepOwner(state, l.done, l) && !gateWait(state, l); },
  title: (_s, a) => (a.lead && LADDER[a.lead.done]?.t) || "The next rung", sub: (_s, a) => a.lead!.n, Body: RungBody, Foot: RungFoot,
});

/* ---- DRAWERS.commit — the three rungs that cannot be taken back ---- */
function CommitBody({ lead }: DrawerProps) {
  const st = LADDER[lead!.done];
  if (!st) return null;
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>This records <b>{st.ev || st.t}</b>, and {RUNGASK[st.t]}.{st.sla ? <> What the manual attaches to it: <b>{st.sla}</b>.</> : null}</p>
      <p className="lbl">What you cannot do after it</p>
      <p className="sm" style={{ margin: "0 0 12px" }}>This stage cannot be undone. A later correction must be recorded separately.</p>
      <div className="drwsec"><p className="lbl">What it does not do</p>
        <p className="sm" style={{ margin: 0 }}>This records the stage. Finance confirms receipts separately; ownership stays with the IR.</p></div>
    </>
  );
}
function CommitFoot({ lead }: DrawerProps) {
  const { dispatch } = useConsole();
  const jw = useJourneyWrites();
  const press = useLadderPress();
  return (
    <>
      <button type="button" className="act" onClick={() => void jw.tick(lead!, "tickCommit").then(press.done)}>{LADDER[lead!.done]?.t || ""}</button>
      <button type="button" className="chip" onClick={() => dispatch({ type: "closeDrawer" })}>Leave it as it is</button>
      {press.err}
    </>
  );
}
registerDrawer("p:lead.commit" as DrawerKind, {
  lead: true, w: 430, title: (_s, a) => (a.lead && LADDER[a.lead.done]?.t) || "The next rung", sub: (_s, a) => a.lead!.n, Body: CommitBody, Foot: CommitFoot,
});

/* ---- DRAWERS.undo — taking a rung back, with the reason ---- */
function UndoBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!, t = LADDER[l.done - 1]?.t || "", back = LADDER[l.done - 2]?.t || "";
  const why = String(state.ui.UNDOWHY || ""), note = String(state.ui.UNDON || "");
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>Return this investor to <b>{back}</b>. The original stage and your correction remain in history.</p>
      <p className="lbl">Reason for correction</p>
      <div className="chips" style={{ marginBottom: "14px" }}>{UNDOWHY.map((w) => (
        <button type="button" key={w} className={`chip ${why === w ? "on" : ""}`} aria-pressed={why === w} onClick={() => dispatch({ type: "setUi", patch: { UNDOWHY: w } })}>{w}</button>))}</div>
      <label className="fi"><span>What was actually true (optional)</span>
        <textarea className="nta" id="undon" rows={2} placeholder="So the next person reads a correction, not a gap" value={note}
          onChange={(e) => dispatch({ type: "setUi", patch: { UNDON: e.target.value } })} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>{why ? "The history will read “Un-ticked · " + t + " · " + why + "”." : "Choose a reason to enable the correction."}</p>
    </>
  );
}
function UndoFoot({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const jw = useJourneyWrites();
  const press = useLadderPress();
  const l = lead!, why = String(state.ui.UNDOWHY || "");
  const ok = (UNDOWHY as readonly string[]).includes(why);
  return (
    <>
      <button type="button" className="act" disabled={!ok} title={ok ? undefined : "Pick a reason first"}
        onClick={ok ? () => { void jw.untick(l, why, String(state.ui.UNDON || ""), "undoRung").then(press.done); dispatch({ type: "setUi", patch: { UNDOWHY: "", UNDON: "" } }); } : undefined}>
        Un-tick “{LADDER[l.done - 1]?.t || ""}”
      </button>
      {press.err}
    </>
  );
}
registerDrawer("p:lead.undo" as DrawerKind, {
  lead: true, w: 440,
  ok: (state, id) => { const l = state.LEADS.find((x) => x.id === id); return !!l && l.done > 1 && undoStage(state, l).ok; },
  title: (_s, a) => "Un-tick “" + ((a.lead && LADDER[a.lead.done - 1]?.t) || "") + "”", sub: (_s, a) => a.lead!.n, Body: UndoBody, Foot: UndoFoot,
});

/* ---- the Investor file: fileTabs(l,k) and the wrap ---- */
function FileTabs({ l, k }: { l: NonNullable<DrawerProps["lead"]>; k: string }) {
  const { state, dispatch } = useConsole();
  if (!state.ui.FILEON) return null;
  const tabs = FILETABS.filter(([t]) => t !== "money" || (seeMoney(state, l) && (!!state.PAY[l.id] || !!state.ACCT[l.id])));
  return (
    <div className="lp-tabs" role="tablist">{tabs.map(([t, n]) => (
      <button type="button" role="tab" key={t} aria-selected={t === k} className={t === k ? "on" : ""}
        onClick={() => dispatch({ type: "openDrawer", k: t as DrawerKind, id: l.id, seed: { FILEON: true } })}>{n}</button>))}</div>
  );
}

/* roundBlock(l,R) — ir-merged.js 3404. Read-only: each beat, who, when — and whose move the next is */
function RoundBlock({ l, rk }: { l: NonNullable<DrawerProps["lead"]>; rk: string }) {
  const { state } = useConsole();
  if (!canReadFinance(state, l, "docs")) return null;
  const R = ROUNDS.find((x) => x.k === rk)!;
  type Beat = { by: PersonKey; at: string; ch?: string; via?: string; link?: string; v?: number };
  const p = (pr(state, l.id, rk) || {}) as Record<string, Beat | undefined> & { chase?: { ch: string; at: string; phase: string }[]; back?: { by: PersonKey; at: string; why: string } };
  const n = prNext(state, l, rk) as { k: string; t?: string; who?: string | null };
  const any = Object.keys(p).some((k) => k !== "chase" || (p.chase || []).length);
  if (n.k === "none" && !any) return null;
  const tag = n.k === "done" ? <span className="tag go"><span className="dot" />signed and verified</span>
    : n.k === "wait" ? <span className="tag">{n.t}</span>
    : n.who === "Finance" ? <span className="tag due"><span className="dot" />with Finance, in the IM portal</span>
    : n.who ? <span className="tag due"><span className="dot" />the IR&apos;s move</span> : <span className="tag">{n.t || "closed"}</span>;
  const head = <div className="rhd"><b>{R.t}</b><span className="sm">{tag}</span></div>;
  if (n.k === "wait" && !any) return <div className="drwsec">{head}</div>;
  const byline = (o: Beat, extra?: ReactNode) => <><Pname k={o.by} cls="xs" nw /> · <span className="mono">{String(o.at).slice(0, 6)}</span>{extra ? <> · {extra}</> : null}</>;
  const row = (k: string, label: string, o: Beat | undefined, extra: ReactNode, todo: string) => (
    <div key={k} className={`tk ${o ? "on" : ""} ${n.k === k ? "wait" : ""}`}><span className="box">✓</span>
      <span className="t"><b style={{ fontWeight: 600 }}>{label}</b><span className="sm">{o ? byline(o, extra) : n.k === k ? "next — " + (n.who === "Finance" ? "Finance, in the IM portal" : "the IR") : todo}</span></span></div>
  );
  const chaseLine = (phase: string) => {
    const c = prChases(state, l.id, rk, phase);
    if (!c.length) return null;
    return <div key={"c" + phase} className="sm" style={{ padding: "2px 0 8px 27px" }}>{phase === "draft" ? "Chasing agreement" : "Reminders"} — {(Object.keys(PCHN) as (keyof typeof PCHN)[]).filter((ch) => c.some((x) => x.ch === ch))
      .map((ch, i) => <span key={ch}>{i ? " · " : ""}{PCHN[ch]} <b>×{c.filter((x) => x.ch === ch).length}</b></span>)} · last <span className="mono">{String(c[c.length - 1].at).slice(0, 6)}</span></div>;
  };
  const B: ReactNode[] = [];
  if ((R as { draft?: boolean }).draft) {
    B.push(row("draft", "Draft sent", p.draft, p.draft ? ((p.draft.v || 1) > 1 ? "draft " + p.draft.v + " · " : "") + (p.draft.link || "no link") : "", "not yet"));
    B.push(chaseLine("draft"));
    B.push(row("agreed", "Final draft agreed", p.agreed, p.agreed ? p.agreed.link || "" : "", "not yet"));
  }
  B.push(row("sent", "Sent for signature", p.sent, p.sent ? <><ProvL t="IM portal" /> {p.sent.via || ""}</> : "", "not yet"));
  B.push(row("told", "Investor told", p.told, p.told ? "by " + (PCH[p.told.ch as keyof typeof PCH] || p.told.ch) : "", "not yet"));
  B.push(chaseLine("sign"));
  B.push(row("said", "They say it is signed", p.said, "", "not yet"));
  B.push(row("ok", "Signed copy verified", p.ok, p.ok ? <><ProvL t="IM portal" /> on file</> : "", "not yet"));
  return (
    <div className="drwsec">{head}
      {p.back ? <div className="note bad" style={{ margin: "0 0 8px" }}><b>Not signed after all.</b> {p.back.why} — {P(state.PEOPLE, p.back.by).n} <span className="mono">{p.back.at}</span>.</div> : null}
      <div className="ticks">{B}</div></div>
  );
}

function wrap(k: DrawerKind, extra?: (l: NonNullable<DrawerProps["lead"]>) => ReactNode, after?: (l: NonNullable<DrawerProps["lead"]>) => ReactNode) {
  /* a hot reload re-runs this module over defs it already wrapped — wrap the original, once */
  type Marked = DrawerDef & { __orig?: DrawerDef };
  const cur = drawerDef(k) as Marked | undefined;
  const D = cur?.__orig || cur;
  if (!D) return;
  const Inner = D.Body;
  const Extra = ({ l }: { l: NonNullable<DrawerProps["lead"]> }) => <>{extra ? extra(l) : null}</>;
  const After = ({ l }: { l: NonNullable<DrawerProps["lead"]> }) => <>{after ? after(l) : null}</>;
  function Body(props: DrawerProps) {
    const { state } = useConsole();
    const l = props.lead;
    return (
      <>
        {l ? <FileTabs l={l} k={k} /> : null}
        {l && state.ui.FILEON ? <Extra l={l} /> : null}
        <Inner {...props} />
        {l && state.ui.FILEON ? <After l={l} /> : null}
      </>
    );
  }
  registerDrawer(k, { ...D, title: (s, a) => (s.ui.FILEON ? "Investor file" : D.title(s, a)), Body });
  const now = drawerDef(k) as Marked | undefined;
  if (now) now.__orig = D;
}

function HistoryNotes({ l }: { l: NonNullable<DrawerProps["lead"]> }) {
  /* live: GET /api/leads/[id]/notes; fixture: the book's own NOTES */
  const { notes } = useLeadNotes(l.id);
  const n = notes.filter((x) => !(x as { interaction?: string }).interaction);
  if (!n.length) return null;
  return (
    <>
      <p className="lbl">Notes</p>
      {n.map((x, i) => <article className="nt" key={i}><p style={{ margin: 0 }}>{x.t}</p><span className="sm"><Pname k={x.who} first nw cls="xs" /> · <span className="mono">{x.at}</span></span></article>)}
      <div className="drwsec" />
    </>
  );
}
function OwnerDetails({ l }: { l: NonNullable<DrawerProps["lead"]> }) {
  const { state, dispatch } = useConsole();
  return (
    <div className="lp-filerow"><span><b>Details &amp; permission</b><br /><span className="sm">{l.src || "Source not recorded"} · {l.city || "City not recorded"} · {l.em || "no email"}</span></span>
      <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id })}>{canWork(state, l) ? "Edit" : "View"}</button></div>
  );
}
function PaperFile({ l }: { l: NonNullable<DrawerProps["lead"]> }) {
  const { state } = useConsole();
  const any = canReadFinance(state, l, "docs") && ROUNDS.some((R) => { const n = prNext(state, l, R.k); const p = pr(state, l.id, R.k) as Record<string, unknown> | null;
    return !(n.k === "none" && !(p && Object.keys(p).some((k) => k !== "chase" || ((p.chase as unknown[]) || []).length))); });
  return (
    <>
      {any ? <><p className="lbl">Paperwork</p>{ROUNDS.map((R) => <RoundBlock key={R.k} l={l} rk={R.k} />)}</> : null}
      {canReadFinance(state, l, "docs") ? <DocumentHistoryBlock l={l} /> : null}
      <p className="lbl" style={{ marginTop: "14px" }}>Material sent</p>
    </>
  );
}

wrap("history", (l) => <HistoryNotes l={l} />);
wrap("owner", (l) => <OwnerDetails l={l} />);
wrap("material", (l) => <PaperFile l={l} />);
wrap("money");
