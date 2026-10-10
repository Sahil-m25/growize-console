"use client";

/* ── TODAY — vTodayWork, ir-merged.js:4290 (the merged prototype, D59 "g1"); Finance's day,
   vFinanceToday, ir-merged.js:4281. The queue is the page: one row per investor in the seat's own
   work (todayList — owned leads only), the investor in focus beside it (investorWorkPanel — the
   lead page's next-step card), and ONE fold ("Filters · your week" / "Filters · this week") that
   holds the list/channel choice and the week (vGap/vMyWeeklyWork + vDayside).

   Contact buttons (Call / WhatsApp / Email / Log a contact) hand over to the lead page's own
   logging flow (g1LeadFlow): they route to the lead and set `ui.LPFLOW = {id, what, channel}` for
   the lead page to open its flow on that channel, as the prototype's lpOpen() does. A paperwork
   chip (irPaperStep/goPaper) routes to the lead and sets `ui.LPFOCUS = id` so the lead page can
   bring its paperwork row into view.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import { Icon } from "@/components/ui";
import { CHAN, LADDER, ST } from "@/domain";
import type { Channel, Lead, LogEntry } from "@/domain";
import { dAdd, dISO, dISOtoDisp, money, whenT } from "@/lib/format";
import type { NextUp } from "@/lib/selectors";
import {
  active,
  lost,
  nxDue,
  paperNow,
  canAssign,
  canClaim,
  canOperateLeads,
  canPlan,
  canWork,
  claimBlock,
  claimOf,
  conFor,
  covOf,
  acting,
  gateMet,
  gateWait,
  hasNext,
  isFin,
  isIR,
  knownUnitIntent,
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
import { useGoLead, useGoView } from "@/features/leads/nav";
import { BalanceChase } from "./BalanceChase";
import { uiHorizon, uiTchan } from "@/features/leads/ui";
import { fuPreference } from "@/features/lead/followupContext";
import { useMoveNextTo } from "@/features/lead/followupWrites";
import { useApiMode } from "@/lib/data/api";
import { useJourneyWrites } from "@/lib/data/endpoints/journey";
import { useLeadNotes } from "@/lib/data/endpoints/record";
import { useAssignToMe } from "@/lib/data/endpoints/ownership";
import { DaySide } from "./DaySide";
import { Gap } from "./Gap";
import { Horizon } from "./Horizon";
import {
  claimReceiptMatch,
  claimReportLabel,
  financeTodayWork,
  fuLatest,
  FUCHANNELS,
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

export function TodayPage() {
  const { state } = useConsole();
  /* register the lead drawers (next, owner, details, claim, paper, history, …) after the first
     paint rather than before it: they are a large chunk and nothing opens one on arrival */
  useEffect(() => {
    void import("@/features/lead/drawers");
  }, []);
  if (isFin(state.ROLE)) return <FinanceToday />;
  return <WorkToday />;
}

/* ===== the IR/manager day — vTodayWork, ir-merged.js:4290 =================================== */

/* WORKNOTICE — workNotice()/setWorkNotice()/undoWorkNotice(). A short-lived confirmation left where
   the click happened, offered back with an Undo. Kept local to the page (not the store). */
type WorkNoticeData = { message: string; undo?: { id: string; nx: NonNullable<Lead["nx"]> } };
type Dispatch = ReturnType<typeof useConsole>["dispatch"];

/* The wired writes Today offers (ir-write-map.md C1–C3). Fixture: the reducer, as before. Live: the route, then
   reloadData() (inside each hook); a refusal is said in Today's notice line, in the route's words. */
type TodayWrites = { live: boolean; assign: (l: Lead) => void; tick: (l: Lead) => void };
function useTodayWrites(): TodayWrites {
  const { state, dispatch } = useConsole();
  const live = useApiMode() === "live";
  const { assign } = useAssignToMe();
  const jw = useJourneyWrites();
  const said = (r: { ok: true } | { ok: false; error: string }) => {
    if (live && !r.ok) dispatch({ type: "setUi", patch: { TODAYNOTICE: { message: r.error, who: state.WHO } } });
  };
  return { live, assign: (l) => void assign(l.id).then(said), tick: (l) => void jw.tick(l).then(said) };
}

/* g1LeadFlow(id,what,channel) — ir-merged.js:4215 (D59). Contact happens on the lead page's own
   flow (D57), so a Today button hands over to it rather than opening a second recording form.
   The lead page reads `ui.LPFLOW` ({id, what, channel}) the way the prototype's `lpOpen()` sets
   LPFLOW/LPFROM on arrival. */
function useLeadFlow() {
  const { dispatch } = useConsole();
  const goLead = useGoLead("today");
  return (id: string, what: "log" | "email", channel?: Channel) => {
    goLead(id);
    dispatch({ type: "setUi", patch: { LPFLOW: { id, what, channel: channel ?? null } } });
  };
}

/* goPaper(id) — ir-merged.js:3292. Open the lead with its paperwork row in view. */
function useGoPaper() {
  const { dispatch } = useConsole();
  const goLead = useGoLead("today");
  return (id: string) => {
    goLead(id);
    dispatch({ type: "setUi", patch: { LPFOCUS: id } });
  };
}

function WorkToday() {
  const { state, dispatch } = useConsole();
  const goView = useGoView();
  const goLeadChase = useGoLead("today");
  const moveNextTo = useMoveNextTo();
  const liveMode = useApiMode() === "live";
  /* WORKSELECT / TODAYGROUP / WORKRESCHEDULE / WORKNOTICE are the prototype's page globals; they
     live in `ui` so they survive the landing redirect ("/" draws Today, then becomes /today) */
  const ui = state.ui as Record<string, unknown>;
  const workSelect = (ui.WORKSELECT as string | null | undefined) ?? null;
  const group = ((ui.TODAYGROUP as WorkGroupKey | undefined) ?? "today") as WorkGroupKey;
  const reschedule = (ui.WORKRESCHEDULE as string | null | undefined) ?? null;
  const noticeRaw = ui.TODAYNOTICE as (WorkNoticeData & { who: string }) | null | undefined;
  const notice: WorkNoticeData | null = noticeRaw && noticeRaw.who === state.WHO ? noticeRaw : null;
  const setWorkSelect = (id: string | null) => dispatch({ type: "setUi", patch: { WORKSELECT: id } });
  const setGroup = (k: WorkGroupKey) => dispatch({ type: "setUi", patch: { TODAYGROUP: k } });
  const setReschedule = (f: string | null | ((r: string | null) => string | null)) =>
    dispatch({ type: "setUi", patch: { WORKRESCHEDULE: typeof f === "function" ? f(reschedule) : f } });
  const setNotice = (n: WorkNoticeData | null) =>
    dispatch({ type: "setUi", patch: { TODAYNOTICE: n ? { ...n, who: state.WHO } : null } });

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
  const advanced = !!TCHAN || group !== "today";
  const teamCount = !team && seesTeam(state) ? todayList(state, "team").length : 0;
  const ir = isIR(state.ROLE);
  const setChannel = (c: string | null) => dispatch({ type: "setUi", patch: { TCHAN: c } });
  const setWorkGroup = (k: WorkGroupKey) => {
    setGroup(k);
    setReschedule(null);
  };
  const back = () => dispatch({ type: "setUi", patch: { HORIZON: "today", CALDAY: null } });

  /* selectWork(id) — ir-merged.js:4144 */
  const selectWork = (id: string) => {
    if (!openable(state).some((l) => l.id === id)) return;
    setWorkSelect(id);
    setReschedule(null);
    if (typeof window !== "undefined" && window.matchMedia("(max-width:1180px)").matches) {
      const n = document.getElementById("work-context");
      if (n) {
        n.scrollIntoView({ block: "start", behavior: "smooth" });
        n.focus();
      }
    }
  };

  /* WORKNOTICE/WORKADVANCE — hand-offs from drawers that cannot reach this component's state. */
  useEffect(() => {
    const msg = state.ui.WORKNOTICE as string | null | undefined;
    if (!msg) return;
    dispatch({ type: "setUi", patch: { WORKNOTICE: null, TODAYNOTICE: { message: msg, who: state.WHO } } });
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

  /* rescheduleWork(id,days) — ir-merged.js:4187. Keeps the hour, moves the day, offers Undo. */
  /* C1 moveNextTo (features/lead/followupWrites): live POSTs /api/leads/[id]/next/move and re-reads; the Undo stays a fixture
     nicety (live has none: the step was moved in Zoho; moving it back is another move) */
  const rescheduleWork = (l: Lead, days: number) => {
    if (!canPlan(state, l) || !hasNext(l)) return;
    const was = l.nx!;
    const by = dISOtoDisp(dISO(dAdd(state.NOW, days)), state.NOW);
    const said = `${l.n} rescheduled to ${by}${nxTime(l) ? " · " + nxTime(l) : ""}`;
    setReschedule(null);
    void moveNextTo(l, days).then((r) => {
      if (!liveMode) setNotice({ message: said, undo: { id: l.id, nx: was } });
      else setNotice({ message: r.ok ? said : r.error });
    });
  };

  const workNotice = notice ? (
    <div className="work-notice" role="status">
      <span>{notice.message}</span>
      {notice.undo ? (
        <button
          type="button"
          className="chip"
          onClick={() => {
            const u = notice.undo!;
            dispatch({ type: "setUi", patch: { NXD: { t: u.nx.t, d: u.nx.d || "", tm: u.nx.tm || "", ch: u.nx.ch || "other" } } });
            dispatch({ type: "saveNext", id: u.id });
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

  /* D59 (g1): ONE fold holds everything rare — the list/channel choice and the week. */
  const more = (withFilters: boolean) => (
    <details className="ux-disclosure ux-inline-filter g1-more" data-ux-key="today-more">
      <summary>
        {withFilters ? "Filters · " : ""}
        {withFilters ? (ir ? "your week" : "this week") : ir ? "Your week" : "This week"}
      </summary>
      <div className="cb">
        {withFilters ? (
          <div className="ux-filter-fields g1-fields">
            <label className="fi">
              <span>Show follow-ups</span>
              <select
                className="selw"
                id="work-view"
                value={group}
                onChange={(e) => setWorkGroup(e.target.value as WorkGroupKey)}
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
          </div>
        ) : null}
        <div className="g1-week">
          <Gap team={team} onRefuse={() => undefined} />
          {ir ? null : <DaySide team={team} />}
        </div>
      </div>
    </details>
  );

  const heading = (fold: React.ReactNode) => (
    <div className="ph work-page-head g1-head">
      <div>
        <h1>{HORIZON === "today" ? (team ? "Team follow-ups" : "Your follow-ups") : "Follow-up calendar"}</h1>
        <p className="sub">
          {all.length
            ? now + " due now · " + all.length + " open"
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
      ) : (
        <>
          <button
            type="button"
            className="btn"
            onClick={() => dispatch({ type: "setUi", patch: { HORIZON: "week", CALDAY: null } })}
          >
            <Icon name="events" />
            Calendar
          </button>
          {fold}
        </>
      )}
    </div>
  );

  const page = (content: React.ReactNode) => (
    <section className="rd-today" aria-label="Daily investor work">
      {content}
    </section>
  );

  if (HORIZON !== "today")
    return page(
      <>
        {heading(null)}
        {workNotice}
        <Horizon book={book} team={team} />
      </>,
    );

  if (!all.length)
    return page(
      <>
        {heading(more(false))}
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
      </>,
    );

  const showing = [group !== "today" ? WORK_GROUPS.find((g) => g.k === group)!.t : null, TCHAN ? CHAN[TCHAN as keyof typeof CHAN] : null]
    .filter(Boolean)
    .join(" · ");

  return page(
    <>
      {heading(more(true))}
      {workNotice}
      {/* D137 ruling 3: after Reserved the IR chases the balance — one item per Reserved allotment with the balance still due */}
      {ir ? <BalanceChase onOpenLead={goLeadChase} /> : null}
      {team && movesWaiting(state).length ? (
        <div className="work-notice">
          <span>{movesWaiting(state).length} ownership requests need a decision.</span>
          <button type="button" className="chip" onClick={() => goView("leads")}>
            Review requests
          </button>
        </div>
      ) : null}
      {advanced ? (
        <div className="ux-active-filters g1-active">
          <span className="ux-secondary">Showing {showing}</span>
          <button
            type="button"
            className="chip"
            onClick={() => {
              setChannel(null);
              setWorkGroup("today");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : null}
      {list.length ? (
        <div className="work-layout">
          <section className="work-queue" id="work-queue" tabIndex={-1} aria-label="Investor follow-up queue">
            <ul className="work-rows">
              {list.map((l) => (
                <WorkRow key={l.id} l={l} team={team} selected={selected?.id === l.id} onSelect={() => selectWork(l.id)} />
              ))}
            </ul>
          </section>
          <InvestorPanel
            l={selected}
            rescheduling={!!selected && reschedule === selected.id}
            onToggleReschedule={(id) => setReschedule((r) => (r === id ? null : id))}
            onReschedule={rescheduleWork}
          />
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
              ? "Clear filters to see the rest of the list."
              : group === "today"
                ? counts.upcoming
                  ? "Your next appointments are ready in All open."
                  : counts.waiting
                    ? "The remaining work is waiting on another team."
                    : "There are no overdue or due tasks to handle now."
                : "Use another work list, or set a next appointment from an investor's record."}
          </p>
          <div className="ux-primary">
            {TCHAN ? null : group === "today" && counts.upcoming ? (
              <button type="button" className="act" onClick={() => setWorkGroup("all")}>
                View all open investors
              </button>
            ) : group === "today" && counts.waiting ? (
              <button type="button" className="btn" onClick={() => setWorkGroup("waiting")}>
                View waiting work
              </button>
            ) : group !== "all" ? (
              <button type="button" className="btn" onClick={() => setWorkGroup("all")}>
                View active investors
              </button>
            ) : null}
          </div>
        </section>
      )}
    </>,
  );
}

/* PRSTEP / irPaperStep(l) — ir-merged.js:3286. The IR's one paperwork step on this lead right now. */
const PRSTEP: Record<string, string> = {
  told: "Tell them it's sent",
  said: "Chase the signature",
  draft: "Send the draft",
  agreed: "Get the final draft agreed",
};
function irPaperStep(state: ConsoleState, l: Lead): { R: NonNullable<ReturnType<typeof paperNow>["R"]>; k: string; t: string } | null {
  const pn = paperNow(state, l);
  const k = pn.n && "k" in pn.n ? (pn.n.k as string) : "";
  const who = pn.n && "who" in pn.n ? (pn.n as { who?: string }).who : undefined;
  return pn.R && who === "IR" && canWork(state, l) && PRSTEP[k] ? { R: pn.R, k, t: PRSTEP[k]! } : null;
}

/* workAction(l,u) — ir-merged.js:4200. What this lead needs next, said as one action. Returns null
   for the plain follow-up / open-the-record cases, which each caller words for itself. */
type WorkAct = { node: React.ReactNode; kind: "special" | "followup" | "open" };
function workAction(
  state: ConsoleState,
  dispatch: Dispatch,
  writes: TodayWrites,
  goLead: (id: string, drawer?: DrawerKind) => void,
  goPaper: (id: string) => void,
  l: Lead,
  u: NextUp,
): WorkAct {
  const rec = u.rec;
  const sp = (node: React.ReactNode): WorkAct => ({ node, kind: "special" });
  if (!l.own && rec?.kind === "assign")
    return sp(
      <button type="button" className="act" onClick={() => writes.assign(l)}>
        Assign to me
      </button>,
    );
  if (!l.own && canAssign(state))
    return sp(
      <button type="button" className="act" onClick={() => goLead(l.id, "owner")}>
        Assign owner
      </button>,
    );
  if (rec?.kind === "consent" && canWork(state, l))
    return sp(
      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id, seed: { DTAB: "permission" } })}>
        Record permission
      </button>,
    );
  if (rec?.kind === "paper") {
    const st = irPaperStep(state, l);
    return sp(
      st ? (
        <button type="button" className="act" onClick={() => goPaper(l.id)}>
          {st.t}
        </button>
      ) : (
        <button type="button" className="btn" onClick={() => dispatch({ type: "openDrawer", k: "paper", id: l.id })}>
          With Finance
        </button>
      ),
    );
  }
  if (rec?.kind === "claim")
    return sp(
      <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "claim", id: l.id })}>
        View payment status
      </button>,
    );
  if (noNext(l) && canPlan(state, l))
    return sp(
      <button
        type="button"
        className="act"
        onClick={() => {
          dispatch({ type: "seedNext", id: l.id });
          dispatch({ type: "openDrawer", k: "next", id: l.id });
        }}
      >
        Set next step
      </button>,
    );
  if (u.kind === "stage" && canWork(state, l) && stepOwner(state, l.done, l) && gateMet(state, l))
    return sp(
      <button type="button" className="act" onClick={() => writes.tick(l)}>
        Confirm {LADDER[l.done]?.t || "stage"}
      </button>,
    );
  if (canWork(state, l)) return { node: null, kind: "followup" };
  return {
    node: (
      <button type="button" className="btn" onClick={() => goLead(l.id)}>
        Open the record
      </button>
    ),
    kind: "open",
  };
}

/* g1Contact(l,cls,only) — ir-merged.js:4216. Call / WhatsApp / Email (and Record visit when asked
   for by name) — each hands over to the lead page's flow on that channel. */
function G1Contact({ l, cls, only }: { l: Lead; cls: string; only: Channel | null }) {
  const flow = useLeadFlow();
  const num = waNum(l.ph);
  return (
    <>
      {num && conFor(l, "call") && (!only || only === "call") ? (
        <a className={cls} href={`tel:+${num}`} onClick={() => flow(l.id, "log", "call")} aria-label={`Call ${l.n}`}>
          <Icon name="call" />
          Call
        </a>
      ) : null}
      {num && conFor(l, "msg") && (!only || only === "msg") ? (
        <a
          className={cls}
          href={`https://wa.me/${num}`}
          target="_blank"
          rel="noopener"
          onClick={() => flow(l.id, "log", "msg")}
          aria-label={`WhatsApp ${l.n}`}
        >
          <Icon name="wa" />
          WhatsApp
        </a>
      ) : null}
      {l.em && conFor(l, "email") && (!only || only === "email") ? (
        <button type="button" className={cls} onClick={() => flow(l.id, "email")} aria-label={`Email ${l.n}`}>
          <Icon name="email" />
          Email
        </button>
      ) : null}
      {only === "visit" && conFor(l, "visit") ? (
        <button type="button" className={cls} onClick={() => flow(l.id, "log", "visit")} aria-label={`Record a visit with ${l.n}`}>
          <Icon name="events" />
          Record visit
        </button>
      ) : null}
    </>
  );
}

function hasContact(l: Lead, only: Channel | null): boolean {
  const num = waNum(l.ph);
  return (
    (!!num && conFor(l, "call") && (!only || only === "call")) ||
    (!!num && conFor(l, "msg") && (!only || only === "msg")) ||
    (!!l.em && conFor(l, "email") && (!only || only === "email")) ||
    (only === "visit" && conFor(l, "visit"))
  );
}

/* workRow(l) — ir-merged.js:4231. The selected investor's action lives in the panel beside the
   queue — shown once, not twice. */
function WorkRow({ l, team, selected, onSelect }: { l: Lead; team: boolean; selected: boolean; onSelect: () => void }) {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("today");
  const goPaper = useGoPaper();
  const flow = useLeadFlow();
  const writes = useTodayWrites();
  const u = nextUp(state, l);
  const g = workGroup(state, l);
  const partner = partnerLabel(state, l);
  const st = irPaperStep(state, l);
  /* g1Action(l,u) — ir-merged.js:4225 */
  const action = (() => {
    const ch = primaryWorkChannel(state, l, u);
    if (ch && hasContact(l, ch)) return <G1Contact l={l} cls="act" only={ch} />;
    const w = workAction(state, dispatch, writes, goLead, goPaper, l, u);
    if (w.kind === "followup")
      return (
        <button type="button" className="act" onClick={() => flow(l.id, "log")}>
          Log a contact
        </button>
      );
    return w.node;
  })();
  return (
    <li className={`work-row rd-work-row ${selected ? "is-selected" : ""}`} data-work-group={g}>
      <div className={`ux-work-row-main ${selected ? "g1-noact" : ""}`}>
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
          {st && u.kind !== "paper" ? (
            <button
              type="button"
              className="chip d61-move"
              onClick={(e) => {
                e.stopPropagation();
                goPaper(l.id);
              }}
            >
              {st.R.k === "nda" ? "NDA" : "Agreement"} · your move: {st.t}
            </button>
          ) : null}
          <div className="work-row-meta">
            <span>{LADDER[Math.max(0, l.done - 1)]!.t}</span>
            {partner ? <span>Partner: {partner}</span> : null}
            {hasNext(l) ? <span>{nxWhen(l)}</span> : null}
            {team && l.own ? <span>{P(state.PEOPLE, l.own).n}</span> : null}
            {covOf(state, l) && acting(state, l) === state.WHO ? <span className="tag cov">Covering</span> : null}
          </div>
        </div>
        {selected ? null : <div className="work-row-actions">{action}</div>}
      </div>
    </li>
  );
}

/* investorWorkPanel(l) — ir-merged.js:4247 (D59). The lead page's next-step card for the selected
   row — next step, what was last heard, and the same Call / WhatsApp / Email / Log a contact
   buttons, which open the lead page's flow. */
function InvestorPanel({
  l,
  rescheduling,
  onToggleReschedule,
  onReschedule,
}: {
  l: Lead | null;
  rescheduling: boolean;
  onToggleReschedule: (id: string) => void;
  onReschedule: (l: Lead, days: number) => void;
}) {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("today");
  const goPaper = useGoPaper();
  const flow = useLeadFlow();
  const writes = useTodayWrites();
  /* the newest note: live, GET /api/leads/[id]/notes; fixture, the book's own */
  const { notes } = useLeadNotes(l ? l.id : null);
  if (!l) return null;
  const u = nextUp(state, l);
  const blocked = gateWait(state, l);
  const work = canWork(state, l);
  const act = active(l) && !lost(l) && l.done < ST.ONBOARDED;
  const due = nxDue(l, state.NOW);
  const last = fuLatest(state, l);
  const note = notes[0] ?? null;
  const heard =
    ((state.INTERACTIONS || {})[l.id] || [])
      .filter((x) => x.obj && x.obj.length)
      .sort((a, b) => (whenT(b.at, state.NOW)?.getTime() || 0) - (whenT(a.at, state.NOW)?.getTime() || 0))[0] || null;
  const pref = l.contactPreference;
  const hasPref = typeof pref === "string" ? !!pref.trim() : !!(pref && typeof pref === "object");
  const w = workAction(state, dispatch, writes, goLead, goPaper, l, u);
  const special = w.kind === "special" ? w.node : null;
  /* D138 (B-10): units, never units × the prototype's unit price */
  const sub = [LADDER[Math.max(0, l.done - 1)]!.t, l.unitsKnown === false ? "" : l.units + " unit" + (l.units === 1 ? "" : "s")].filter(Boolean).join(" · ");
  const planned = act && hasNext(l);
  return (
    <section className="work-context card g1-focus" id="work-context" tabIndex={-1} aria-label={`${l.n} — investor in focus`}>
      <header className="ch">
        <div>
          <h2>{l.n}</h2>
          <span className="ux-secondary">{sub}</span>
        </div>
        <div className="ux-primary">
          <button
            type="button"
            className="btn ux-mobile-only"
            onClick={() => {
              const n = document.getElementById("work-" + l.id) || document.getElementById("work-queue");
              if (n) {
                n.scrollIntoView({ block: "center", behavior: "smooth" });
                n.focus();
              }
            }}
          >
            Back to list
          </button>
          <button type="button" className="btn" onClick={() => goLead(l.id)}>
            Open the record <Icon name="next" />
          </button>
        </div>
      </header>
      <div className="cb">
        <div className="lp-nexthead">
          <div>
            <span className="work-eyebrow">Next step</span>
            <h3>{planned ? l.nx!.t : u.t}</h3>
          </div>
          {planned ? (
            <span className={`tag ${due === "overdue" ? "late" : due === "today" ? "due" : "go"}`}>
              {due === "overdue" ? "Overdue · " : ""}
              {nxWhen(l)}
            </span>
          ) : null}
        </div>
        {planned && canPlan(state, l) ? (
          <button type="button" className="lp-link g1-resched" aria-expanded={rescheduling} onClick={() => onToggleReschedule(l.id)}>
            Reschedule
          </button>
        ) : null}
        {rescheduling ? (
          <div className="work-reschedule">
            <span>Keep {nxTime(l) || "the current time"}, move to:</span>
            <button type="button" className="chip" onClick={() => onReschedule(l, 1)}>
              Tomorrow
            </button>
            <button type="button" className="chip" onClick={() => onReschedule(l, 3)}>
              In 3 days
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                dispatch({ type: "seedNext", id: l.id });
                dispatch({ type: "openDrawer", k: "next", id: l.id });
              }}
            >
              Choose date
            </button>
          </div>
        ) : null}
        {last ? (
          <p className="lp-meta">
            Last contact: {FUCHANNELS[last.channel] || last.channel} · {last.outcome || ""} · {last.at || ""}
          </p>
        ) : null}
        {heard ? <p className="lp-meta">Raised before: {heard.obj!.join(", ")}</p> : null}
        {hasPref ? <p className="lp-meta">Prefers: {fuPreference(l)}</p> : null}
        {note ? (
          <p className="lp-meta lp-lastnote">
            Latest note: “{note.t.length > 140 ? note.t.slice(0, 140) + "…" : note.t}” — {P(state.PEOPLE, note.who).n.split(" ")[0]} · {note.at}
          </p>
        ) : null}
        {blocked ? (
          <div className="work-blocker">
            <b>{blocked.who === "fin" ? "Finance is checking" : "Action needed"}</b>
            <p>{blocked.d}</p>
          </div>
        ) : null}
        {special || (work && act) ? (
          <div className="lp-actions">
            {special}
            {work && act ? (
              <>
                <G1Contact l={l} cls="btn" only={null} />
                <button type="button" className={special ? "btn" : "act"} onClick={() => flow(l.id, "log")}>
                  Log a contact
                </button>
              </>
            ) : null}
          </div>
        ) : null}
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
        <div className="g1-foot">
          <button
            type="button"
            className="lp-link"
            onClick={() => goLead(l.id, "history")}
          >
            Investor file
          </button>
          <span className="ux-secondary">history, notes, documents, details</span>
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
  const financeLive = useApiMode() === "live";
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
              /* confirmClaim / rejectClaim are the reducer's only (the claim redesign is not built): live offers Review only */
              const permitted = !!b?.answerable && !financeLive;
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
              /* D138 (B-10): what is in, as recorded — no balance worked out from the prototype's unit price */
              const balance =
                knownUnitIntent(l) && pay
                  ? money(pay.got) + " in · " + l.units + " unit" + (l.units === 1 ? "" : "s")
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
              {xferRows(state).filter((x) => !x.ack).length} confirmed investor entries need acknowledgement
              {xOwner(state) ? <> from {P(state.PEOPLE, xOwner(state)!).n}</> : null}.
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
