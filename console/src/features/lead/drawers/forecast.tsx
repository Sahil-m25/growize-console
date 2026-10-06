"use client";

/* ── DRAWERS.forecast. 03-app.js 6251–6275 ──────────────────────────────────────────────────
   Manual §3.1 and Table 22. What a forecast owes is a DATE. It used to owe a written
   justification as well, and that turned out to be the wrong trade: an IR with a real date and no
   time to write a paragraph either left the category off or wrote something meaningless to clear
   the flag. Evidence is now asked for, shown where it exists, and never required.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { FCAT, ST } from "@/domain";
import { canPlan, fcInFY, fcOf, payOf, whyLocked } from "@/lib/selectors";
import { iso, when } from "@/lib/format";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { useApiMode, useApiWrite } from "@/lib/data/api";
import { leadForecastSet, type ForecastArgs } from "@/lib/data/endpoints/record";

function Body({ lead }: DrawerProps) {
  const { state, dispatch, reloadData } = useConsole();
  /* setFc / setFcDate are PUT /api/leads/[id]/forecast (cluster C2, lib/data/endpoints/record): Leads.Forecast and
     Leads.Forecast_Paid_By on the person's own token. Evidence (setFcEv) stays as it was: its home is PROVISIONAL (J4). */
  const put = useApiWrite(leadForecastSet, state, dispatch);
  const live = useApiMode() === "live";
  const [err, setErr] = useState<string | null>(null);
  const save = (a: ForecastArgs) => void put(a).then(r => { setErr(r.ok ? null : r.error); if (r.ok && live) reloadData(); });
  const l = lead!;
  const cat = fcOf(l);
  const fc = l.fc || null;
  const plan = canPlan(state, l);
  /* setFcDate(id,v) — ir-console-redesigned.html:3446, store.tsx's own case. A literal calendar
     date for the same field `setFcBy` sets by day-count; both write `l.fc.by/at/who`. */
  const dateEditable = plan && l.done < ST.PAID && payOf(state, l.id)?.state !== "full";
  /* setFc() asks for the rung as well as for the seat — nothing is forecast before it qualifies.
     The lead page draws this door at Qualified and no earlier, so the gap only opens when a rung
     is taken back under a drawer that is already open; it is still a control whose handler would
     refuse it, so it says why rather than doing nothing. */
  const set = plan && l.done >= ST.QUALIFIED;

  return (
    <>
      {err ? <p className="sm lp-err" role="alert">{err}</p> : null}
      <p className="lbl">Forecast category</p>
      <div className="chips" style={{ marginBottom: "12px" }}>
        {(Object.entries(FCAT) as [string, { t: string; d: string; c: string }][]).map(([k, v]) => (
          <button
            type="button"
            key={k}
            className={`chip ${cat === k ? "on" : ""}`}
            title={set ? v.d : plan ? "Nothing is forecast before it qualifies" : whyLocked(state, l)}
            disabled={!set}
            onClick={set ? () => save({ id: l.id, expectedModifiedTime: l.mt ?? null, via: "setFc", c: k }) : undefined}
          >
            {v.t}
          </button>
        ))}
      </div>
      {cat ? (
        <>
          <p className="sm" style={{ margin: "0 0 14px" }}>
            {FCAT[cat as keyof typeof FCAT].d}
          </p>
          <p className="lbl">
            {l.done >= ST.PAID ? "Paid in full on" : "Full payment expected by"}
          </p>
          <div className="nxc" style={{ marginBottom: "8px" }}>
            {fc && fc.by ? (
              <>
                <b className="mono" style={{ fontSize: "15px" }}>
                  {fc.by}
                </b>
                {fcInFY(l, state.NOW) || l.done >= ST.PAID ? null : (
                  <span className="tag due">after 31 Mar 2027</span>
                )}
              </>
            ) : (
              <span className="tag late">not set</span>
            )}
          </div>
          {dateEditable ? (
            <>
              <label className="fi">
                <span>Expected full-payment date</span>
                <input
                  className="di2"
                  type="date"
                  aria-label="Expected full-payment date"
                  min={iso(state.NOW)}
                  value={fc && fc.by ? iso(when(fc.by, state.NOW) || state.NOW) : ""}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    save({ id: l.id, expectedModifiedTime: l.mt ?? null, via: "setFcDate", v: e.target.value });
                  }}
                />
              </label>
              <p className="sm" style={{ margin: "7px 0 0" }}>
                Date and category changes save immediately.
              </p>
            </>
          ) : null}
          {cat !== "pipeline" && l.done < ST.PAID ? (
            <p className="sm" style={{ margin: "10px 0 0" }}>
              Set a date for Commit or Probable. Dates through 31 March 2027 count toward the FY
              forecast.
            </p>
          ) : null}
          {/* setFcEv is not wired (J4 PROVISIONAL: a Note titled "Forecast evidence"): live hides it so nothing pretends to save */}
          {live ? null : <details className="drwsec">
            <summary className="lbl">Evidence · {fc && fc.ev ? "recorded" : "optional"}</summary>
            {plan ? (
              <textarea
                className="nta"
                id="fcev"
                rows={3}
                style={{ width: "100%" }}
                aria-label="Forecast evidence"
                placeholder="What the investor actually said or did…"
                defaultValue={(fc && fc.ev) || ""}
                onChange={(e) => dispatch({ type: "setFcEv", id: l.id, t: e.target.value })}
              />
            ) : fc && fc.ev ? (
              <p style={{ margin: 0 }}>{fc.ev}</p>
            ) : (
              <span className="tag late">none recorded</span>
            )}
            {plan ? (
              <p className="sm" style={{ margin: "7px 0 0" }}>
                Evidence saves when you leave the field.
              </p>
            ) : null}
          </details>}
        </>
      ) : (
        <p className="sm" style={{ margin: 0 }}>
          Nothing is forecast until someone says which of the three it is. Pipeline counts for
          coverage, never for achievement.
        </p>
      )}
    </>
  );
}

registerDrawer("forecast", {
  lead: true,
  w: 430,
  title: () => "Forecast",
  sub: (_s, a) => a.lead!.n,
  Body,
});
