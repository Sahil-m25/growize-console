/* ── the lead page's own writes — lpFinish, lpLose, lpRestore, lpPaper, emSend, undoRung,
   recordRung, tickCommit. ir-merged.js 5113–5310 (lpFinish/lpLose/lpRestore/lpPaper), 10474
   (emSend), 2913 (undoRung), 2690 (recordRung/tickCommit).

   Each is ONE press that stands for several facts (a contact and the next step; a contact and a
   loss; a reminder and the contact it is), so each is one action here and one save in the queue —
   and the page's 10-second Undo (`lpRestore`) puts every one of those facts back at once. The
   writers underneath are the existing ones (`saveFollowup`, `closeLost`, `tick`, `untick`, `mat`,
   the paperwork beats), reached through `root` so no rule is written twice.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { LADDER, LOSTWHY, TOUCHCHANNELS } from "@/domain";
import type { InteractionRec, LeadId, LogEntry } from "@/domain";
import { dISOtoDisp, hhmm, iso, nowT, plusD, stamp } from "@/lib/format";
import { canLose, canPlan, canWork, channelForAction, conFor, lost, ndaOK, openable, tList } from "@/lib/selectors";
import type { Action, ConsoleState } from "@/lib/store";
import { pagesAReducer } from "@/features/leads/reducer";
import { FUCHANNELS, FUOUTCOMES } from "@/features/today/work";
import { EMMAT, emTplOK, lpPaperName, LPPCH, needOf, UNDOWHY, ZLABEL, zKind, type LpDraft } from "./lp";

/* what a follow-up write touches on this lead, so Undo can put it back exactly — lpSnap(id) */
export type LpSnap = {
  l: unknown; i: unknown; c: unknown; n: unknown; p: unknown; s: unknown; k: unknown; logN: number;
};
export type LpNotice = { who: string; id: string; msg: string; snap: LpSnap | null; label: string; t: number };

export type LeadPageAction =
  | { type: "lpFinish"; id: LeadId; d: LpDraft }
  | { type: "lpLose"; id: LeadId; d: LpDraft; why: string }
  | { type: "lpRestore"; id: LeadId; snap: LpSnap; label: string }
  | { type: "lpPaper"; id: LeadId; beat: string; rk: string; a?: string; link?: string }
  | { type: "emSend"; id: LeadId; tpl: string; s: string; b: string }
  | { type: "undoRung"; id: LeadId; why: string; note: string }
  | { type: "recordRung"; id: LeadId }
  | { type: "tickCommit"; id: LeadId };

export const LEADPAGE_WRITES = ["lpFinish", "lpLose", "lpRestore", "lpPaper", "emSend", "undoRung", "recordRung", "tickCommit"] as const;

type Root = (s: ConsoleState, a: Action) => ConsoleState;
const cp = <T,>(v: T): unknown => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

export function lpSnap(state: ConsoleState, id: LeadId): LpSnap {
  return {
    l: cp(state.LEADS.find((x) => x.id === id)), i: cp(state.INTERACTIONS[id]), c: cp(state.CALLS[id]),
    n: cp(state.NOTES[id]), p: cp(state.PAPER[id]), s: cp(state.SENT[id]), k: cp(state.PACK[id]),
    logN: state.LOG.filter((e) => e.lead === id).length,
  };
}

const put = <M extends Record<string, unknown>>(M: M, id: string, v: unknown): M => {
  const n = { ...M } as Record<string, unknown>;
  if (v === null || v === undefined) delete n[id]; else n[id] = v;
  return n as M;
};

const notice = (s: ConsoleState, id: LeadId, msg: string, snap: LpSnap | null, label: string): ConsoleState => ({
  ...s, ui: { ...s.ui, LPNOTICE: { who: s.WHO, id, msg, snap, label, t: Date.now() } as LpNotice },
});
const closeFlow = (s: ConsoleState): ConsoleState => ({ ...s, ui: { ...s.ui, LP: null, FU: null } });

/* amend the newest log line on this lead — the build says, on the line itself, what it wrote */
function amendTop(s: ConsoleState, id: LeadId, f: (e: LogEntry) => LogEntry): ConsoleState {
  const i = s.LOG.findIndex((e) => e.lead === id);
  if (i < 0) return s;
  const LOG = s.LOG.slice(); LOG[i] = f(LOG[i]);
  return { ...s, LOG };
}

function pushLog(s: ConsoleState, what: string, id: LeadId, note: string, kind: LogEntry["kind"]): ConsoleState {
  return { ...s, LOG: [{ d: iso(s.TODAY), at: stamp(nowT(s.NOW)), who: s.WHO, what, lead: id, note, kind, temp: null } as LogEntry, ...s.LOG] };
}

export function leadPageReducer(state: ConsoleState, a: LeadPageAction, root: Root): ConsoleState {
  const l = state.LEADS.find((x) => x.id === a.id);
  if (!l || !openable(state).some((x) => x.id === a.id)) return state;
  switch (a.type) {
    /* lpFinish(id) — the last tap finishes: a date saves the contact and the next step */
    case "lpFinish": {
      if (!canWork(state, l) || !canPlan(state, l)) return state;
      const d = { ...a.d };
      if (!d.keep && !d.nd) d.nd = iso(nowT(state.NOW));
      const snap = lpSnap(state, a.id);
      const s1 = root({ ...state, ui: { ...state.ui, FU: d } }, { type: "saveFollowup", id: a.id });
      if (s1.LEADS === state.LEADS && s1.INTERACTIONS === state.INTERACTIONS) return state;
      let s2 = s1;
      const nl = s2.LEADS.find((x) => x.id === a.id)!;
      let msg = "appointment kept";
      if (nl.nx && !d.keep) {
        const k = zKind(nl.nx.t);
        s2 = { ...s2, LEADS: s2.LEADS.map((x) => (x.id === a.id ? { ...x, nx: { ...x.nx!, zk: k } } : x)) };
        s2 = amendTop(s2, a.id, (e) => ({ ...e, note: (e.note ? e.note + " · " : "") + "Zoho: " + ZLABEL[k]
          + (k === "call" && nl.nx!.tm ? ", reminder 15 min before" : "") + (k === "meeting" ? ", synced to Zoho Calendar" : "") }));
        msg = (ZLABEL[k] || "Next step") + ": " + nl.nx.t + " · " + nl.nx.by + (nl.nx.tm ? " " + nl.nx.tm : "");
      }
      return notice(closeFlow({ ...s2, ui: { ...s2.ui, NXASK: null } }), a.id, "Saved · " + msg, snap, "Undid a follow-up");
    }

    /* lpLose(id,why) — a loss is one question and one write of both facts */
    case "lpLose": {
      const d = a.d;
      if (!canLose(state, l) || !(LOSTWHY as readonly string[]).includes(a.why)) return state;
      if (!(FUOUTCOMES[d.channel] || []).includes(d.outcome)) return state;
      const snap = lpSnap(state, a.id);
      const at = dISOtoDisp(d.d, state.NOW) + " " + d.tm, ch = d.channel;
      const ev = { id: "FU-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), channel: ch, outcome: d.outcome,
        obj: [], at, who: state.WHO, next: null, completedTask: null } as unknown as InteractionRec;
      let l2 = { ...l };
      if (ch === "reply") l2.reply = at;
      if (ch !== "reply" && (TOUCHCHANNELS as readonly string[]).includes(ch) && (ch !== "call" || d.outcome !== "Wrong number")) {
        const k = ch as (typeof TOUCHCHANNELS)[number];
        l2 = { ...l2, touch: { ...l2.touch, [k]: [...tList(l, k), at] } };
      }
      let s1: ConsoleState = {
        ...state,
        LEADS: state.LEADS.map((x) => (x.id === a.id ? l2 : x)),
        INTERACTIONS: { ...state.INTERACTIONS, [a.id]: [...(state.INTERACTIONS[a.id] || []), ev] },
        CALLS: ch === "call" ? { ...state.CALLS, [a.id]: { o: d.outcome, obj: [], at, who: state.WHO } as unknown as ConsoleState["CALLS"][string] } : state.CALLS,
      };
      s1 = pushLog(s1, ch === "call" ? "Call connected" : FUCHANNELS[ch] + " contact recorded", a.id, d.outcome,
        ((TOUCHCHANNELS as readonly string[]).includes(ch) ? ch : "stage") as LogEntry["kind"]);
      const s2 = root(s1, { type: "closeLost", id: a.id, why: a.why, note: "" });
      if (!lost(s2.LEADS.find((x) => x.id === a.id)!)) return state;
      return notice(closeFlow(s2), a.id, "Closed as lost — " + a.why, snap, "Undid closing as lost");
    }

    /* lpRestore(id,snap,label) — the 10-second Undo */
    case "lpRestore": {
      const s = a.snap;
      if (!s || !s.l) return state;
      let extra = state.LOG.filter((e) => e.lead === a.id).length - s.logN;
      const LOG = state.LOG.filter((e) => { if (extra > 0 && e.lead === a.id) { extra--; return false; } return true; });
      let next: ConsoleState = {
        ...state,
        LEADS: state.LEADS.map((x) => (x.id === a.id ? (s.l as typeof x) : x)),
        INTERACTIONS: put(state.INTERACTIONS, a.id, s.i), CALLS: put(state.CALLS, a.id, s.c), NOTES: put(state.NOTES, a.id, s.n),
        PAPER: put(state.PAPER, a.id, s.p), SENT: put(state.SENT, a.id, s.s), PACK: put(state.PACK as Record<string, unknown>, a.id, s.k) as ConsoleState["PACK"],
        LOG,
      };
      next = pushLog(next, a.label, a.id, "within the undo window", "stage");
      return { ...next, ui: { ...next.ui, LPNOTICE: null } };
    }

    /* lpPaper(id,beat,rk,a) — one tap, one write of every fact it stands for (PRLP) */
    case "lpPaper": {
      if (!canWork(state, l)) return state;
      const rk = a.rk, ch = a.a || "";
      if ((a.beat === "told" || a.beat === "chase") && (!LPPCH[ch] || !conFor(l, ch as (typeof TOUCHCHANNELS)[number]))) return state;
      const nm = lpPaperName(rk), snap = lpSnap(state, a.id), before = JSON.stringify(state.PAPER[a.id] || null), link = (a.link || "").trim();
      const v = (((state.PAPER[a.id] || {}) as Record<string, { draft?: { v?: number } }>)[rk]?.draft?.v) || 1;
      const MSG: Record<string, string> = {
        told: nm + " — told them by " + LPPCH[ch], chase: nm + " reminder by " + LPPCH[ch] + " · on the contact history too",
        said: "They say the " + nm + " is signed — Finance checks it in the IM portal", draft: "Supplementary draft sent",
        agreed: "Final draft agreed — Finance sends it for signature", redraft: "Draft " + (v + 1) + " sent",
      };
      if (!MSG[a.beat]) return state;
      const pa = (x: Action) => pagesAReducer(state, x) ?? state;
      let s1: ConsoleState =
        a.beat === "told" ? pa({ type: "prTold", id: a.id, rk, ch })
        : a.beat === "said" ? pa({ type: "prSaid", id: a.id, rk })
        : a.beat === "draft" ? pa({ type: "prDraft", id: a.id, link })
        : a.beat === "agreed" ? pa({ type: "prAgreed", id: a.id, link })
        : a.beat === "redraft" ? pa({ type: "prRedraft", id: a.id, link })
        : pa({ type: "prChase", id: a.id, rk, ch, phase: "sign" });
      if (JSON.stringify(s1.PAPER[a.id] || null) === before) return state;
      if (a.beat === "chase") {
        /* the reminder IS a contact: the same touch the contact log writes, in the same press —
           prChase's own history line is the one line, so nothing is logged twice */
        const nw = nowT(state.NOW), at = dISOtoDisp(iso(nw), state.NOW) + " " + hhmm(nw);
        const outcome = ({ call: "Connected", msg: "Message sent", email: "Email sent" } as Record<string, string>)[ch];
        const ev = { id: "FU-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), channel: ch, outcome, obj: [],
          note: nm + " reminder", at, who: state.WHO, next: null, completedTask: null } as unknown as InteractionRec;
        const k = ch as (typeof TOUCHCHANNELS)[number];
        s1 = {
          ...s1,
          INTERACTIONS: { ...s1.INTERACTIONS, [a.id]: [...(s1.INTERACTIONS[a.id] || []), ev] },
          LEADS: s1.LEADS.map((x) => (x.id === a.id ? { ...x, touch: { ...x.touch, [k]: [...tList(x, k), at] } } : x)),
          CALLS: ch === "call" ? { ...s1.CALLS, [a.id]: { o: "Connected", obj: [], at, who: state.WHO } as unknown as ConsoleState["CALLS"][string] } : s1.CALLS,
        };
      }
      s1 = { ...s1, ui: { ...s1.ui, PREDRAFT: null, PLINK: "" } };
      return notice(s1, a.id, "Saved · " + MSG[a.beat], snap, a.beat === "chase" ? "Undid a reminder" : "Undid a paperwork step");
    }

    /* emSend(id) — the Send press IS the approval; nothing leaves until it is pressed */
    case "emSend": {
      const setErr = (err: string): ConsoleState => {
        const EM = { ...((state.ui.EM as Record<string, unknown>) || {}) };
        EM[a.id] = { ...((EM[a.id] as object) || {}), tpl: a.tpl, s: a.s, b: a.b, err };
        return { ...state, ui: { ...state.ui, EM } };
      };
      if (!canWork(state, l) || !canPlan(state, l)) return state;
      if (!l.em || !conFor(l, "email")) return setErr("This investor has not given email permission, or has no email address.");
      if (!a.s.trim() || !a.b.trim()) return setErr("Add a subject and a message.");
      const nda = ndaOK(state, l);
      if (!emTplOK(a.tpl, nda)) return setErr("Deck goes after the NDA is signed.");
      const M = EMMAT[a.tpl];
      const n = nowT(state.NOW);
      const task = l.nx || null;
      const f: LpDraft = {
        channel: "email", outcome: "Email sent", obj: [], note: "Email: " + a.s.trim(), d: iso(n), tm: hhmm(n),
        keep: false, complete: !!task, t: "Nurture — check back", nd: iso(plusD(n, 3)), ntm: "10:00", nch: "other", noNext: false,
      };
      if (task && channelForAction(task.t) !== "email" && String(task.ch || "") !== "email") { f.keep = true; f.complete = false; }
      let s1 = root({ ...state, ui: { ...state.ui, FU: f } }, { type: "saveFollowup", id: a.id });
      if (s1.INTERACTIONS === state.INTERACTIONS) return setErr("Not sent.");
      const me = state.PEOPLE[state.WHO];
      s1 = amendTop(s1, a.id, (e) => e.kind === "email"
        ? { ...e, what: "Email approved and sent", note: "From " + ((me as { em?: string })?.em || "") + " via Zoho · “" + a.s.trim() + "” · " + e.note } : e);
      if (M && !(s1.SENT[a.id] || {})[M.item as keyof ConsoleState["SENT"][string]] && nda && l.consent) s1 = root(s1, { type: "mat", id: a.id, d: M.item });
      const marked = !!M && !!(s1.SENT[a.id] || {})[M.item as keyof ConsoleState["SENT"][string]];
      const EM = { ...((s1.ui.EM as Record<string, unknown>) || {}) }; delete EM[a.id];
      s1 = { ...closeFlow(s1), ui: { ...closeFlow(s1).ui, EM } };
      return notice(s1, a.id, "Email sent" + (M ? " with " + M.say + " attached" + (marked ? " · " + M.item + " marked sent" : "") : ""), null, "");
    }

    /* undoRung(id) — the un-tick, with the reason the confirm promised and never collected */
    case "undoRung": {
      if (!(UNDOWHY as readonly string[]).includes(a.why)) return state;
      const t = LADDER[l.done - 1]?.t || "";
      const s1 = root(state, { type: "untick", id: a.id });
      if (s1 === state || s1.LEADS === state.LEADS) return state;
      const note = a.note.trim();
      return { ...amendTop(s1, a.id, (e) => ({ ...e, note: t + " · " + a.why + (note ? " — " + note : "") })), DRW: null };
    }

    /* recordRung(id) — the drawer's button; the half the console holds, and the half it does not */
    case "recordRung": {
      const n = needOf(l);
      if (!n || !l.nx) return state;
      const s1 = root(state, { type: "tick", id: a.id });
      if (s1.LEADS === state.LEADS) return state;
      return { ...amendTop(s1, a.id, (e) => ({ ...e, note: e.note + " · " + n.note })), DRW: null };
    }

    case "tickCommit": {
      const s1 = root(state, { type: "tick", id: a.id });
      if (s1.LEADS === state.LEADS) return state;
      return { ...s1, DRW: null };
    }
  }
  return state;
}
