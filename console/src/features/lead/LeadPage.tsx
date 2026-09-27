"use client";

/* ── 3. ONE INVESTOR — D56–D58, the lead page. ir-merged.js 4988–5410 (vLead, lpLogger,
   lpComposer, lpPaperRow, lpStepper) ────────────────────────────────────────────────────────
   D56 shows about six things: who this is, the next step, and the ways to act on it. Everything
   else is shown only while it applies (the alerts and the rows), opened by the act that needs it
   (the logging flow, the composer), or kept in one Investor file drawer (four tabs).

   The flow's state (LPFLOW/LPFROM/LPOBJ/LPEARLY/LPLOSE/LPDAY and the draft) lives in `ui.LP`; the
   composer's (EMDRAFT/LPEM) in `ui.EM`; the stepper toggle in `ui.LPSTEPS`; the Saved notice with
   its 10-second Undo in `ui.LPNOTICE` (set by `./reducer.ts`). The writes are `./reducer.ts`'s
   composite actions plus the existing tick/skipStage/addNote/assign/decideMove/reopenLost. */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FCAT, LADDER, LOSTWHY, NAV, OBJS, ST, TOUCHCHANNELS, UNIT } from "@/domain";
import type { Channel, Lead, NavKey } from "@/domain";
import type { DrawerKind } from "@/lib/store";
import { DAY, dISOtoDisp, hhmm, iso, money, nowT, plusD, when, whenT } from "@/lib/format";
import {
  active, canAssign, canClaim, canDecideMove, canLose, canNote, canOperateLeads, canPlan, canReach,
  canReadFinance, canReopen, canWork, channelForAction, claimOf, conFor, covOf, fcOf, gateWait, hasNext,
  inReservation, isIR, lost, ndaOK, nextUp, nxDue, nxWhen, openable, P, paperNow, ph, pr, prChases,
  ragOf, seeMoney, stepOwner, undoStage, watching, whyLocked,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { uiFrom } from "@/features/leads/ui";
import { FUCHANNELS, FUOUTCOMES, fuLatest, waNum } from "@/features/today/work";
import { Icon } from "@/components/ui/Icon";
import { fuPreference } from "./followupContext";
import {
  DEAD, EMMAT, EMTPL, emTplFor, emTplOK, emTpls, emUse, HESITANT, LP_SHORT, LP_SLOTS, LP_WHEN, lpNextChoices,
  lpPaperName, LPPCH, lpPickStep, lpPrefSlot, needOf, RUNGASK, zKind,
  type EmDraft, type LpDraft, type LpFlow,
} from "./lp";
import type { LpNotice } from "./reducer";
import { Live, say } from "./Live";
import "@/features/lead/drawers";   /* register the lead drawers before anything opens one */
import { buildFollowupDraft } from "@/features/leads/followupDrawer";   /* also registers "p:followup" (the first-contact tick opens it) */

type Ctx = ReturnType<typeof useConsole>;

/* ---- the flow's state: one flow open at a time, per person ---- */
const flowOf = (state: Ctx["state"], id: string): LpFlow | null => {
  const f = state.ui.LP as LpFlow | null | undefined;
  return f && f.who === state.WHO && f.id === id ? f : null;
};

/* fuDraft(l), fresh — ir-merged.js 3612 */
function freshDraft(state: Ctx["state"], l: Lead): LpDraft {
  const n = nowT(state.NOW), k = (["call", "msg", "email", "visit"] as const).find((c) => conFor(l, c)) || "reply";
  const next = hasNext(l) && l.nx ? { t: l.nx.t, by: l.nx.by, tm: l.nx.tm || "" } : null;
  return {
    channel: k, outcome: "", obj: [], note: "", d: iso(n), tm: hhmm(n), task: next, keep: false, complete: !!next,
    t: "", nd: iso(plusD(n, 1)), ntm: "10:00", nch: (k === "reply" ? "other" : k) as LpDraft["nch"], noNext: false, error: "",
  };
}

function useLp(l: Lead) {
  const { state, dispatch } = useConsole();
  const f = flowOf(state, l.id);
  const setFlow = (next: LpFlow | null) => dispatch({ type: "setUi", patch: { LP: next } });
  const allowed = (k: string) => conFor(l, k as Channel);
  const pick = (d: LpDraft, t: string) => lpPickStep(d, t, (x) => channelForAction(x), allowed);
  return {
    f,
    /* lpOpen(id,what,channel) */
    open: (what: "log" | "email", channel?: string) => {
      if (!canWork(state, l)) return;
      const d = freshDraft(state, l);
      if (what === "log") { d.channel = (channel || "") as LpDraft["channel"]; d.outcome = ""; d.obj = []; d.t = ""; }
      setFlow({ who: state.WHO, id: l.id, flow: what, from: what === "log" && channel ? channel : null, d });
    },
    close: () => setFlow(null),
    /* lpChange(id) — step back to the outcome question; the channel stays if it came from the button pressed */
    change: () => {
      if (!f) return;
      setFlow({ ...f, day: false, lose: false, obj: false, d: { ...f.d, outcome: "", obj: [], t: "", error: "", channel: f.from ? f.d.channel : ("" as LpDraft["channel"]) } });
    },
    /* lpSet(id,k,v) */
    set: (k: string, v: string | boolean) => {
      if (!f || !canWork(state, l)) return;
      let d: LpDraft = { ...f.d, error: "" }, n: LpFlow = { ...f };
      if (k === "channel") d = { ...d, channel: v as LpDraft["channel"], outcome: "", obj: [] };
      else if (k === "outcome") {
        d = { ...d, outcome: String(v), obj: [], t: "" }; n = { ...n, lose: false, obj: false };
        if (v === "No answer" || v === "Call back") d = pick(d, "Call back");
      } else if (k === "obj") { d = { ...d, obj: v ? [String(v)] : [] }; n = { ...n, obj: true }; }
      else if (k === "t") d = pick(d, String(v));
      else if (k === "untask") d = { ...d, t: "" };
      else if (k === "keep") d = { ...d, keep: !!v, complete: !v };
      else if (k === "earlier") n = { ...n, early: !n.early };
      else if (k === "lose") n = { ...n, lose: "keep" };
      else if (k === "unday") n = { ...n, day: false };
      setFlow({ ...n, d });
    },
    /* lpWhen(id,v) */
    when: (v: string) => {
      if (!f || !v) return;
      const [dd, tt] = v.split("T");
      setFlow({ ...f, early: false, d: { ...f.d, d: dd, tm: (tt || "").slice(0, 5), error: "" } });
    },
    finish: (d: LpDraft) => {
      let x = d;
      if (!x.t) x = pick(x, "Call back");
      if (!x.keep && !x.nd) x = { ...x, nd: iso(nowT(state.NOW)) };
      dispatch({ type: "lpFinish", id: l.id, d: x });
    },
    /* lpDate(id,days,dateISO) */
    date: (days: number | null, dateISO?: string) => {
      if (!f) return;
      let d = f.d;
      if (!d.t) d = pick(d, "Call back");
      d = { ...d, nd: dateISO || iso(plusD(nowT(state.NOW), days || 0)) };
      if (zKind(d.t) === "task") { d = { ...d, ntm: "" }; setFlow({ ...f, d }); dispatch({ type: "lpFinish", id: l.id, d }); return; }
      setFlow({ ...f, day: true, d });
    },
    /* lpTime(id,tm) */
    time: (tm: string) => {
      if (!f) return;
      const d = { ...f.d, ntm: tm || "" };
      dispatch({ type: "lpFinish", id: l.id, d: d.t ? d : pick(d, "Call back") });
    },
    lose: (why: string) => { if (f) dispatch({ type: "lpLose", id: l.id, d: f.d, why }); },
  };
}

function Chip({ on, cls, onClick, children }: { on?: boolean; cls?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`chip ${on ? "on" : ""} ${cls || ""}`} aria-pressed={!!on} onClick={onClick}>{children}</button>
  );
}
const Ask = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <div className="lp-ask"><p className="lp-ql">{label}</p>{children}</div>
);

/* ---- the logging flow, D57: one question at a time ---- */
function LpLogger({ l }: { l: Lead }) {
  const { state } = useConsole();
  const lp = useLp(l);
  const f = lp.f!;
  const d = f.d;
  const now = nowT(state.NOW);
  const bits: ReactNode[] = [];
  if (d.channel) bits.push(d.channel === "reply" ? "They contacted us" : FUCHANNELS[d.channel]);
  if (d.outcome) bits.push(d.outcome);
  if (d.obj && d.obj.length) bits.push(d.obj[0]);
  if (d.channel && d.outcome) {
    const w = whenT(dISOtoDisp(d.d, state.NOW) + " " + d.tm, state.NOW) || state.NOW;
    const isNow = d.d === iso(now) && Math.abs(w.getTime() - now.getTime()) < 30 * 60000;
    bits.push(<button key="w" type="button" className="lp-link lp-mini" onClick={() => lp.set("earlier", true)} title="Change when it happened">{isNow ? "just now" : dISOtoDisp(d.d, state.NOW) + " " + d.tm}</button>);
  }
  if (d.task && d.outcome && !DEAD.includes(d.outcome))
    bits.push(<button key="k" type="button" className="lp-link lp-mini" onClick={() => lp.set("keep", !d.keep)} title={d.keep ? "Mark it done instead" : "Keep it scheduled instead"}>{d.keep ? "keeps" : "completes"} “{d.task.t}”</button>);
  if (d.t && (d.outcome === "No answer" || d.outcome === "Call back") && !d.keep) bits.push("next: " + d.t);
  const joined: ReactNode[] = [];
  bits.forEach((b, i) => { if (i) joined.push(" · "); joined.push(<span key={i}>{b}</span>); });

  const chans = (["call", "msg", "email", "visit"] as const).filter((k) => conFor(l, k) && (k !== "email" || !!l.em) && (!["call", "msg"].includes(k) || !!waNum(l.ph)));
  let q: ReactNode = null;
  if (!d.channel)
    q = <Ask label="How did you reach them?"><div className="chips">{[...chans, "reply" as const].map((k) => (
      <Chip key={k} onClick={() => lp.set("channel", k)}>{k === "reply" ? "They contacted us" : FUCHANNELS[k]}</Chip>))}</div></Ask>;
  else if (!d.outcome)
    q = <Ask label="What happened?"><div className="chips">{(FUOUTCOMES[d.channel] || []).map((o) => (
      <Chip key={o} cls={DEAD.includes(o) ? "lp-neg" : ""} onClick={() => lp.set("outcome", o)}>{o}</Chip>))}</div></Ask>;
  else if (DEAD.includes(d.outcome) && canLose(state, l) && f.lose !== "keep")
    q = <Ask label="Why are they out?"><div className="chips">{LOSTWHY.map((w) => <Chip key={w} onClick={() => lp.lose(w)}>{w}</Chip>)}
      <Chip cls="lp-quiet" onClick={() => lp.set("lose", true)}>Keep it open instead</Chip></div>
      <p className="lp-hint">Picking a reason saves this contact and closes the lead. You can undo for 10 seconds.</p></Ask>;
  else if ((HESITANT.includes(d.outcome) || DEAD.includes(d.outcome)) && !f.obj)
    q = <Ask label="What held them back?"><div className="chips">{OBJS.map((o) => <Chip key={o} onClick={() => lp.set("obj", o)}>{o}</Chip>)}
      <Chip cls="lp-quiet" onClick={() => lp.set("obj", "")}>Skip</Chip></div></Ask>;
  else if (d.keep) q = <div className="lp-ask"><button type="button" className="act" onClick={() => lp.finish(d)}>Save</button></div>;
  else if (!d.t)
    q = <Ask label="What's next?"><div className="chips">{lpNextChoices(l, ndaOK(state, l)).map((t) => <Chip key={t} onClick={() => lp.set("t", t)}>{t}</Chip>)}</div></Ask>;
  else if (!f.day) {
    const tk = zKind(d.t) === "task";
    q = <Ask label={d.outcome === "No answer" || d.outcome === "Call back" ? "Which day will you try again?"
      : <>Which day? <span className="lp-qsub">{d.t} · <button type="button" className="lp-link" onClick={() => lp.set("untask", true)}>change</button></span></>}>
      <div className="chips">{LP_WHEN.map(([t, n]) => <Chip key={t} onClick={() => lp.date(n)}>{t}</Chip>)}
        <label className="chip lp-date">Pick a date<input type="date" min={iso(now)} onChange={(e) => { if (e.target.value) lp.date(null, e.target.value); }} aria-label="Pick a date" /></label></div>
      <p className="lp-hint">{tk ? "Saved as a task with this due date. Picking a date saves; you can undo for 10 seconds." : "Next you pick the time."}</p></Ask>;
  } else {
    const today = d.nd === iso(now), nowHM = hhmm(now), pref = lpPrefSlot(l, (state.NOTES[l.id] || [])[0]?.t);
    const slots = LP_SLOTS.filter(([, tm]) => !today || tm > nowHM);
    const k = zKind(d.t);
    q = <Ask label={<>What time? <span className="lp-qsub">{d.t} · {dISOtoDisp(d.nd || "", state.NOW)} · <button type="button" className="lp-link" onClick={() => lp.set("unday", true)}>change day</button></span></>}>
      <div className="chips">{slots.map(([t, tm]) => {
        const p = !!pref && pref.slot === tm;
        return <Chip key={tm} on={p} cls={p ? "lp-pref" : ""} onClick={() => lp.time(tm)}>{t + " " + tm + (p ? " · their " + pref!.src : "")}</Chip>;
      })}
        <label className="chip lp-date">Pick a time<input type="time" min={today ? nowHM : undefined} onChange={(e) => { if (e.target.value) lp.time(e.target.value); }} aria-label="Pick a time" /></label>
        <Chip cls="lp-quiet" onClick={() => lp.time("")}>Any time that day</Chip></div>
      <p className="lp-hint">Saved in Zoho as {k === "call" ? "a scheduled call with a reminder 15 minutes before" : "a meeting, which also appears in Zoho Calendar"}. Picking a time saves; you can undo for 10 seconds.</p></Ask>;
  }
  return (
    <div className="lp-flow" id="lp-flow">
      <div className="lp-sum"><span>{joined.length ? joined : "Recording a contact"}</span>
        <span className="sp" />
        {d.outcome || (!f.from && d.channel) ? <button type="button" className="lp-link" onClick={lp.change}>Change</button> : null}
        <button type="button" className="lp-x" onClick={lp.close} aria-label="Cancel"><Icon name="x" /></button></div>
      {f.early ? <div className="lp-ask"><input type="datetime-local" className="lp-dt" max={`${iso(now)}T${hhmm(now)}`} defaultValue={`${d.d}T${d.tm}`} onChange={(e) => lp.when(e.target.value)} aria-label="When it happened" /></div> : null}
      {q}
      {d.error ? <p className="lp-err" role="alert">{d.error}</p> : null}
    </div>
  );
}

/* ---- the email composer, D57b: a summary line, a preview, Send ---- */
function emDraftOf(state: Ctx["state"], l: Lead): EmDraft {
  const EM = (state.ui.EM as Record<string, EmDraft> | undefined) || {};
  const nda = ndaOK(state, l), meName = P(state.PEOPLE, state.WHO).n;
  const cur = EM[l.id];
  if (cur) return emTplOK(cur.tpl, nda) ? cur : emUse(l, emTplFor(l, nda, state.SENT[l.id] as Record<string, string> | undefined), meName, cur);
  return emUse(l, emTplFor(l, nda, state.SENT[l.id] as Record<string, string> | undefined), meName);
}
function LpComposer({ l }: { l: Lead }) {
  const { state, dispatch } = useConsole();
  const lp = useLp(l);
  const d = emDraftOf(state, l);
  const setD = (patch: Partial<EmDraft>) => {
    const EM = { ...((state.ui.EM as Record<string, EmDraft> | undefined) || {}) };
    EM[l.id] = { ...d, ...patch };
    dispatch({ type: "setUi", patch: { EM } });
  };
  const T = EMTPL[d.tpl] || { t: "Custom" }, M = EMMAT[d.tpl];
  const nda = ndaOK(state, l), meName = P(state.PEOPLE, state.WHO).n;
  return (
    <div className="lp-flow" id="lp-flow">
      <div className="lp-sum"><span>{T.t}{M ? " · with " + M.say + " attached" : ""} · to {l.em} · from you via Zoho · <b>{d.s}</b></span><span className="sp" />
        <button type="button" className="lp-link" onClick={() => setD({ head: !d.head })}>{d.head ? "Done" : "Edit"}</button>
        <button type="button" className="lp-x" onClick={() => {
          const EM = { ...((state.ui.EM as Record<string, EmDraft> | undefined) || {}) }; delete EM[l.id];
          dispatch({ type: "setUi", patch: { EM, LP: null } });
        }} aria-label="Cancel"><Icon name="x" /></button></div>
      {d.head ? (
        <div className="lp-ask"><div className="chips">{emTpls(nda).map(([k, t]) => (
          <button type="button" key={k} className={`chip ${d.tpl === k ? "on" : ""}`} onClick={() => setD(emUse(l, k, meName, d))}>{t.t}</button>))}</div>
          <input className="lp-noteline" value={d.s} aria-label="Subject" onChange={(e) => setD({ s: e.target.value })} /></div>
      ) : null}
      {d.body
        ? <textarea className="lp-mail" rows={8} aria-label="Message" value={d.b} onChange={(e) => setD({ b: e.target.value })} />
        : <div className="lp-preview">{d.b.split("\n").filter(Boolean).slice(0, 4).join("\n")}…<button type="button" className="lp-link" onClick={() => setD({ body: true })}>Edit message</button></div>}
      {d.err ? <p className="lp-err" role="alert">{d.err}</p> : null}
      <div className="lp-ask"><button type="button" className="act" onClick={() => { if (lp.f) dispatch({ type: "emSend", id: l.id, tpl: d.tpl, s: d.s, b: d.b }); }}>Send email</button></div>
    </div>
  );
}

/* ---- D60: the paperwork row. Only the IR's one next beat, as tap-to-save controls ---- */
function LpPaperRow({ l }: { l: Lead }) {
  const { state, dispatch } = useConsole();
  if (!l || lost(l) || !(canReadFinance(state, l, "docs") || canWork(state, l))) return null;
  const pn = paperNow(state, l);
  if (!pn.R) return null;
  const R = pn.R, n = pn.n as { k: string; t: string; who: string | null };
  const p = (pr(state, l.id, R.k) || {}) as { draft?: { v?: number; link?: string }; back?: { why: string } };
  const nm = lpPaperName(R.k), mine = n.who === "IR" && canWork(state, l);
  const paper = (beat: string, a?: string, link?: string) => dispatch({ type: "lpPaper", id: l.id, beat, rk: R.k, a, link });
  const chip = (label: string, onClick: () => void, cls = "") => <button type="button" key={label} className={`chip ${cls}`} onClick={onClick}>{label}</button>;
  const sub = (t: ReactNode) => <span className="d60d-sub">{t}</span>;
  const deck = R.k === "nda" && !ndaOK(state, l) ? <span className="d60d-sub d60d-deck">Deck goes after the NDA is signed</span> : null;
  const CH = (["call", "msg", "email"] as const).filter((ch) => conFor(l, ch));
  const noCh = sub("Record contact permission first.");
  const link = String(state.ui.PLINK ?? "");
  const linkField = (phd: string, btn: string, beat: string) => (
    <div className="d60d-link"><input className="inp" aria-label={phd} placeholder={phd} value={link}
      onChange={(e) => dispatch({ type: "setUi", patch: { PLINK: e.target.value } })} />
      <button type="button" className="btn" id="d60d-go" disabled={!link.trim()} onClick={() => paper(beat, undefined, link)}>{btn}</button></div>
  );
  let head: string, body: ReactNode = null, tag: ReactNode = null;
  if (n.who === "Finance") {
    head = nm + " — with Finance in the IM portal";
    body = sub(n.k === "sent" ? "Finance sends it for signature." : "They say it is signed; Finance is checking the signed copy.");
  } else if (!mine) {
    head = nm + " — " + n.t.toLowerCase();
    tag = <span className="tag">{l.own ? "With " + P(state.PEOPLE, l.own).n.split(" ")[0] : "No owner"}</span>;
  } else if (n.k === "told") {
    head = nm + " is in their inbox — how did you tell them?";
    body = CH.length ? <div className="chips">{CH.map((ch) => chip(LPPCH[ch][0].toUpperCase() + LPPCH[ch].slice(1), () => paper("told", ch)))}</div> : noCh;
  } else if (n.k === "said") {
    const c = prChases(state, l.id, R.k, "sign").length;
    head = nm + " — waiting for their signature · " + (c ? c + " reminder" + (c === 1 ? "" : "s") : "no reminders yet");
    body = <>{p.back ? sub("Finance: not signed after all — " + p.back.why + ".") : null}
      <div className="chips">{CH.map((ch) => chip("Reminded by " + LPPCH[ch], () => paper("chase", ch)))}
        {chip("They say it's signed", () => paper("said"), "on")}</div></>;
  } else if (n.k === "draft") {
    head = nm + " — send the draft";
    body = linkField("Paste the Zoho link to the draft", "Draft sent", "draft");
  } else if (n.k === "agreed") {
    const redo = state.ui.PREDRAFT === l.id + R.k;
    head = nm + " — get the final draft agreed";
    body = <>{sub("Draft " + (p.draft?.v || 1) + (p.draft?.link ? " · " + p.draft.link : ""))}
      {redo ? linkField("Paste the link to draft " + ((p.draft?.v || 1) + 1), "New draft sent", "redraft")
        : linkField("Paste the link to the agreed final draft", "Final draft agreed", "agreed")}
      <button type="button" className="lp-link lp-mini" onClick={() => dispatch({ type: "setUi", patch: { PREDRAFT: redo ? null : l.id + R.k, PLINK: "" } })}>{redo ? "Back to the final draft" : "New draft"}</button></>;
  } else head = nm + " — " + n.t.toLowerCase();
  return (
    <div className="lp-stage d60d-paper"><span className="sm">Paperwork</span><div className="d60d-pbody"><b>{head}</b>{body}{deck}</div>{tag}</div>
  );
}

/* lpStepper(l) */
function LpStepper({ l }: { l: Lead }) {
  const at = Math.max(0, l.done - 1);
  return (
    <ol className="lp-steps" aria-label="Journey stages">{LADDER.map((s, i) => {
      const st = lost(l) && i === at ? "lost" : i < l.done ? "done" : i === l.done && !lost(l) ? "here" : "";
      return <li key={s.t} className={st} title={s.t + (i < l.done && l.at[i] ? " · " + l.at[i] : "")}><span className="lp-dot">{i < l.done ? "✓" : i + 1}</span><span className="lp-lbl">{LP_SHORT[i]}</span></li>;
    })}</ol>
  );
}

/* workNotice() — the page's Saved notice, with its 10-second Undo */
function LpNoticeBar() {
  const { state, dispatch } = useConsole();
  const n = state.ui.LPNOTICE as LpNotice | null | undefined;
  const [, tickNow] = useState(0);
  useEffect(() => {
    if (!n || !n.snap) return;
    const left = n.t + 10000 - Date.now();
    const h = setTimeout(() => { dispatch({ type: "setUi", patch: { LPNOTICE: { ...n, snap: null } } }); tickNow((x) => x + 1); }, Math.max(0, left));
    return () => clearTimeout(h);
  }, [n, dispatch]);
  const legacy = state.ui.WORKNOTICE as string | null | undefined;
  if (n && n.who === state.WHO)
    return (
      <div className="work-notice" role="status"><span>{n.msg}</span>
        {n.snap ? <button type="button" className="chip" onClick={() => dispatch({ type: "lpRestore", id: n.id as Lead["id"], snap: n.snap!, label: n.label })}>Undo</button> : null}
        <button type="button" className="btn" onClick={() => dispatch({ type: "setUi", patch: { LPNOTICE: null } })} aria-label="Dismiss notification"><Icon name="x" /></button></div>
    );
  if (legacy)
    return (
      <div className="work-notice" role="status"><span>{legacy}</span>
        <button type="button" className="btn" onClick={() => dispatch({ type: "setUi", patch: { WORKNOTICE: null } })} aria-label="Dismiss notification"><Icon name="x" /></button></div>
    );
  return null;
}

export const FILEKINDS: readonly string[] = ["history", "owner", "material", "money"];
/* openFile(id) — the Investor file toggles */
export function useOpenFile() {
  const { state, dispatch } = useConsole();
  return (id: string) => {
    const on = state.DRW && FILEKINDS.includes(state.DRW.k) && state.DRW.id === id;
    if (on) { dispatch({ type: "closeDrawer" }); dispatch({ type: "setUi", patch: { FILEON: false } }); return; }
    dispatch({ type: "openDrawer", k: "history", id, seed: { FILEON: true } });
  };
}

export function LeadPage({ id }: { id: string }) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const openFile = useOpenFile();

  const l0 = openable(state).find((x) => x.id === id);
  /* FILEON clears whenever the drawer is not one of the file's tabs */
  const fileDrw = !!(state.DRW && FILEKINDS.includes(state.DRW.k));
  useEffect(() => {
    if (!fileDrw && state.ui.FILEON) dispatch({ type: "setUi", patch: { FILEON: false } });
  }, [fileDrw, state.ui.FILEON, dispatch]);

  const lpl = useLp(l0 || ({ id } as Lead));
  if (!l0)
    return (
      <>
        <div className="ph"><h1>Nothing to open</h1></div>
        <div className="card"><div className="empty">
          There is no lead here. Either the one you came from has moved to somebody else&apos;s
          book, or you carry none yet — a lead opens from the book, and only while it is yours to
          read.
          <br />
          <button type="button" className="chip" style={{ marginTop: "10px" }} onClick={() => { dispatch({ type: "go", v: "leads" }); router.push("/leads"); }}>Open the leads book</button>{" "}
          {canOperateLeads(state) ? (
            <button type="button" className="chip" style={{ marginTop: "10px" }} onClick={() => dispatch({ type: "openDrawer", k: "p:add.quick" })}>Add a lead</button>
          ) : null}
        </div></div>
      </>
    );
  const l = l0;
  const FROM = uiFrom(state.ui);
  const back: NavKey | "event" = FROM === "event" && canReach(state, "events") ? "event" : canReach(state, FROM as NavKey) ? (FROM as NavKey) : "leads";
  const backT = back === "event" ? "the event" : (NAV.find((n) => n.k === back) || { t: "Leads" }).t.toLowerCase();
  const goBack = () => {
    if (back === "event") { dispatch({ type: "go", v: "events" }); router.push(`/events/${encodeURIComponent(state.EVID)}`); return; }
    dispatch({ type: "go", v: back }); router.push(`/${back}`);
  };
  const u = nextUp(state, l), due = nxDue(l, state.NOW), work = canWork(state, l), act = active(l) && !lost(l) && l.done < ST.ONBOARDED;
  const sig = ragOf(state, l), last = fuLatest(state, l), here = LADDER[l.done], und = undoStage(state, l);
  const flow = lpl.f?.flow || null;
  const open = (k: DrawerKind, seed?: Record<string, unknown>) => dispatch({ type: "openDrawer", k, id: l.id, ...(seed ? { seed } : {}) });

  const A: ReactNode[] = [];
  const al = (key: string, cls: string, msg: ReactNode, btn?: ReactNode) => A.push(<div key={key} className={`lp-alert ${cls}`}><span>{msg}</span>{btn || null}</div>);
  const r = state.REQ[l.id], cm = claimOf(state, l.id);
  if (lost(l)) al("lost", "", <><b>Closed as lost</b> — {l.lost!.why}{l.lost!.note ? ". " + l.lost!.note : ""} · {P(state.PEOPLE, l.lost!.by).n} {l.lost!.at}</>,
    canReopen(state, l) ? <button type="button" className="chip" onClick={() => dispatch({ type: "reopenLost", id: l.id })}>Re-open</button> : null);
  if (!l.own) al("own", "bad", <b>No owner yet.</b>, canAssign(state) ? <button type="button" className="act" onClick={() => open("owner")}>Assign owner</button>
    : isIR(state.ROLE) ? <button type="button" className="act" onClick={() => dispatch({ type: "assign", id: l.id, to: state.WHO })}>Assign to me</button> : null);
  if (watching(state, l)) al("watch", "", <><b>{whyLocked(state, l)}</b> You can see everything; changes are not yours to make.</>);
  const cv = covOf(state, l);
  if (cv) al("cov", "due", <><b>{P(state.PEOPLE, cv.by).n} is covering</b> for {P(state.PEOPLE, l.own).n} until {cv.to}.</>);
  if (r && r.state === "waiting") al("req", "due", <><b>{P(state.PEOPLE, r.by).n} asked to move this to {P(state.PEOPLE, r.to).n}</b> — {r.why}</>,
    canDecideMove(state, l) ? <><button type="button" className="chip on" onClick={() => dispatch({ type: "decideMove", id: l.id, ok: true })}>Approve</button><button type="button" className="chip" onClick={() => dispatch({ type: "decideMove", id: l.id, ok: false })}>Decline</button></> : null);
  if (seeMoney(state, l) && cm && cm.state === "waiting") al("cw", "due", <><b>Payment reported</b> — waiting for Finance to find it in the bank.</>, <button type="button" className="chip" onClick={() => open("claim")}>Status</button>);
  else if (seeMoney(state, l) && cm && cm.state === "notfound") al("cn", "bad", <><b>Finance could not find that payment.</b> {cm.why}</>, <button type="button" className="chip" onClick={() => dispatch({ type: "reopenClaim", id: l.id })}>Ask again</button>);
  if (inReservation(state, l)) {
    const hold = state.PAY[l.id]!.hold as string;
    const dl = Math.round(((when(hold, state.NOW)?.getTime() || 0) - state.NOW.getTime()) / DAY);
    al("hold", dl <= 3 ? "bad" : "due", <><b>Reservation {dl < 0 ? "lapsed " + -dl + " days ago" : dl + " days left"}</b> — the balance is due by {hold}.</>, <button type="button" className="chip" onClick={() => open("hold")}>Details</button>);
  }
  if (!TOUCHCHANNELS.some((k) => conFor(l, k))) al("perm", "bad", <><b>No contact permission yet.</b> Record it before reaching out.</>,
    work ? <button type="button" className="act" onClick={() => open("details", { DTAB: "permission" })}>Record permission</button> : null);

  /* the Next milestone button — tick(id), ir-merged.js 2614 */
  const tick = () => {
    if (l.done < ST.TOUCH) {
      const first = TOUCHCHANNELS.find((k) => conFor(l, k));
      dispatch({ type: "openDrawer", k: "p:followup" as DrawerKind, id: l.id, seed: state.ui.FU ? {} : { FU: buildFollowupDraft(state, l, first || "reply") } });
      return;
    }
    if (gateWait(state, l)) return;
    if (needOf(l)) { open("p:lead.rung" as DrawerKind, { RUNGSAID: false }); return; }
    if (RUNGASK[LADDER[l.done].t]) { open("p:lead.commit" as DrawerKind); return; }
    dispatch({ type: "tick", id: l.id });
  };
  const untick = () => {
    if (l.done <= 1) return;
    open("p:lead.undo" as DrawerKind, { UNDOWHY: "", UNDON: "" });
  };

  /* rows that exist only while they apply */
  const owned = !!here && stepOwner(state, l.done, l), gw = gateWait(state, l), rows: ReactNode[] = [];
  if (act && here && owned && !gw && work)
    rows.push(<div key="ms" className="lp-stage"><span className="sm">Next milestone</span><b>{here.t}</b>
      <button type="button" className="btn" onClick={tick}>{here.t === "First touch made" ? "Mark first contact made" : "Mark done"}</button>
      {here.skip ? <button type="button" className="lp-link" onClick={() => dispatch({ type: "skipStage", id: l.id })}>Not needed</button> : null}</div>);
  else if (act && here && owned && gw && gw.who === "fin")
    rows.push(<div key="ms" className="lp-stage"><span className="sm">Next milestone</span><b>{here.t}</b><span className="tag due">Waiting on Finance</span></div>);
  if (act && gw && canClaim(state, l) && !claimOf(state, l.id))
    rows.push(<div key="pay" className="lp-stage"><span className="sm">Payment</span><b>Has the investor paid?</b>
      <button type="button" className="btn" onClick={() => open("claim", { CKIND: l.done >= ST.RESERVED ? "full" : "advance", CREF: "", CNOTE: "" })}>Investor says they paid</button></div>);
  rows.push(<LpPaperRow key="paper" l={l} />);
  if (act && l.done >= ST.QUALIFIED && canPlan(state, l)) {
    const fc = fcOf(l);
    rows.push(<div key="fc" className="lp-stage"><span className="sm">Forecast</span><b>{fc ? FCAT[fc as keyof typeof FCAT].t : "Not set"}</b>
      <button type="button" className="lp-link" onClick={() => open("forecast")}>{fc ? "Change" : "Set forecast"}</button></div>);
  }

  const pref = (l as Lead & { contactPreference?: unknown }).contactPreference;
  const hasPref = typeof pref === "string" ? !!pref.trim() : !!(pref && typeof pref === "object");
  const showOwner = !!l.own && (l.own !== state.WHO || !!cv);
  const num = waNum(l.ph);
  const note0 = (state.NOTES[l.id] || [])[0];
  const buttons = work && act && !flow ? (
    <div className="lp-actions">
      {num && conFor(l, "call") ? <a className="btn" href={`tel:+${num}`} onClick={() => lpl.open("log", "call")}><Icon name="call" />Call</a> : null}
      {num && conFor(l, "msg") ? <a className="btn" href={`https://wa.me/${num}`} target="_blank" rel="noopener" onClick={() => lpl.open("log", "msg")}><Icon name="wa" />WhatsApp</a> : null}
      {l.em && conFor(l, "email") ? <button type="button" className="btn" onClick={() => lpl.open("email")}>Email</button> : null}
      <button type="button" className="act" onClick={() => lpl.open("log")}>Log a contact</button>
    </div>
  ) : null;
  const card = (
    <section className="card lp-next" aria-label="Next step"><div className="cb">
      <div className="lp-nexthead"><div><span className="work-eyebrow">Next step</span><h2>{act && hasNext(l) ? l.nx!.t : u.t}</h2></div>
        {act && hasNext(l) ? <span className={`tag ${due === "overdue" ? "late" : due === "today" ? "due" : "go"}`}>{due === "overdue" ? "Overdue · " : ""}{nxWhen(l)}</span> : null}</div>
      {last ? <p className="lp-meta">Last contact: {FUCHANNELS[last.channel] || last.channel} · {last.outcome || ""} · {last.at || ""}</p> : null}
      {hasPref ? <p className="lp-meta">Prefers: {fuPreference(l)}</p> : null}
      {note0 ? <p className="lp-meta lp-lastnote">Latest note: “{note0.t.length > 140 ? note0.t.slice(0, 140) + "…" : note0.t}” — {P(state.PEOPLE, note0.who).n.split(" ")[0]} · {note0.at} · <button type="button" className="lp-link" onClick={() => openFile(l.id)}>All notes</button></p> : null}
      {showOwner ? <p className="lp-meta">Owner: {P(state.PEOPLE, l.own).n}{l.sec ? " · backup " + P(state.PEOPLE, l.sec).n : ""}</p> : null}
      {buttons}
      {work && act && flow === "log" && canPlan(state, l) ? <LpLogger l={l} /> : null}
      {work && act && flow === "email" ? <LpComposer l={l} /> : null}
    </div></section>
  );
  const sub = [l.city, ph(state, l), l.unitsKnown === false ? "" : money(l.units * UNIT) + " · " + l.units + " unit" + (l.units === 1 ? "" : "s"), l.nri ? "NRI" : ""].filter(Boolean).join(" · ");
  const fileOpen = !!(state.DRW && state.ui.FILEON && state.DRW.id === l.id && fileDrw);
  const steps = !!((state.ui.LPSTEPS as Record<string, boolean> | undefined) || {})[l.id];
  const ndOn = state.ui.NDRAFTID === l.id ? String(state.ui.NDRAFT ?? "") : "";
  /* commit()'s two sentences for a write that did not land (ir-merged.js 2373, 2413) */
  const addNote = () => {
    const r = dispatch({ type: "addNote", id: l.id });
    const label = "Added a note";
    if (r && r.status === "failed") say(label + " was not recorded. The local demo did not confirm this change. Nothing on the record changed.");
    else if (r && r.status === "pending") say(label + " is waiting for a connection. Nothing on the record changed. It will fail after five minutes if it cannot save.");
  };
  return (
    <div className="lp lp2">
      <div className="ph lp-head">
        <button type="button" className="btn" onClick={goBack} aria-label={`Back to ${backT}`} title={`Back to ${backT}`}><Icon name="back" /></button>
        <div className="lp-title"><h1>{l.n}</h1><span className="ux-secondary">{flow ? ph(state, l) : sub}</span></div>
        {sig.c !== "green" && !flow ? <span className={`tag ${sig.c === "red" ? "late" : "due"}`}><span className={`rag ${sig.c}`} />{sig.t}</span> : null}
        <div className="sp" /><button type="button" className={`btn ${fileOpen ? "on" : ""}`} aria-expanded={fileOpen} onClick={() => openFile(l.id)}>Investor file</button>
      </div>
      {flow ? null : (
        <div className="lp-journey">
          <button type="button" className="lp-link lp-jl" aria-expanded={steps} onClick={() => dispatch({ type: "setUi", patch: { LPSTEPS: { ...((state.ui.LPSTEPS as Record<string, boolean>) || {}), [l.id]: !steps } } })}>
            {LADDER[Math.max(0, l.done - 1)].t} · step {Math.max(1, l.done)} of {LADDER.length}</button>
          {l.done > 1 && und.ok ? <button type="button" className="lp-link lp-undo" title={und.why || ""} onClick={untick}>Undo</button> : null}
        </div>
      )}
      {steps && !flow ? <LpStepper l={l} /> : null}
      {A}
      <LpNoticeBar />
      {card}
      {flow ? null : rows}
      {canNote(state, l) && !flow ? (
        <div className="lp-notebar">
          <textarea rows={1} placeholder="Add a note…" aria-label="Add a note" value={ndOn}
            onChange={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; dispatch({ type: "setUi", patch: { NDRAFT: e.target.value, NDRAFTID: l.id } }); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } }} />
          <button type="button" className="btn" id="lp-note-save" hidden={!ndOn.trim()} onClick={addNote}>Add note</button>
        </div>
      ) : null}
      <Live />
    </div>
  );
}
