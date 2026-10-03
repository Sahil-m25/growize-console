"use client";

/* People's four drawers — ir-console-redesigned.html 12287–12360 (temp), 12599–12601 (leaver),
   12605–12664 (person), 12680–12706 (newp).

   Everything about ONE person — their seat, their team, their grid, their absence — opens in the
   person drawer, so the screen behind never splits into two columns the eye has to choose between.

   Staff handover gets its OWN drawer, exactly as the redesign draws it — 500px, titled "Handover
   and remove member", opened by the "Handover and remove member" button and returned from by "Back
   to member" — registered as a "p:" panel (`registerDrawer("p:leaver", …)`, `DrawerKind`'s
   `p:${string}` case, `src/lib/store.tsx`) rather than a fifth named `DrawerKind`: `canOpenDrawer`
   already lets every "p:" panel decide for itself (`src/lib/selectors/access.ts`), so this needs no
   cross-owner change at all — only the `ok` this file already writes for `person`. */

import { BYGRANT, CAPT, NOSIGN, PAGECAPS, SEAT, SEATSCREENS, ST, TDUR } from "@/domain";
import type { Cap, NavKey, PersonKey, SeatKey } from "@/domain";
import { Pav, Pname } from "@/components/ui";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers";
import { plusDays } from "@/lib/format";
import {
  avail,
  canGrant,
  canManage,
  canRosterFor,
  capsBase,
  chainOf,
  consoleAccount,
  gone,
  isMgr,
  lost,
  manageable,
  mgrOf,
  moveCost,
  myCaps,
  openable,
  outFor,
  own,
  P,
  planFor,
  reachBase,
  reachCeil,
  reachOf,
  roleOf,
  seatClash,
  seatReach,
  seatShape,
  teamName,
  teamOfPerson,
  tempFor,
  titleOf,
  capsFor,
} from "@/lib/selectors";
import { useConsole, type ConsoleState } from "@/lib/store";
import { useState } from "react";
import { useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { grantAdd, grantRemove, leadSeatChange, managerChange } from "@/lib/data/endpoints/access";
import { teamMember, type PersonView } from "@/lib/data/endpoints/teams";
import { titleOf as imAwareTitle } from "@/components/shell/SignIn";
import {
  absOpen,
  devWords,
  leaverMayManage,
  leaverPlan,
  leaverSuccessors,
  openPerson,
  screenCount,
  screensOf,
  tCanLend,
  tPages,
} from "./helpers";
import { leaverDraft, newp, roleAllowsCap, tgt, type NewPerson } from "./reducer";
import { UxDetails } from "./UxDetails";

/* ---- LEND A PAGE ------------------------------------------------------------------------------
   Nobody hands over a password here. You lend one page, to one person, until a date — and never
   anything you do not hold yourself. 03-app.js:6496 */

const lendOK = (s: ConsoleState): boolean => {
  const T = tgt(s);
  return !!(T.to && T.page && TDUR[T.dur] && (T.why || "").trim());
};

function TempBody() {
  const { state, dispatch } = useConsole();
  const T = tgt(state);
  const who = manageable(state).filter((k) => state.PEOPLE[k].on && canManage(state, k));
  const pages = tPages(state);
  const caps: Cap[] = T.page ? capsBase(state, state.WHO, T.page) : [];
  const ok = lendOK(state);

  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>
        The member activates this grant from Profile. Access expires automatically.
      </p>
      <p className="lbl">To whom</p>
      <select
        className="selw"
        aria-label="To whom"
        value={T.to ?? ""}
        onChange={(e) => dispatch({ type: "tSet", f: "to", v: e.target.value })}
      >
        <option value="">Choose a person…</option>
        {who.map((k) => (
          <option value={k} key={k}>
            {P(state.PEOPLE, k).n} — {imAwareTitle(state, k)}
            {avail(state, k) ? "" : " · out"}
          </option>
        ))}
      </select>
      <p className="lbl" style={{ marginTop: "14px" }}>
        Which page
      </p>
      <select
        className="selw"
        aria-label="Which page"
        value={T.page ?? ""}
        onChange={(e) => dispatch({ type: "tSet", f: "page", v: e.target.value })}
      >
        <option value="">Choose a page…</option>
        {pages.map((x) => (
          <option value={x} key={x}>
            {PAGECAPS[x as NavKey]!.t}
            {T.to && reachBase(state.PEOPLE, T.to, state.CAPS).includes(x) ? " — they already reach it" : ""}
          </option>
        ))}
      </select>
      {T.page ? (
        <details className="ux-disclosure" data-ux-key="grant-actions">
          <summary>Allowed actions · {T.caps.length}</summary>
          <p className="lbl" style={{ marginTop: "14px" }}>
            What they may do with it
          </p>
          <div className="chips">
            {caps.map((c) => (
              <button
                type="button"
                key={c}
                className={`chip ${T.caps.includes(c) ? "on" : ""}`}
                aria-pressed={T.caps.includes(c)}
                {...(c === "view"
                  ? { disabled: true, title: "Seeing it is the floor" }
                  : { onClick: () => dispatch({ type: "tSet", f: "cap", v: c }) })}
              >
                {CAPT[c] || c}
              </button>
            ))}
          </div>
          <p className="sm" style={{ margin: "8px 0 0" }}>
            Only actions you hold can be granted.
          </p>
        </details>
      ) : null}
      <p className="lbl" style={{ marginTop: "14px" }}>
        Until when
      </p>
      <select
        className="selw"
        aria-label="Access duration"
        value={T.dur}
        onChange={(e) => dispatch({ type: "tSet", f: "dur", v: e.target.value })}
      >
        {Object.entries(TDUR).map(([k, d]) => (
          <option value={k} key={k}>
            {d.t} · ends {plusDays(d.days as number, state.NOW)}
          </option>
        ))}
      </select>
      <label className="fi" style={{ marginTop: "14px" }}>
        <span>Why — this is on the record</span>
        <input
          className="inp"
          placeholder="e.g. covering Harsha while he is out"
          value={T.why}
          onChange={(e) => dispatch({ type: "tSet", f: "why", v: e.target.value })}
        />
      </label>
      <p className="sm" style={{ margin: "10px 0 0" }}>
        {ok && T.to && T.page ? (
          <>
            {P(state.PEOPLE, T.to).n} gets {PAGECAPS[T.page as NavKey]!.t} until{" "}
            {plusDays(TDUR[T.dur].days as number, state.NOW)}.
          </>
        ) : (
          "Choose a member, page, duration and reason."
        )}
      </p>
    </>
  );
}

function TempFoot() {
  const { state, dispatch } = useConsole();
  const ok = lendOK(state);
  return (
    <button
      type="button"
      className="act"
      disabled={!ok}
      title={ok ? undefined : "Person, page, window and reason"}
      onClick={ok ? () => dispatch({ type: "grantTemp" }) : undefined}
    >
      Grant access
    </button>
  );
}

registerDrawer("temp", {
  w: 480,
  title: () => "Grant temporary access",
  sub: () => "one page, one member, a limited time",
  Body: TempBody,
  Foot: TempFoot,
});

/* ---- ADD A MEMBER -----------------------------------------------------------------------------
   Name, email and position, then the tick/toggle grid the position fills in. 03-app.js:6748 */

/* newpOK() — 03-app.js:5665. The seat may not reach past the manager who was picked. */
export function newpOK(s: ConsoleState): boolean {
  const N = newp(s);
  if (!N) return false;
  const up = ([N.mgr] as (PersonKey | null)[])
    .concat(N.mgr ? chainOf(s.PEOPLE, N.mgr) : [])
    .filter(Boolean) as PersonKey[];
  return (
    (N.n || "").trim().length > 1 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((N.em || "").trim()) &&
    canGrant(s, N.seat) &&
    (SEATSCREENS[N.seat] || []).every((pg) => up.every((m) => seatReach(s.PEOPLE, m).indexOf(pg) >= 0))
  );
}

function NewpBody() {
  const { state, dispatch } = useConsole();
  const N: NewPerson | null = newp(state);
  if (!N) return null;
  const seats = (Object.keys(SEAT) as SeatKey[]).filter((st) => canGrant(state, st));
  const mgrs = [state.WHO].concat(
    manageable(state).filter(
      (k) =>
        state.PEOPLE[k].on &&
        ["conv", "exec", "ops"].includes(roleOf(state.PEOPLE, k) as string),
    ),
  );
  return (
    <>
      <p className="lbl">Full name</p>
      <input
        className="inp"
        id="npn"
        aria-label="Full name"
        style={{ width: "100%", marginBottom: "14px" }}
        placeholder="Priya Raghavan"
        value={N.n}
        onChange={(e) => dispatch({ type: "editPerson", k: "n", v: e.target.value })}
      />
      <p className="lbl">Work email</p>
      <input
        className="inp mono"
        id="npe"
        aria-label="Work email"
        style={{ width: "100%", marginBottom: "4px" }}
        placeholder="priya@agresearchlabs.com"
        value={N.em}
        onChange={(e) => dispatch({ type: "editPerson", k: "em", v: e.target.value })}
      />
      <p className="sm" style={{ margin: "0 0 14px" }}>
        Used for sign-in and document copies. An administrator manages later changes.
      </p>
      <p className="lbl">Role</p>
      <select
        className="selw"
        id="npseat"
        aria-label="Position"
        value={N.seat}
        onChange={(e) => dispatch({ type: "editPerson", k: "seat", v: e.target.value })}
      >
        {seats.map((st) => (
          <option value={st} key={st}>
            {SEAT[st]}
            {(BYGRANT as readonly string[]).includes(st) ? " — no access until granted" : " — console access"}
          </option>
        ))}
      </select>
      {(BYGRANT as readonly string[]).includes(N.seat) ? (
        <p className="sm" style={{ margin: "7px 0 0" }}>
          This role has no console access by default. Add them, then grant pages in their Page permissions —
          they reach only what you grant.
        </p>
      ) : null}
      <p className="lbl" style={{ marginTop: "14px" }}>
        Reports to
      </p>
      <select
        className="selw"
        id="npmgr"
        aria-label="Reports to"
        value={N.mgr ?? ""}
        onChange={(e) => dispatch({ type: "editPerson", k: "mgr", v: e.target.value })}
      >
        {mgrs.map((k) => (
          <option value={k} key={k}>
            {P(state.PEOPLE, k).n}
          </option>
        ))}
      </select>
      <p className="sm" style={{ margin: "12px 0 0" }}>
        The role applies its permission preset within the manager&apos;s access. Review individual
        permissions after adding the member.
      </p>
    </>
  );
}

function NewpFoot() {
  const { state, dispatch } = useConsole();
  const N = newp(state);
  const n = ((N || { n: "" }).n || "").trim();
  const em = ((N || { em: "" }).em || "").trim();
  const ok = newpOK(state);
  const why = !N
    ? ""
    : n.length < 2
      ? "A full name first"
      : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)
        ? "That address will not send"
        : !ok
          ? "That seat reaches past the manager you picked"
          : "";
  return (
    <>
      <button
        type="button"
        className="act"
        disabled={!ok}
        title={ok ? undefined : why}
        onClick={
          ok
            ? () => {
                const result = dispatch({ type: "addPerson" });
                if (result?.status === "completed") dispatch({ type: "closeDrawer" });
              }
            : undefined
        }
      >
        Add {n.split(/\s+/)[0] || "them"}
      </button>
      {why ? <span className="sm">{why}</span> : null}
      <button
        type="button"
        className="chip"
        onClick={() => {
          dispatch({ type: "cancelPerson" });
          dispatch({ type: "closeDrawer" });
        }}
      >
        Discard this member
      </button>
    </>
  );
}

registerDrawer("newp", {
  w: 460,
  title: () => "Add a member",
  sub: () => "name, work email, role and manager",
  Body: NewpBody,
  Foot: NewpFoot,
});

/* ---- STAFF HANDOVER — the "leaver" review, folded into this drawer (see the file header) --------
   ir-console-redesigned.html:11117-11146 (`leaverPlan`), 11147-11157 (`leaverReview`),
   11158-11186 (`removePerson`). Reviewed before it removes anybody: the successor picked here is
   the one `removePerson` reads back off the store when the drawer's own button applies it. */

function LeaverBody({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const k = id as PersonKey;
  const draftId = state.WHO + ":" + k;
  const draft = leaverDraft(state, k);
  const plan = leaverPlan(state, k, draft.to);
  const choices = leaverSuccessors(state, k);
  const pick = (to: PersonKey | null) =>
    dispatch({
      type: "setUi",
      patch: { LEAVER: { ...(state.ui.LEAVER || {}), [draftId]: { ...draft, to, applyError: "" } } },
    });

  return (
    <section className="ux-section">
      <p className="ux-secondary">Review the handover before ending {P(state.PEOPLE, k).n}&apos;s access.</p>
      <dl className="kv">
        <dt>Owned IR leads</dt>
        <dd>
          <b>{plan.owned.length}</b> · all stages, including completed and lost
        </dd>
        <dt>Secondary roles</dt>
        <dd>{plan.secondary}</dd>
        <dt>Cover assignments</dt>
        <dd>{plan.covers}</dd>
        <dt>Unique lead records</dt>
        <dd>{plan.affected.length}</dd>
        <dt>Reports</dt>
        <dd>
          {plan.kids.length}
          {plan.kids.length ? <> · move to {plan.up ? P(state.PEOPLE, plan.up).n : "no reporting manager"}</> : null}
        </dd>
      </dl>
      {plan.needsSuccessor ? (
        <label className="fi" style={{ marginTop: "18px" }}>
          <span>Receive this IR work</span>
          <select
            className="selw"
            id="leaver-successor"
            value={draft.to ?? ""}
            onChange={(e) => pick((e.target.value || null) as PersonKey | null)}
          >
            <option value="">Choose an active IR teammate…</option>
            {choices.map((x) => (
              <option value={x} key={x}>
                {P(state.PEOPLE, x).n} · {state.LEADS.filter((l) => l.own === x).length} owned leads
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="sm">This member has no IR work requiring a successor.</p>
      )}
      {draft.to && !plan.error ? (
        <p className="note" style={{ marginTop: "14px" }}>
          <b>{P(state.PEOPLE, draft.to).n}</b> receives {plan.owned.length} owned lead
          {plan.owned.length === 1 ? "" : "s"} and the applicable secondary and cover work. Cover on
          transferred owned leads ends; duplicate owner and secondary roles are cleared.
        </p>
      ) : null}
      {plan.affected.length ? (
        <details className="ux-disclosure" data-ux-key={`leaver-records-${k}`}>
          <summary>Review {plan.affected.length} affected lead records</summary>
          <div className="ux-section">
            {plan.affected.map((l) => {
              const seen = openable(state).some((x) => x.id === l.id);
              const suffix = seen
                ? l.done >= ST.ONBOARDED
                  ? " · completed"
                  : lost(l)
                    ? " · lost"
                    : ""
                : " · included in the handover";
              return (
                <div className="mini" key={l.id}>
                  <span>
                    <b>{seen ? l.n : "Investor outside your access"}</b>
                    <span className="sm">
                      {" "}
                      · {l.own === k ? "Owned" : l.sec === k ? "Secondary" : "Cover"}
                      {suffix}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
      <p className="sm">
        Follow-ups, stages, notes, receipts and past activity keep their content and original
        authors. This action changes staff responsibility in this console; it does not transfer
        investments or Finance records. Active temporary access granted to or by this member ends.
      </p>
      {draft.applyError ? (
        <p className="note bad" role="alert">
          {draft.applyError}
        </p>
      ) : plan.error ? (
        <p className="sm" role="status">
          {plan.error}
        </p>
      ) : null}
    </section>
  );
}

function LeaverFoot({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const k = id as PersonKey;
  const draftId = state.WHO + ":" + k;
  const draft = leaverDraft(state, k);
  const plan = leaverPlan(state, k, draft.to);
  return (
    <>
      <button type="button" className="btn" onClick={() => dispatch(openPerson(k))}>
        Back to member
      </button>
      <button
        type="button"
        className="act"
        disabled={!!plan.error}
        onClick={() => {
          const result = dispatch({ type: "removePerson", k });
          if (result?.status !== "completed" && result?.status !== "pending") {
            dispatch({
              type: "setUi",
              patch: {
                LEAVER: {
                  ...(state.ui.LEAVER || {}),
                  [draftId]: {
                    ...draft,
                    applyError:
                      "The handover was not saved. Your selection is retained; review it and try again.",
                  },
                },
              },
            });
          }
        }}
      >
        {plan.needsSuccessor ? "Handover and remove" : "Remove member"}
      </button>
    </>
  );
}

registerDrawer("p:leaver", {
  w: 500,
  ok: (state, id) => !!id && leaverMayManage(state, id as PersonKey),
  title: () => "Handover and remove member",
  sub: (state, a) => P(state.PEOPLE, a.id as PersonKey).n,
  Body: LeaverBody,
  Foot: LeaverFoot,
});

/* ---- ONE PERSON -------------------------------------------------------------------------------
   The grid is the ceiling made visible: a page their chain cannot reach is marked, not silently
   dropped, and a capability you do not hold yourself is locked rather than merely inert.
   ir-console-redesigned.html:12605-12664 */

/* M17-S01-W2: the drawer's availability, clash and "changed from the seat" are GET /api/teams/{id} (endpoints/teams teamMember).
   The edit controls below still read the book, so they show only where the book holds the person (the demo); live the member is
   drawn read only from the route alone. */
const AVAIL_CLASH = (pv: PersonView) => pv.clash.map((x) => (PAGECAPS as Record<string, { t: string }>)[x]?.t ?? x).join(", ");

function AvailBlock({ pv, k }: { pv: PersonView; k: PersonKey }) {
  const { state } = useConsole();
  return (
    <div className="ux-availability">
      <div className="ux-account-person">
        {state.PEOPLE[k] ? <Pav k={k} size="lg" /> : null}
        <div>
          <b>{pv.name}</b>
          <span>{pv.email || "No address on file"}</span>
        </div>
      </div>
      <section className="ux-account-availability">
        <div>
          <b>Availability</b>
          <span className={`tag ${pv.availability.out ? "cov" : "go"}`}>
            <span className="dot" />
            {pv.availability.out ? "Out" : "In"}
          </span>
        </div>
        <p>{pv.availability.detail}</p>
        {pv.availability.cover ? <p>{pv.availability.cover}</p> : null}
      </section>
    </div>
  );
}

function ClashNote({ pv }: { pv: PersonView }) {
  return pv.clash.length ? (
    <div className="note bad" style={{ marginTop: "12px" }}>
      Their seat asks for <b>{AVAIL_CLASH(pv)}</b>, which {pv.managerName ?? "their team"} cannot reach — so neither can they.
      Either move them to a manager who reaches it, or change the seat.
    </div>
  ) : null;
}

/** The member from the route alone (live: the book holds nobody). Read only. */
function LiveMember({ pv }: { pv: PersonView }) {
  return (
    <>
      <AvailBlock pv={pv} k={pv.id} />
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Seat</dt>
        <dd>{pv.seatLabel || "—"}</dd>
        <dt>Team</dt>
        <dd>{pv.team ?? "—"}{pv.managerName ? <> · under {pv.managerName}</> : null}</dd>
        {pv.leads !== null ? (
          <>
            <dt>Carries</dt>
            <dd>{pv.leads} lead{pv.leads === 1 ? "" : "s"}</dd>
          </>
        ) : null}
        {pv.side === "lead" ? (
          <>
            <dt>Reaches</dt>
            <dd>
              {pv.screens} of {screenCount()} screens
              {pv.changed.length ? <>{" "}<span className="tag br" title={devWords(pv.changed)}>{pv.changed.length} changed from the seat</span></> : null}
            </dd>
          </>
        ) : null}
      </dl>
      <ClashNote pv={pv} />
    </>
  );
}

function PersonBody({ id }: DrawerProps) {
  const { state, dispatch: dispatchable } = useConsole();
  const k = id as PersonKey;
  const member = useApiRead(teamMember, state, id);
  /* M17-S02-W1 / M03-S04-W1 / M03-S02-W1: the manager, the seat and a page reset go through their routes
     (endpoints/access); a refusal is the route's own message, shown here */
  const [err, setErr] = useState<string | null>(null);
  const setMgr = useApiWrite(managerChange, state, dispatchable);
  const setSeat = useApiWrite(leadSeatChange, state, dispatchable);
  const resetPage = useApiWrite(grantRemove, state, dispatchable);
  const said = (r: { ok: boolean; error?: string }) => setErr(r.ok ? null : r.error ?? null);
  if (member.state === "idle" || member.state === "loading") return <p className="sm">Reading the member…</p>;
  if (member.state === "error") return <p className="note bad" role="alert">{member.err.error}</p>;
  const pv = member.data;
  if (!state.PEOPLE[k]) return <LiveMember pv={pv} />;

  const edit = own(state, "people", "seats") && canManage(state, k);
  const t = teamOfPerson(state.PEOPLE, k);
  const mgr = mgrOf(state.PEOPLE, k);
  const opts = [state.WHO]
    .concat(
      manageable(state).filter((x) => state.PEOPLE[x].on && x !== k && isMgr(state.PEOPLE, x)),
    )
    .filter((x, i, a) => a.indexOf(x) === i && x !== k);
  const mine = state.LEADS.filter((l) => l.own === k).length;
  const lent = tempFor(state, k);
  const deviations = pv.changed;
  const byg = (BYGRANT as readonly string[]).includes(roleOf(state.PEOPLE, k) || "");
  const acct = consoleAccount(state.PEOPLE, k, state.CAPS);
  const ceil = reachCeil(state.PEOPLE, k);
  const held = state.CAPS[k] as Record<string, Cap[]> | undefined;

  return (
    <>
      <AvailBlock pv={pv} k={k} />

      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Seat</dt>
        <dd>{SEAT[roleOf(state.PEOPLE, k) as SeatKey] || "—"}</dd>
        <dt>Team</dt>
        <dd>
          {t ? teamName(state.PEOPLE, t) : "—"}
          {mgr ? (
            <>
              {" "}
              · under <Pname k={mgr} nw cls="xs" />
            </>
          ) : isMgr(state.PEOPLE, k) ? (
            " · leads it"
          ) : null}
        </dd>
        <dt>Carries</dt>
        <dd>
          {mine} lead{mine === 1 ? "" : "s"} ·{" "}
          {state.LEADS.filter((l) => l.sec === k).length} as secondary
        </dd>
        {lent.length ? (
          <>
            <dt>Lent to them</dt>
            <dd>
              {lent.map((g, i) => (
                <span key={g.id}>
                  {i ? <br /> : null}
                  {PAGECAPS[g.page as NavKey]!.t} until {g.until}
                  {g.by === state.WHO ? "" : " · by " + P(state.PEOPLE, g.by).n.split(" ")[0]}
                </span>
              ))}
            </dd>
          </>
        ) : null}
        <dt>Reaches</dt>
        <dd>
          {byg && !acct ? "No console access — nothing granted" : <>
          {screensOf(state, k).length} of {screenCount()} screens
          {byg ? " · by grant" : deviations.length ? (
            <>
              {" "}
              <span className="tag br" title={devWords(deviations)}>
                {deviations.length} changed from the seat
              </span>
            </>
          ) : null}
          </>}
        </dd>
      </dl>

      <ClashNote pv={pv} />

      {err ? <p className="note bad" role="alert" style={{ marginTop: "12px" }}>{err}</p> : null}

      {edit ? (
        <details className="ux-disclosure" data-ux-key={`person-role-${k}`}>
          <summary>Role and reporting manager</summary>
          <div className="drwsec">
            <p className="lbl">Reports to</p>
            <select
              className="selw"
              id="pmgr"
              aria-label="Reports to"
              value={mgr ?? ""}
              onChange={(e) => void setMgr({ whom: k, manager: (e.target.value || null) as PersonKey | null }).then(said)}
            >
              <option value="">Nobody — they sit at the top</option>
              {opts.map((x) => {
                const c = moveCost(state.PEOPLE, k, x, state.CAPS);
                return (
                  <option value={x} key={x} disabled={!c.ok}>
                    {P(state.PEOPLE, x).n} — {teamName(state.PEOPLE, x)}
                    {c.ok
                      ? ""
                      : c.cycle
                        ? " (they already sit under this person)"
                        : " (cannot reach " +
                          c.lose
                            .map((y) => (PAGECAPS as Record<string, { t: string }>)[y]?.t ?? y)
                            .join(", ") +
                          ")"}
                  </option>
                );
              })}
            </select>
            <p className="sm" style={{ margin: "7px 0 0" }}>
              Changes save immediately. Incompatible managers are unavailable.
            </p>
          </div>

          <div className="drwsec">
            <p className="lbl">Position</p>
            <select
              className="selw"
              id="pseat"
              aria-label="Position"
              value={roleOf(state.PEOPLE, k) ?? ""}
              onChange={(e) => void setSeat({ whom: k, seat: e.target.value as SeatKey }).then(said)}
            >
              {(Object.keys(SEAT) as SeatKey[]).filter((seat) => !(NOSIGN as readonly string[]).includes(seat) || roleOf(state.PEOPLE, k) === seat).map((seat) => {
                const bad = seatClash(state.PEOPLE, k, seat);
                const can = canGrant(state, seat);
                return (
                  <option value={seat} key={seat} disabled={!(can && !bad.length)}>
                    {SEAT[seat]}
                    {can
                      ? bad.length
                        ? " — " +
                          (mgr ? P(state.PEOPLE, mgr).n : "their manager") +
                          " cannot reach " +
                          bad
                            .map((x) => (PAGECAPS as Record<string, { t: string }>)[x]?.t ?? x)
                            .join(", ")
                        : (BYGRANT as readonly string[]).includes(seat) ? " — no access until granted" : ""
                      : " — above your own access"}
                  </option>
                );
              })}
            </select>
            <p className="sm" style={{ margin: "7px 0 0" }}>
              Changing role resets its permission preset
              {state.CAPS[k] ? " and removes individual grants" : ""}. Only IR, IR Manager and Digital Infrastructure have access by default.
            </p>
          </div>
        </details>
      ) : null}

      <UxDetails k={`person-access-${k}`} force={byg && edit && !acct}>
        <summary>Page permissions · {byg && !acct ? "none granted" : screensOf(state, k).length + " accessible"}</summary>
        <div className="drwsec">
          <p className="lbl">
            {byg ? "Granted access" : "Individual access"}
            {state.CAPS[k] && edit ? " " : null}
            {state.CAPS[k] && edit ? (
              <button
                type="button"
                className="chip"
                style={{ padding: "1px 7px", fontSize: "var(--text-small)", marginLeft: "6px" }}
                onClick={() => dispatchable({ type: "resetCaps", k })}
              >
                {byg ? "Remove all access" : "Reset all to role"}
              </button>
            ) : null}
          </p>
          {byg ? (
            <p className="sm" style={{ margin: "0 0 10px" }}>
              {P(state.PEOPLE, k).n.split(" ")[0]} has no console access by default.{" "}
              {acct
                ? "They sign in and reach only the pages granted here; taking the last one away ends their access."
                : "Grant a page and they can sign in, reaching only what is granted here."}
            </p>
          ) : null}
          {(Object.keys(PAGECAPS) as NavKey[])
            .filter((pg) => pg !== "me" && (!byg || seatShape(state.PEOPLE, k, pg, PAGECAPS[pg]!.caps).length > 0))
            .map((pg) => {
              const mineCaps = myCaps(state, pg);
              const theirs = capsFor(state, k, pg);
              const over = !!(held && held[pg]);
              const blocked = ceil.indexOf(pg) < 0;
              const asks = seatReach(state.PEOPLE, k).indexOf(pg) >= 0;
              /* a granted-only seat that has lost its sign-in still shows what was granted, so the grid is
                 never a row of zeros hiding the one tick that would let them back in */
              const shown = byg && !acct ? (held && held[pg]) || [] : theirs;
              return (
                <UxDetails k={`person-page-${k}-${pg}`} key={pg}>
                  <summary>
                    {PAGECAPS[pg]!.t} · {shown.length} allowed
                    {over && shown.length ? (
                      <>
                        {" "}
                        <span className="tag br">{byg ? "granted" : "changed"}</span>
                      </>
                    ) : null}
                    {blocked ? (
                      <>
                        {" "}
                        <span
                          className={`tag ${asks ? "late" : ""}`}
                          title={
                            asks
                              ? "Their seat asks for this page; their manager cannot reach it"
                              : "Their seat cannot hold this page"
                          }
                        >
                          {asks ? "manager limit" : "not in role"}
                        </span>
                      </>
                    ) : null}
                  </summary>
                  {over && edit && !byg ? (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => void resetPage({ whom: k, page: pg }).then(said)}   /* DELETE /api/grants {whom, page} */
                    >
                      Reset this page to role
                    </button>
                  ) : null}
                  <div className="chips">
                    {PAGECAPS[pg]!.caps.map((c) => {
                      const can = mineCaps.includes(c);
                      const on = shown.includes(c);
                      const fits = seatShape(state.PEOPLE, k, pg, [c]).includes(c);
                      const live = can && edit && !blocked && fits;
                      return (
                        <button
                          type="button"
                          key={c}
                          className={`tgl ${on ? "on" : ""}`}
                          aria-pressed={on}
                          {...(live
                            ? {
                                /* toggleCap (ir-console-redesigned.html:3026-3032) refuses before
                                   ever opening the drawer when the target's role could never hold
                                   this cap — a silent no-op, not a failed save. */
                                onClick: () => {
                                  if (!roleAllowsCap(state, k, pg, c)) return;
                                  dispatchable({ type: "openDrawer", k: "p:cap", id: `${k}|${pg}|${c}` });
                                },
                              }
                            : {
                                disabled: true,
                                title: blocked
                                  ? "Their manager cannot reach this page, so neither can they"
                                  : !fits
                                    ? "Their role cannot hold this, whoever grants it"
                                  : !can && on
                                    ? "They hold this from their seat — you do not have it yourself, so you cannot take it away"
                                    : !can
                                      ? "You do not have this yourself"
                                      : "View only for you",
                              })}
                        >
                          {on ? "✓" : can && !blocked && fits ? "" : "🔒"} {CAPT[c]}
                        </button>
                      );
                    })}
                  </div>
                </UxDetails>
              );
            })}
          <p className="sm" style={{ margin: "10px 0 0" }}>
            {roleOf(state.PEOPLE, state.WHO) === "conv"
              ? "You can adjust access for the IRs who report to you, and only within your own. Changes are logged."
              : "Grant only access you hold. Changes are logged and shown in their Updates."}
          </p>
        </div>
      </UxDetails>

      {edit ? (
        <details className="ux-disclosure" data-ux-key={`person-administration-${k}`}>
          <summary>Temporary access and staff handover</summary>
          <div className="ux-toolbar">
            {lent
              .filter((g) => g.by === state.WHO)
              .map((g) => (
                <button
                  type="button"
                  key={g.id}
                  className="chip"
                  onClick={() => dispatchable({ type: "revokeTemp", id: g.id })}
                >
                  End {PAGECAPS[g.page as NavKey]!.t} access
                </button>
              ))}
            {leaverMayManage(state, k) ? (
              <button
                type="button"
                className="chip"
                onClick={() => {
                  const draftId = state.WHO + ":" + k;
                  dispatchable({
                    type: "setUi",
                    patch: {
                      LEAVER: {
                        ...(state.ui.LEAVER || {}),
                        [draftId]: { ...leaverDraft(state, k), applyError: "" },
                      },
                    },
                  });
                  dispatchable({ type: "openDrawer", k: "p:leaver", id: k });
                }}
              >
                Handover and remove member
              </button>
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  );
}

/* ir-console-redesigned.html:12678. Two independent halves, never one gate over both: the roster
   button shows whenever `canRosterFor(k)` is true — including a member opening their own drawer,
   who does not hold `people.seats` — and the read-only line is what shows in its place, never
   alongside it. Lending is its own separate condition, only for someone with the seats authority
   over this person. */
function PersonFoot({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const k = id as PersonKey;
  const canAdmin = own(state, "people", "seats") && canManage(state, k);

  return (
    <>
      {canRosterFor(state, k) && !gone(state, k) ? (
        <button
          type="button"
          className="act"
          id={`ab2-${k}`}
          onClick={() => dispatch(absOpen(state, k))}
        >
          {outFor(state, k) ? "Change return date" : planFor(state, k) ? "Change planned absence" : "Set availability"}
        </button>
      ) : !canAdmin ? (
        <span className="sm">Member details are read only.</span>
      ) : null}
      {canAdmin && tCanLend(state) && consoleAccount(state.PEOPLE, k, state.CAPS) ? (
        <button
          type="button"
          className="chip"
          onClick={() => dispatch({ type: "startTemp", to: k })}
        >
          Grant temporary access
        </button>
      ) : null}
    </>
  );
}

registerDrawer("person", {
  w: 470,
  ok: (state, k) =>
    !!k &&
    (!Object.keys(state.PEOPLE).length ||   /* live: the route decides (see canOpenDrawer) */
      (!!state.PEOPLE[k as PersonKey] &&
        state.PEOPLE[k as PersonKey].on &&
        (k === state.WHO || canManage(state, k as PersonKey)))),
  /* live the book holds nobody: the row that opened the drawer seeded the name and the seat (openPerson) */
  title: (state, a) => (state.PEOPLE[a.id as PersonKey] ? P(state.PEOPLE, a.id as PersonKey).n : String(state.ui.PNAME ?? "Member")),
  sub: (state, a) => (state.PEOPLE[a.id as PersonKey] ? imAwareTitle(state, a.id as PersonKey) : String(state.ui.PSUB ?? "")),
  Body: PersonBody,
  Foot: PersonFoot,
});

/* ---- CHANGING WHAT SOMEBODY REACHES. The consequence, said before it happens: what moves, what
   does not, and a button that names the thing it is about to do. The person it happens to is told
   by the write itself. ir-console-redesigned.html:12738-12770 (DRAWERS.cap). Registered as a "p:"
   panel — see the note above PersonFoot on why a fifth named DrawerKind is unnecessary here too.
   The grid's tick (PersonBody, above) only opens this drawer now; the write it used to do straight
   through moved to CapFoot's own button, which dispatches "toggleCap" — the only action name
   store.tsx's Action union carries for this write (see crossOwnerRequests: a dedicated `capSave`/
   `resetCap` pair belongs there, in the shell-owned file this agent does not touch). */

function CapBody({ id }: DrawerProps) {
  const { state } = useConsole();
  const [k, p, c] = String(id).split("|") as [PersonKey, NavKey, Cap];
  const has = capsFor(state, k, p).includes(c);
  const page = PAGECAPS[p]!.t;
  const first = P(state.PEOPLE, k).n.split(" ")[0];
  const rest = capsFor(state, k, p)
    .filter((x) => x !== c)
    .map((x) => (CAPT[x] || x).toLowerCase())
    .join(", ");
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>
        {c === "view" && has ? (
          <>
            <b>{first} stops reaching {page}.</b> It comes off their rail, and every capability
            they hold on it goes with the page{rest ? " — " + rest : ""}. Anything already recorded
            from it stays exactly where it is.
          </>
        ) : has ? (
          <>
            <b>
              {first} keeps {page} and can no longer {(CAPT[c] || c).toLowerCase()} on it.
            </b>{" "}
            Every control that writes it is refused from that moment, and the screen says so where
            the control was.
          </>
        ) : c === "view" ? (
          <>
            <b>{first} starts reaching {page}.</b> It appears on their rail with “See it” and
            nothing else — every other capability on this page is its own tick.
          </>
        ) : (
          <>
            <b>
              {first} can {(CAPT[c] || c).toLowerCase()} on {page} from now on.
            </b>{" "}
            You can only hand over what you hold yourself, and this is one of yours.
          </>
        )}
      </p>
      <p className="sm" style={{ margin: "0 0 12px" }}>
        Existing investor ownership and records stay in place.
      </p>
      <details className="ux-disclosure" data-ux-key={`permission-change-${k}-${p}-${c}`}>
        <summary>Audit and restoring access</summary>
        <div className="ux-section">
          <p className="sm" style={{ margin: "0 0 9px" }}>
            The change is logged with your name and shown in {first}&apos;s Updates.
          </p>
          <p className="sm" style={{ margin: 0 }}>
            Use Reset this page to role in the member&apos;s permissions to restore the preset.
          </p>
        </div>
      </details>
    </>
  );
}

function CapFoot({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const [k, p, c] = String(id).split("|") as [PersonKey, NavKey, Cap];
  const has = capsFor(state, k, p).includes(c);
  /* M03-S02-W1: POST / DELETE /api/grants {whom, page, cap}; the route's refusal is shown here */
  const mode = useApiMode();
  const give = useApiWrite(grantAdd, state, dispatch);
  const take = useApiWrite(grantRemove, state, dispatch);
  const [err, setErr] = useState<string | null>(null);
  const press = () => void (has ? take : give)({ whom: k, page: p, cap: c }).then((r) => {
    if (!r.ok) { setErr(r.error); return; }
    /* fixture: the reducer's capSave already went back to the person; live: the route answered, go back */
    if (mode === "live") dispatch({ type: "openDrawer", k: "person", id: k });
  });
  const first = P(state.PEOPLE, k).n.split(" ")[0];
  const label =
    c === "view"
      ? has
        ? `Take ${PAGECAPS[p]!.t} off ${first}`
        : `Give ${first} ${PAGECAPS[p]!.t}`
      : has
        ? `Take “${CAPT[c]}” off ${first}`
        : `Give ${first} “${CAPT[c]}”`;
  return (
    <>
      {err ? <p className="note bad" role="alert">{err}</p> : null}
      <button type="button" className="act" onClick={press}>
        {label}
      </button>
      <button type="button" className="chip" onClick={() => dispatch({ type: "openDrawer", k: "person", id: k })}>
        Leave it as it is
      </button>
    </>
  );
}

registerDrawer("p:cap", {
  w: 430,
  ok: (state, id) => {
    const [k, p, c] = String(id || "").split("|");
    return (
      !!state.PEOPLE[k as PersonKey] &&
      !!PAGECAPS[p as NavKey] &&
      p !== "me" &&
      !!CAPT[c as Cap] &&
      canManage(state, k as PersonKey) &&
      own(state, "people", "seats") &&
      reachCeil(state.PEOPLE, k as PersonKey).indexOf(p) >= 0 &&
      seatShape(state.PEOPLE, k as PersonKey, p, [c as Cap]).includes(c as Cap) &&
      capsBase(state, state.WHO, p).includes(c as Cap)
    );
  },
  title: () => "Change what they reach",
  sub: (state, a) => P(state.PEOPLE, (a.id as string).split("|")[0] as PersonKey).n,
  Body: CapBody,
  Foot: CapFoot,
});

/* keep tCanLend reachable from the page that draws the Lend button */
export { tCanLend };
