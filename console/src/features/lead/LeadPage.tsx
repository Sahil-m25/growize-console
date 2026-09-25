"use client";

/* ── 3. LEAD — investor context, the appointment, the journey, and the rest behind a fold.
   vLead, ir-console-redesigned.html 7671-7791 ────────────────────────────────────────────────
   The redesigned prototype replaced the old "two cards and a bare door row" layout with: the
   header lines, an "Investor context" card (next action, contact actions, the details links),
   an "Appointment" disclosure holding the Next step and Forecast blocks, a "Journey" disclosure
   holding the ladder, and a "More investor tools" disclosure holding the doors.

   THE REFUSALS. The prototype's `tick()` and `untick()` popped an `alert()`. This screen already
   has the treatment for a sentence that stops you — the `.hd1` band the gate uses — so a refused
   tick or un-tick renders there, in the prototype's own words, and nothing else on the page moves.

   "Record follow-up" and "Record visit" open the canonical `"p:followup"` drawer
   (`@/features/leads/followupDrawer`) instead of the old `touch` drawer — the store's
   `saveFollowup`/`discardFollowup` (store.tsx) implement the prototype's combined outcome-and-
   next-step save (INTERACTIONS, the touch/reply/CALLS mirrors, the next step), and that drawer
   collects `ui.FU` for it. This page used to open its own near-identical `"followup"` drawer
   (`./drawers/followup`) — a real cross-agent duplication from the same round `@/features/leads/
   followupDrawer.tsx` was built in. Consolidated onto `"p:followup"`, the key Today/WorkAction/
   LeadsPage already use, so there is exactly one follow-up drawer in the running app; `./drawers/
   followup.tsx` (and `./drawers/touch.tsx`, the drawer it superseded in turn) are left on disk but
   no longer imported by `./drawers/index.ts`, rather than deleted, since deleting either file broke
   Turbopack's live cache mid-round — dropping the import already makes both truly unreachable. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CLAIMKINDS, FCAT, LADDER, ST, TOUCHCHANNELS, TOUCHDONE, TOUCHSLA, UNIT } from "@/domain";
import type { Lead, NavKey, PersonKey } from "@/domain";
import type { DrawerKind } from "@/lib/store";
import { money } from "@/lib/format";
import {
  active,
  canAssign,
  canDecideMove,
  canEdit,
  canPlan,
  canReach,
  canReopen,
  canWork,
  canClaim,
  canOperateLeads,
  chanOf,
  claimBlock,
  claimOpen,
  cold,
  conFor,
  covOf,
  fcInFY,
  fcOf,
  fcOK,
  gateWait,
  hasNext,
  isFin,
  isIR,
  lost,
  missingTouch,
  named,
  needsNext,
  nextUp,
  noNext,
  nxDue,
  nxWhen,
  openable,
  P,
  ph,
  ragOf,
  refTxt,
  reopenHandoff,
  sinceReply,
  stepOwner,
  tCount,
  tFirst,
  tLast,
  undoStage,
  watching,
  whyLocked,
  seeMoney,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useTick, useUntick, type Refusal } from "@/features/leads/actions";
import { uiFrom, uiNxask } from "@/features/leads/ui";
import { WorkAction } from "@/features/leads/WorkAction";
import { waNum } from "@/features/today/work";
import { Icon } from "@/components/ui/Icon";
import { Doors } from "./Doors";
import { buildFollowupDraft } from "@/features/leads/followupDrawer";
import { FollowupContext } from "./followupContext";
import "@/features/lead/drawers";   /* register the lead drawers before anything opens one */
import "@/features/leads/followupDrawer";   /* registers "p:followup" before this page's own buttons can open it */

/* ---- Investor context: contact links, and the primary channel the current work is asking for.
   ir-console-redesigned.html 6735-6765 (contactActions/primaryWorkChannel). `nextUp`'s `rec.kind`
   now carries "followup" for a dated step (selectors/leads.ts), so a channel is offered for that
   case too, not only a missed-touch SLA. */
function primaryWorkChannel(state: ReturnType<typeof useConsole>["state"], l: Lead): string | null {
  const u = nextUp(state, l);
  if (!canWork(state, l) || !u.rec || !["touch", "followup"].includes(u.rec.kind)) return null;
  const ch = u.rec.kind === "touch" ? u.rec.k : chanOf(state, l);
  if (!conFor(l, ch as (typeof TOUCHCHANNELS)[number])) return null;
  if (ch === "visit") return ch;
  if (ch === "email") return l.em ? ch : null;
  if (ch === "call" || ch === "msg") return waNum(l.ph) ? ch : null;
  return null;
}

/* followupSeed(state,l,channel) — ir-console-redesigned.html:6011-6019 (openFollowup). A fresh
   draft is seeded from `channel` only when there is no draft already open; re-opening (another
   contact button, "＋ Record contact", "Record follow-up") on top of one in progress must never
   throw a part-filled form away, so every caller below asks this instead of building the draft
   directly. ponytail: keyed off `ui.FU` alone rather than `ui.FU`'s own lead, since this port
   holds one followup draft at a time (not per lead, as `FUDRAFTS` does) — good enough as long as
   only one lead's follow-up drawer is ever open, which is all the shell allows today. */
function followupSeed(state: ReturnType<typeof useConsole>["state"], l: Lead, channel: string) {
  return state.ui.FU ? {} : { FU: buildFollowupDraft(state, l, channel) };
}

/* afterContact(id,chan) — ir-console-redesigned.html:3357-3370. The dialer/WhatsApp/mail client
   send nothing and record nothing (rule 6: a system touch is never a human touch) — what tapping
   one of these links does instead is arm a one-shot "the tab came back" listener that offers the
   follow-up drawer, seeded to the channel just tapped, so logging what happened is one tap away
   rather than a hunt back through Doors. One listener at a time, module-scope like the prototype's
   own `CBACK`, since only one contact link can be the most recently tapped. */
let contactBack: (() => void) | null = null;
function afterContact(dispatch: ReturnType<typeof useConsole>["dispatch"], state: ReturnType<typeof useConsole>["state"], l: Lead, chan: string) {
  if (typeof window === "undefined" || !canWork(state, l)) return;
  if (contactBack) { window.removeEventListener("focus", contactBack); contactBack = null; }
  const armed = Date.now();
  const back = () => {
    if (Date.now() - armed < 500) return;   /* the tap itself can hand focus back before a dialer opens */
    window.removeEventListener("focus", back);
    if (contactBack === back) contactBack = null;
    dispatch({ type: "openDrawer", k: "p:followup" as DrawerKind, id: l.id, seed: followupSeed(state, l, chan) });
  };
  contactBack = back;
  window.addEventListener("focus", back);
}

function ContactActions({
  l,
  compact,
  onlyChannel,
  excludeChannel,
}: {
  l: Lead;
  compact?: boolean;
  onlyChannel?: string | null;
  excludeChannel?: string | null;
}) {
  const { state, dispatch } = useConsole();
  if (!canWork(state, l)) return null;
  const num = waNum(l.ph);
  const cls = onlyChannel ? "act" : compact ? "chip" : "btn";
  const show = (k: string) => (!onlyChannel || onlyChannel === k) && excludeChannel !== k;
  const arm = (chan: string) => afterContact(dispatch, state, l, chan);
  return (
    <div className="work-contact">
      {num && conFor(l, "call") && show("call") ? (
        <a className={cls} href={`tel:+${num}`} aria-label={`Call ${l.n}`} onClick={() => arm("call")}>
          <Icon name="call" />
          Call
        </a>
      ) : null}
      {num && conFor(l, "msg") && show("msg") ? (
        <a className={cls} href={`https://wa.me/${num}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${l.n}`} onClick={() => arm("msg")}>
          <Icon name="wa" />
          WhatsApp
        </a>
      ) : null}
      {l.em && conFor(l, "email") && show("email") ? (
        <a className={cls} href={`mailto:${l.em}`} aria-label={`Email ${l.n}`} onClick={() => arm("email")}>
          Email
        </a>
      ) : null}
      {conFor(l, "visit") && show("visit") ? (
        <button
          type="button"
          className={cls}
          onClick={() =>
            dispatch({
              type: "openDrawer",
              k: "p:followup" as DrawerKind,
              id: l.id,
              seed: followupSeed(state, l, "visit"),
            })
          }
          aria-label={`Record a visit with ${l.n}`}
        >
          <Icon name="events" />
          Record visit
        </button>
      ) : null}
    </div>
  );
}

export function LeadPage({ id }: { id: string }) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const tick = useTick();
  const untick = useUntick();
  const [refusal, setRefusal] = useState<Refusal>(null);
  /* workNotice() — ir-console-redesigned.html:6721-6724. The "p:followup" drawer's save
     (`@/features/leads/followupDrawer.tsx`) hands off through the same generic `ui.WORKNOTICE`
     field the Today page's own copy of this pattern already consumes (`TodayPage.tsx:166-177`) —
     one message, read once and cleared, so a lead page left open behind a closed drawer never
     replays a stale confirmation. ponytail: no Undo affordance, since `ui.WORKNOTICE` carries a
     plain string, not a callback; add one if a save on this page ever needs it. */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const msg = state.ui.WORKNOTICE as string | null | undefined;
    if (!msg) return;
    setNotice(msg);
    dispatch({ type: "setUi", patch: { WORKNOTICE: null } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ui.WORKNOTICE]);

  const l = openable(state).find((x) => x.id === id);
  if (!l)
    return (
      <>
        <div className="ph">
          <h1>Nothing to open</h1>
        </div>
        <div className="card">
          <div className="empty">
            There is no lead here. Either the one you came from has moved to somebody else&apos;s
            book, or you carry none yet — a lead opens from the book, and only while it is yours to
            read.
            <br />
            <button
              type="button"
              className="chip"
              style={{ marginTop: "10px" }}
              onClick={() => {
                dispatch({ type: "go", v: "leads" });
                router.push("/leads");
              }}
            >
              Open the leads book
            </button>{" "}
            {canOperateLeads(state) ? (
              <button
                type="button"
                className="chip"
                style={{ marginTop: "10px" }}
                onClick={() => dispatch({ type: "openDrawer", k: "p:add.quick" })}
              >
                Add a lead
              </button>
            ) : null}
          </div>
        </div>
      </>
    );

  const c = covOf(state, l);
  const plan = canPlan(state, l);
  const r = state.REQ[l.id];
  const claim = seeMoney(state, l) ? state.CLAIM[l.id] : null;
  const FROM = uiFrom(state.ui);
  const back: NavKey | "event" =
    FROM === "event" && canReach(state, "events")
      ? "event"
      : canReach(state, FROM as NavKey)
        ? (FROM as NavKey)
        : "leads";
  const backT = back === "event" ? "the event" : back === "leads" ? "leads" : back;
  const due = nxDue(l, state.NOW);
  const und = undoStage(state, l);
  const g = gateWait(state, l);
  const NXASK = uiNxask(state.ui);
  const currentWork = nextUp(state, l);
  const currentChannel = primaryWorkChannel(state, l);

  const goBack = () => {
    if (back === "event") {
      dispatch({ type: "go", v: "events" });
      router.push(`/events/${encodeURIComponent(state.EVID)}`);
      return;
    }
    dispatch({ type: "go", v: back });
    router.push(`/${back}`);
  };

  const lines: React.ReactNode[] = [];

  if (lost(l))
    lines.push(
      <div className="hd1" key="lost">
        <b>Closed as lost — {l.lost!.why}.</b> {l.lost!.note ? l.lost!.note + " " : ""}Recorded by{" "}
        {P(state.PEOPLE, l.lost!.by).n} <span className="mono">{l.lost!.at}</span>, at “
        {LADDER[Math.max(0, (l.lost!.stage || 1) - 1)].t}”.
        {canReopen(state, l) ? (
          <>
            <div className="sp" />
            <button
              type="button"
              className="chip"
              onClick={() => dispatch({ type: "reopenLost", id: l.id })}
            >
              Re-open it
            </button>
          </>
        ) : reopenHandoff(state, l) ? (
          <span className="sm"> {reopenHandoff(state, l)}</span>
        ) : null}
      </div>,
    );

  if (!l.own)
    lines.push(
      <div className="hd1 bad" key="noowner">
        <b>No owner.</b> Added by {P(state.PEOPLE, l.by).n} ·{" "}
        <span className="mono">{l.at[0]}</span>
        <div className="sp" />
        {canAssign(state) ? (
          <button
            type="button"
            className="act"
            onClick={() => dispatch({ type: "openDrawer", k: "owner", id: l.id })}
          >
            Assign owner
          </button>
        ) : isIR(state.ROLE) ? (
          <button
            type="button"
            className="chip"
            onClick={() => dispatch({ type: "assign", id: l.id, to: state.WHO })}
          >
            Assign to me
          </button>
        ) : (
          <span>A manager or an IR has to pick this up.</span>
        )}
      </div>,
    );

  if (watching(state, l))
    lines.push(
      <div className="hd1" key="watch">
        <b>{whyLocked(state, l)}</b>
        <span>
          You stay{" "}
          {l.own === state.WHO
            ? "the owner of record"
            : l.sec === state.WHO
              ? "the secondary owner"
              : "on it"}{" "}
          and see everything that happens.
        </span>
      </div>,
    );

  /* the gate, said on the record itself — ir-console-redesigned.html 7622-7627. One sentence, not
     two: the old second sentence explaining who is waiting on what is dropped, matching the
     redesign's own trim. */
  if (g && !lost(l) && !claimOpen(state, l.id)) {
    const ck = l.done >= ST.RESERVED ? "full" : "advance";
    lines.push(
      <div className={`hd1 ${g.who === "fin" ? "due" : ""}`} key="gate">
        <span>
          <b>
            “{LADDER[l.done].t}” needs {g.t}
            {g.who === "fin" ? ", and Finance has it" : ""}.
          </b>{" "}
          {g.d}
        </span>
        {canClaim(state, l) && !claimOpen(state, l.id) ? (
          <>
            <div className="sp" />
            <button
              type="button"
              className="chip"
              id="door-claim-gate"
              onClick={() =>
                dispatch({
                  type: "openDrawer",
                  k: "claim",
                  id: l.id,
                  seed: { CKIND: ck, CREF: "", CNOTE: "" },
                })
              }
            >
              Record what the investor told you
            </button>
          </>
        ) : null}
      </div>,
    );
  }

  if (c)
    lines.push(
      <div className="hd1 due" key="cover">
        <b>{P(state.PEOPLE, c.by).n} is covering</b> for {P(state.PEOPLE, l.own).n} until {c.to} —
        the owner does not change.
        <div className="sp" />
        <button
          type="button"
          className="chip"
          id="door-owner2"
          onClick={() => dispatch({ type: "openDrawer", k: "owner", id: l.id })}
        >
          Owners and cover
        </button>
      </div>,
    );

  if (r && r.state === "waiting")
    lines.push(
      <div className="hd1 due" key="req">
        <b>
          {P(state.PEOPLE, r.by).n} asked to move this to {P(state.PEOPLE, r.to).n}
        </b>{" "}
        — {r.why}
        <div className="sp" />
        {canDecideMove(state, l) ? (
          <div className="chips">
            <button
              type="button"
              className="chip on"
              onClick={() => dispatch({ type: "decideMove", id: l.id, ok: true })}
            >
              Approve the move
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => dispatch({ type: "decideMove", id: l.id, ok: false })}
            >
              Decline it
            </button>
          </div>
        ) : (
          <span className="sm">
            {P(state.PEOPLE, P(state.PEOPLE, l.own).mgr || ("tasneem" as PersonKey)).n} or anyone
            above decides.
          </span>
        )}
      </div>,
    );
  else if (r && r.state === "declined")
    lines.push(
      <div className="hd1" key="reqd">
        <b>A move was asked for and declined</b> by {P(state.PEOPLE, r.did).n}{" "}
        <span className="mono">{r.on}</span>. It stays with {P(state.PEOPLE, l.own).n}.
      </div>,
    );

  /* D42 — the mirror never prints a bank reference in the clear. `refTxt` masks it to its last
     four digits until the reader explicitly asks (`showRef`/`hideRef`), and the ask itself is
     logged — same as the money drawer's own reveal. */
  if (claim && claim.state === "waiting") {
    const cb = claimBlock(state, l);
    const label = cb ? cb.label : CLAIMKINDS[claim.kind] || "Payment";
    lines.push(
      <div className="hd1 due" key="claim">
        <span>
          <b>{P(state.PEOPLE, claim.by).n} says the investor has paid</b> — {label},{" "}
          {claim.mode} <span className="mono">{refTxt(state, `claim:${l.id}`)}</span>,
          told to Finance <span className="mono">{claim.at}</span>. Nothing moves until Finance
          finds it in the bank.
        </span>
        <div className="sp" />
        <button
          type="button"
          className="chip"
          id="door-claim2"
          onClick={() => dispatch({ type: "openDrawer", k: "claim", id: l.id })}
        >
          {isFin(state.ROLE) ? "Confirm it" : "What happens next"}
        </button>
      </div>,
    );
  } else if (claim && claim.state === "notfound")
    lines.push(
      <div className="hd1 bad" key="claimnf">
        <span>
          <b>Finance could not find that payment.</b> {claim.why} —{" "}
          {P(state.PEOPLE, claim.did).n} <span className="mono">{claim.on}</span>. Go back to the
          investor for the reference before asking again.
        </span>
        {named(state, l) || canAssign(state) || isFin(state.ROLE) ? (
          <>
            <div className="sp" />
            <button
              type="button"
              className="chip"
              onClick={() => dispatch({ type: "reopenClaim", id: l.id })}
            >
              Ask Finance to look again
            </button>
          </>
        ) : null}
      </div>,
    );

  if (!TOUCHCHANNELS.some((k) => conFor(l, k)))
    lines.push(
      <div className="hd1 bad" key="consent">
        <b>Contact permission missing.</b> Record the investor's permission before contacting them.
        {canWork(state, l) ? (
          <button
            type="button"
            className="chip"
            onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id, seed: { DTAB: "permission" } })}
          >
            Record permission
          </button>
        ) : null}
      </div>,
    );

  if (cold(state, l, state.NOW))
    lines.push(
      <div className="hd1 bad" key="cold">
        <b>
          {sinceReply(state, l, state.NOW)} touches since they last came back
          {l.reply ? "" : " — and they never have"}.
        </b>{" "}
        The next attempt should change channel or change the offer, not repeat itself.
      </div>,
    );

  if (refusal)
    lines.push(
      <div className="hd1 bad" key="refusal" role="alert">
        <span>{refusal}</span>
      </div>,
    );

  const sig = ragOf(state, l);
  const pre = !needsNext(l);
  const sla = missingTouch(state, l);
  const cat = fcOf(l);
  const otherChannelsOpen = canWork(state, l) && TOUCHCHANNELS.some((k) => k !== currentChannel && conFor(l, k));
  /* ir-console-redesigned.html 7688-7689: shown whenever the channel is not visit (visit's own
     "Record visit" button already opens this same drawer) AND either a channel is on offer, or
     `nextUp` is not already the dated-step case `workAction` itself renders as "Record follow-up". */
  const showRecordFollowup =
    canWork(state, l) && currentChannel !== "visit" && !!(currentChannel || !currentWork.rec || currentWork.rec.kind !== "followup");

  return (
    <>
      <div className="ph">
        <button type="button" className="btn" onClick={goBack} aria-label={`Back to ${backT}`} title={`Back to ${backT}`}>
          <Icon name="back" />
        </button>
        <h1>{l.n}</h1>
        <span className="tag">
          {money(l.units * UNIT)} · {l.units} units
        </span>
        <span
          className={`tag ${
            sig.c === "red" ? "late" : sig.c === "amber" ? "due" : "go"
          }`}
        >
          <span className={`rag ${sig.c}`} />
          {sig.t}
        </span>
        {l.nri ? <span className="tag due">NRI</span> : null}
        <div className="sp" />
        <span className="ux-secondary">
          {l.city ? l.city + " · " : ""}
          <span className="mono">{ph(state, l)}</span>
        </span>
      </div>
      {lines}
      {notice ? (
        <div className="work-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="btn" aria-label="Dismiss notification" onClick={() => setNotice(null)}>
            <Icon name="x" />
          </button>
        </div>
      ) : null}

      <section className="card work-before-contact">
        <div className="ch">
          <h3>Investor context</h3>
        </div>
        <div className="cb">
          {active(l) ? (
            <div className="work-next">
              <span className="work-eyebrow">Next action</span>
              <b>{currentWork.t}</b>
            </div>
          ) : null}
          <FollowupContext l={l} />
          <div className="work-panel-actions">
            {currentChannel ? (
              <ContactActions l={l} onlyChannel={currentChannel} />
            ) : canWork(state, l) ? (
              <WorkAction l={l} u={currentWork} />
            ) : null}
            {showRecordFollowup ? (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  dispatch({
                    type: "openDrawer",
                    k: "p:followup" as DrawerKind,
                    id: l.id,
                    seed: followupSeed(state, l, chanOf(state, l)),
                  })
                }
              >
                Record follow-up
              </button>
            ) : null}
          </div>
          {otherChannelsOpen ? (
            <details className="ux-contact-options">
              <summary>Other contact channels</summary>
              <ContactActions l={l} excludeChannel={currentChannel} />
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
              {canWork(state, l) ? "Edit" : "View"} details &amp; permission
            </button>
          </div>
        </div>
      </section>

      {active(l) ? (
        <details className="ux-disclosure" open={NXASK === l.id || undefined}>
          <summary>
            Appointment · {hasNext(l) ? `${l.nx!.t} · ${nxWhen(l)}` : pre ? "First contact pending" : "Next step missing"}
          </summary>
          <div className="cb">
            <div className="ch" style={noNext(l) ? { borderColor: "var(--late)" } : undefined}>
              <h3>Next step</h3>
              <div className="sp" />
              {hasNext(l) ? (
                <span
                  className={`tag ${due === "overdue" ? "late" : due === "today" ? "due" : "go"}`}
                >
                  {due === "overdue" ? "was due" : "due"} {nxWhen(l)}
                </span>
              ) : pre ? (
                <span className="tag br">first touch</span>
              ) : (
                <span className="tag late">
                  <span className="dot" />
                  missing
                </span>
              )}
            </div>
            <div className="cb">
              {NXASK === l.id && hasNext(l) ? (
                <div className="hd1 due" style={{ marginBottom: "10px" }}>
                  <b>Still {nxWhen(l)}?</b> You just recorded something and the step is dated later.
                  {plan ? (
                    <>
                      <div className="sp" />
                      <div className="chips">
                        <button
                          type="button"
                          className="chip on"
                          onClick={() => dispatch({ type: "keepNext", id: l.id })}
                        >
                          Keep it
                        </button>
                        {(
                          [
                            ["Tomorrow", 1],
                            ["In 3 days", 3],
                          ] as const
                        ).map(([t, d]) => (
                          <button
                            type="button"
                            className="chip"
                            key={t}
                            onClick={() => dispatch({ type: "moveNextTo", id: l.id, days: d })}
                          >
                            {t}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="chip"
                          onClick={() => {
                            dispatch({ type: "askReschedule", id: null });
                            dispatch({ type: "seedNext", id: l.id });
                            dispatch({ type: "openDrawer", k: "next", id: l.id });
                          }}
                        >
                          Change it
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="nxc">
                {hasNext(l) ? (
                  <>
                    <b style={{ fontSize: "15px" }}>{l.nx!.t}</b>
                    <span className="sm">
                      set by {P(state.PEOPLE, l.nx!.who).n.split(" ")[0]} ·{" "}
                      <span className="mono">{l.nx!.at}</span>
                    </span>
                  </>
                ) : pre ? (
                  <span>
                    The first-touch service level is the next action until the touch lands
                    {sla ? (
                      <>
                        {" "}
                        — <b>{sla.t}</b>, {sla.due}
                      </>
                    ) : null}
                    .
                  </span>
                ) : (
                  <>
                    <b style={{ color: "var(--late)" }}>No next action and no date.</b>
                    <span className="sm">The weekly review reads this as an exception.</span>
                  </>
                )}
                <div className="sp" />
                {plan ? (
                  <button
                    type="button"
                    className="chip"
                    id="door-next"
                    onClick={() => {
                      dispatch({ type: "seedNext", id: l.id });
                      dispatch({ type: "openDrawer", k: "next", id: l.id });
                    }}
                  >
                    {hasNext(l) ? "Change the step" : "Set the next step"}
                  </button>
                ) : !hasNext(l) && !pre ? (
                  <span className="sm">{P(state.PEOPLE, l.own).n} has to set it.</span>
                ) : null}
              </div>
              {l.done >= ST.QUALIFIED ? (
                <div
                  className="nxc"
                  style={{
                    borderTop: "1px solid var(--line-2)",
                    marginTop: "11px",
                    paddingTop: "10px",
                  }}
                >
                  <span className="lbl" style={{ margin: 0 }}>
                    Forecast
                  </span>
                  {cat ? (
                    <>
                      <span className={`tag ${FCAT[cat as keyof typeof FCAT].c}`}>
                        {FCAT[cat as keyof typeof FCAT].t}
                      </span>
                      <span className="sm">
                        {l.fc!.by ? (
                          <>
                            {l.done >= ST.PAID ? "paid in full " : "full payment by "}
                            <span className="mono">{l.fc!.by}</span>
                          </>
                        ) : (
                          "no date set"
                        )}
                      </span>
                      {!fcOK(l, state.NOW) ? (
                        <span className="tag late">
                          <span className="dot" />
                          needs evidence and a date
                        </span>
                      ) : cat !== "pipeline" && l.done >= ST.PAID ? (
                        <span className="tag go">realised</span>
                      ) : cat !== "pipeline" && !fcInFY(l, state.NOW) ? (
                        <span className="tag due">outside FY26–27</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="sm">
                      Not categorised — it counts for nothing in the weekly forecast.
                    </span>
                  )}
                  <div className="sp" />
                  {plan ? (
                    <button
                      type="button"
                      className="chip"
                      id="door-forecast"
                      onClick={() => dispatch({ type: "openDrawer", k: "forecast", id: l.id })}
                    >
                      {cat ? "Change the forecast" : "Set the forecast"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}

      <details className="card work-journey">
        <summary>
          <b>Journey · {LADDER[Math.max(0, l.done - 1)].t}</b>
          <span className="sm">Stage {LADDER[Math.max(0, l.done - 1)].stage} of 8 · View milestones</span>
        </summary>
        <div className="cb">
          <div className="lc">
            {LADDER.map((st, i) => {
              const done = i < l.done;
              const here = i === l.done;
              const owned = stepOwner(state, i, l);
              const last = done && i === l.done - 1;
              return (
                <div key={st.t}>
                  <div className={`lcr ${done ? "done" : here ? "here" : "locked"}`}>
                    <span className="bul">{done ? "✓" : st.stage}</span>
                    <div className="bd">
                      <div className="tl1">
                        <b>{st.t}</b>
                        {st.skip ? <span className="tag">optional</span> : null}
                        {done ? (
                          <time>{l.at[i] || "—"}</time>
                        ) : here ? (
                          <span className="sm">
                            {st.sla ? st.sla : st.ev}
                            {st.needs ? " · needs the " + st.needs : ""}
                          </span>
                        ) : null}
                      </div>
                      {i === ST.TOUCH - 1 && l.done >= ST.TOUCH - 1 ? (
                        <div className="tps">
                          {/* the three SLA'd channels, plus a visit only once one has actually been
                             logged — a visit carries no service-level deadline of its own */}
                          {(
                            [...TOUCHSLA, ...(tCount(l, "visit") ? [{ k: "visit", due: "when agreed" }] : [])] as readonly {
                              k: (typeof TOUCHCHANNELS)[number];
                              due: string;
                            }[]
                          ).map((x) => {
                            const n = tCount(l, x.k);
                            const allowed = conFor(l, x.k);
                            return (
                              <span
                                key={x.k}
                                className={`tp ${n ? "on" : allowed && l.done >= ST.TOUCH ? "miss" : ""}`}
                                title={
                                  n
                                    ? TOUCHDONE[x.k] +
                                      " ×" +
                                      n +
                                      " — first " +
                                      tFirst(l, x.k) +
                                      ", last " +
                                      tLast(l, x.k)
                                    : TOUCHDONE[x.k] +
                                      (allowed ? " · due " + x.due + ", nothing logged" : " · contact not permitted")
                                }
                              >
                                {TOUCHDONE[x.k]} <b>×{n}</b>
                                {n ? (
                                  <i>
                                    {(tFirst(l, x.k) as string).slice(0, 6)}
                                    {n > 1 ? " → " + (tLast(l, x.k) as string).slice(0, 6) : ""}
                                  </i>
                                ) : (
                                  <i>{allowed ? x.due : "Not permitted"}</i>
                                )}
                              </span>
                            );
                          })}
                          <span className={`tp ${l.reply ? "rep" : ""}`}>
                            {l.reply ? (
                              <>
                                Replied <i>{l.reply.slice(0, 6)}</i>
                              </>
                            ) : (
                              "No reply yet"
                            )}
                          </span>
                          {canWork(state, l) ? (
                            <button
                              type="button"
                              className="tadd"
                              id="door-touch"
                              onClick={() =>
                                dispatch({
                                  type: "openDrawer",
                                  k: "p:followup" as DrawerKind,
                                  id: l.id,
                                  seed: followupSeed(state, l, chanOf(state, l)),
                                })
                              }
                            >
                              ＋ Record contact
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="rt">
                      {here && owned && g ? (
                        <span className={`tag ${g.who === "fin" ? "due" : ""}`}>
                          <span className="dot" />
                          {g.who === "fin" ? "waiting on Finance" : "not yet true"}
                        </span>
                      ) : here && owned ? (
                        <button
                          type="button"
                          className="act"
                          onClick={() => setRefusal(tick(l))}
                        >
                          {st.t === "First touch made" ? "Record first contact" : "Confirm " + st.t.toLowerCase()}
                        </button>
                      ) : here ? (
                        <span className="tag">{st.who}</span>
                      ) : last && und.ok ? (
                        <button
                          type="button"
                          className="btn"
                          title={und.why ?? undefined}
                          onClick={() => setRefusal(untick(l))}
                        >
                          Un-tick “{st.t}”
                        </button>
                      ) : last &&
                        (canEdit(state, l) || l.own === state.WHO || l.sec === state.WHO) ? (
                        <span className="lock" title={und.why ?? undefined}>
                          🔒 locked
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {here && st.skip && owned ? (
                    <div className="lcr" style={{ border: 0, paddingTop: 0 }}>
                      <span className="bul" style={{ visibility: "hidden" }}>
                        ·
                      </span>
                      <div className="bd">
                        <span className="sm">
                          A webinar or visit moves an investor forward but is not a mandatory gate.
                        </span>
                      </div>
                      <div className="rt">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => dispatch({ type: "skipStage", id: l.id })}
                        >
                          Not needed
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </details>

      <details className="ux-disclosure">
        <summary>More investor tools</summary>
        <div className="cb">
          <Doors l={l} />
        </div>
      </details>
    </>
  );
}
