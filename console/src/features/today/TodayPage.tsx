"use client";

/* ── TODAY — vTodayWork, ir-console-redesigned.html 6830–6871; Finance's day, vFinanceToday,
   6821–6829. The daily list stopped being a card feed and became two panes: a queue sorted into
   Due now / All open (plus Upcoming/Waiting behind Filters), and beside it the investor picked out
   of that queue — their next action, how to reach them, and what happened last. Working a batch of
   calls no longer means leaving the page once per name.

   Finance's day is a different shape again (vFinanceToday, 6821): every open, unlost, un-onboarded
   lead sorts into exactly one bucket — a reported payment, paperwork Finance owes, a reservation
   clock, or everything else — because Finance's part of the ladder is four things, not a queue.

   `vGap`/`vMyWeeklyWork`/`vDayside`/`vBookMini` are unchanged in substance from D39 and live on in
   `./Gap` and `./DaySide`; here they are folded into one collapsed "Your week" /
   "Weekly progress & planning" disclosure under the queue, exactly where vTodayWork's own
   `weekly()` puts them (6844).

   Round 2: `nextUp()` now carries "claim"/"followup" record kinds, `workAction()` below reads the
   claim branch straight off `u.rec.kind==="claim"`, and every "Record follow-up"/"Record visit"
   opens the registered `"p:followup"` drawer (`@/features/leads/followupDrawer`) seeded with a
   `FollowupDraft`, in place of the old "touch" stand-in. "Interest" now reads `knownUnitIntent(l)`
   ("Not discussed" when unset) and Finance's claim rows/hold balances read `refTxt()`/
   `knownUnitIntent()` for the masked reference and the D42 gate.

   Known gaps still forced by what other owners' files export — see the hand-back's
   crossOwnerRequests:
     — "Record permission" and "Details & permission" both open the plain `details` drawer
       (`src/features/lead/drawers/call.tsx`, not this feature's); the prototype's
       `openDetails(id,'consent')` seeds a specific tab that drawer does not expose yet.
     — `confirmClaim` in `@/features/pay/reducer.ts` still runs the ordinary receipt path (records
       money) instead of only matching an existing receipt — see crossOwnerRequests.

   Round 3: `XferRow.ack` and `CHECKS`'s `"transfer"` owner now exist, so Finance's own
   "Investor entry status" disclosure (6829) is no longer blocked — `xferRows()`/`xOwner()` live in
   `./work.ts`, next to `financeTodayWork`, since `@/features/xfer/XferPage.tsx`'s own `xferRows()`
   is private to that module.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { CHAN, LADDER, ST, TOUCHCHANNELS, TOUCHDONE, UNIT } from "@/domain";
import type { Channel, Lead, LogEntry } from "@/domain";
import { dAdd, dISO, dISOtoDisp, money } from "@/lib/format";
import {
  canAssign,
  canClaim,
  canOperateLeads,
  canPlan,
  canReach,
  canSee,
  canWork,
  chanOf,
  claimBlock,
  claimOf,
  conFor,
  covOf,
  acting,
  gateMet,
  gateWait,
  hasNext,
  inReservation,
  isFin,
  isIR,
  knownUnitIntent,
  logReadable,
  movesWaiting,
  myWork,
  nextUp,
  noNext,
  nxTime,
  nxWhen,
  openable,
  P,
  payOf,
  refTxt,
  scopeOf,
  seesTeam,
  stepOwner,
  suppOK,
  teamBook,
  todayList,
} from "@/lib/selectors";
import type { DrawerKind } from "@/lib/store";
import { useConsole } from "@/lib/store";
import type { ConsoleState } from "@/lib/store";
import { useLogTouch, type Refusal } from "@/features/leads/actions";
import { useGoLead, useGoView } from "@/features/leads/nav";
import { uiHorizon, uiTchan } from "@/features/leads/ui";
import { buildFollowupDraft } from "@/features/leads/followupDrawer";
import { DaySide } from "./DaySide";
import { Gap } from "./Gap";
import { Horizon } from "./Horizon";
import {
  claimReceiptMatch,
  claimReportLabel,
  financeTodayWork,
  fuHeard,
  fuLatest,
  FUCHANNELS,
  latestNote,
  partnerLabel,
  primaryWorkChannel,
  WORK_GROUPS,
  workGroup,
  workList,
  waNum,
  xferRows,
  xOwner,
} from "./work";
import type { WorkGroupKey } from "./work";
import "@/features/lead/drawers";   /* register the lead drawers before anything opens one */
import "@/features/leads/followupDrawer"; /* registers p:followup before a follow-up button can open it */

export function TodayPage() {
  const { state } = useConsole();
  if (isFin(state.ROLE)) return <FinanceToday />;
  return <WorkToday />;
}

/* ===== the IR/manager day — the queue and the investor beside it ============================ */

/* WORKNOTICE — workNotice()/setWorkNotice()/undoWorkNotice(), 6716-6724. A short-lived confirmation
   left where the click happened, offered back with an Undo. Kept local to the page (not the store):
   the prototype's own `commit()`/save-queue plumbing behind `rescheduleWork()` is cross-owner
   (`@/features/leads/reducer.ts`), so the undo here replays the old next step through the already-
   exported `saveNext` action rather than a bespoke reducer case — see the file header. */
type WorkNotice = { message: string; undo?: () => void };

function WorkToday() {
  const { state, dispatch } = useConsole();
  const goView = useGoView();
  const logTouch = useLogTouch();
  const [refusal, setRefusal] = useState<Refusal>(null);
  const [workSelect, setWorkSelect] = useState<string | null>(null);
  const [group, setGroup] = useState<WorkGroupKey>("today");
  const [notice, setNotice] = useState<WorkNotice | null>(null);

  const team = !["ir", "cp"].includes(state.ROLE) && scopeOf(state, "today") === "team";
  const HORIZON = uiHorizon(state.ui);
  const TCHAN = uiTchan(state.ui);
  const all = todayList(state);
  const book = team ? teamBook(state) : myWork(state);
  const list = workList(state, all, group, TCHAN);
  const selected = list.find((l) => l.id === workSelect) ?? list[0] ?? null;
  const now = all.filter((l) => ["overdue", "today"].includes(workGroup(state, l))).length;
  const counts = Object.fromEntries(
    WORK_GROUPS.map((g) => [g.k, all.filter((l) => g.accepts.includes(workGroup(state, l))).length]),
  ) as Record<WorkGroupKey, number>;
  const advanced = !!TCHAN || group === "upcoming" || group === "waiting";
  const teamCount = !team && seesTeam(state) ? todayList(state, "team").length : 0;
  const setChannel = (c: string | null) => dispatch({ type: "setUi", patch: { TCHAN: c } });
  const back = () => dispatch({ type: "setUi", patch: { HORIZON: "today", CALDAY: null } });

  /* selectWork(id) — 6708. Ignores an id the queue would never show (a stale click after the
     record left `openable()`), then, below the layout's 1180px breakpoint where the panel is no
     longer beside the queue, scrolls the investor panel into view and focuses it. */
  const selectWork = (id: string) => {
    if (!openable(state).some((l) => l.id === id)) return;
    setWorkSelect(id);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1180px)").matches) {
      const n = document.getElementById("work-context");
      if (n) {
        n.scrollIntoView({ block: "start", behavior: "smooth" });
        n.focus();
      }
    }
  };

  /* WORKNOTICE/WORKADVANCE — the followup drawer's save (`@/features/leads/followupDrawer.tsx`) has
     no reach into this component's local `notice`/`workSelect` state, so it hands off through a
     pair of generic `ui` fields: a message for the usual `.work-notice`, and — for "Save and next
     investor" — the id just saved, so the panel moves to whoever follows it in the list instead of
     falling back to the list's first row. selectNextInvestorAfterFollowup, 6734. */
  useEffect(() => {
    const msg = state.ui.WORKNOTICE as string | null | undefined;
    if (!msg) return;
    setNotice({ message: msg });
    dispatch({ type: "setUi", patch: { WORKNOTICE: null } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ui.WORKNOTICE]);

  useEffect(() => {
    const savedId = state.ui.WORKADVANCE as string | null | undefined;
    if (!savedId) return;
    const idx = list.findIndex((l) => l.id === savedId);
    const rest = list.filter((l) => l.id !== savedId);
    const next = (idx >= 0 ? list.slice(idx + 1).find((l) => l.id !== savedId) : undefined) ?? rest[0];
    setWorkSelect(next ? next.id : null);
    dispatch({ type: "setUi", patch: { WORKADVANCE: null } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ui.WORKADVANCE]);

  const workNotice = notice ? (
    <div className="work-notice" role="status">
      <span>{notice.message}</span>
      {notice.undo ? (
        <button
          type="button"
          className="chip"
          onClick={() => {
            notice.undo!();
            setNotice(null);
          }}
        >
          Undo
        </button>
      ) : null}
      <button type="button" className="btn" aria-label="Dismiss notification" onClick={() => setNotice(null)}>
        <Icon name="x" />
      </button>
    </div>
  ) : null;

  const heading = (
    <div className="ph work-page-head">
      <div>
        <h1>
          {HORIZON === "today"
            ? team
              ? "Team follow-ups"
              : "Your follow-ups"
            : "Follow-up calendar"}
        </h1>
        <p className="sub">
          {all.length
            ? now + " due now · " + all.length + " active investors"
            : team
              ? "Follow-ups and next steps for your team's investors."
              : "Follow-ups and next steps for your investors."}
        </p>
      </div>
      <div className="sp" />
      {HORIZON !== "today" ? (
        <div className="ux-primary">
          <button type="button" className="btn" onClick={back}>
            <Icon name="back" />
            Daily list
          </button>
          <select
            className="sel"
            aria-label="Calendar range"
            value={HORIZON}
            onChange={(e) => dispatch({ type: "setUi", patch: { HORIZON: e.target.value, CALDAY: null } })}
          >
            <option value="week">Next 7 days</option>
            <option value="month">Next 31 days</option>
          </select>
        </div>
      ) : all.length ? (
        <button
          type="button"
          className="btn"
          onClick={() => dispatch({ type: "setUi", patch: { HORIZON: "week", CALDAY: null } })}
        >
          <Icon name="events" />
          Calendar
        </button>
      ) : null}
    </div>
  );

  /* weekly() — 6839. `<div class="cb">${vGap(team)}${isIR()?"":vDayside(team)}</div>` — no
     `.colst` two-column wrapper: the cards stack, full width, exactly as `.cb`'s own plain padding
     leaves them. */
  const weekly = (
    <details className="ux-disclosure rd-weekly" data-ux-key="today-weekly">
      <summary>{isIR(state.ROLE) ? "Your week" : "Weekly progress & planning"}</summary>
      <div className="cb">
        <Gap team={team} onRefuse={setRefusal} />
        {isIR(state.ROLE) ? null : <DaySide team={team} />}
      </div>
    </details>
  );

  if (!all.length)
    return (
      <section className="rd-today" aria-label="Daily investor work">
        {heading}
        {workNotice}
        <section className="card ux-empty">
          <span className="rd-empty-icon" aria-hidden="true">
            <Icon name="leads" />
          </span>
          <h2>{team ? "No active investor work" : "No investors assigned to you"}</h2>
          <p>
            {team
              ? "Add an investor or assign an unowned lead to start the team's follow-ups."
              : teamCount
                ? "You can review and help with your team's follow-ups."
                : "Add your first investor to begin. Appointments and follow-ups will appear here automatically."}
          </p>
          <div className="ux-primary">
            {teamCount ? (
              <button
                type="button"
                className="act"
                onClick={() => dispatch({ type: "setScope", view: "today", to: "team" })}
              >
                View team follow-ups
              </button>
            ) : null}
            {canOperateLeads(state) ? (
              <button
                type="button"
                className={teamCount ? "btn" : "act"}
                onClick={() => dispatch({ type: "openDrawer", k: "p:add.quick" })}
              >
                Add {teamCount ? "investor" : "first investor"}
              </button>
            ) : null}
          </div>
        </section>
        {weekly}
      </section>
    );

  if (HORIZON !== "today")
    return (
      <section className="rd-today" aria-label="Daily investor work">
        {heading}
        {workNotice}
        <Horizon book={book} team={team} />
      </section>
    );

  return (
    <section className="rd-today" aria-label="Daily investor work">
      {heading}
      {workNotice}

      {team && movesWaiting(state).length ? (
        <div className="work-notice">
          <span>{movesWaiting(state).length} ownership requests need a decision.</span>
          <button type="button" className="chip" onClick={() => goView("leads")}>
            Review requests
          </button>
        </div>
      ) : null}

      {refusal ? (
        <div className="note bad" style={{ marginBottom: "10px" }} role="alert">
          {refusal}
        </div>
      ) : null}

      <div className="ux-toolbar rd-work-toolbar">
        <div className="ux-primary rd-work-tabs" role="group" aria-label="Daily work list">
          {(
            [
              ["today", "Due now"],
              ["all", "All open"],
            ] as const
          ).map(([k, t]) => {
            const sel = k === "today" ? group === "today" : group !== "today";
            return (
              <button
                type="button"
                key={k}
                className={`chip ${sel ? "on" : ""}`}
                aria-pressed={sel}
                onClick={() => setGroup(k)}
              >
                {t} <b>{counts[k]}</b>
              </button>
            );
          })}
        </div>
        <details className="ux-disclosure ux-inline-filter" data-ux-key="today-filters">
          <summary>Filters{advanced ? " · active" : ""}</summary>
          <div className="cb ux-filter-fields">
            <label className="fi">
              <span>Show follow-ups</span>
              <select
                className="selw"
                id="work-view"
                value={group}
                onChange={(e) => setGroup(e.target.value as WorkGroupKey)}
              >
                {WORK_GROUPS.map((g) => (
                  <option value={g.k} key={g.k}>
                    {g.t} · {counts[g.k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="fi">
              <span>Contact channel</span>
              <select className="selw" id="work-channel" value={TCHAN ?? ""} onChange={(e) => setChannel(e.target.value || null)}>
                <option value="">All channels</option>
                {Object.entries(CHAN).map(([c, t]) => (
                  <option value={c} key={c}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <p className="ux-secondary">Choose a channel when working through a batch of calls or messages.</p>
          </div>
        </details>
      </div>

      {advanced ? (
        <div className="ux-active-filters">
          <span className="ux-secondary">
            Showing{" "}
            {[
              group === "upcoming" || group === "waiting"
                ? WORK_GROUPS.find((g) => g.k === group)!.t
                : null,
              TCHAN ? CHAN[TCHAN as keyof typeof CHAN] : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button
            type="button"
            className="chip"
            onClick={() => {
              setChannel(null);
              setGroup(group === "today" ? "today" : "all");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : null}

      {list.length ? (
        <div className="work-layout">
          <section className="work-queue" id="work-queue" tabIndex={-1} aria-label="Investor follow-up queue">
            <div className="rd-queue-heading">
              <h2>
                {group === "today"
                  ? "Ready for your attention"
                  : group === "upcoming"
                    ? "Scheduled follow-ups"
                    : group === "waiting"
                      ? "Waiting on the next step"
                      : "Open relationships"}
              </h2>
              <span>
                {list.length} investor{list.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="work-rows">
              {list.map((l) => (
                <WorkRow
                  key={l.id}
                  l={l}
                  team={team}
                  selected={selected?.id === l.id}
                  onSelect={() => selectWork(l.id)}
                  logTouch={logTouch}
                  onRefuse={setRefusal}
                  onNotice={setNotice}
                />
              ))}
            </ul>
          </section>
          <InvestorPanel l={selected} logTouch={logTouch} onRefuse={setRefusal} onBack={() => setWorkSelect(null)} />
        </div>
      ) : (
        <section className="card ux-empty">
          <span className="rd-empty-icon" aria-hidden="true">
            <Icon name={group === "today" ? "today" : "events"} />
          </span>
          <h2>
            {TCHAN
              ? "No matching follow-ups"
              : group === "today"
                ? "You're up to date"
                : group === "upcoming"
                  ? "Nothing scheduled yet"
                  : "No matching investor work"}
          </h2>
          <p>
            {TCHAN
              ? "Clear the channel filter to see the selected work list."
              : group === "today"
                ? counts.upcoming
                  ? "Your next appointments are ready in All open."
                  : counts.waiting
                    ? "The remaining work is waiting on another team."
                    : "There are no overdue or due tasks to handle now."
                : "Use another work list, or set a next appointment from an investor's record."}
          </p>
          <div className="ux-primary">
            {TCHAN ? (
              <button type="button" className="act" onClick={() => setChannel(null)}>
                Clear channel filter
              </button>
            ) : group === "today" && counts.upcoming ? (
              <button type="button" className="act" onClick={() => setGroup("all")}>
                View all open investors
              </button>
            ) : group === "today" && counts.waiting ? (
              <button type="button" className="btn" onClick={() => setGroup("waiting")}>
                View waiting work
              </button>
            ) : group !== "all" ? (
              <button type="button" className="btn" onClick={() => setGroup("all")}>
                View active investors
              </button>
            ) : null}
          </div>
        </section>
      )}

      {weekly}
    </section>
  );
}

/* workAction(l,u) — 6765. What this lead needs next, said as one action — shared by the row and
   the panel. See the file header for the record kinds `nextUp()` cannot surface (claim/followup)
   and the "Record permission"/"Details & permission" simplification. */
function workAction(
  state: ConsoleState,
  dispatch: ReturnType<typeof useConsole>["dispatch"],
  goLead: (id: string, drawer?: DrawerKind) => void,
  l: Lead,
  onSelect?: () => void,
) {
  const u = nextUp(state, l);
  const rec = u.rec;
  if (!l.own && rec?.kind === "assign")
    return (
      <button type="button" className="act" onClick={() => dispatch({ type: "assign", id: l.id, to: state.WHO })}>
        Assign to me
      </button>
    );
  if (!l.own && canAssign(state))
    return (
      <button type="button" className="act" onClick={() => goLead(l.id, "owner")}>
        Assign owner
      </button>
    );
  if (rec?.kind === "consent" && canWork(state, l))
    return (
      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id, seed: { DTAB: "permission" } })}>
        Record permission
      </button>
    );
  if (rec?.kind === "paper")
    return (
      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "paper", id: l.id })}>
        {isFin(state.ROLE) ? u.act : "Review paperwork"}
      </button>
    );
  if (rec?.kind === "claim")
    return (
      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "claim", id: l.id })}>
        View payment status
      </button>
    );
  if (noNext(l) && canPlan(state, l))
    return (
      <button
        type="button"
        className="act"
        onClick={() => {
          dispatch({ type: "seedNext", id: l.id });
          dispatch({ type: "openDrawer", k: "next", id: l.id });
        }}
      >
        Set next step
      </button>
    );
  if (u.kind === "stage" && canWork(state, l) && stepOwner(state, l.done, l) && gateMet(state, l))
    return (
      <button type="button" className="act" onClick={() => dispatch({ type: "tick", id: l.id })}>
        Confirm {LADDER[l.done]?.t || "stage"}
      </button>
    );
  if (canWork(state, l))
    return (
      <button
        type="button"
        className="act"
        onClick={() => {
          onSelect?.();
          dispatch({
            type: "openDrawer",
            k: "p:followup" as DrawerKind,
            id: l.id,
            seed: { FU: buildFollowupDraft(state, l, chanOf(state, l)) },
          });
        }}
      >
        Record follow-up
      </button>
    );
  return (
    <button type="button" className="btn" onClick={() => goLead(l.id)}>
      View investor
    </button>
  );
}

/* afterContact(id,chan) — 3357. The dialer/WhatsApp links send nothing and record nothing; what
   they do instead is arm a one-shot "the tab got focus back" listener that offers the follow-up
   drawer, seeded to the channel just tapped. One listener at a time, exactly as the prototype's own
   single `CBACK` — a second tap replaces the first rather than stacking two.
   ponytail: reads `state`/`l` from the moment the link was tapped rather than re-fetching the
   freshest record the way the prototype's `back()` does (`LEADS.find(...)` at focus-return time);
   good enough for a return that, per the prototype's own 500ms guard, happens seconds later, not
   minutes. Revisit if a stale `canWork`/consent check on return turns out to matter. */
let CBACK: (() => void) | null = null;
function afterContact(
  dispatch: ReturnType<typeof useConsole>["dispatch"],
  state: ConsoleState,
  l: Lead,
  chan: Channel,
) {
  if (!canWork(state, l)) return;
  if (CBACK) {
    window.removeEventListener("focus", CBACK);
    CBACK = null;
  }
  const armed = Date.now();
  const back = () => {
    if (Date.now() - armed < 500) return;
    window.removeEventListener("focus", back);
    if (CBACK === back) CBACK = null;
    dispatch({
      type: "openDrawer",
      k: "p:followup" as DrawerKind,
      id: l.id,
      seed: { FU: buildFollowupDraft(state, l, chan) },
    });
  };
  CBACK = back;
  window.addEventListener("focus", back);
}

/* contactActions(l,compact,onlyChannel,excludeChannel) — 6735. tel:/wa.me/mailto links, gated
   exactly as leadReach() gates the number itself, plus the visit button — a record action, not a
   link — which opens the "p:followup" drawer the same way every other follow-up here does. Every
   link also selects the row (`WORKSELECT='<id>'`) and arms `afterContact` before it opens the
   dialer/WhatsApp/mailto. */
function ContactLinks({
  l,
  onlyChannel,
  excludeChannel,
  compact,
  onSelect,
}: {
  l: Lead;
  onlyChannel?: string | null;
  excludeChannel?: string | null;
  compact?: boolean;
  onSelect?: () => void;
}) {
  const { state, dispatch } = useConsole();
  if (!canWork(state, l)) return null;
  const num = waNum(l.ph);
  const cls = onlyChannel ? "act" : compact ? "chip" : "btn";
  const show = (k: string) => (!onlyChannel || onlyChannel === k) && excludeChannel !== k;
  const tap = (chan: Channel) => {
    onSelect?.();
    afterContact(dispatch, state, l, chan);
  };
  return (
    <div className="work-contact">
      {num && conFor(l, "call") && show("call") ? (
        <a className={cls} href={`tel:+${num}`} onClick={() => tap("call")} aria-label={`Call ${l.n}`}>
          <Icon name="call" />
          Call
        </a>
      ) : null}
      {num && conFor(l, "msg") && show("msg") ? (
        <a
          className={cls}
          href={`https://wa.me/${num}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => tap("msg")}
          aria-label={`WhatsApp ${l.n}`}
        >
          <Icon name="wa" />
          WhatsApp
        </a>
      ) : null}
      {l.em && conFor(l, "email") && show("email") ? (
        <a className={cls} href={`mailto:${l.em}`} onClick={() => tap("email")} aria-label={`Email ${l.n}`}>
          Email
        </a>
      ) : null}
      {conFor(l, "visit") && show("visit") ? (
        <button
          type="button"
          className={cls}
          onClick={() => {
            onSelect?.();
            dispatch({
              type: "openDrawer",
              k: "p:followup" as DrawerKind,
              id: l.id,
              seed: { FU: buildFollowupDraft(state, l, "visit") },
            });
          }}
          aria-label={`Record a visit with ${l.n}`}
        >
          <Icon name="events" />
          Record visit
        </button>
      ) : null}
    </div>
  );
}

function WorkRow({
  l,
  team,
  selected,
  onSelect,
  logTouch,
  onRefuse,
  onNotice,
}: {
  l: Lead;
  team: boolean;
  selected: boolean;
  onSelect: () => void;
  logTouch: (l: Lead, k: string) => Refusal;
  onRefuse: (r: Refusal) => void;
  onNotice: (n: WorkNotice) => void;
}) {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("today");
  const u = nextUp(state, l);
  const g = workGroup(state, l);
  const channel = primaryWorkChannel(state, l, u);
  const partner = partnerLabel(state, l);
  const touchRec = u.rec && u.rec.kind === "touch" ? u.rec : null;
  const [reschedule, setReschedule] = useState(false);
  /* rescheduleWork(id,days) — 6752. Pulls the dated step forward by `days`, keeping its hour, then
     offers it back with Undo — see WORKNOTICE at the top of this file for what the undo replays. */
  const rescheduleTo = (days: number) => {
    const was = l.nx;
    const at = dISOtoDisp(dISO(dAdd(state.NOW, days)), state.NOW);
    dispatch({ type: "moveNextTo", id: l.id, days });
    onNotice({
      message: `${l.n} rescheduled to ${at}${nxTime(l) ? " · " + nxTime(l) : ""}`,
      undo: was
        ? () => {
            dispatch({ type: "setUi", patch: { NXD: { t: was.t, d: was.d || "", tm: was.tm || "" } } });
            dispatch({ type: "saveNext", id: l.id });
          }
        : undefined,
    });
    setReschedule(false);
  };
  return (
    <li className={`work-row rd-work-row ${selected ? "is-selected" : ""}`} data-work-group={g}>
      <div className="ux-work-row-main">
        <div>
          <div className="work-row-head">
            <button type="button" className="work-name" id={`work-${l.id}`} aria-pressed={selected} onClick={onSelect}>
              {l.n}
            </button>
            <span className={`tag ${g === "overdue" ? "late" : g === "waiting" ? "br" : ""}`}>
              {g === "overdue" ? "Overdue" : g === "today" ? "Today" : g === "waiting" ? "Waiting" : "Upcoming"}
            </span>
          </div>
          <p className="work-reason">{u.t}</p>
          <div className="work-row-meta">
            <span>{LADDER[Math.max(0, l.done - 1)]!.t}</span>
            {partner ? <span>Partner: {partner}</span> : null}
            {hasNext(l) ? <span>{nxWhen(l)}</span> : null}
            {team && l.own ? <span>{P(state.PEOPLE, l.own).n}</span> : null}
            {covOf(state, l) && acting(state, l) === state.WHO ? <span className="tag cov">Covering</span> : null}
          </div>
        </div>
        <div className="work-row-actions">
          {channel ? (
            <ContactLinks l={l} onlyChannel={channel} compact onSelect={onSelect} />
          ) : (
            workAction(state, dispatch, goLead, l, onSelect)
          )}
        </div>
      </div>
      {canWork(state, l) ? (
        <details className="ux-work-more" data-ux-key={`work-actions-${l.id}`}>
          <summary>Follow-up options</summary>
          <div className="work-row-actions">
            <button
              type="button"
              className="btn"
              onClick={() =>
                dispatch({
                  type: "openDrawer",
                  k: "p:followup" as DrawerKind,
                  id: l.id,
                  seed: { FU: buildFollowupDraft(state, l, chanOf(state, l)) },
                })
              }
            >
              Record follow-up
            </button>
            {hasNext(l) && canPlan(state, l) ? (
              <button type="button" className="btn" aria-expanded={reschedule} onClick={() => setReschedule((v) => !v)}>
                Reschedule
              </button>
            ) : null}
            {touchRec && conFor(l, touchRec.k as Channel) ? (
              <button
                type="button"
                className="btn"
                aria-label={`Record already completed contact for ${l.n}`}
                onClick={() => onRefuse(logTouch(l, touchRec.k))}
              >
                Log {TOUCHDONE[touchRec.k as Channel].toLowerCase()}
              </button>
            ) : null}
          </div>
        </details>
      ) : null}
      {reschedule ? (
        <div className="work-reschedule">
          <span>Keep {nxTime(l) || "the current time"}, move to:</span>
          <button type="button" className="chip" onClick={() => rescheduleTo(1)}>
            Tomorrow
          </button>
          <button type="button" className="chip" onClick={() => rescheduleTo(3)}>
            In 3 days
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              dispatch({ type: "seedNext", id: l.id });
              dispatch({ type: "openDrawer", k: "next", id: l.id });
              setReschedule(false);
            }}
          >
            Choose date
          </button>
        </div>
      ) : null}
    </li>
  );
}

/* followupContext(l) — 6057. See the file header for what this approximates without a ported
   `INTERACTIONS`/`contactPreference`. */
function FollowupContext({ l }: { l: Lead }) {
  const { state } = useConsole();
  const last = fuLatest(state, l);
  const heard = fuHeard(state, l);
  const note = latestNote(state, l);
  return (
    <div className="fucontext">
      <div className="sm">
        <b>Last interaction</b>{" "}
        {last ? `${FUCHANNELS[last.channel] || last.channel} · ${last.outcome || "Recorded"} · ${last.at || ""}` : "No contact recorded"}
      </div>
      {heard ? (
        <div className="sm" style={{ marginTop: "7px" }}>
          <b>Previously raised</b> {heard.obj!.join(", ")} · {heard.at || ""}
        </div>
      ) : null}
      <div className="sm" style={{ marginTop: "7px" }}>
        <b>Latest note</b> {note || "No conversation note yet"}
      </div>
      <div className="sm" style={{ marginTop: "7px" }}>
        <b>Contact preference</b> No preferred contact time recorded
      </div>
    </div>
  );
}

function InvestorPanel({
  l,
  logTouch,
  onRefuse,
  onBack,
}: {
  l: Lead | null;
  logTouch: (l: Lead, k: string) => Refusal;
  onRefuse: (r: Refusal) => void;
  onBack: () => void;
}) {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("today");
  if (!l) return null;
  const u = nextUp(state, l);
  const blocked = gateWait(state, l);
  const channel = primaryWorkChannel(state, l, u);
  const otherChannels = canWork(state, l) && TOUCHCHANNELS.some((k) => k !== channel && conFor(l, k));
  return (
    <section className="work-context card" id="work-context" tabIndex={-1} aria-label={`${l.n} — investor context`}>
      <header className="ch">
        <div>
          <span className="work-eyebrow">Investor in focus</span>
          <h2>{l.n}</h2>
        </div>
        <div className="ux-primary">
          <button type="button" className="btn ux-mobile-only" onClick={onBack}>
            Back to list
          </button>
          <button type="button" className="btn" onClick={() => goLead(l.id)}>
            Full record <Icon name="next" />
          </button>
        </div>
      </header>
      <div className="cb">
        <div className="rd-work-facts">
          <div>
            <span>Current stage</span>
            <b>{LADDER[Math.max(0, l.done - 1)]!.t}</b>
          </div>
          <div>
            <span>Interest</span>
            <b>{knownUnitIntent(l) ? money(l.units * UNIT) : "Not discussed"}</b>
          </div>
        </div>
        <div className="work-next">
          <span className="work-eyebrow">Next action</span>
          <b>{u.t}</b>
          {hasNext(l) ? <span>{nxWhen(l)}</span> : null}
          <div className="rd-work-next-actions">
            {channel ? <ContactLinks l={l} onlyChannel={channel} /> : workAction(state, dispatch, goLead, l)}
            {channel && channel !== "visit" ? (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  dispatch({
                    type: "openDrawer",
                    k: "p:followup" as DrawerKind,
                    id: l.id,
                    seed: { FU: buildFollowupDraft(state, l, channel) },
                  })
                }
              >
                Record follow-up
              </button>
            ) : null}
          </div>
        </div>
        {blocked ? (
          <div className="work-blocker">
            <b>{blocked.who === "fin" ? "Finance is checking" : "Action needed"}</b>
            <p>{blocked.d}</p>
          </div>
        ) : null}
        <section className="rd-work-history" aria-label="Conversation context">
          <FollowupContext l={l} />
        </section>
        {canClaim(state, l) ? (
          <div className="work-panel-actions">
            <button
              type="button"
              className="chip"
              onClick={() =>
                dispatch({
                  type: "openDrawer",
                  k: "claim",
                  id: l.id,
                  seed: { CKIND: l.done >= ST.RESERVED ? "full" : "advance", CREF: "", CNOTE: "" },
                })
              }
            >
              Report payment
            </button>
          </div>
        ) : null}
        {otherChannels ? (
          <details className="ux-contact-options" data-ux-key={`work-contact-${l.id}`}>
            <summary>Other contact channels</summary>
            <ContactLinks l={l} excludeChannel={channel} />
          </details>
        ) : null}
        <div className="work-details-links">
          <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "history", id: l.id })}>
            Timeline
          </button>
          <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "notes", id: l.id })}>
            Notes
          </button>
          <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "paper", id: l.id })}>
            Documents
          </button>
          <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id })}>
            Details & permission
          </button>
        </div>
      </div>
    </section>
  );
}

/* ===== Finance's day — vFinanceToday. Four beats, not a queue. ============================== */

function FinanceToday() {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("today");
  const goView = useGoView();
  const HORIZON = uiHorizon(state.ui);
  const w = financeTodayWork(state);
  const count = w.claims.length + w.paper.length + w.holds.length;
  const back = () => dispatch({ type: "setUi", patch: { HORIZON: "today", CALDAY: null } });

  const heading = (
    <div className="ph">
      <div>
        <h1>{HORIZON === "today" ? "Finance work" : "Finance calendar"}</h1>
        <p className="sub">
          {HORIZON === "today"
            ? count
              ? count + " payment, paperwork and reservation items"
              : "No payment confirmations or paperwork waiting"
            : "Payment dates and reservation deadlines"}
        </p>
      </div>
      <div className="sp" />
      {HORIZON !== "today" ? (
        <div className="ux-primary">
          <button type="button" className="btn" onClick={back}>
            <Icon name="back" />
            Daily list
          </button>
          <select
            className="sel"
            aria-label="Calendar range"
            value={HORIZON}
            onChange={(e) => dispatch({ type: "setUi", patch: { HORIZON: e.target.value, CALDAY: null } })}
          >
            <option value="week">Next 7 days</option>
            <option value="month">Next 31 days</option>
          </select>
        </div>
      ) : w.book.length ? (
        <button
          type="button"
          className="btn"
          onClick={() => dispatch({ type: "setUi", patch: { HORIZON: "week", CALDAY: null } })}
        >
          <Icon name="events" />
          Calendar
        </button>
      ) : null}
    </div>
  );

  if (HORIZON !== "today")
    return (
      <section className="ux-finance-today">
        {heading}
        <Horizon book={w.book} team={false} />
      </section>
    );

  return (
    <section className="ux-finance-today">
      {heading}
      {count ? (
        <>
          <FinanceGroup
            id="finance-confirmations"
            title="Payment confirmations"
            count={w.claims.length}
            note="Match reports only to independently confirmed bank receipts. Matching answers the report without recording money."
          >
            {w.claims.map((l) => {
              const c = claimOf(state, l.id)!;
              const b = claimBlock(state, l);
              const match = claimReceiptMatch(state, l.id);
              const permitted = !!b?.answerable;
              return (
                <li className="ux-finance-row" key={l.id} data-finance-investor={l.id}>
                  <div>
                    <button type="button" className="work-name" onClick={() => goLead(l.id)}>
                      {l.n}
                    </button>
                    <p className="work-reason">
                      {claimReportLabel(state, c)} · {c.mode} <span className="mono">{refTxt(state, "claim:" + l.id)}</span>
                      <span className="ux-finance-detail">
                        {c.id} · {P(state.PEOPLE, c.by).n} · {c.at}
                      </span>
                      {c.note ? <span className="ux-finance-detail">{c.note}</span> : null}
                    </p>
                    {l.own ? <span className="ux-secondary">IR owner: {P(state.PEOPLE, l.own).n}</span> : null}
                  </div>
                  <div className="ux-primary">
                    {permitted && match.ok ? (
                      <button type="button" className="act" onClick={() => dispatch({ type: "confirmClaim", id: l.id })}>
                        Match recorded receipt
                      </button>
                    ) : (
                      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "claim", id: l.id })}>
                        Review report
                      </button>
                    )}
                    {permitted ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => dispatch({ type: "rejectClaim", id: l.id, why: "Not in the account yet" })}
                      >
                        Not found yet
                      </button>
                    ) : null}
                    {!suppOK(state, l) ? (
                      <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "paper", id: l.id })}>
                        Open paperwork
                      </button>
                    ) : (
                      <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "money", id: l.id })}>
                        Review payments
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </FinanceGroup>

          <FinanceGroup id="finance-paperwork" title="Paperwork waiting on Finance" count={w.paper.length}>
            {w.paper.map(({ l, p }) => (
              <li className="ux-finance-row" key={l.id} data-finance-investor={l.id}>
                <div>
                  <button type="button" className="work-name" onClick={() => goLead(l.id)}>
                    {l.n}
                  </button>
                  <p className="work-reason">
                    {p.R!.t} · {p.n.t}
                  </p>
                </div>
                <div className="ux-primary">
                  <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "paper", id: l.id })}>
                    {p.n.k === "sent" ? "Send document" : "Verify signature"}
                  </button>
                </div>
              </li>
            ))}
          </FinanceGroup>

          <FinanceGroup id="finance-reservations" title="Reservation clocks" count={w.holds.length}>
            {w.holds.map(({ l, left }) => {
              const pay = payOf(state, l.id);
              const balance =
                knownUnitIntent(l) && pay
                  ? money(Math.max(0, l.units * UNIT - pay.got)) + " balance"
                  : "Unit count not recorded";
              return (
                <li className="ux-finance-row" key={l.id} data-finance-investor={l.id}>
                  <div>
                    <button type="button" className="work-name" onClick={() => goLead(l.id)}>
                      {l.n}
                    </button>
                    <p className="work-reason">
                      {pay ? money(pay.got) : "₹0"} received · {balance}
                      {pay && pay.hold ? " · hold ends " + pay.hold : ""}
                    </p>
                  </div>
                  <div className="ux-primary">
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        dispatch({ type: "openDrawer", k: left !== null && left < 0 ? "hold" : "money", id: l.id })
                      }
                    >
                      {left !== null && left < 0 ? "Review lapsed hold" : "Review payment"}
                    </button>
                    {left !== null && (left < 0 || left <= 7) ? (
                      <span className={`tag ${left < 0 ? "late" : "due"}`}>{left < 0 ? "Lapsed" : left + "d left"}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </FinanceGroup>
        </>
      ) : (
        <section className="card ux-empty">
          <h2>{w.book.length ? "Finance tasks are up to date" : "No Finance work yet"}</h2>
          <p>
            {w.book.length
              ? "There are no reported payments or signatures waiting on Finance. Other investor work is below."
              : "Payment reports and document requests will appear here when investors reach those steps."}
          </p>
        </section>
      )}
      {w.other.length ? (
        <details className="ux-disclosure" data-ux-key="finance-other-work">
          <summary>Other investor work · {w.other.length}</summary>
          <ul className="ux-finance-rows">
            {w.other.map((l) => {
              const u = nextUp(state, l);
              const paper = u.rec?.kind === "paper";
              const pay = payOf(state, l.id);
              const moneyTask = l.done >= ST.CONVERTED && (!pay || pay.state !== "full");
              return (
                <li className="ux-finance-row" key={l.id} data-finance-investor={l.id}>
                  <div>
                    <button type="button" className="work-name" onClick={() => goLead(l.id)}>
                      {l.n}
                    </button>
                    <p className="work-reason">{u.t}</p>
                  </div>
                  <div className="ux-primary">
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        paper || moneyTask
                          ? dispatch({ type: "openDrawer", k: paper ? "paper" : "money", id: l.id })
                          : goLead(l.id)
                      }
                    >
                      {paper ? "Review paperwork" : moneyTask ? "Review payment" : "View investor"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      {xferRows(state).some((x) => !x.ack) ? (
        <details className="ux-disclosure" data-ux-key="finance-transfer-context">
          <summary>Investor entry status</summary>
          <div className="ux-section">
            <p className="ux-secondary">
              {xferRows(state).filter((x) => !x.ack).length} confirmed investor entries need acknowledgement from{" "}
              {P(state.PEOPLE, xOwner()).n}.
            </p>
            <button type="button" className="btn" onClick={() => goView("xfer")}>
              Review investor transfers
            </button>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function FinanceGroup({
  id,
  title,
  count,
  note,
  children,
}: {
  id: string;
  title: string;
  count: number;
  note?: string;
  children: React.ReactNode;
}) {
  if (!count) return null;
  return (
    <section className="card ux-finance-group" aria-labelledby={id}>
      <header className="ch">
        <h2 id={id}>{title}</h2>
        <span className="tag">{count}</span>
      </header>
      {note ? <p className="ux-secondary ux-finance-note">{note}</p> : null}
      <ul className="ux-finance-rows">{children}</ul>
    </section>
  );
}
