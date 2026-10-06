"use client";

/* ── DRAWERS.owner and DRAWERS.reassign. 03-app.js 6601–6689 ────────────────────────────────
   CHANGING THE OWNER, said plainly. There used to be exactly one path out of a name: swap the
   primary with the secondary. That is not what a manager means by "move this to Kavya" — Kavya is
   usually not the secondary — so the honest verb was missing and people went round the product to
   get it. Three verbs now, and they are three different things:

     assign          a lead with no owner gets one
     reassignTo      the owner of record changes, to anyone who carries a book, with a reason
     handover        somebody carries it for a while and the owner does not change

   Everything a manager can do here, an IR can ask for; the reason list is the same closed list.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { DUR, REASONS } from "@/domain";
import type { PersonKey } from "@/domain";
import {
  active,
  assignees,
  canAskMove,
  canAssign,
  isIR,
  covOf,
  custodian,
  GATES,
  outFor,
  outTo,
  secondaryMayWork,
  secOK,
  P,
  titleOf,
} from "@/lib/selectors";
import { Pav, Pname } from "@/components/ui";
import { useState } from "react";
import { useConsole } from "@/lib/store";
import { useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { leadGate } from "@/lib/data/endpoints/lead";
import { useAssignToMe } from "@/lib/data/endpoints/ownership";
import { coverEnd, coverStart } from "@/lib/data/endpoints/cover";
import type { CoverDuration } from "@/server/leads/cover";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { uiAsto, uiMvto } from "@/features/leads/ui";

function OwnerBody({ lead }: DrawerProps) {
  const { state, dispatch, reloadData } = useConsole();
  const l = lead!;
  /* M08-S02-W1: where it stands is GET /api/leads/[id]/gate; M08-S05-W1: Start / End the cover are POST / DELETE /api/leads/[id]/cover */
  const gate = useApiRead(leadGate, state, l.id);
  const start = useApiWrite(coverStart, state, dispatch), end = useApiWrite(coverEnd, state, dispatch);
  const live = useApiMode() === "live";
  const [coverErr, setCoverErr] = useState<string | null>(null);
  const press = (r: Awaited<ReturnType<typeof start>>) => {
    /* fixture: the reducer did it (a refusal there is silent, as before); live: the route's answer is the page's */
    if (!live) return;
    if (r.ok) { setCoverErr(null); reloadData(); } else setCoverErr(r.error);
  };

  if (!l.own) {
    /* the door that opens this drawer only shows once the lead has no owner at all — matches the
       prototype's own no-owner branch of the "owner" body. The pick shares ASTO with the
       has-an-owner branch's own select below: one piece of drawer-local state, one place it is
       read back, same as the prototype's per-drawer draft. */
    const closed = custodian(l) === "Closed";
    const ASTO = uiAsto(state.ui);
    return (
      <>
        <div className="note due" style={{ marginTop: 0 }}>
          <b>No owner assigned.</b> Choose who will handle this investor's follow-ups.
        </div>
        {!closed && canAssign(state) ? (
          <>
            <label className="fi">
              <span>Owner</span>
              <select
                className="selw"
                aria-label="Assign an owner"
                value={ASTO ?? ""}
                onChange={(e) => dispatch({ type: "setAsTo", v: e.target.value || null })}
              >
                <option value="">Choose a person…</option>
                {assignees(state).map((k) => (
                  <option value={k} key={k}>
                    {P(state.PEOPLE, k).n} · {state.LEADS.filter((x) => x.own === k && active(x)).length}{" "}
                    active
                  </option>
                ))}
              </select>
            </label>
            <p className="sm" style={{ margin: "9px 0 0" }}>
              The selected owner receives this investor in their work list.
            </p>
          </>
        ) : (
          <p className="sm" style={{ margin: "9px 0 0" }}>
            {closed
              ? "This transferred record cannot be assigned."
              : "A manager can assign an owner from the Leads list."}
          </p>
        )}
      </>
    );
  }

  const c = covOf(state, l);
  const closed = custodian(l) === "Closed";
  /* who may start a cover: the owner, the secondary, whoever is already covering, or a manager */
  const mayCover =
    !closed &&
    custodian(l) === "IR" &&
    (canAssign(state) ||
      l.own === state.WHO ||
      (secOK(state,l) && secondaryMayWork(state,l)) ||
      (!!c && c.by === state.WHO));
  const mayMove = !closed && canAssign(state); /* changing the owner is a manager's act */
  const others = assignees(state).filter((k) => k !== l.own);
  const load = (k: PersonKey) => state.LEADS.filter((x) => x.own === k && active(x)).length;
  const ASTO = uiAsto(state.ui);
  const gr = gate.state === "ok" ? gate.data : null;
  const g = gr && gr.who && gr.gate ? GATES[gr.gate] : null;

  return (
    <>
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Owner of record</dt>
        <dd>
          <Pname k={l.own as PersonKey} b /> <span className="sm">{titleOf(state.PEOPLE, l.own as PersonKey)}</span>
        </dd>
        <dt>Secondary</dt>
        <dd>
          {l.sec ? (
            <>
              <Pname k={l.sec} /> <span className="sm">{titleOf(state.PEOPLE, l.sec)}</span>
            </>
          ) : (
            <span className="sm">nobody named</span>
          )}
        </dd>
        {c ? (
          <>
            <dt>Acting</dt>
            <dd>
              <span className="tag cov">
                <Pav k={c.by} size="xs" /> {P(state.PEOPLE, c.by).n}
              </span>{" "}
              until {c.to} · {c.why || ""}
            </dd>
          </>
        ) : null}
        <dt>Where it stands</dt>
        <dd>
          {closed ? (
            <span className="tag">every rung done</span>
          ) : g ? (
            <>
              <span className="tag due">
                <span className="dot" />
                waiting on Finance
              </span>{" "}
              <span className="sm">{g.t}</span>
            </>
          ) : (
            <span className="tag go">
              <span className="dot" />
              the IR's move
            </span>
          )}
        </dd>
      </dl>

      {closed ? (
        <p className="sm" style={{ margin: "12px 0 0" }}>
          This one is transferred. The names on it are history now and nothing here changes them.
        </p>
      ) : null}

      {mayMove ? (
        <details className="ux-disclosure">
          <summary>Change the owner permanently</summary>
          <div className="ux-section">
          <p className="sm" style={{ margin: "0 0 9px" }}>
            Choose a person and reason. The change is logged when you save.
          </p>
          <select
            className="selw"
            aria-label="New owner"
            value={ASTO ?? ""}
            onChange={(e) => dispatch({ type: "setAsTo", v: e.target.value || null })}
          >
            <option value="">Choose a person…</option>
            {others.map((k) => (
              <option value={k} key={k}>
                {P(state.PEOPLE, k).n} — {load(k)} active
              </option>
            ))}
          </select>
          <div className="chips" style={{ marginTop: "10px" }}>
            {REASONS.map((r) => (
              <button
                type="button"
                key={r}
                className="chip"
                disabled={!ASTO}
                title={ASTO ? undefined : "Pick the person first"}
                onClick={
                  ASTO ? () => dispatch({ type: "reassignTo", id: l.id, to: ASTO, why: r }) : undefined
                }
              >
                {r}
              </button>
            ))}
          </div>
          <p className="sm" style={{ margin: "9px 0 0" }}>
            {ASTO ? (
              <>
                <Pname k={ASTO} cls="xs" nw /> carries {load(ASTO)} active lead
                {load(ASTO) === 1 ? "" : "s"} today. Pick the reason to make the move.
              </>
            ) : (
              "Nothing happens until both are chosen."
            )}
          </p>
          </div>
        </details>
      ) : null}

      {mayCover ? (
        <div className="drwsec">
          <p className="lbl">Temporary cover</p>
          {coverErr ? <p className="ux-date-error" role="alert">{coverErr}</p> : null}
          {c ? (
            <>
              <p className="sm" style={{ margin: "0 0 9px" }}>
                {P(state.PEOPLE, c.by).n} is carrying it until {c.to}.{" "}
                {P(state.PEOPLE, l.own).n.split(" ")[0]} is still the owner and still sees
                everything.
              </p>
              <button
                type="button"
                className="act"
                onClick={() => void end({ id: l.id, expectedModifiedTime: l.mt ?? null }).then(press)}
              >
                End the cover
              </button>
            </>
          ) : l.sec ? (
            <>
              <p className="sm" style={{ margin: "0 0 9px" }}>
                {P(state.PEOPLE, l.sec).n} covers this investor; {P(state.PEOPLE, l.own).n} remains
                the owner. Choose a duration to start.
              </p>
              <div className="chips">
                {Object.entries(DUR).map(([k, d]) => (
                  <button
                    type="button"
                    key={k}
                    className="chip"
                    onClick={() => void start({ id: l.id, expectedModifiedTime: l.mt ?? null, duration: k as CoverDuration }).then(press)}
                  >
                    Start · {d.t}
                    {d.days === null && outFor(state, l.own as PersonKey) ? (
                      <span className="u">{outTo(state, l.own as PersonKey)}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="sm" style={{ margin: 0 }}>
              There is nobody to hand it to — no secondary is named.
            </p>
          )}
        </div>
      ) : null}

      {!closed && canAssign(state) ? (
        <details className="ux-disclosure">
          <summary>Change the secondary</summary>
          <div className="ux-section">
          <label className="fi">
            <span>Secondary</span>
            <select
              className="selw"
              aria-label="Secondary owner"
              value={l.sec ?? ""}
              onChange={(e) => e.target.value && dispatch({ type: "setSecondary", id: l.id, to: e.target.value as PersonKey })}
            >
              <option value="">Choose a person…</option>
              {others.map((k) => (
                <option value={k} key={k}>
                  {P(state.PEOPLE, k).n}
                </option>
              ))}
            </select>
          </label>
          <p className="sm" style={{ margin: "7px 0 0" }}>
            Saves immediately. This person covers when the owner cannot.
          </p>
          </div>
        </details>
      ) : null}

      {canAskMove(state, l) ? (
        <div className="drwsec">
          <p className="lbl">Not the right person for this one?</p>
          <p className="sm" style={{ margin: "0 0 9px" }}>
            {P(state.PEOPLE, l.own).mgr
              ? <>Ask {P(state.PEOPLE, P(state.PEOPLE, l.own).mgr!).n} or a manager above them to approve a new owner.</>
              : "Ask a manager to approve a new owner."}
          </p>
          <button
            type="button"
            className="act"
            onClick={() =>
              dispatch({ type: "openDrawer", k: "reassign", id: l.id, seed: { MVTO: null } })
            }
          >
            Ask for it to be moved
          </button>
        </div>
      ) : null}

      {!mayMove && !mayCover && !canAskMove(state, l) && !closed ? (
        <p className="sm" style={{ margin: "12px 0 0" }}>
          Read only — the owner, the secondary or a manager moves these names.
        </p>
      ) : null}
    </>
  );
}

function ReassignBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const MVTO = uiMvto(state.ui);
  const load = (k: PersonKey) => state.LEADS.filter((x) => x.own === k && active(x)).length;
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>
        This changes nothing on its own. It appears on the lead, on your manager's day and in
        Updates, and{" "}
        <b>{P(state.PEOPLE, l.own).mgr ? P(state.PEOPLE, P(state.PEOPLE, l.own).mgr!).n + " or anyone above" : "a manager"}</b>{" "}
        approves or declines it.
      </p>
      <p className="lbl">To whom</p>
      <select
        className="selw"
        id="mvto"
        aria-label="To whom"
        value={MVTO ?? ""}
        onChange={(e) => dispatch({ type: "setUi", patch: { MVTO: e.target.value || null } })}
      >
        <option value="">Choose a person…</option>
        {assignees(state)
          .filter((k) => k !== l.own)
          .map((k) => (
            <option value={k} key={k}>
              {P(state.PEOPLE, k).n} — {titleOf(state.PEOPLE, k)}
            </option>
          ))}
      </select>
      <p className="sm" style={{ margin: "6px 0 0" }}>
        {MVTO ? (
          <>
            <Pname k={MVTO} cls="xs" nw /> carries {load(MVTO)} active lead
            {load(MVTO) === 1 ? "" : "s"} today.
          </>
        ) : (
          " "
        )}
      </p>
      <p className="lbl" style={{ marginTop: "14px" }}>
        Why
      </p>
      <div className="chips">
        {REASONS.map((r) => (
          <button
            type="button"
            key={r}
            className="chip"
            disabled={!MVTO}
            onClick={() => {
              if (!MVTO) return;
              dispatch({ type: "askMove", id: l.id, to: MVTO, why: r });
              dispatch({ type: "closeDrawer" });
            }}
          >
            {r}
          </button>
        ))}
      </div>
      {MVTO ? null : (
        <p className="sm" style={{ margin: "9px 0 0" }}>
          Pick the person first. A request without a name and a reason is not a request, it is a
          complaint.
        </p>
      )}
    </>
  );
}

function OwnerFoot({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  /* C3: live, "Assign" is POST /api/leads/[id]/assign, which is self only (an IR takes the lead for themselves); giving a lead to
     somebody else is a manager's act and is not wired yet. The fixture keeps the reducer's full rule. */
  const live = useApiMode() === "live";
  const { assign, error, pending } = useAssignToMe();
  const l = lead!;
  if (l.own || custodian(l) === "Closed" || !canAssign(state)) return null;
  const ASTO = uiAsto(state.ui);
  const ready = !!ASTO && assignees(state).includes(ASTO);
  const selfOnly = live && (ASTO !== state.WHO || !isIR(state.ROLE));
  const why = !ready ? "Choose a current owner first"
    : selfOnly ? "Live, an IR takes an unowned lead for themselves; giving it to somebody else is not available yet" : undefined;
  return (
    <>
      {error ? <p className="ux-date-error" role="alert" style={{ margin: "0 0 9px" }}>{error}</p> : null}
      <button
        type="button"
        className="act"
        disabled={!ready || selfOnly || pending}
        title={why}
        onClick={ready && !selfOnly ? () => (live ? void assign(l.id) : dispatch({ type: "assign", id: l.id, to: ASTO })) : undefined}
      >
        Assign owner
      </button>
    </>
  );
}

registerDrawer("owner", {
  lead: true,
  w: 460,
  title: () => "Owners and cover",
  sub: (_s, a) => a.lead!.n,
  Body: OwnerBody,
  Foot: OwnerFoot,
});

registerDrawer("reassign", {
  lead: true,
  w: 440,
  title: () => "Ask for it to be moved",
  sub: (_s, a) => a.lead!.n,
  Body: ReassignBody,
});
