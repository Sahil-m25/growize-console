"use client";

/* =================================================================================================
   THE WORKSPACE HEADER — the redesigned prototype's <header class="top rd-top">, ~2373–2388, filled
   by draw() ~13040–13165.

   Search, team availability, lead creation, updates and the account menu each get their own
   position and priority instead of sharing one crowded strip; availability and the Undo offer move
   to a second row that exists only when either has something to say (.rd-header-context, hidden by
   console.css when both #cov and #tbk are empty).

   Two controls from the original top bar are not here, on purpose:
     - #whoin (team availability) ships `hidden` in the redesigned markup and nothing in draw()
       ever clears that attribute — Team availability moved into the account menu below instead
       (see drawers/account.tsx). Rendering a button the prototype itself never shows would be
       drawing dead chrome, not porting behaviour.
     - #signout is unconditionally `display:none` in the redesigned stylesheet (console.css) and
       there is no sign-in in this stage of the port (README: "no sign-in, no job") — see the demo
       person switcher inside the account drawer instead.
   ============================================================================================== */

import { useRouter } from "next/navigation";
import type { NavKey, PersonKey } from "@/domain";
import { LADDER, PAGECAPS, ST, TOUCHDONE, EDIT_H } from "@/domain";
import {
  canAssign,
  canWork,
  coverLive,
  coversOf,
  isIR,
  may,
  navFor,
  outFor,
  outOf,
  outTo,
  P,
  tList,
  tempFor,
  tempOn,
  undoStage,
  unread,
} from "@/lib/selectors";
import type { Action, ConsoleState } from "@/lib/store";
import { useConsole } from "@/lib/store";
import { agoStr } from "@/lib/format";
import { Icon } from "@/components/ui";
import { FindBox } from "@/features/leads/FindBox";
import { pathOf, type View } from "./routes";
import { titleOf as mergedTitleOf } from "./SignIn";
import { sidesOf } from "@/lib/selectors/access";
import { imReadOnly } from "@/lib/im";
import { DataFresh } from "./DataStatus";   /* M01-S03 */

const PAGES = PAGECAPS as unknown as Record<string, { t: string } | undefined>;
const pageTitle = (p: string) => PAGES[p]?.t ?? p;

export function TopBar({ side = "ir", view }: { side?: "ir" | "im" | "mix"; view?: NavKey }) {
  const { state, dispatch, saves = [], browserOnline = null, lastLocalUpdate = null, retrySave, dataRead = { at: null, failed: false, source: null } } = useConsole();
  const router = useRouter();
  const me = state.WHO;
  const p = P(state.PEOPLE, me);

  /* titleOf(k) — ir-merged.js:1590: imTitle(k) || SEAT[roleOf(k)] || "" (SignIn.tsx) */
  const titleOf = (k: PersonKey) => mergedTitleOf(state, k);

  const out = outOf(state, me);
  const covers = coversOf(state, me);
  /* myCov — 13063: `COVER[me()] || (LEADS.find(l=>l.own===me()&&l.cov)||{}).cov || null`, read
     independently of outFor so a covered person still sees who covers them while they are out
     (the old guard here — `!outFor(state, me)` — made this unconditionally null for that case). */
  const myCov =
    (coverLive(state, state.COVER[me], me) ? state.COVER[me] : null) ??
    (state.LEADS.find((l) => l.own === me && coverLive(state, l.cov, l.own))?.cov ?? null);
  const tg = tempOn(state);
  const lent = tempFor(state, me);

  /* the door is chrome, so it goes when the act does — the same way the bell goes when there is
     no Updates to reach. What is never hidden is the refusal: `capb.hidden = !may("add","capture")
     || (DRW && DRW.k==="p:add.quick") || popOpen(...)` — draw() 10759. A viewer here is refused at
     the write and never by a hidden button, so the shortcut follows the capability, not canReach. */
  const mayCapture = may(state, "add", "capture");
  const capOpen = state.DRW?.k === "p:add.quick";

  /* saveStatusHTML()'s arithmetic — 03-app.js:4668-4680 */
  const failedSaves = saves.filter((s) => s.status === "failed");
  const pendingSaves = saves.filter((s) => s.status !== "failed");
  const saveTone = failedSaves.length ? "failed" : pendingSaves.length || !browserOnline ? "waiting" : "online";
  const saveTimeLabel = lastLocalUpdate
    ? new Date(lastLocalUpdate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;
  const saveSummary = [
    pendingSaves.length ? `${pendingSaves.length} change${pendingSaves.length === 1 ? "" : "s"} waiting · up to 5 minutes` : "",
    failedSaves.length ? `${failedSaves.length} save${failedSaves.length === 1 ? "" : "s"} failed` : "",
    saveTimeLabel ? `Last local update ${saveTimeLabel}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const nUp = navFor(state).some((n) => n.k === "updates") ? unread(state) : 0;
  /* merge-glue.js:147 — on the Investors side of a page, a seat that only reads says so */
  const ro = side === "im" && sidesOf(state, view ?? state.VIEW).im && imReadOnly({ data: state.IM, ui: state.IMUI }, me);

  return (
    <header className="top rd-top">
      {/* D60 b · the top-bar Find investor is a real search box — FindBox (features/leads) */}
      {navFor(state).some((n) => n.k === "leads") ? <FindBox /> : null}

      <div className="sp" />

      {/* THE SAVE/CONNECTION STATUS — D41, redesigned markup and wording: saveStatusHTML(),
          03-app.js:4668. The queue, the retry and the online read are unchanged; only the frame
          and the copy are the prototype's own — `#save-status` (a live region, not a disclosure),
          the dot's three tones (online is the base colour, no modifier class), and the summary
          line's three optional clauses, joined by " · ". */}
      <div id="save-status" className="save-status" role="status" aria-live="polite">
        <span className={`save-dot ${saveTone}`} aria-hidden="true" />
        <span>
          {/* M01-S09-W1: the source is what GET /api/data's fresh block said (dataRead.source) */}
          <b>{`Browser ${browserOnline ? "online" : "offline"} · ${dataRead.source === "zoho" ? "Zoho" : "Local demo"}`}</b>
          <small>{saveSummary || (state.FIXTURES ? "Demo fixtures · no live source connected" : dataRead.source === "zoho" ? "Live from Zoho, on your own sign-in" : "No live source connected")}</small>
          <DataFresh />
        </span>
        {failedSaves.length > 0 ? (
          <button type="button" className="chip" onClick={() => failedSaves.forEach((s) => retrySave?.(s.key))}>
            Retry
          </button>
        ) : null}
      </div>

      {mayCapture && !capOpen ? (
        <button
          type="button"
          className="btn cap"
          id="capb"
          onClick={() => dispatch({ type: "openDrawer", k: "p:add.quick" })}
          title="Add lead — opens beside this page"
          aria-label="Add lead"
        >
          <Icon name="add" />
          <span className="cxt">Add lead</span>
        </button>
      ) : null}

      {/* #helpb — the redesigned markup ships this `hidden` and draw() never clears it
         (ir-console-redesigned.html:2381); help is reached from the account menu and the "?" key
         (Shell.tsx) instead. Rendering a button the prototype itself never shows would be drawing
         dead chrome, not porting behaviour, so it is dropped rather than kept hidden. */}

      {navFor(state).some((n) => n.k === "updates") ? (
        <button
          type="button"
          className="btn bell"
          id="bell"
          onClick={() => dispatch({ type: "openDrawer", k: "updates" })}
          aria-label={nUp ? `Updates — ${nUp} unread` : "Updates — nothing new"}
        >
          <Icon name="updates" />
          {nUp ? <span className="bdot">{nUp > 9 ? "9+" : nUp}</span> : null}
        </button>
      ) : null}

      <button
        type="button"
        className="who"
        id="who"
        title="Your account"
        aria-label="Your account"
        onClick={() => dispatch({ type: "openDrawer", k: "account" })}
      >
        <span
          className={`av${p.sq ? " sq" : ""}`}
          id="av"
          style={{ ["--pc" as string]: p.c ? `var(--c${p.c})` : "var(--ink-3)", borderRadius: p.sq ? "9px" : "50%" }}
        >
          {p.i}
        </span>
        <span className="rd-account-label">
          <b id="wn">{p.n}</b>
          <span className="role" id="wr">
            {titleOf(me)}
          </span>
        </span>
        <Icon name="chev" className="cv" />
      </button>

      <div className="rd-header-context">
        <span id="cov">
          {outFor(state, me) ? (
            <span className="tag cov">
              <span className="dot" />
              {myCov ? `out — ${P(state.PEOPLE, myCov.by as PersonKey).n} covering` : `out until ${outTo(state, me)}`}
            </span>
          ) : out ? (
            <span className="tag cov">
              <span className="dot" />
              {`out — ${P(state.PEOPLE, out.by as PersonKey).n} covering`}
            </span>
          ) : covers ? (
            <span className="tag cov">
              <span className="dot" />
              {`covering ${covers}`}
            </span>
          ) : null}

          {tg ? (
            <span
              className="tag br"
              style={{ marginLeft: "6px" }}
              title={`${pageTitle(tg.page)} lent by ${P(state.PEOPLE, tg.by as PersonKey).n} until ${tg.until} — everything you do with it is recorded against this grant`}
            >
              <span className="dot" />
              {`borrowed: ${pageTitle(tg.page)}`}
            </span>
          ) : lent.length ? (
            <span
              className="tag"
              style={{ marginLeft: "6px" }}
              role="button"
              tabIndex={0}
              onClick={() => router.push(pathOf("me" as View))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(pathOf("me" as View));
                }
              }}
              title="Switch it on from your profile"
            >
              {`${lent.length} lent to you`}
            </span>
          ) : null}
          {ro ? (
            <span className="tag ro" style={{ marginLeft: "6px" }}>
              <span className="dot" />
              read only
            </span>
          ) : null}
        </span>
        <span id="tbk">
          <UndoNotice state={state} dispatch={dispatch} />
        </span>
      </div>
    </header>
  );
}

/* THE UNDO NOTICE — the redesigned prototype's #tbk, drawn each time by draw() ~13091–13107. Takes
   back whichever of the three one-click writes TJUST names, for as long as it is still fresh; goes
   silent the moment it is not — no "Undo" button that quietly does nothing. */
function UndoNotice({ state, dispatch }: { state: ConsoleState; dispatch: (a: Action) => unknown }) {
  const t = state.TJUST;
  if (!t) return null;
  const tj = state.LEADS.find((l) => l.id === t.id);
  if (!tj) return null;

  let call: (() => void) | null = null;
  let what = "";
  let verb = "";
  if (t.w === "own") {
    verb = "the pick-up";
    if (tj.own === t.to && (canAssign(state) || (isIR(state.ROLE) && t.to === state.WHO))) {
      what = `${tj.n} on ${P(state.PEOPLE, t.to).n}'s book`;
      call = () => dispatch({ type: "dropAssign", id: t.id });
    }
  } else if (t.w === "rung") {
    verb = "the rung";
    const blocked = !!state.PAY[t.id] && tj.done <= ST.PAID;
    if (canWork(state, tj) && tj.done === t.r && undoStage(state, tj).ok && !blocked) {
      what = `${LADDER[t.r - 1]!.t} against ${tj.n}`;
      call = () => dispatch({ type: "untick", id: t.id });
    }
  } else {
    verb = "the touch";
    if (canWork(state, tj) && tList(tj, t.k).includes(t.at)) {
      what = `${TOUCHDONE[t.k as keyof typeof TOUCHDONE] ?? t.k} against ${tj.n}`;
      call = () => dispatch({ type: "dropTouch", id: t.id, k: t.k, at: t.at });
    }
  }
  if (!call) return null;

  return (
    <button
      type="button"
      className="btn"
      onClick={call}
      aria-label={`Undo — ${what}`}
      title={`${what}, recorded ${agoStr(t.at, state.NOW)} — a one-click record can be taken back for ${EDIT_H} hours`}
    >
      {`Undo ${verb}`}
    </button>
  );
}

