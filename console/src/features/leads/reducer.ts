/* ── pagesAReducer — every write My day, Leads and the lead page make ───────────────────────
   Ports `ref/03-app.js` 150–162 (logTouch), 523–534 (closeLost / reopenLost), 573–592
   (clearNext / askReschedule / keepNext / pullIn), 624–640 (setFc / setFcBy / setFcEv),
   754–767 (setCall / toggleObj), 781–786 (addNote), 877–882 (endCoverFor), 1245–1268
   (skipStage / tick), 1281–1310 (askMove / decideMove), 1348–1381 (handover / endCover),
   1389–1430 (setSecondary / assign / setAsTo / reassignTo), 1432–1446 (untick),
   1448–1474 (mat / pack), 1720–1801 (the paperwork beats), 2160–2231 (the next-step and touch
   drafts and their writers), 2757 (toLeads).

   The prototype mutates the object graph in place — `l.touch[k].push(...)`, `SENT[id][d]=stamp()`,
   `REQ[id].state="approved"` — and calls draw(). Here every case copies: a mutated object is a
   render that never happens. The DECISION half of each of these already lives in
   `@/lib/selectors` (`tickStage`, `undoStage`, `canWork`, `conFor`, …); this file asks it and then
   writes, so the button and the handler can never disagree about what is allowed.

   `alert()` does not survive the port. Where the prototype popped one, the refusal is computed by
   the same selector the reducer asks and rendered inline by the screen (see the note in
   `src/features/lead/LeadPage.tsx`); this reducer simply declines to write.

   Returns `null` for anything it does not own, so the root reducer can compose it.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import {
  CALLOUT,
  DCLS_EXTRA,
  DTPLS,
  DUR,
  LADDER,
  LOSTWHY,
  OBJS,
  REASONS,
  ST,
  TOUCHCHANNELS,
  TOUCHDONE,
} from "@/domain";
import type {
  ActKind,
  CallOutcome,
  Channel,
  Cover,
  DocClass,
  FcCat,
  Forecast,
  Lead,
  LeadId,
  LogEntry,
  Lost,
  LostWhy,
  Objection,
  PersonKey,
  Reason,
  Sendable,
  SlaChannel,
  SortKey,
  Stamp,
  TempGrant,
} from "@/domain";
import {
  dAdd,
  dISOtoDisp,
  DAY,
  hhmm,
  iso,
  monday,
  nowT,
  plusD,
  plusDays,
  pinAccessDate,
  stamp,
  whenFwd,
  whenT,
} from "@/lib/format";
import {
  absFrom,
  assignees,
  canAssign,
  canDecideMove,
  canEdit,
  canLose,
  canNote,
  canPlan,
  canReach,
  canReopen,
  canWork,
  channelForAction,
  conFor,
  covOf,
  custodian,
  fresh,
  hasNext,
  isIR,
  nxDate,
  nxDue,
  outFor,
  outTo,
  openable,
  P,
  pr,
  prChases,
  prDone,
  prMine,
  prNext,
  prOpen,
  prRow,
  RND,
  seesTeam,
  secondaryMayWork,
  secOK,
  SORTS,
  stepOwner,
  tempOn,
  tickStage,
  tList,
  undoStage,
  CLEARED_LEAD_FILTERS,
} from "@/lib/selectors";
import type { Action, ConsoleState } from "@/lib/store";

/* ---- the small immutable primitives --------------------------------------------------------- */

const leadOf = (state: ConsoleState, id: LeadId): Lead | null =>
  state.LEADS.find((x) => x.id === id) ?? null;

/* put one changed lead back in the book, in place */
const setLead = (state: ConsoleState, l: Lead): Lead[] =>
  state.LEADS.map((x) => (x.id === l.id ? l : x));

/* log(what, lead, note, kind) — 03-app.js:1227. Everything written while a grant is switched on
   carries the grant, and the grant's own count goes up: the question after the fact is never
   "what did they do on Documents", it is "what did they do while they had it". */
type Written = { LOG: LogEntry[]; TEMP: TempGrant[] };
function log(
  state: ConsoleState,
  at: Stamp,
  what: string,
  lead: LeadId | null,
  note: string,
  kind: ActKind = "admin",
): Written {
  const g = tempOn(state);
  return {
    LOG: [
      {
        d: iso(state.TODAY),
        at,
        who: state.WHO,
        what,
        lead,
        note: note || "",
        kind,
        temp: g ? g.id : null,
      },
      ...state.LOG,
    ],
    TEMP: g ? state.TEMP.map((x) => (x.id === g.id ? { ...x, acts: (x.acts || 0) + 1 } : x)) : state.TEMP,
  };
}

/* askReschedule(l) — 03-app.js:581. Something was recorded on a lead whose next step is dated
   later; rather than let the date drift quietly out of date, ask once, while the person is still
   on the record. */
const ask = (state: ConsoleState, l: Lead | null): string | null =>
  l && hasNext(l) && nxDue(l, state.NOW) === "ahead" ? l.id : null;

const withUi = (state: ConsoleState, patch: Record<string, unknown>): ConsoleState => ({
  ...state,
  ui: { ...state.ui, ...patch },
});

/* seedNext(id) / seedTouch(id) — 03-app.js:2163, 2206. `ch` — the next step's own channel — is
   part of the seed too: an existing dated step keeps its own channel when it is a real one,
   otherwise falls back to whatever `channelForAction` reads off its wording; a fresh step picks
   the lead's first permitted channel in the prototype's own literal order (call before msg before
   email before visit — NOT `TOUCHCHANNELS`'s msg/email/call/visit order, which would default a
   lead permitted for more than one channel to the wrong one), or "other" ("Internal task") when
   none are open. Leaving `ch` unset — the pre-port bug — left every fresh draft reading back as
   "other" regardless of what the lead can actually be reached on. */
const NEXT_FALLBACK_ORDER: readonly Channel[] = ["call", "msg", "email", "visit"];
function seedNext(state: ConsoleState, l: Lead | null) {
  const now = nowT(state.NOW);
  return l && hasNext(l)
    ? {
        t: l.nx!.t,
        d: l.nx!.d || (nxDate(l, state.NOW) ? iso(nxDate(l, state.NOW) as Date) : iso(now)),
        tm: l.nx!.tm || "",
        ch: l.nx!.ch && ([...TOUCHCHANNELS, "other"] as readonly string[]).includes(l.nx!.ch)
          ? l.nx!.ch
          : channelForAction(l.nx!.t),
      }
    : { t: "", d: iso(plusD(now, 1)), tm: "10:00", ch: NEXT_FALLBACK_ORDER.find((k) => conFor(l, k)) || "other" };
}

/* NEXTDRAFTS — the prototype's own NEXTDRAFTS[me()+"|"+id] (03-app.js:2164/2165). A next-step
   draft survives closing the drawer and reopening it for the same lead; only `saveNext` clears it.
   Keyed by actor too, exactly like followupDrawer.tsx's FUDRAFTS and for the same reason: an
   account switch inside one running session must never hand the next signed-in person a draft the
   previous one typed but never saved. */
const NEXTDRAFTS = new Map<string, ReturnType<typeof uiNXDLocal>>();
const nextDraftKey = (state: ConsoleState, id: string): string => state.WHO + "|" + id;
function seedTouch(state: ConsoleState) {
  const n = nowT(state.NOW);
  return { k: "msg", d: iso(n), tm: hhmm(n) };
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

/* moveNextTo(id,days) — 03-app.js:2196. Pulling a dated step forward keeps its hour: the investor
   agreed to a time, not to a date. `moveNext` is the prototype's one-line alias for it. */
function moveNextTo(state: ConsoleState, id: LeadId, days: number): ConsoleState | null {
  const l = leadOf(state, id);
  if (!l || !canPlan(state, l) || !hasNext(l)) return state;
  const at = stamp(nowT(state.NOW));
  const was = l.nx!.by + (l.nx!.tm ? " " + l.nx!.tm : "");
  const d = plusD(nowT(state.NOW), days);
  const nx = { ...l.nx!, d: iso(d), by: dISOtoDisp(iso(d), state.NOW), who: state.WHO, at };
  const nl: Lead = { ...l, nx };
  return {
    ...state,
    LEADS: setLead(state, nl),
    ...log(
      state,
      at,
      "Moved the next step",
      id,
      nx.t + ": " + was + " → " + nx.by + (nx.tm ? " " + nx.tm : ""),
      "stage",
    ),
    ui: { ...state.ui, NXASK: null },
  };
}

/* dClsOf(t) — 03-app.js:1914, inlined: the paperwork rounds write a Documents row and the two
   screens read the same one. */
const dClsOf = (t: string): DocClass | null =>
  DTPLS.find((x) => x.t === t)?.cls ?? DCLS_EXTRA[t] ?? null;

/* ============================================================================================== */

export function pagesAReducer(state: ConsoleState, action: Action): ConsoleState | null {
  if ("id" in action && action.id && !openable(state).some(l => l.id === action.id)) return state;
  const a = action;
  switch (a.type) {
    /* ===== TOUCHES ==========================================================================
       The console cannot send a WhatsApp — the IR does, on their phone. So the control records
       that it happened. Recording the first one also ticks the rung, because "First touch made"
       is exactly what it means. 03-app.js:150 */
    case "logTouch": {
      const l = leadOf(state, a.id);
      const k = a.k as Channel;
      if (!l || !TOUCHDONE[k] || !canWork(state, l)) return state;
      if (!conFor(l, k)) return state; /* the refusal is conWhy(), shown by the screen */
      const at = stamp(nowT(state.NOW));
      const arr = [...tList(l, k), at];
      const nl: Lead = {
        ...l,
        touch: { ...l.touch, [k]: arr },
        ...(l.done < ST.TOUCH ? { at: [...l.at, at], done: ST.TOUCH, late: 0 } : {}),
      };
      const n = arr.length;
      const wk = iso(monday(state.NOW));
      const nWk =
        state.LOG.filter(
          (e) => e.lead === a.id && ["msg", "call", "email"].includes(e.kind) && e.d >= wk,
        ).length + 1;
      const w = log(state, at, TOUCHDONE[k], a.id, n > 1 ? "attempt " + n : "", k);
      w.LOG[0] = { ...w.LOG[0], touch: nWk };
      return { ...state, LEADS: setLead(state, nl), ...w, ui: { ...state.ui, NXASK: ask(state, nl) } };
    }

    /* ===== THE LADDER =======================================================================
       tick() asks askReschedule FIRST and then the three refusals, in the prototype's own order:
       whose rung it is, consent, and the gate. 03-app.js:1253 */
    case "tick": {
      const l = leadOf(state, a.id);
      if (!l || l.done >= LADDER.length) return state;
      const NXASK = ask(state, l);
      if (!tickStage(state, l).ok) return withUi(state, { NXASK });
      const at = stamp(nowT(state.NOW));
      const nl: Lead = { ...l, at: [...l.at, at], done: l.done + 1, late: 0 };
      return {
        ...state,
        LEADS: setLead(state, nl),
        ...log(state, at, "Marked done", a.id, LADDER[nl.done - 1].t, "stage"),
        ui: { ...state.ui, NXASK },
      };
    }

    /* untick(id) — 03-app.js:1432. The confirm() is the screen's; the two refusals below are the
       prototype's own and are shown inline rather than in an alert. `undoStage` is declared as its
       own action name too, and is the same write. */
    case "untick":
    case "undoStage": {
      const l = leadOf(state, a.id);
      if (!l || l.done <= 1) return state;
      if (!undoStage(state, l).ok) return state;
      /* money on the record outranks a stage correction */
      if (state.PAY[a.id] && l.done <= ST.PAID) return state;
      const at = stamp(nowT(state.NOW));
      const t = LADDER[l.done - 1].t;
      const nl: Lead = {
        ...l,
        at: l.at.slice(0, -1),
        done: l.done - 1,
        undoAt: at,
        undoWhat: t /* the window closes behind it */,
      };
      return {
        ...state,
        LEADS: setLead(state, nl),
        ...log(state, at, "Un-ticked", a.id, t, "stage"),
      };
    }

    /* skipStage(id) — 03-app.js:1245. Engagement is the one rung that is not a mandatory gate. */
    case "skipStage": {
      const l = leadOf(state, a.id);
      if (!l || l.done !== ST.ENGAGED - 1 || !canEdit(state, l) || !stepOwner(state, l.done, l))
        return state;
      const at = stamp(nowT(state.NOW));
      const nl: Lead = { ...l, at: [...l.at, at], done: l.done + 1, skipped: true };
      return {
        ...state,
        LEADS: setLead(state, nl),
        ...log(
          state,
          at,
          "Skipped the engagement stage",
          a.id,
          "went straight to conversion — not a mandatory gate",
          "stage",
        ),
      };
    }

    /* ===== OWNERSHIP ========================================================================
       Three verbs, and they are three different things: `assign` gives an unowned lead an owner,
       `reassignTo` changes the owner of record with a reason, `handover` lends it for a while.
       03-app.js:1389 */
    case "assign": {
      const to = a.to;
      if (!to) return state;
      if (!canAssign(state) && !(isIR(state.ROLE) && to === state.WHO)) return state;
      const l = leadOf(state, a.id);
      if (!l) return state;
      if (!assignees(state).includes(to)) return state; /* only somebody who carries a book */
      if (custodian(l) === "Closed") return state;
      if (l.own) return state; /* changing an owner it already has is a reassignment */
      const at = stamp(nowT(state.NOW));
      return {
        ...state,
        LEADS: setLead(state, { ...l, own: to }),
        ...log(state, at, "Assigned owner", a.id, P(state.PEOPLE, to).n),
      };
    }

    /* setSecondary(id,to) — 03-app.js:1389 */
    case "setSecondary": {
      const l = leadOf(state, a.id);
      const to = a.to;
      if (!l || !to || !canAssign(state) || custodian(l) === "Closed") return state;
      if (!assignees(state).includes(to) || to === l.own) return state;
      const at = stamp(nowT(state.NOW));
      return {
        ...state,
        LEADS: setLead(state, { ...l, sec: to }),
        ...log(state, at, "Set secondary owner", a.id, P(state.PEOPLE, to).n, "admin"),
      };
    }

    /* reassignTo(id,to,why) — 03-app.js:1417. An IR asks; a manager moves. */
    case "reassignTo": {
      const l = leadOf(state, a.id);
      const to = a.to;
      if (!l || !to) return state;
      if (!canAssign(state)) return state;
      if (custodian(l) === "Closed") return state;
      if (!assignees(state).includes(to) || to === l.own) return state;
      if (!(REASONS as readonly string[]).includes(a.why)) return state;
      const at = stamp(nowT(state.NOW));
      const was = l.own;
      const nl: Lead = {
        ...l,
        sec: l.sec === to ? was || null : l.sec /* never the same person twice on one lead */,
        own: to,
        ...(l.cov ? { cov: null } : {}) /* a new owner ends any cover in flight */,
      };
      const r = state.REQ[a.id];
      const REQ =
        r && r.state === "waiting"
          ? { ...state.REQ, [a.id]: { ...r, state: "approved" as const, did: state.WHO, on: at } }
          : state.REQ;
      return {
        ...state,
        LEADS: setLead(state, nl),
        REQ,
        ...log(
          state,
          at,
          was ? "Changed the owner" : "Assigned owner",
          a.id,
          (was ? P(state.PEOPLE, was).n + " → " : "") + P(state.PEOPLE, to).n + " · " + a.why,
          "admin",
        ),
        ui: { ...state.ui, ASTO: null },
      };
    }

    /* askMove(id,to,why) — 03-app.js:1281. An IR cannot move a lead off their own book. They can
       ask, with a reason and a name, and their manager or anyone above decides. */
    case "askMove": {
      const l = leadOf(state, a.id);
      if (!l || !canAskMoveLocal(state, l) || !assignees(state).includes(a.to) || a.to === l.own)
        return state;
      if (!(REASONS as readonly string[]).includes(a.why))
        return withUi(state, { MVOPEN: a.id, MVTO: a.to });
      const at = stamp(nowT(state.NOW));
      return {
        ...state,
        REQ: {
          ...state.REQ,
          [a.id]: { by: state.WHO, at, to: a.to, why: a.why as Reason, state: "waiting" as const },
        },
        ...log(
          state,
          at,
          "Asked to reassign",
          a.id,
          "to " + P(state.PEOPLE, a.to).n + " · " + a.why,
          "admin",
        ),
        ui: { ...state.ui, MVOPEN: null, MVTO: null },
      };
    }

    /* decideMove(id,ok) — 03-app.js:1293. Time passes between asking and deciding and the world
       moves in it, so approval re-runs every check the manual reassignment runs. */
    case "decideMove": {
      const r = state.REQ[a.id];
      const l = leadOf(state, a.id);
      if (!r || !l || r.state !== "waiting" || !canDecideMove(state, l)) return state;
      const at = stamp(nowT(state.NOW));
      if (a.ok) {
        if (custodian(l) === "Closed") return state;
        if (!assignees(state).includes(r.to)) return state;
        if (r.to === l.own)
          return {
            ...state,
            REQ: { ...state.REQ, [a.id]: { ...r, state: "approved" as const, did: state.WHO, on: at } },
          };
      }
      const nr = {
        ...r,
        state: a.ok ? ("approved" as const) : ("declined" as const),
        did: state.WHO,
        on: at,
      };
      if (!a.ok)
        return {
          ...state,
          REQ: { ...state.REQ, [a.id]: nr },
          ...log(
            state,
            at,
            "Declined a reassignment",
            a.id,
            "asked by " + P(state.PEOPLE, r.by).n + " · " + r.why,
            "admin",
          ),
        };
      const was = l.own;
      const nl: Lead = {
        ...l,
        sec: l.sec === r.to ? was : l.sec,
        own: r.to,
        ...(l.cov ? { cov: null } : {}),
      };
      return {
        ...state,
        LEADS: setLead(state, nl),
        REQ: { ...state.REQ, [a.id]: nr },
        ...log(
          state,
          at,
          "Reassigned on request",
          a.id,
          P(state.PEOPLE, was).n + " → " + P(state.PEOPLE, nl.own as PersonKey).n + " · " + r.why,
          "admin",
        ),
      };
    }

    case "setAsTo":
      return withUi(state, { ASTO: a.v || null });

    /* handover(id,perm,why) — 03-app.js:1348. Cover is the secondary's to start; changing the
       owner of record is not. */
    case "handover": {
      const l = leadOf(state, a.id);
      if (!l || !l.sec || !secOK(state,l) || !openable(state).some(x=>x.id === l.id)) return state;
      if (custodian(l) === "Closed") return state;
      const may =
        custodian(l) === "IR"
          ? canAssign(state) || l.own === state.WHO || secondaryMayWork(state,l) || covOf(state,l)?.by === state.WHO
          : canAssign(state);
      if (!may) return state;
      if (a.perm && !canAssign(state) && l.own !== state.WHO) return state;
      const at = stamp(nowT(state.NOW));
      if (a.perm) {
        if (!(REASONS as readonly string[]).includes(a.why)) return withUi(state, { ASKW: a.id });
        const was = l.own;
        const nl: Lead = { ...l, own: l.sec, sec: was };
        return {
          ...state,
          LEADS: setLead(state, nl),
          ...log(
            state,
            at,
            "Reassigned to secondary",
            a.id,
            P(state.PEOPLE, was).n + " → " + P(state.PEOPLE, nl.own as PersonKey).n + " · " + a.why,
            "admin",
          ),
          ui: { ...state.ui, ASKW: null },
        };
      }
      const d = DUR[a.why];
      if (!d) return withUi(state, { ASKD: a.id }); /* how long is a decision, not a default */
      const to =
        d.days === null
          ? outFor(state, l.own as PersonKey)
            ? outTo(state, l.own as PersonKey)
            : plusDays(14, state.NOW)
          : plusDays(d.days, state.NOW);
      const cov: Cover = { by: l.sec, from: pinAccessDate(at.slice(0, 6), state.NOW),
        to: pinAccessDate(to, state.NOW), why: d.t };
      return {
        ...state,
        LEADS: setLead(state, { ...l, cov }),
        ...log(
          state,
          at,
          "Handed to secondary",
          a.id,
          P(state.PEOPLE, l.sec).n +
            " acting for " +
            P(state.PEOPLE, l.own).n +
            " · " +
            d.t +
            ", to " +
            to,
          "admin",
        ),
        ui: { ...state.ui, ASKD: null },
      };
    }

    /* endCover(id) — 03-app.js:1378. Whichever store it came from. */
    case "endCover": {
      const l = leadOf(state, a.id);
      if (!l) return state;
      const c = covOf(state, l);
      if (!c) return state;
      if (
        custodian(l) === "IR"
          ? !(canAssign(state) || l.own === state.WHO || c.by === state.WHO)
          : !canAssign(state)
      )
        return state;
      const at = stamp(nowT(state.NOW));
      const w = log(
        state,
        at,
        "Ended cover",
        a.id,
        P(state.PEOPLE, c.by).n + " handed back to " + P(state.PEOPLE, l.own).n,
        "admin",
      );
      if (l.cov) return { ...state, LEADS: setLead(state, { ...l, cov: null }), ...w };
      const COVER = { ...state.COVER };
      delete COVER[l.own as PersonKey];
      return { ...state, COVER, ...w };
    }

    /* endCoverFor(k) — 03-app.js:877. Coming back has to end the cover it started, or the lead
       goes on saying somebody else is carrying it after its owner is at their desk again. */
    case "endCoverFor": {
      let n = 0;
      const COVER = { ...state.COVER };
      if (COVER[a.k]) {
        delete COVER[a.k];
        n++;
      }
      const LEADS = state.LEADS.map((l) => {
        if (l.own === a.k && l.cov) {
          n++;
          return { ...l, cov: null };
        }
        return l;
      });
      if (!n) return state;
      const at = stamp(nowT(state.NOW));
      return {
        ...state,
        COVER,
        LEADS,
        ...log(
          state,
          at,
          "Ended cover",
          null,
          P(state.PEOPLE, a.k).n + " is back — " + n + " cover record" + (n === 1 ? "" : "s") + " closed",
          "roster",
        ),
      };
    }

    /* ===== THE DATED NEXT STEP ============================================================== */
    /* seedNext(id) — 03-app.js:2163-2166. A cached draft for the lead being opened (kept current by
       every edit below, exactly like followupDrawer.tsx's FUDRAFTS) is reused untouched; only a
       lead with no cached draft gets a freshly built one. */
    case "seedNext": {
      if (!openable(state).some((l) => l.id === a.id)) return state;
      const key = nextDraftKey(state, a.id);
      const NXD = NEXTDRAFTS.get(key) ?? seedNext(state, leadOf(state, a.id));
      NEXTDRAFTS.set(key, NXD);
      return withUi(state, { NXD });
    }

    /* setNXD(k,v) — 03-app.js:6379. `k==="t"` also derives the channel from the wording, the same
       way the prototype's own `setNXD` does — but only overwrites `ch` when the derived channel is
       an actual one (`channelForAction` falling back to "other" leaves whatever channel was
       already chosen alone). Written straight back into NEXTDRAFTS, keyed off whichever lead's
       drawer is open, so the half-typed draft survives closing and reopening it. */
    case "setNXD": {
      const NXD = { ...uiNXDLocal(state), [a.k]: a.v };
      if (a.k === "t") {
        const mapped = channelForAction(a.v);
        if (mapped !== "other") NXD.ch = mapped;
      }
      if (state.DRW && state.DRW.k === "next" && state.DRW.id) NEXTDRAFTS.set(nextDraftKey(state, state.DRW.id), NXD);
      return withUi(state, { NXD });
    }

    case "quickDate": {
      const NXD = { ...uiNXDLocal(state), d: iso(plusD(nowT(state.NOW), a.n)) };
      if (state.DRW && state.DRW.k === "next" && state.DRW.id) NEXTDRAFTS.set(nextDraftKey(state, state.DRW.id), NXD);
      return withUi(state, { NXD });
    }

    /* saveNext(id) — 03-app.js:2185. A step and a date are both required, the time optional. */
    case "saveNext": {
      const l = leadOf(state, a.id);
      if (!l || !canPlan(state, l)) return state;
      const NXD = uiNXDLocal(state);
      if (!NXD.t || !isoDay.test(NXD.d || "")) return state;
      const by = dISOtoDisp(NXD.d, state.NOW);
      if (!by) return state;
      const tmm = /^(\d{2}):(\d{2})$/.exec(NXD.tm || "");
      const tm = tmm && +tmm[1] < 24 && +tmm[2] < 60 ? NXD.tm : "";
      const at = stamp(nowT(state.NOW));
      /* saveNext — 03-app.js:6390. The drawer's own choice of channel wins when it is a real one;
         otherwise the wording decides. */
      const mapped = channelForAction(NXD.t);
      const ch = (([...TOUCHCHANNELS, "other"] as readonly string[]).includes(NXD.ch)
        ? NXD.ch
        : mapped) as Channel | "other";
      const nx = { t: NXD.t, by, d: NXD.d, tm, ch, who: state.WHO, at };
      NEXTDRAFTS.delete(nextDraftKey(state, a.id)); /* 03-app.js:2192 — a saved draft is not a draft any more */
      return {
        ...state,
        LEADS: setLead(state, { ...l, nx }),
        ...log(
          state,
          at,
          "Set the next action",
          a.id,
          NXD.t + " — by " + by + (tm ? " " + tm : ""),
          "stage",
        ),
        DRW: null /* saveNext closes the drawer — 03-app.js:2194 */,
        ui: { ...state.ui, NXASK: null },
      };
    }

    /* clearNext(id) — 03-app.js:573 */
    case "clearNext": {
      const l = leadOf(state, a.id);
      if (!l || !canPlan(state, l) || !l.nx) return state;
      const at = stamp(nowT(state.NOW));
      const was = l.nx.t;
      return {
        ...state,
        LEADS: setLead(state, { ...l, nx: null }),
        ...log(state, at, "Cleared the next action", a.id, was, "stage"),
      };
    }

    /* keepNext(id) — 03-app.js:582 */
    case "keepNext": {
      const l = leadOf(state, a.id);
      if (!l || !hasNext(l)) return withUi(state, { NXASK: null });
      const at = stamp(nowT(state.NOW));
      return {
        ...state,
        ...log(state, at, "Kept the next step", a.id, l.nx!.t + " — still " + l.nx!.by, "stage"),
        ui: { ...state.ui, NXASK: null },
      };
    }

    /* pullIn(id) — 03-app.js:589. If the owner is rostered out when it falls, the useful target is
       the working day before they go — the whole reason somebody opens the month view before leave. */
    case "pullIn": {
      const l = leadOf(state, a.id);
      if (!l || !canPlan(state, l) || !hasNext(l)) return state;
      const cur = nxDate(l, state.NOW);
      if (!cur) return state;
      const from = l.own ? absFrom(state, l.own) : null;
      let target = from && cur >= from ? dAdd(from, -1) : dAdd(cur, -2);
      if (target < state.NOW) target = new Date(state.NOW.getTime());
      return moveNextTo(
        state,
        a.id,
        Math.max(0, Math.round((target.getTime() - state.NOW.getTime()) / DAY)),
      );
    }

    case "moveNextTo":
      return moveNextTo(state, a.id, a.days);

    case "askReschedule":
      return !a.id || openable(state).some(l=>l.id === a.id) ? withUi(state, { NXASK: a.id ? ask(state, leadOf(state, a.id)) : null }) : state;

    /* ===== A TOUCH AT A TIME ================================================================ */
    case "seedTouch":
      return openable(state).some(l=>l.id === a.id) ? withUi(state, { TD: seedTouch(state) }) : state;

    case "setTD":
      return withUi(state, { TD: { ...uiTDLocal(state), [a.k]: a.v } });

    /* saveTouch(id) — 03-app.js:2210. One attempt per save; the count is what tells you whether
       they want it. Two refusals here — the consent one and the future one — were alerts. */
    case "saveTouch": {
      const l = leadOf(state, a.id);
      if (!l || !canWork(state, l)) return state;
      const TD = uiTDLocal(state);
      /* a reply is inbound: the one thing you can record on a lead that has given no consent */
      if (TD.k !== "reply" && !conFor(l, TD.k as Channel)) return state;
      if (!isoDay.test(TD.d || "")) return state;
      const at = dISOtoDisp(TD.d, state.NOW) + " " + (/^\d{2}:\d{2}$/.test(TD.tm || "") ? TD.tm : "09:00");
      const atD = whenT(at, state.NOW);
      if (!atD || atD > nowT(state.NOW)) return state;
      const now = stamp(nowT(state.NOW));
      void now;
      if (TD.k === "reply") {
        const nl: Lead = { ...l, reply: at };
        return {
          ...state,
          LEADS: setLead(state, nl),
          ...log(state, at, "Reply received", a.id, at, "stage"),
          ui: { ...state.ui, NXASK: ask(state, nl), TD: seedTouch(state) },
        };
      }
      const k = TD.k as Channel;
      if (!TOUCHDONE[k]) return state;
      const arr = [...tList(l, k), at].sort(
        (x, y) => (whenT(x, state.NOW)?.getTime() || 0) - (whenT(y, state.NOW)?.getTime() || 0),
      );
      const n = arr.length;
      /* a backdated attempt is real, but the rung cannot be stamped before the capture it followed */
      let ats = l.at;
      let done = l.done;
      let late = l.late;
      if (l.done < ST.TOUCH) {
        const cap = whenT(l.at[0], state.NOW);
        ats = [...l.at, cap && atD < cap ? l.at[0] : at];
        done = ST.TOUCH;
        late = 0;
      }
      const nl: Lead = { ...l, touch: { ...l.touch, [k]: arr }, at: ats, done, late };
      const wk = iso(monday(state.NOW));
      const nWk =
        state.LOG.filter(
          (e) => e.lead === a.id && ["msg", "call", "email"].includes(e.kind) && e.d >= wk,
        ).length + 1;
      const w = log(state, stamp(nowT(state.NOW)), TOUCHDONE[k], a.id, n > 1 ? "attempt " + n : "", k);
      w.LOG[0] = { ...w.LOG[0], touch: nWk };
      return {
        ...state,
        LEADS: setLead(state, nl),
        ...w,
        /* stay on the channel you were logging */
        ui: { ...state.ui, NXASK: ask(state, nl), TD: { ...seedTouch(state), k } },
      };
    }

    /* dropTouch(id,k,at) — 03-app.js:2233. The entry itself, not just whichever is last, because a
       backdated attempt sorts into the middle and would otherwise be stuck there for ever. */
    case "dropTouch": {
      const l = leadOf(state, a.id);
      if (!l || !canWork(state, l)) return state;
      const at = stamp(nowT(state.NOW));
      if (a.k === "reply") {
        if (!l.reply) return state;
        if (!fresh(l.reply, state.NOW)) return state;
        const was = l.reply;
        return {
          ...state,
          LEADS: setLead(state, { ...l, reply: null }),
          ...log(state, at, "Removed the reply", a.id, was, "stage"),
        };
      }
      const k = a.k as Channel;
      const list = tList(l, k);
      const hit = a.at || list[list.length - 1];
      if (!hit || !list.includes(hit)) return state;
      if (!fresh(hit, state.NOW)) return state;
      const arr = list.slice();
      arr.splice(arr.indexOf(hit), 1);
      return {
        ...state,
        LEADS: setLead(state, { ...l, touch: { ...l.touch, [k]: arr } }),
        ...log(state, at, "Removed a touch", a.id, TOUCHDONE[k] + " · " + hit, "stage"),
      };
    }

    /* ===== FORECAST ========================================================================= */
    case "setFc": {
      const l = leadOf(state, a.id);
      if (!l || !canPlan(state, l) || l.done < ST.QUALIFIED) return state;
      if (!FCATT[a.c]) return state;
      const c = a.c as FcCat;
      const at = stamp(nowT(state.NOW));
      /* Object.assign({c:"pipeline",by:"",ev:"",at:"",who:me()}, l.fc||{}, {c, at, who:me()}) */
      const base: Forecast = { c: "pipeline", by: "", ev: "", at: "", who: state.WHO };
      const nf: Forecast = { ...base, ...(l.fc || {}), c, at, who: state.WHO };
      return {
        ...state,
        LEADS: setLead(state, { ...l, fc: nf }),
        ...log(state, at, "Set the forecast category", a.id, FCATT[c], "stage"),
      };
    }

    case "setFcBy": {
      const l = leadOf(state, a.id);
      if (!l || !canPlan(state, l) || !l.fc) return state;
      const at = stamp(nowT(state.NOW));
      const by = plusDays(a.days, state.NOW);
      return {
        ...state,
        LEADS: setLead(state, { ...l, fc: { ...l.fc, by, at, who: state.WHO } }),
        ...log(state, at, "Set the expected full-payment date", a.id, by, "stage"),
      };
    }

    case "setFcEv": {
      const l = leadOf(state, a.id);
      if (!l || !canPlan(state, l) || !l.fc) return state;
      const at = stamp(nowT(state.NOW));
      const ev = (a.t || "").trim();
      return {
        ...state,
        LEADS: setLead(state, { ...l, fc: { ...l.fc, ev, at, who: state.WHO } }),
        ...log(state, at, "Recorded forecast evidence", a.id, ev.slice(0, 60), "stage"),
      };
    }

    /* ===== HOW A LEAD ENDS ================================================================== */
    case "closeLost": {
      const l = leadOf(state, a.id);
      if (!l || !canLose(state, l) || !(LOSTWHY as readonly string[]).includes(a.why)) return state;
      const at = stamp(nowT(state.NOW));
      const lost: Lost = {
        why: a.why as LostWhy,
        note: (a.note || "").trim(),
        at,
        by: state.WHO,
        stage: l.done,
        nx: l.nx || null,
      };
      return {
        ...state,
        LEADS: setLead(state, { ...l, lost, nx: null }),
        ...log(state, at, "Closed as lost", a.id, a.why + (lost.note ? " — " + lost.note : ""), "stage"),
        ui: { ...state.ui, LOSTW: null, LOSTN: "" },
      };
    }

    /* reopenLost(id) — 03-app.js:531. The close is not deleted, it is closed. */
    case "reopenLost": {
      const l = leadOf(state, a.id);
      if (!l || !canReopen(state, l) || !l.lost) return state;
      const at = stamp(nowT(state.NOW));
      const was = l.lost;
      const back = was.nx && whenFwd(was.nx.by, state.NOW) && (whenFwd(was.nx.by, state.NOW) as Date) >= state.NOW;
      const nl: Lead = {
        ...l,
        lostWas: [...(l.lostWas || []), { ...was, reopened: at, reby: state.WHO }],
        lost: null,
        nx: back ? was.nx! : l.nx,
      };
      return {
        ...state,
        LEADS: setLead(state, nl),
        ...log(state, at, "Re-opened", a.id, "was closed as: " + was.why, "stage"),
      };
    }

    /* ===== NOTES AND THE CALL =============================================================== */
    case "addNote": {
      const l = leadOf(state, a.id);
      const t = String(state.ui.NDRAFT ?? "").trim();
      if (!l || !t || !canNote(state, l)) return state;
      const at = stamp(nowT(state.NOW));
      const NOTES = {
        ...state.NOTES,
        [a.id]: [{ who: state.WHO, at, d: iso(state.TODAY), t }, ...(state.NOTES[a.id] || [])],
      };
      return {
        ...state,
        NOTES,
        ...log(state, at, "Added a note", a.id, t.slice(0, 60) + (t.length > 60 ? "…" : ""), "note"),
        ui: { ...state.ui, NDRAFT: "", NXASK: ask(state, l) },
      };
    }

    case "setCall": {
      const l = leadOf(state, a.id);
      if (!l || !canWork(state, l)) return state;
      if (!(CALLOUT as readonly string[]).includes(a.o)) return state;
      const at = stamp(nowT(state.NOW));
      const c = state.CALLS[a.id] || { obj: [] };
      const o = c.o === a.o ? null : (a.o as CallOutcome);
      return {
        ...state,
        CALLS: { ...state.CALLS, [a.id]: { ...c, o, at, who: state.WHO } },
        ...log(
          state,
          at,
          o ? "Call outcome recorded" : "Call outcome cleared",
          a.id,
          o || a.o,
          "note",
        ),
        ui: { ...state.ui, NXASK: ask(state, l) },
      };
    }

    case "toggleObj": {
      const l = leadOf(state, a.id);
      if (!l || !canWork(state, l)) return state;
      if (!(OBJS as readonly string[]).includes(a.o)) return state;
      const at = stamp(nowT(state.NOW));
      const c = state.CALLS[a.id] || { obj: [] };
      const i = c.obj.indexOf(a.o as Objection);
      const obj = i >= 0 ? c.obj.filter((x) => x !== a.o) : [...c.obj, a.o as Objection];
      return {
        ...state,
        CALLS: { ...state.CALLS, [a.id]: { ...c, obj, at, who: state.WHO } },
        ...log(state, at, i >= 0 ? "Objection removed" : "Objection recorded", a.id, a.o, "note"),
      };
    }

    /* ===== MATERIAL AND THE PRODUCE PACK ==================================================== */
    case "mat": {
      const l = leadOf(state, a.id);
      if (!l) return state;
      const sent = state.SENT[a.id] || {};
      const d = a.d as Sendable;
      /* nothing goes out to somebody who has not signed an NDA */
      if (!sent[d] && !prDone(state, l.id, "nda")) return state;
      if (!canWork(state, l)) return state;
      if (!sent[d] && !l.consent) return state;
      const at = stamp(nowT(state.NOW));
      if (sent[d]) {
        if (!fresh(sent[d] as string, state.NOW)) return state;
        const next = { ...sent };
        delete next[d];
        return {
          ...state,
          SENT: { ...state.SENT, [a.id]: next },
          ...log(state, at, "Un-ticked material", a.id, a.d, "mat"),
        };
      }
      return {
        ...state,
        SENT: { ...state.SENT, [a.id]: { ...sent, [d]: at } },
        ...log(state, at, "Ticked material sent", a.id, a.d, "mat"),
      };
    }

    case "pack": {
      const l = leadOf(state, a.id);
      if (!l || !canWork(state, l)) return state;
      const down = state.PACK[a.id] === a.w;
      if (!down && !l.consent) return state;
      if (down && !fresh(state.PACKAT[a.id] || "", state.NOW)) return state;
      const at = stamp(nowT(state.NOW));
      const w = down ? a.w - 1 : a.w;
      return {
        ...state,
        PACK: { ...state.PACK, [a.id]: w },
        PACKAT: { ...state.PACKAT, [a.id]: at },
        ...log(state, at, "Produce pack", a.id, "week " + w + " of 4", "pack"),
      };
    }

    /* ===== THE LEADS LIST'S OWN CONTROLS ==================================================== */
    case "setSort":
      return withUi(state, { LSORT: (SORTS[a.v as SortKey] ? a.v : "urgent") as SortKey });

    case "setLQ":
      return withUi(state, { LQ: a.v });

    case "clearLeadFilters":
      return withUi(state, { ...CLEARED_LEAD_FILTERS });

    /* toLeads(set, scope) — 03-app.js:2757. How a number on another screen becomes the leads
       behind it: clear everything, apply exactly one cut, switch the scope. `set` is that cut,
       encoded as "<field>:<value>" — "stage:3", "filt:cold", "src:Events", "own:kavya",
       "q:unassigned" — because an action is data and the prototype's callback is not. */
    case "toLeads": {
      if (!canReach(state, "leads")) return state;
      const patch: Record<string, unknown> = { ...CLEARED_LEAD_FILTERS };
      if (a.set) {
        const i = a.set.indexOf(":");
        const f = i < 0 ? a.set : a.set.slice(0, i);
        const v = i < 0 ? "" : a.set.slice(i + 1);
        if (f === "stage") patch.LSTAGE = +v || null;
        else if (f === "filt") patch.LFILT = v || null;
        else if (f === "src") patch.LSRC = v || null;
        else if (f === "own") patch.LOWN = v || null;
        else if (f === "q") patch.LQ = v;
      }
      const SC = seesTeam(state) ? { ...state.SC, leads: a.scope || "team" } : state.SC;
      return { ...state, SC, ui: { ...state.ui, ...patch } };
    }

    /* ===== THE PAPERWORK ROUNDS =============================================================
       Every beat goes through prGate(), so the order and the permission are checked in exactly one
       place. 03-app.js:1720–1801. The NDA goes first and gates the material; the supplementary
       agreement comes after the investor has said yes. */
    case "prGate":
      return state; /* the prototype's prGate is a read, not a write — see selectors/paper.ts */

    case "prDraft": {
      const l = leadOf(state, a.id);
      if (!l || !gated(state, l, "supp", "draft")) return state;
      const at = stamp(nowT(state.NOW));
      const draft = { by: state.WHO, at, link: (a.link || "").trim(), v: 1 };
      return {
        ...state,
        PAPER: setRound(state, a.id, "supp", { ...prRow(state, a.id, "supp"), draft }),
        ...log(
          state,
          at,
          "Sent the draft",
          a.id,
          "Supplementary agreement, first draft" + (draft.link ? " · " + draft.link : ""),
          "doc",
        ),
        ui: { ...state.ui, PLINK: "" },
      };
    }

    case "prRedraft": {
      const l = leadOf(state, a.id);
      const r = pr(state, a.id, "supp");
      if (!l || !r || !r.draft || r.agreed || !prOpen(state, l, "supp") || !prMine(state, l, "IR"))
        return state;
      const at = stamp(nowT(state.NOW));
      const draft = {
        by: state.WHO,
        at,
        link: (a.link || "").trim() || r.draft.link,
        v: (r.draft.v || 1) + 1,
      };
      return {
        ...state,
        PAPER: setRound(state, a.id, "supp", { ...r, draft }),
        ...log(
          state,
          at,
          "Sent the draft",
          a.id,
          "Supplementary agreement, draft " + draft.v + (draft.link ? " · " + draft.link : ""),
          "doc",
        ),
        ui: { ...state.ui, PLINK: "", PREDRAFT: null },
      };
    }

    case "prAgreed": {
      const l = leadOf(state, a.id);
      if (!l || !gated(state, l, "supp", "agreed")) return state;
      const ln = (a.link || "").trim();
      if (!ln) return state; /* the final draft IS its link */
      const at = stamp(nowT(state.NOW));
      return {
        ...state,
        PAPER: setRound(state, a.id, "supp", {
          ...prRow(state, a.id, "supp"),
          agreed: { by: state.WHO, at, link: ln },
        }),
        ...log(state, at, "Final draft agreed", a.id, "Supplementary agreement · " + ln, "doc"),
        ui: { ...state.ui, PLINK: "" },
      };
    }

    case "prSend": {
      const l = leadOf(state, a.id);
      const R = RND(a.rk);
      if (!l || !R || !gated(state, l, a.rk, "sent")) return state;
      const at = stamp(nowT(state.NOW));
      const acct = state.ACCT[a.id];
      const row = state.DOCS.find((d) => d.lead === a.id && d.t === R.tpl);
      const DOCS = row
        ? state.DOCS.map((d) =>
            d === row
              ? { ...d, state: "awaiting" as const, on: at.slice(0, 6), how: "Zoho Sign", by: state.WHO }
              : d,
          )
        : [
            {
              lead: a.id,
              t: R.tpl,
              cls: dClsOf(R.tpl) || ("Agreement" as DocClass),
              state: "awaiting" as const,
              on: at.slice(0, 6),
              how: "Zoho Sign",
              ref: acct ? acct.code : null,
              by: state.WHO,
            },
            ...state.DOCS,
          ];
      return {
        ...state,
        DOCS,
        PAPER: setRound(state, a.id, a.rk, {
          ...prRow(state, a.id, a.rk),
          sent: { by: state.WHO, at, via: "Zoho Sign" },
        }),
        ...log(state, at, "Sent document", a.id, R.tpl + " · Zoho Sign", "doc"),
      };
    }

    case "prTold": {
      const l = leadOf(state, a.id);
      const R = RND(a.rk);
      /* a visit is never how a chase for a signature is logged — domain/types.ts:190-192 — so this
         reads as an `SlaChannel`, and PCHT[ch] is undefined (the guard below refuses it) for
         anything else, "visit" included */
      const ch = a.ch as SlaChannel;
      if (!l || !R || !PCHT[ch] || !gated(state, l, a.rk, "told")) return state;
      const at = stamp(nowT(state.NOW));
      return {
        ...state,
        PAPER: setRound(state, a.id, a.rk, {
          ...prRow(state, a.id, a.rk),
          told: { by: state.WHO, at, ch },
        }),
        ...log(state, at, "Told them it is there", a.id, R.t + " · by " + PCHT[ch], "doc"),
      };
    }

    case "prChase": {
      const l = leadOf(state, a.id);
      const r = pr(state, a.id, a.rk);
      const R = RND(a.rk);
      const ch = a.ch as SlaChannel;
      if (!l || !r || !R || !PCHT[ch] || !prOpen(state, l, a.rk) || !prMine(state, l, "IR"))
        return state;
      const ph = a.phase === "draft" ? "draft" : "sign";
      if (ph === "draft" ? !r.draft || r.agreed : !r.told || r.said) return state;
      const at = stamp(nowT(state.NOW));
      const chase = [...(r.chase || []), { by: state.WHO, at, ch, phase: ph as "draft" | "sign" }];
      const next = { ...state, PAPER: setRound(state, a.id, a.rk, { ...r, chase }) };
      const n = prChases(next, a.id, a.rk, ph).length;
      return {
        ...next,
        ...log(state, at, "Chased it", a.id, R.t + " · " + PCHT[ch] + " · reminder " + n, ch),
      };
    }

    case "prSaid": {
      const l = leadOf(state, a.id);
      const R = RND(a.rk);
      if (!l || !R || !gated(state, l, a.rk, "said")) return state;
      const at = stamp(nowT(state.NOW));
      const r = { ...prRow(state, a.id, a.rk), said: { by: state.WHO, at } };
      delete r.back;
      return {
        ...state,
        PAPER: setRound(state, a.id, a.rk, r),
        ...log(state, at, "They say it is signed", a.id, R.t + " · waiting on Finance to verify", "doc"),
      };
    }

    case "prVerify": {
      const l = leadOf(state, a.id);
      const R = RND(a.rk);
      if (!l || !R || !gated(state, l, a.rk, "ok")) return state;
      const at = stamp(nowT(state.NOW));
      const acct = state.ACCT[a.id];
      const DOCS = state.DOCS.map((d) =>
        d.lead === a.id && d.t === R.tpl
          ? {
              ...d,
              state: "signed" as const,
              on: at.slice(0, 6),
              ref: d.ref || (acct ? acct.code : "EMU-" + at.slice(0, 2) + at.slice(3, 6).toUpperCase()),
            }
          : d,
      );
      return {
        ...state,
        DOCS,
        PAPER: setRound(state, a.id, a.rk, {
          ...prRow(state, a.id, a.rk),
          ok: { by: state.WHO, at },
        }),
        ...log(state, at, "Verified the signed copy", a.id, R.tpl + " · signed and on file", "doc"),
      };
    }

    case "prBounce": {
      const l = leadOf(state, a.id);
      const r = pr(state, a.id, a.rk);
      const R = RND(a.rk);
      if (!l || !r || !R || !r.said || r.ok || !prMine(state, l, "Finance")) return state;
      const at = stamp(nowT(state.NOW));
      const next = { ...r, back: { by: state.WHO, at, why: a.why || "Nothing has come back signed" } };
      delete next.said;
      return {
        ...state,
        PAPER: setRound(state, a.id, a.rk, next),
        ...log(state, at, "Not signed after all", a.id, R.t + " · " + next.back.why, "doc"),
      };
    }

    default:
      return null;
  }
}

/* ---- the leftovers the cases above lean on --------------------------------------------------- */

/* FCAT's labels, without importing the whole table for one string */
const FCATT: Record<string, string> = { commit: "Commit", probable: "Probable", pipeline: "Pipeline" };
/* PCH — "told them by …". 03-app.js:1726. `SlaChannel`, not `Channel`: a visit is never how a
   chase for a signature is logged (domain/types.ts:190-192). */
const PCHT: Record<SlaChannel, string> = { msg: "WhatsApp", call: "a call", email: "email" };

/* canAskMove(l) — only the owner of record may ask. Local because selectors/leads.ts exports it
   under the same name and this file already imports twelve of its neighbours. */
const canAskMoveLocal = (state: ConsoleState, l: Lead): boolean =>
  !!l.own && custodian(l) !== "Closed" && l.own === state.WHO && !canAssign(state);

/* prGate(id,rk,beat) — the beat that is next, and it is mine. 03-app.js:1720 */
const gated = (state: ConsoleState, l: Lead, rk: string, beat: string): boolean => {
  const n = prNext(state, l, rk);
  return n.k === beat && !!n.who && prMine(state, l, n.who);
};

/* prRow(id,k) CREATED the row as a side effect of reading it; this is the write half */
const setRound = (
  state: ConsoleState,
  id: LeadId,
  k: string,
  row: ReturnType<typeof prRow>,
): ConsoleState["PAPER"] => ({ ...state.PAPER, [id]: { ...(state.PAPER[id] || {}), [k]: row } });

const uiNXDLocal = (state: ConsoleState) => {
  const v = state.ui.NXD as { t?: string; d?: string; tm?: string; ch?: string } | undefined;
  return { t: v?.t ?? "", d: v?.d ?? "", tm: v?.tm ?? "", ch: v?.ch ?? "" };
};
const uiTDLocal = (state: ConsoleState) => {
  const v = state.ui.TD as { k?: string; d?: string; tm?: string } | undefined;
  return { k: v?.k ?? "msg", d: v?.d ?? "", tm: v?.tm ?? "" };
};
