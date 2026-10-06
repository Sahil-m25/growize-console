"use client";

/* ── DRAWERS.hold — the reservation clock. 03-app.js 6691–6717 ──────────────────────────────
   Balance is due within 30 days of the advance. A lapse forfeits ₹50,000 per unit and puts the
   units back on the shelf; only the Growize BU Owner approves an extension.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { EXTDAYS, FORFEIT } from "@/domain";
import { DAY } from "@/lib/format";
import { canAskExt, canDecideExt, inReservation, isFin, may, P } from "@/lib/selectors";
import { useApiMode, useApiRead } from "@/lib/data/api";
import { holdDay, leadGate } from "@/lib/data/endpoints/lead";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";

function Body({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  /* askExt (J8 PROVISIONAL, no route), decideExt and lapse (the release route is not wired into this drawer) are the reducer's
     only: live shows the hold and says asking is not available yet, so nothing pretends to save. */
  const apiLive = useApiMode() === "live";
  const l = lead!;
  const x = state.EXT[l.id];
  /* M08-S04-W1: the hold's day is the gate route's `holdUntil` (GET /api/leads/[id]/gate) */
  const gate = useApiRead(leadGate, state, l.id);
  const until = gate.state === "ok" ? gate.data.holdUntil : null;
  const hold = until ? holdDay(until) : null;
  const left = until ? Math.round((new Date(until + "T00:00:00").getTime() - state.NOW.getTime()) / DAY) : null;

  return (
    <>
      <div className="nxc" style={{ marginBottom: "12px" }}>
        {left === null ? (
          <span className="tag">30 days</span>
        ) : left < 0 ? (
          <span className="tag late">
            <span className="dot" />
            lapsed {-left}d ago
          </span>
        ) : (
          <span className={`tag ${left <= 3 ? "late" : left <= 7 ? "due" : "go"}`}>
            {left} day{left === 1 ? "" : "s"} left
          </span>
        )}
        <span className="sm">
          hold ends <span className="mono">{hold || "—"}</span>
        </span>
      </div>
      <p className="sm" style={{ margin: "0 0 12px" }}>
        Balance is due within 30 days of the advance. A lapse forfeits{" "}
        <b>₹{FORFEIT.toLocaleString("en-IN")} per unit</b> — ₹
        {(FORFEIT * l.units).toLocaleString("en-IN")} here — and puts {l.units} unit
        {l.units > 1 ? "s" : ""} back on the shelf.
      </p>
      {x ? (
        <>
          <div
            className={`hd1 ${x.state === "waiting" ? "due" : x.state === "approved" ? "" : "bad"}`}
          >
            <span>
              <b>
                {x.state === "waiting"
                  ? "Extension requested"
                  : x.state === "approved"
                    ? "Extension approved"
                    : "Extension declined"}
              </b>{" "}
              — {x.days} days, asked by {P(state.PEOPLE, x.by).n}{" "}
              <span className="mono">{x.asked}</span>
              {x.why ? ". " + x.why : ""}
              {x.did
                ? ". " +
                  (x.state === "approved" ? "Approved" : "Declined") +
                  " by " +
                  P(state.PEOPLE, x.did).n
                : ""}
              .
            </span>
          </div>
          {x.state === "waiting" && canDecideExt(state.ROLE) && !apiLive ? (
            <div className="chips" style={{ marginTop: "10px" }}>
              <button
                type="button"
                className="chip on"
                onClick={() => dispatch({ type: "decideExt", id: l.id, ok: true })}
              >
                Approve {x.days} days
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => dispatch({ type: "decideExt", id: l.id, ok: false })}
              >
                Decline it
              </button>
            </div>
          ) : x.state === "waiting" ? (
            <p className="sm" style={{ margin: "10px 0 0" }}>
              Only the Growize BU Owner approves an extension.
            </p>
          ) : null}
        </>
      ) : canAskExt(state, l) && apiLive ? (
        <p className="sm" style={{ margin: 0 }}>Not available yet: asking for an extension is still to be built.</p>
      ) : canAskExt(state, l) ? (
        <>
          <p className="lbl">Ask the BU Owner for an extension</p>
          <div className="chips">
            {EXTDAYS.map((d) => {
              /* askExt() asks for a live reservation as well as for the seat. Nothing opens this
                 drawer without one today — the door is drawn from inReservation — but a hold paid
                 off or released under an already-open drawer left chips that did nothing. */
              const live = inReservation(state, l);
              return (
                <button
                  type="button"
                  key={d}
                  className="chip"
                  disabled={!live}
                  title={
                    live
                      ? undefined
                      : "An extension moves a live reservation's clock. This one is either paid in full or already released, so there is no clock to move."
                  }
                  onClick={live ? () => dispatch({ type: "askExt", id: l.id, days: d }) : undefined}
                >
                  {d} days
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="sm" style={{ margin: 0 }}>
          The owner or Finance can ask the BU Owner for an extension.
        </p>
      )}
      {isFin(state.ROLE) && may(state, "pay", "record") && left !== null && left < 0 && !apiLive ? (
        <div className="drwsec">
          <button
            type="button"
            className="act"
            style={{ background: "var(--late)" }}
            onClick={() => dispatch({ type: "lapse", id: l.id })}
          >
            Reservation lapsed — release the units
          </button>
        </div>
      ) : null}
    </>
  );
}

registerDrawer("hold", {
  lead: true,
  w: 440,
  title: () => "Reservation clock",
  sub: (_s, a) => a.lead!.n,
  Body,
});
