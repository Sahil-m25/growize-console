"use client";

/* One check, opened — DRAWERS.check, `ref/03-app.js` 6912–6945.

   What it does, what breaks if it stops, who owns it, and the last three weeks day by day. The
   history is read off the record, not sampled. */

import { Tw } from "@/components/ui";
import { CKDAYS, CKS } from "@/domain";
import { Pname } from "@/components/ui";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers";
import { dISOtoDisp, dLabel, isoDay } from "@/lib/format";
import { useConsole } from "@/lib/store";
import { CkBar } from "./CkBar";
import { ckDays, ckHist } from "./checks";

function Body({ id }: DrawerProps) {
  const { state } = useConsole();
  const c = state.CHECKS.find((x) => x.k === id);
  if (!c) return null;
  const h = ckHist(c, state.NOW);
  const bad = h.filter((x) => x.s !== "ok").length;
  const since = isoDay.test(c.since || "") ? dISOtoDisp(c.since, state.NOW) : c.since;
  return (
    <>
      <div
        className={`note ${c.st === "fail" ? "bad" : c.st === "warn" ? "due" : ""}`}
        style={{ marginTop: 0 }}
      >
        <b>{CKS[c.st].t[0].toUpperCase() + CKS[c.st].t.slice(1)}</b> for {ckDays(c, state.NOW)} days,
        since {since}. {c.note ? c.note : ""}
      </div>
      {c.fix ? (
        <div className="note" style={{ marginTop: "8px" }}>
          <b>What fixes it</b>
          <br />
          {c.fix}
        </div>
      ) : null}
      <dl className="kv">
        <dt>What it does</dt>
        <dd>{c.w}</dd>
        <dt>If it stops</dt>
        <dd>{c.br}</dd>
        <dt>Owner</dt>
        <dd>
          <Pname k={c.own} />
        </dd>
        <dt>Runs</dt>
        <dd>{c.every}</dd>
        <dt>Since</dt>
        <dd className="mono">{since}</dd>
      </dl>
      <details className="ux-disclosure" data-ux-key={`check-history-${id}`}>
        <summary>Recorded history · last {CKDAYS} days</summary>
        <div className="ux-section">
          <CkBar c={c} NOW={state.NOW} />
          <p className="sm" style={{ margin: "8px 0 0" }}>
            {bad
              ? bad + " of the last " + CKDAYS + " days " + (bad === 1 ? "was" : "were") + " not clean."
              : "Every one of the last " + CKDAYS + " days was clean."}{" "}
            Prototype history is derived from recorded states and dates.
          </p>
          <div className="leg" style={{ marginTop: "10px" }}>
            <span>
              <span className="sw" style={{ background: "var(--go)" }} />
              working
            </span>
            <span>
              <span className="sw" style={{ background: "var(--due)" }} />
              needed a person
            </span>
            <span>
              <span className="sw" style={{ background: "var(--late)" }} />
              not working
            </span>
          </div>
        </div>
        <div className="drwsec">
          <p className="lbl">Day by day</p>
          <Tw>
            <table>
              <tbody>
                {h
                  .slice()
                  .reverse()
                  .slice(0, 10)
                  .map((x, i) => (
                    <tr key={i}>
                      <td className="sm mono nw" style={{ width: "96px" }}>
                        {dLabel(x.d)}
                      </td>
                      <td>
                        <span className={`tag ${CKS[x.s].c}`}>{CKS[x.s].g}</span>{" "}
                        <span className="sm">{CKS[x.s].t}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Tw>
        </div>
      </details>
    </>
  );
}

registerDrawer("check", {
  w: 430,
  ok: (state, k) => state.CHECKS.some((c) => c.k === k),
  title: (state, a) => state.CHECKS.find((x) => x.k === a.id)?.t ?? "Check",
  sub: (state, a) => {
    const c = state.CHECKS.find((x) => x.k === a.id);
    return c ? CKS[c.st].t : "";
  },
  Body,
});
