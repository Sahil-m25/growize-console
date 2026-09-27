/* =================================================================================================
   pages-c's half of the store's reducer — People, Profile, Plan and System.

   `src/lib/store.tsx` belongs to the shell, so every case the store declares as TODO(pages-c) is
   implemented here and the store's reducer is left alone. One function, one switch, the prototype's
   own names:

     People    startPerson editPerson cancelPerson addPerson removePerson setMgr setSeat
               toggleCap resetCaps                              03-app.js 336–370, 5638–5714
     Roster    setAvail setOutWhy setOutFrom setOutTo           03-app.js 858–905
     Lending   tSet startTemp grantTemp revokeTemp              03-app.js 5583–5615
     Profile   setMe setMyStyle                                 03-app.js 5024–5041
     Plan      bump setNum setTarget setActual setPeriodDate setGrain addPeriod dropPeriod
               setBaseline                                      03-app.js 5909–6041
     Numbers   setRecov clearRecov                              03-app.js 4135–4146

   THE AUDIT TRAIL IS THE FEATURE. Every prototype write that called `log(...)` writes the same line
   here, with the same wording, and a write that is refused writes nothing at all — a toggle that
   changes state without its log line is the defect this file exists to avoid.

   Two prototype habits do not survive the port and are handled at the call site instead:
   `alert()`/`confirm()` (a reducer is pure — the page asks, then dispatches) and `draw()`.
   ============================================================================================== */

import {
  BASEWHY,
  CAPT,
  freeStyle,
  GRAINS,
  OUTWHY,
  PAGECAPS,
  PLANAT,
  RECOVACTS,
  SEAT,
  SEATSCREENS,
  TDUR,
  UNIT,
} from "@/domain";
import type {
  ActKind,
  Cap,
  CapGrid,
  Cover,
  Grain,
  LeadId,
  LogEntry,
  NavKey,
  Person,
  PersonKey,
  Plan,
  PlanPeriod,
  PlanScalar,
  RecovAction,
  SeatKey,
  TempGrant,
} from "@/domain";
import {
  dAdd,
  dISOtoDisp,
  dOf,
  iso,
  isoDay,
  nowT,
  pLabel,
  pinAccessDate,
  plusDays,
  stamp,
} from "@/lib/format";
import {
  canGrant,
  canManage,
  canOperateLeads,
  consoleAccount,
  canRosterFor,
  capsBase,
  capsFor,
  chainOf,
  gone,
  isFin,
  kpis,
  may,
  moveCost,
  own,
  P,
  planTotals,
  reachBase,
  reachCeil,
  seatShape,
  roleOf,
  seatClash,
  seatReach,
  tempOn,
} from "@/lib/selectors";
import type { Action, ConsoleState, UiState } from "@/lib/store";
import { leaverDraftId, leaverPlan } from "./helpers";

/* ---- the page-local globals the prototype kept as module `let`s -------------------------------
   The store's `UiState` carries the shell's own drafts and an index signature; a feature slice adds
   its keys here, optional so the store's initialState() still satisfies the interface. Each read
   below falls back to the prototype's own initial value. */
declare module "@/lib/store" {
  interface UiState {
    /** People's tab — teams | members | roster | access. 03-app.js:934 */
    PTAB?: string;
    /** the member the person drawer is about. 03-app.js:934 */
    PSEL?: PersonKey | null;
    /** the draft member, while the form is open. 03-app.js:5638 */
    NEWP?: NewPerson | null;
    /** the draft grant, while Lend-a-page is open. 03-app.js:5578 */
    TGT?: TempDraft;
    /** the staff-handover draft: who receives the leaving member's work, and the last apply failure
        (if any) — keyed by who is signed in plus the member's key, so switching who is signed in
        never reads another admin's half-finished pick. Which drawer is open (member vs. the
        "p:leaver" review) is the drawer stack itself, not a flag in here.
        ir-console-redesigned.html:11148 */
    LEAVER?: Record<string, { to: PersonKey | null; applyError: string }>;
    /** the last grant id minted. 03-app.js:266 */
    TSEQ?: number;
    /** period keys are minted, never derived from length. 03-app.js:5955 */
    PKEY?: number;
    /** re-baselining asks for a reason before it changes anything. 03-app.js:6025 */
    ASKB?: boolean;
    BASED?: number;
    /** System's activity filter. 03-app.js:934 */
    LOGWHO?: PersonKey | null;
    /** the recovery action being written, and who it is going to. 03-app.js:4829 */
    RCACT?: string | null;
    RCWHO?: PersonKey | null;
  }
}

export type NewPerson = { n: string; em: string; seat: SeatKey; mgr: PersonKey | null };
export type TempDraft = {
  to: PersonKey | null;
  page: string | null;
  caps: Cap[];
  dur: string;
  why: string;
};

/* the prototype's own starting values, read wherever the ui bag has not been written yet */
export const TGT0: TempDraft = { to: null, page: null, caps: ["view"], dur: "d3", why: "" };
export const ptab = (s: ConsoleState): string => (s.ui.PTAB as string) ?? "teams";
export const psel = (s: ConsoleState): PersonKey | null => (s.ui.PSEL as PersonKey | null) ?? null;
export const newp = (s: ConsoleState): NewPerson | null => (s.ui.NEWP as NewPerson | null) ?? null;
export const tgt = (s: ConsoleState): TempDraft => (s.ui.TGT as TempDraft) ?? TGT0;
export const askb = (s: ConsoleState): boolean => !!s.ui.ASKB;
export const based = (s: ConsoleState): number => (s.ui.BASED as number) ?? 0;
export const logwho = (s: ConsoleState): PersonKey | null =>
  (s.ui.LOGWHO as PersonKey | null) ?? null;

/** the leaver draft for one member, under the reviewer signed in right now */
export const leaverDraft = (
  s: ConsoleState,
  k: PersonKey,
): { to: PersonKey | null; applyError: string } =>
  s.ui.LEAVER?.[leaverDraftId(s, k)] ?? { to: null, applyError: "" };

/* the TARGET's role ceiling for one capability — ir-console-redesigned.html:2991-3001
   (`roleCaps`). `selectors/access.ts` keeps its own copy private (it is that file's internal
   filter, applied inside `capsBase`/`capsFor`/`roleCaps` itself), so a guard that must ask "could
   this role EVER hold this cap on this page" rather than "does it currently hold it" needs this
   copy — see crossOwnerRequests: exporting `roleCaps` from selectors/access.ts (a shell-owned
   file this agent does not touch) would let this be dropped. Kept byte-for-byte in step with the
   prototype and with access.ts's private `roleCaps`. Exported so drawers.tsx's grid tick can make
   the same early refusal toggleCap (3026-3032) makes before ever opening the "cap" drawer — a tick
   for a cap the target's role can never hold is a silent no-op, not a failed save. */
export function roleAllowsCap(state: ConsoleState, k: PersonKey, p: string, c: Cap): boolean {
  return seatShape(state.PEOPLE, k, p, [c]).includes(c);
}

/* ---- the audit line ---------------------------------------------------------------------------
   03-app.js:1227. Everything written while a grant is switched on carries the grant, not only the
   writes that happen to be on the borrowed page — so the question after the fact is never "what did
   they do on Documents", it is "what did they do while they had it". */

type Draft = { LOG: LogEntry[]; TEMP: TempGrant[] };

/* `about` is the person a line HAPPENED TO, which is never the person who wrote it — it is what lets
   Updates answer "what was done to me" rather than only "what did somebody do". 03-app.js
   (redesigned):4386-4391. */
function log(
  s: ConsoleState,
  d: Draft,
  what: string,
  lead: LeadId | null,
  note: string,
  kind: ActKind,
  about?: PersonKey,
): void {
  const g = tempOn({ ...s, TEMP: d.TEMP });
  if (g) d.TEMP = d.TEMP.map((x) => (x.id === g.id ? { ...x, acts: (x.acts || 0) + 1 } : x));
  d.LOG = [
    {
      d: iso(s.TODAY),
      at: stamp(nowT(s.NOW)),
      who: s.WHO,
      what,
      lead,
      note: note || "",
      kind,
      temp: g ? g.id : null,
      ...(about ? { about: [about] } : {}),
    },
    ...d.LOG,
  ];
}

const draftOf = (s: ConsoleState): Draft => ({ LOG: s.LOG, TEMP: s.TEMP });

/* ---- small immutable helpers ------------------------------------------------------------------ */

const withUi = (s: ConsoleState, patch: Partial<UiState>): ConsoleState => ({
  ...s,
  ui: { ...s.ui, ...patch },
});

const setPerson = (s: ConsoleState, k: PersonKey, p: Partial<Person>): Record<PersonKey, Person> => ({
  ...s.PEOPLE,
  [k]: { ...s.PEOPLE[k], ...p },
});

const period = (PLAN: Plan, pk: string): PlanPeriod | undefined =>
  PLAN.periods.find((x) => x.k === pk);

const crStr = (n: number): string => "₹" + (n / 1e7).toFixed(2) + " Cr";

/* ---- the roster's other half — endCoverFor(k), 03-app.js:891 ----------------------------------
   Coming back has to end the cover it started, or the lead goes on saying somebody else is carrying
   it after its owner is at their desk again. The store declares `endCoverFor` as pages-a's action;
   this is the same write, inline, because setAvail cannot be honest without it. */
function endCoverFor(s: ConsoleState, d: Draft, k: PersonKey): Pick<ConsoleState, "COVER" | "LEADS"> {
  let n = 0;
  const COVER = { ...s.COVER };
  if (COVER[k]) {
    delete COVER[k];
    n++;
  }
  const LEADS = s.LEADS.map((l) => {
    if (l.own === k && l.cov) {
      n++;
      return { ...l, cov: null };
    }
    return l;
  });
  if (n)
    log(s, d, "Ended cover", null,
      P(s.PEOPLE, k).n + " is back — " + n + " cover record" + (n === 1 ? "" : "s") + " closed",
      "roster");
  return { COVER, LEADS };
}

/* =================================================================================================
   THE REDUCER. Returns new state for pages-c's own action types and `null` for everything else, so
   the caller can fall through to whoever owns the action.
   ============================================================================================== */

export function pagesCReducer(state: ConsoleState, action: Action): ConsoleState | null {
  switch (action.type) {
    /* ===== PEOPLE ============================================================================ */

    /* startPerson() — 03-app.js:5640. A draft outlives the drawer, so closing it to check a name on
       the list behind does not throw away what has been typed. */
    case "startPerson": {
      if (!own(state, "people", "seats")) return state;
      const NEWP =
        newp(state) ??
        ({
          n: "",
          em: "",
          seat: (Object.keys(SEAT) as SeatKey[]).filter((st) => canGrant(state, st))[0] ?? "ir",
          mgr: state.WHO,
        } as NewPerson);
      return { ...withUi(state, { NEWP, PTAB: "teams" }), DRW: { k: "newp", id: null } };
    }

    /* editPerson(k,v) — 03-app.js:5646 */
    case "editPerson": {
      const NEWP = newp(state);
      if (!NEWP) return state;
      return withUi(state, { NEWP: { ...NEWP, [action.k]: action.v } as NewPerson });
    }

    /* cancelPerson() — 03-app.js:5647 */
    case "cancelPerson":
      return withUi(state, { NEWP: null });

    /* addPerson() — 03-app.js:5648. The seat fills in the access grid; the manager is the ceiling,
       and a pairing that would break the ceiling is refused rather than made. */
    case "addPerson": {
      if (!own(state, "people", "seats")) return state;
      const NEWP = newp(state);
      if (!NEWP) return state;
      const n = (NEWP.n || "").trim();
      const em = (NEWP.em || "").trim();
      if (!n || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || !canGrant(state, NEWP.seat)) return state;
      const up = ([NEWP.mgr] as (PersonKey | null)[])
        .concat(NEWP.mgr ? chainOf(state.PEOPLE, NEWP.mgr) : [])
        .filter(Boolean) as PersonKey[];
      const bad = (SEATSCREENS[NEWP.seat] || []).filter(
        (pg) => !up.every((m) => seatReach(state.PEOPLE, m).indexOf(pg) >= 0),
      );
      if (bad.length) return state;
      const id = "p" + (Object.keys(state.PEOPLE).length + 1);
      const i = n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      const PEOPLE: Record<PersonKey, Person> = {
        ...state.PEOPLE,
        [id]: { n, em, i, seat: NEWP.seat, mgr: NEWP.mgr, on: true, ...freeStyle(state.PEOPLE) } as Person,
      };
      const d = draftOf(state);
      log({ ...state, PEOPLE }, d, "Added member", null,
        n + " · " + SEAT[NEWP.seat] + " · " + em, "admin");
      return { ...withUi(state, { PSEL: id, NEWP: null }), PEOPLE, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* removePerson(k) — ir-console-redesigned.html:11158-11186 ("leaver"). Leaving the team is one
       reviewed write: the successor named on the handover review receives every affected record —
       every owned lead, every place they stood in as secondary or cover, and their own per-person
       cover — before their access ends. Their reports keep a ceiling, moved to whoever they
       themselves reported to. Historical authors and commercial records are never rewritten by a
       staff handover; only staff responsibility in this console moves.

       The successor is read off the reviewed draft (`leaverDraft`) rather than off the action, so
       the plan is always recomputed against the freshest state at the moment this actually runs —
       including a run that was queued while offline — and a plan that has since gone bad (the
       chosen successor left, a lead moved, and so on) is refused exactly as the live review would
       refuse it, never applied half-checked. */
    case "removePerson": {
      const k = action.k;
      const to = leaverDraft(state, k).to;
      const plan = leaverPlan(state, k, to);
      if (plan.error) return state;
      const affectedIds = new Set(plan.affected.map((l) => l.id));
      /* revoked first, so every log line below — including the acts count a currently borrowed
         grant bumps itself by — is written against the state this write is actually leaving behind */
      const revoke = new Set(
        state.TEMP.filter((g) => g.state === "live" && (g.to === k || g.by === k)).map((g) => g.id),
      );
      const TEMP0 = state.TEMP.map((g) =>
        revoke.has(g.id) ? { ...g, state: "revoked" as const, by2: state.WHO, on: stamp(nowT(state.NOW)) } : g);
      const TEMPON = state.TEMPON && revoke.has(state.TEMPON) ? null : state.TEMPON;
      const d: Draft = { LOG: state.LOG, TEMP: TEMP0 };
      const LEADS = state.LEADS.map((l) => {
        if (!affectedIds.has(l.id)) return l;
        const owned = l.own === k;
        const secondary = l.sec === k;
        const cover = !!(l.cov && l.cov.by === k);
        let next = l;
        if (owned || secondary || cover) {
          next = { ...l };
          if (owned) { next.own = to; if (next.cov) next.cov = null; }
          if (secondary) next.sec = to;
          if (next.sec === next.own) next.sec = null;
          if (!owned && cover) next.cov = next.own === to ? null : { ...(l.cov as Cover), by: to as PersonKey };
        }
        log(state, d, "Leaver handover", l.id,
          P(state.PEOPLE, k).n + " → " + P(state.PEOPLE, to as PersonKey).n + " · Left the company · " +
            (owned ? "owner" : secondary ? "secondary" : "cover"),
          "admin", to ?? undefined);
        return next;
      });
      const COVER = { ...state.COVER };
      plan.coverKeys.forEach((x) => {
        if (x === k || x === to) delete COVER[x];
        else COVER[x] = { ...COVER[x], by: to as PersonKey };
      });
      const PEOPLE = { ...state.PEOPLE };
      plan.kids.forEach((x) => { PEOPLE[x] = { ...PEOPLE[x], mgr: plan.up }; });
      PEOPLE[k] = { ...PEOPLE[k], on: false };
      log(state, d, "Removed member after handover", null,
        P(state.PEOPLE, k).n + " · " + plan.owned.length + " owned leads" +
          (to ? " to " + P(state.PEOPLE, to).n : "") + " · " + plan.affected.length +
          " lead records reviewed · " + plan.kids.length + " reports moved up",
        "admin", k);
      const LEAVER = { ...(state.ui.LEAVER || {}) };
      delete LEAVER[leaverDraftId(state, k)];
      return { ...withUi(state, { LEAVER }), PEOPLE, COVER, LEADS, TEMP: d.TEMP, TEMPON, LOG: d.LOG };
    }

    /* setMgr(k,m) — 03-app.js:5686. The ceiling is the whole point, so the console works out what
       the move would cost before it makes it, and refuses one that would take a page the seat needs
       rather than making it and letting them find out. */
    case "setMgr": {
      const k = action.k;
      if (!own(state, "people", "seats") || !canManage(state, k)) return state;
      const m = action.m || null;
      if (m && (!state.PEOPLE[m] || !state.PEOPLE[m].on)) return state;
      if (m === state.PEOPLE[k].mgr) return state;
      const c = moveCost(state.PEOPLE, k, m, state.CAPS);
      if (c.cycle || !c.ok) return state;
      const was = state.PEOPLE[k].mgr;
      const PEOPLE = setPerson(state, k, { mgr: m });
      const d = draftOf(state);
      log(state, d, "Changed who they report to", null,
        P(state.PEOPLE, k).n + ": " + (was ? P(state.PEOPLE, was).n : "nobody") + " → " +
          (m ? P(state.PEOPLE, m).n : "nobody"),
        "admin", k);
      return { ...state, PEOPLE, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setSeat(seat, who) — ir-console-redesigned.html:11059-11078. WHOSE seat: this used to act on
       PSEL — whichever row the Members list had last opened — while the drawer it draws in can be
       opened from four other places that never touch PSEL (the availability roster among them), so
       changing the position of the person in front of you silently reseated somebody else and the
       log line named them. The person is an argument now; PSEL (`psel(state)`) is only the fallback
       for a caller that has none. `who` is not yet on the shared `Action` union — see
       crossOwnerRequests (src/lib/store.tsx) — so it is read off the action with a local cast. */
    case "setSeat": {
      const who = (action as typeof action & { who?: PersonKey }).who;
      const k = who || psel(state);
      const seat = action.seat;
      if (!k || !canGrant(state, seat) || !canManage(state, k) || !own(state, "people", "seats"))
        return state;
      if (seatClash(state.PEOPLE, k, seat).length) return state;
      const was = SEAT[state.PEOPLE[k].seat as SeatKey];
      const had = !!state.CAPS[k];
      const PEOPLE = setPerson(state, k, { seat });
      const CAPS = { ...state.CAPS };
      delete CAPS[k];
      const d = draftOf(state);
      log(state, d, "Changed seat", null,
        P(state.PEOPLE, k).n + ": " + was + " → " + SEAT[seat] + (had ? " (overrides cleared)" : ""),
        "admin", k);
      /* the seat is read off the person, so the signed-in person's own ROLE follows it */
      return {
        ...state, PEOPLE, CAPS, LOG: d.LOG, TEMP: d.TEMP,
        ROLE: k === state.WHO ? seat : state.ROLE,
      };
    }

    /* capSave(k,p,c) — ir-console-redesigned.html:3036-3050. The write itself, once the "cap"
       drawer (registerDrawer("p:cap", …), src/features/people/drawers.tsx) has said what it
       costs; every refusal the drawer's own opening already made is made again here, because the
       drawer can sit open while the person it is about is moved or reseated. The grid's tick
       dispatches the shell's generic `openDrawer` directly now (toggleCap — 3026 — only ever
       opened the drawer, never wrote), so this case is reached from nowhere but the drawer's own
       confirm button.

       `action.c === ""` is resetCap(k,p) — ir-console-redesigned.html:3052-3057, the per-page
       undo the "Reset this page to role" button dispatches. "" is never a real `Cap` (@/domain),
       so it can never collide with an actual toggle; reusing this action's own `c: string` field
       is what lets the per-page reset exist without a new action name in store.tsx, a file this
       agent does not own — see crossOwnerRequests: store.tsx should grow a dedicated `capSave`/
       `resetCap` pair so this reuse (and "toggleCap"'s now-inaccurate name for a write) can be
       retired. */
    case "toggleCap": {
      const { k, p } = action;
      if (!canManage(state, k) || !own(state, "people", "seats") || p === "me") return state;

      if (action.c === "") {
        const grid = { ...(state.CAPS[k] as CapGrid) };
        if (!grid[p]) return state;
        delete grid[p];
        const CAPS = { ...state.CAPS };
        if (Object.keys(grid).length) CAPS[k] = grid; else delete CAPS[k];
        const d = draftOf(state);
        log(state, d, "Put access back to the seat", null,
          P(state.PEOPLE, k).n + " · " + PAGECAPS[p]!.t, "admin", k);
        return { ...state, CAPS, LOG: d.LOG, TEMP: d.TEMP };
      }

      const c = action.c as Cap;
      /* the TARGET's role ceiling — never the actor's own capsBase — so a refused tick cannot
         write even when the acting admin holds the capability themselves. */
      if (!roleAllowsCap(state, k, p, c)) return state;
      if (reachCeil(state.PEOPLE, k).indexOf(p) < 0) return state;
      if (!capsBase(state, state.WHO, p).includes(c)) return state;
      const was = consoleAccount(state.PEOPLE, k, state.CAPS);
      const cur = capsFor(state, k, p).slice();
      const i = cur.indexOf(c);
      if (i >= 0) cur.splice(i, 1); else cur.push(c);
      if (c === "view" && i >= 0) cur.length = 0;       /* no capability survives losing the page */
      else if (c !== "view" && !cur.includes("view")) cur.push("view");
      const CAPS = { ...state.CAPS, [k]: { ...(state.CAPS[k] as CapGrid), [p]: cur } };
      const d = draftOf(state);
      log(state, d, "Changed access", null,
        P(state.PEOPLE, k).n + " · " + PAGECAPS[p]!.t + " · " + (i >= 0 ? "removed " : "added ") + CAPT[c],
        "admin", k);
      /* a granted-only seat crossing the line either way is its own fact, and the log says so */
      if (was !== consoleAccount(state.PEOPLE, k, CAPS))
        log(state, d, was ? "Console access ended" : "Console access granted", null,
          P(state.PEOPLE, k).n + (was ? " · no page left granted" : " · first page granted: " + PAGECAPS[p]!.t), "admin", k);
      return { ...state, CAPS, LOG: d.LOG, TEMP: d.TEMP, DRW: { k: "person", id: k } };
    }

    /* resetCaps(k) — 03-app.js:366 */
    case "resetCaps": {
      const k = action.k;
      if (!canManage(state, k) || !own(state, "people", "seats")) return state;
      const CAPS = { ...state.CAPS };
      delete CAPS[k];
      const d = draftOf(state);
      log(state, d, "Reset access to the seat preset", null, P(state.PEOPLE, k).n + " · every page", "admin", k);
      return { ...state, CAPS, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* ===== PROFILE =========================================================================== */

    /* setMe(f,v) — 03-app.js:5024. Three fields, and each has to survive whatever is typed into it:
       a blank name would erase somebody from every list, and blank initials would empty the badge
       the whole colour system leans on. */
    case "setMe": {
      const f = action.f;
      const me = state.WHO;
      const p = state.PEOPLE[me];
      if (!p || ["n", "ph", "i"].indexOf(f) < 0) return state;
      const v = String(action.v == null ? "" : action.v).trim();
      const was = (p as unknown as Record<string, string>)[f];
      let next: string;
      if (f === "n") {
        if (v.length < 2) return state;
        next = v.slice(0, 40);
      } else if (f === "i") {
        const t = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);
        if (!t) return state;
        next = t;
      } else {
        next = v.slice(0, 24);
      }
      if (next === was) return state;
      const PEOPLE = setPerson(state, me, { [f]: next } as Partial<Person>);
      const d = draftOf(state);
      log(state, d, "Changed their own details", null,
        ({ n: "Display name", i: "Initials", ph: "Mobile" } as Record<string, string>)[f] +
          (f === "ph" ? " updated" : ": " + (was || "—") + " → " + next),
        "admin");
      return { ...state, PEOPLE, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setMyStyle(c,sq) — 03-app.js:5038 */
    case "setMyStyle": {
      const me = state.WHO;
      if (!state.PEOPLE[me]) return state;
      const c = Math.round(Number(action.c));
      if (!(c >= 1 && c <= 8)) return state;
      const PEOPLE = setPerson(state, me, { c: c as Person["c"], sq: !!action.sq });
      const d = draftOf(state);
      log(state, d, "Changed their own badge", null, P(state.PEOPLE, me).n, "admin");
      return { ...state, PEOPLE, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* ===== THE ROSTER ======================================================================== */

    /* setAvail(k,why,from,to) — 03-app.js:858. Every toggle is logged: who, when, why. */
    case "setAvail": {
      const k = action.k;
      if (!canRosterFor(state, k) || !state.PEOPLE[k] || gone(state, k)) return state;
      const d = draftOf(state);
      /* absRec(k) — a leaver is handled above, so the record is the roster's own or nothing */
      if (state.AVAIL[k]) {
        const was = state.AVAIL[k] ? state.AVAIL[k].why : "out";
        const AVAIL = { ...state.AVAIL };
        delete AVAIL[k];
        const cov = endCoverFor({ ...state, AVAIL }, d, k);
        log(state, d, "Marked available", null,
          P(state.PEOPLE, k).n + " is back (was " + was + ")", "roster");
        return { ...state, AVAIL, ...cov, LOG: d.LOG, TEMP: d.TEMP };
      }
      let f = isoDay.test(action.from || "") ? (action.from as string) : iso(state.NOW);
      const fd = dOf(f);
      if (fd && fd < new Date(state.NOW.getFullYear(), state.NOW.getMonth(), state.NOW.getDate()))
        f = iso(state.NOW);                       /* leave already taken is not leave to record */
      let t = isoDay.test(action.to || "") ? (action.to as string) : iso(dAdd(dOf(f) as Date, 1));
      if ((dOf(t) as Date) <= (dOf(f) as Date)) t = iso(dAdd(dOf(f) as Date, 1));
      const why = action.why || OUTWHY[0];
      const AVAIL = {
        ...state.AVAIL,
        [k]: { why, from: f, to: t, by: state.WHO, at: stamp(nowT(state.NOW)) },
      };
      log(state, d, "Marked unavailable", null,
        P(state.PEOPLE, k).n + " — " + why + ", " + dISOtoDisp(f, state.NOW) + " to " +
          dISOtoDisp(t, state.NOW),
        "roster");
      return { ...state, AVAIL, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setOutWhy(k,why) — 03-app.js:897 */
    case "setOutWhy": {
      const k = action.k;
      const a = state.AVAIL[k];
      if (!canRosterFor(state, k) || !a || gone(state, k) ||
          !(OUTWHY as readonly string[]).includes(action.why)) return state;
      const was = a.why;
      const AVAIL = {
        ...state.AVAIL,
        [k]: { ...a, why: action.why, by: state.WHO, at: stamp(nowT(state.NOW)) },
      };
      const d = draftOf(state);
      log(state, d, "Changed absence reason", null,
        P(state.PEOPLE, k).n + ": " + was + " → " + action.why, "roster");
      return { ...state, AVAIL, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setOutTo(k,to) — 03-app.js:902. The day back cannot be the day out, or before. */
    case "setOutTo": {
      const k = action.k;
      const a = state.AVAIL[k];
      if (!canRosterFor(state, k) || !a || gone(state, k) || !isoDay.test(action.to || ""))
        return state;
      if ((dOf(action.to) as Date) <= (dOf(a.from) as Date)) return state;
      const AVAIL = {
        ...state.AVAIL,
        [k]: { ...a, to: action.to, by: state.WHO, at: stamp(nowT(state.NOW)) },
      };
      const d = draftOf(state);
      log(state, d, "Set expected return", null,
        P(state.PEOPLE, k).n + " back " + dISOtoDisp(action.to, state.NOW), "roster");
      return { ...state, AVAIL, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setOutFrom(k,from) — 03-app.js:908 */
    case "setOutFrom": {
      const k = action.k;
      const a = state.AVAIL[k];
      if (!canRosterFor(state, k) || !a || gone(state, k) || !isoDay.test(action.from || ""))
        return state;
      const from = action.from;
      if ((dOf(from) as Date) <
          new Date(state.NOW.getFullYear(), state.NOW.getMonth(), state.NOW.getDate()))
        return state;                             /* leave already taken is not leave to plan */
      const to =
        (dOf(a.to) as Date) <= (dOf(from) as Date) ? iso(dAdd(dOf(from) as Date, 1)) : a.to;
      const AVAIL = {
        ...state.AVAIL,
        [k]: { ...a, from, to, by: state.WHO, at: stamp(nowT(state.NOW)) },
      };
      const d = draftOf(state);
      log(state, d, "Set the leave window", null,
        P(state.PEOPLE, k).n + " " + dISOtoDisp(from, state.NOW) + " to " +
          dISOtoDisp(to, state.NOW),
        "roster");
      return { ...state, AVAIL, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* ===== LENDING A PAGE, AND TAKING IT BACK ================================================ */

    /* tSet(f,v) — 03-app.js:5589. Seeing it is the floor, so `view` is always on the draft. */
    case "tSet": {
      const T = tgt(state);
      if (action.f === "cap") {
        const caps = T.caps.slice();
        const i = caps.indexOf(action.v as Cap);
        if (i >= 0) caps.splice(i, 1); else caps.push(action.v as Cap);
        if (!caps.includes("view")) caps.push("view");
        return withUi(state, { TGT: { ...T, caps } });
      }
      /* `to` and `page` come off a <select>, whose empty option is "", and the prototype's call
         sites pass `this.value||null`; `dur` and `why` are always a string. */
      const v = action.f === "to" || action.f === "page" ? action.v || null : action.v;
      const next = { ...T, [action.f]: v } as TempDraft;
      if (action.f === "page") next.caps = ["view"];
      return withUi(state, { TGT: next });
    }

    /* startTemp(to) — 03-app.js:5595. Granting from a member's drawer while on Members does not
       switch the tab underneath — the drawer that opens is enough. */
    case "startTemp": {
      if (!own(state, "people", "seats")) return state;   /* tCanLend() */
      return {
        ...withUi(state, { TGT: { ...TGT0, to: action.to || null } }),
        DRW: { k: "temp", id: null },
      };
    }

    /* grantTemp() — 03-app.js:5598. Never more than the lender holds, and never anything borrowed
       onward: the caps are filtered against capsBase, which is the seat and the chain and nothing
       switched on. */
    case "grantTemp": {
      if (!own(state, "people", "seats")) return state;
      const T = tgt(state);
      const { to, page, dur, why } = T;
      if (!to || !consoleAccount(state.PEOPLE, to, state.CAPS) || to === state.WHO ||
          !canManage(state, to)) return state;
      if (!page || !(PAGECAPS as Record<string, unknown>)[page]) return state;
      if (!chainOf(state.PEOPLE, to).every(k => seatReach(state.PEOPLE, k).includes(page))) return state;
      if (state.PEOPLE[to].seat === "cp" && !["today", "leads", "updates", "add", "activity"].includes(page)) return state;
      if (!TDUR[dur]) return state;
      if (!(why || "").trim()) return state;
      const caps = [...new Set(T.caps.concat(["view" as Cap]))]
        .filter((c) => capsBase(state, state.WHO, page).includes(c));
      if (!caps.length) return state;
      const TSEQ = Math.max(2, ...state.TEMP.map(g => Number(/^T-(\d+)$/.exec(g.id)?.[1] || 0))) + 1;
      const days = TDUR[dur].days as number;
      const g: TempGrant = {
        id: "T-" + String(TSEQ).padStart(2, "0"),
        to, by: state.WHO, page: page as TempGrant["page"], caps,
        from: pinAccessDate(stamp(nowT(state.NOW)), state.NOW), until: pinAccessDate(plusDays(days, state.NOW), state.NOW),
        why: why.trim(), state: "live", acts: 0,
      };
      const d: Draft = { LOG: state.LOG, TEMP: [g, ...state.TEMP] };
      log(state, d, "Granted temporary access", null,
        P(state.PEOPLE, to).n + " · " + PAGECAPS[page as NavKey]!.t + " (" +
          caps.map((c) => CAPT[c]).join(", ") + ") · " + TDUR[dur].t + " · " + why.trim(),
        "admin");
      return {
        ...withUi(state, { TGT: TGT0, TSEQ }),
        LOG: d.LOG, TEMP: d.TEMP, DRW: null,
      };
    }

    /* revokeTemp(id) — 03-app.js:5613. Pulling it back erases nothing that was done under it. */
    case "revokeTemp": {
      const g = state.TEMP.find((x) => x.id === action.id);
      if (!g || g.state !== "live") return state;
      if (!(g.by === state.WHO || g.to === state.WHO ||
            (own(state, "people", "seats") && canManage(state, g.to)))) return state;
      const TEMP = state.TEMP.map((x) =>
        x.id === g.id
          ? { ...x, state: "revoked" as const, by2: state.WHO, on: stamp(nowT(state.NOW)) }
          : x);
      const TEMPON = state.TEMPON === action.id ? null : state.TEMPON;
      const d: Draft = { LOG: state.LOG, TEMP };
      log({ ...state, TEMPON }, d, "Revoked temporary access", null,
        P(state.PEOPLE, g.to).n + " · " + PAGECAPS[g.page as NavKey]!.t + " · " + (g.acts || 0) +
          " action" + ((g.acts || 0) === 1 ? "" : "s") +
          " recorded while it was on, and they stay recorded",
        "admin");
      return { ...state, TEMP: d.TEMP, LOG: d.LOG, TEMPON };
    }

    /* ===== THE PLAN ========================================================================== */

    /* bump(k,d,lo,hi) — 03-app.js:5909 */
    case "bump": {
      const k = action.k as PlanScalar;
      if (!may(state, "goals", "edit") || !PLANAT[k]) return state;
      const [grp, key] = PLANAT[k];
      const src = (grp
        ? (state.PLAN[grp] as unknown as Record<string, number>)
        : (state.PLAN as unknown as Record<string, number>));
      const was = src[key];
      const now = Math.max(action.lo, Math.min(action.hi, was + action.d));
      if (now === was) return state;
      const PLAN: Plan = grp
        ? ({ ...state.PLAN, [grp]: { ...src, [key]: now } } as unknown as Plan)
        : ({ ...state.PLAN, [key]: now } as unknown as Plan);
      const d = draftOf(state);
      log(state, d, "Changed the plan", null, k + ": " + was + " → " + now, "admin");
      return { ...state, PLAN, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setNum(pk,f,v) — 03-app.js:5925. A target of 50 is a number you type once, not fifty clicks.
       Each field says who may write it, because the manual keeps the target, the verified actual and
       the banked collection in three different pairs of hands. */
    case "setNum": {
      const f = action.f as "target" | "actual" | "coll";
      const PNUM: Record<string, { lbl: string; max: number; mul: number; ok: boolean; kind: ActKind }> = {
        target: { lbl: "target", max: 400, mul: 1, ok: may(state, "goals", "target"), kind: "admin" },
        actual: { lbl: "verified actual", max: 400, mul: 1, ok: isFin(state.ROLE), kind: "money" },
        coll: { lbl: "collections (₹ Cr)", max: 500, mul: 1e7, ok: isFin(state.ROLE), kind: "money" },
      };
      const def = PNUM[f];
      if (!def || !def.ok) return state;
      const p = period(state.PLAN, String(action.pk));
      if (!p) return state;
      const txt = String(action.v).trim().replace(/[,\s]/g, "");
      if (!/^\d+(\.\d+)?$/.test(txt)) return state;   /* junk, negatives and 1e9 change nothing */
      const raw = Number(txt);
      if (!Number.isFinite(raw)) return state;
      const n = Math.max(0, Math.min(def.max * def.mul, Math.round(raw * def.mul)));
      const was = (p as unknown as Record<string, number>)[f] || 0;
      if (n === was) return state;
      const PLAN = {
        ...state.PLAN,
        periods: state.PLAN.periods.map((x) => (x.k === p.k ? { ...x, [f]: n } : x)),
      };
      const d = draftOf(state);
      log(state, d,
        f === "target" ? "Changed the plan" : "Recorded a verified figure", null,
        p.t + " " + def.lbl + ": " +
          (f === "coll" ? crStr(was) + " → " + crStr(n) : was + " → " + n),
        def.kind);
      return { ...state, PLAN, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setTarget / setActual — 03-app.js:6006. Kept so a stepper, a keyboard shortcut or a test can
       still nudge one figure by one. */
    case "setTarget": {
      const p = period(state.PLAN, String(action.pk));
      return p
        ? pagesCReducer(state, {
            type: "setNum", pk: action.pk, f: "target", v: String((p.target || 0) + action.d),
          })
        : state;
    }
    case "setActual": {
      const p = period(state.PLAN, String(action.pk));
      return p
        ? pagesCReducer(state, {
            type: "setNum", pk: action.pk, f: "actual", v: String((p.actual || 0) + action.d),
          })
        : state;
    }

    /* setPeriodDate(pk,f,v) — 03-app.js:5939. A period is a window. Move the window and every
       figure in the row moves with it. */
    case "setPeriodDate": {
      const f = action.f as "from" | "to";
      if (!may(state, "goals", "edit") || !/^\d{4}-\d{2}-\d{2}$/.test(action.v || "")) return state;
      if (isNaN(new Date(action.v + "T00:00:00").getTime())) return state;
      if (f !== "from" && f !== "to") return state;
      const p = period(state.PLAN, String(action.pk));
      if (!p) return state;
      const was = p[f];
      const next = { ...p, [f]: action.v } as PlanPeriod;
      const a = new Date(next.from + "T00:00:00");
      const b = new Date(next.to + "T00:00:00");
      if (isNaN(a.getTime()) || isNaN(b.getTime()) || a > b) return state;
      const PLAN = {
        ...state.PLAN,
        periods: state.PLAN.periods.map((x) => (x.k === p.k ? next : x)),
      };
      const d = draftOf(state);
      log(state, d, "Changed a plan period", null, p.t + " " + f + ": " + was + " → " + action.v,
        "admin");
      return { ...state, PLAN, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setGrain(g) — 03-app.js:5960. Rebuilding keeps the total target and carries verified actuals
       into whichever new window contains them. */
    case "setGrain": {
      const g = action.g as Grain;
      if (!may(state, "goals", "edit") || !GRAINS[g] || !state.PLAN.periods.length) return state;
      const ps = state.PLAN.periods;
      const t0 = dOf(ps[0].from) || new Date(ps[0].from);
      const t1 = dOf(ps[ps.length - 1].to) || new Date(ps[ps.length - 1].to);
      const T = planTotals(state.PLAN);
      const out: PlanPeriod[] = [];
      const step = GRAINS[g];
      let PKEY = (state.ui.PKEY as number) ?? 0;
      let c = step.m ? new Date(t0.getFullYear(), t0.getMonth(), 1) : new Date(t0);
      let guard = 0;
      while (c <= t1 && guard++ < 80) {
        let e = step.m
          ? new Date(c.getFullYear(), c.getMonth() + step.m, 0)
          : new Date(c.getTime() + ((step.days as number) - 1) * 864e5);
        if (e > t1) e = new Date(t1);
        out.push({
          k: "p" + ++PKEY, t: pLabel(c, e, g, state.NOW), from: iso(c), to: iso(e),
          target: 0, actual: 0, coll: 0, emph: "",
        });
        c = step.m
          ? new Date(c.getFullYear(), c.getMonth() + step.m, 1)
          : new Date(e.getTime() + 864e5);
      }
      if (!out.length) return state;
      const per = Math.floor(T.target / out.length);
      let left = T.target - per * out.length;
      out.forEach((p) => { p.target = per + (left > 0 ? 1 : 0); if (left > 0) left--; });
      /* carry by the MIDPOINT of the old window: September ends on the 30th, which falls in a week
         that ends in October, and carrying by the end date moved September's actuals into October */
      ps.forEach((o) => {
        const a = dOf(o.from), b = dOf(o.to);
        if (!a || !b) return;
        const mid = new Date((a.getTime() + b.getTime()) / 2);
        const hit =
          out.find((p) => mid >= (dOf(p.from) as Date) && mid <= (dOf(p.to) as Date)) ||
          out.find((p) => a >= (dOf(p.from) as Date) && a <= (dOf(p.to) as Date)) ||
          out[out.length - 1];
        hit.actual += o.actual || 0;
        hit.coll += o.coll || 0;
      });
      const PLAN = { ...state.PLAN, grain: g, periods: out };
      const d = draftOf(state);
      log(state, d, "Changed the plan granularity", null,
        GRAINS[g].t + " · " + out.length + " periods, total target kept at " + T.target, "admin");
      return { ...withUi(state, { PKEY }), PLAN, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* addPeriod() — 03-app.js:5994 */
    case "addPeriod": {
      if (!may(state, "goals", "edit")) return state;
      const ps = state.PLAN.periods;
      const last = ps[ps.length - 1];
      const step = GRAINS[state.PLAN.grain] || GRAINS.month;
      const a = last
        ? new Date((dOf(last.to) as Date).getTime() + 864e5)
        : new Date(state.NOW.getFullYear(), state.NOW.getMonth(), 1);
      const b = step.m
        ? new Date(a.getFullYear(), a.getMonth() + step.m, 0)
        : new Date(a.getTime() + ((step.days as number) - 1) * 864e5);
      const PKEY = ((state.ui.PKEY as number) ?? 0) + 1;
      const p: PlanPeriod = {
        k: "p" + PKEY, t: pLabel(a, b, state.PLAN.grain, state.NOW),
        from: iso(a), to: iso(b), target: 0, actual: 0, coll: 0, emph: "",
      };
      const PLAN = { ...state.PLAN, periods: [...ps, p] };
      const d = draftOf(state);
      log(state, d, "Added a plan period", null, p.t, "admin");
      return { ...withUi(state, { PKEY }), PLAN, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* dropPeriod(pk) — 03-app.js:6010 */
    case "dropPeriod": {
      if (!may(state, "goals", "edit") || state.PLAN.periods.length <= 1) return state;
      const p = period(state.PLAN, String(action.pk));
      if (!p) return state;
      const PLAN = { ...state.PLAN, periods: state.PLAN.periods.filter((x) => x.k !== p.k) };
      const d = draftOf(state);
      log(state, d, "Removed a plan period", null, p.t, "admin");
      return { ...state, PLAN, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* setBaseline(d,why) — 03-app.js:6026. "Re-baseline only with recorded reason/approval" —
       manual Table 26. So it asks, from a closed list, exactly the way a reassignment does. */
    case "setBaseline": {
      if (!isFin(state.ROLE)) return state;
      if (!(BASEWHY as readonly string[]).includes(action.why))
        return withUi(state, { ASKB: true, BASED: action.d });
      const was = state.PLAN.baseline.units;
      const units = Math.max(0, Math.min(400, was + (action.d || based(state))));
      const next = withUi(state, { ASKB: false });
      if (units === was) return next;
      const PLAN = { ...state.PLAN, baseline: { ...state.PLAN.baseline, units } };
      const d = draftOf(state);
      log(state, d, "Re-baselined", null, was + " → " + units + " units · " + action.why, "money");
      return { ...next, PLAN, LOG: d.LOG, TEMP: d.TEMP };
    }

    /* ===== RECOVERY ACTIONS — one owner, one action, one date. 03-app.js:4135 ================ */

    case "setRecov": {
      if (!may(state, "goals", "edit")) return state;   /* canRecov() */
      const { k, act, who, days } = action;
      if (!kpis(state).some((m) => m.k === k) ||
          !(RECOVACTS as readonly string[]).includes(act) ||
          !state.PEOPLE[who] || !state.PEOPLE[who].on) return state;
      const by = plusDays(days, state.NOW);
      const RECOV = {
        ...state.RECOV,
        [k]: { who, act: act as RecovAction, by, at: stamp(nowT(state.NOW)), set: state.WHO },
      };
      const d = draftOf(state);
      log(state, d, "Set a recovery action", null,
        k + ": " + act + " · " + P(state.PEOPLE, who).n + " by " + by, "admin");
      return { ...state, RECOV, LOG: d.LOG, TEMP: d.TEMP };
    }

    case "clearRecov": {
      if (!may(state, "goals", "edit") || !state.RECOV[action.k]) return state;
      const a = state.RECOV[action.k].act;
      const RECOV = { ...state.RECOV };
      delete RECOV[action.k];
      const d = draftOf(state);
      log(state, d, "Cleared a recovery action", null, action.k + ": " + a, "admin");
      return { ...state, RECOV, LOG: d.LOG, TEMP: d.TEMP };
    }

    default:
      return null;
  }
}

/* the total the Plan's reconciliation line reads, in ₹ — kept here so the page and the reducer
   agree about what a unit is worth. 03-app.js:5720 */
export const planCr = (units: number): string => crStr(units * UNIT);
