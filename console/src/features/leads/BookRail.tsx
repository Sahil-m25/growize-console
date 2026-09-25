"use client";

/* ── The shape of the book — vBookRail. ir-console-redesigned.html 7456–7521 ────────────────────
   Every count is the same list cut one way, and tapping a row applies that cut — so "3 going cold"
   is never a number you then have to go and find.

   The redesign only ever calls this with `part:"more"`, from inside a drawer
   (`panel("leads.more", ...)`, ir-console-redesigned.html:7452-7455) — the always-visible rail
   beside the table is gone. `part:"main"` renders the two everyday cuts (by stage, needs
   attention) plus a door to the rest, ir-console-redesigned.html:7519.

   `part:"main"` opens the rest through the registered "p:leads.more" panel (`./drawer.tsx`) —
   `canOpenDrawer` (src/lib/selectors/access.ts:376) already lets any "p:"-prefixed kind through,
   and `DrawerKind`'s `` `p:${string}` `` member already covers the key, the same mechanism
   `p:add.quick` and `p:updates.feed` already use — see `./drawer.tsx`.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { ReactNode } from "react";
import { BANDS, LADDER } from "@/domain";
import type { Lead, PersonKey } from "@/domain";
import { active, bandOf, EXC, fcOf, P, rag } from "@/lib/selectors";
import type { ExcKey } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { LeadsIcon } from "./icons";
import { srcColor } from "./srcColor";

type FcKey = "commit" | "probable" | "pipeline" | "none";

export function BookRail({ all, team, part = "main" }: { all: Lead[]; team: boolean; part?: "main" | "more" }) {
  const { state, dispatch } = useConsole();
  const title = team ? "The team's book" : "Your book";
  const ui = state.ui;

  const own = all.filter((l) => l.own);
  const noOwn = all.length - own.length;

  if (!all.length)
    return (
      <div className="card fill">
        <div className="ch">
          <h3>{title}</h3>
        </div>
        <div className="cb">
          <p className="sm" style={{ margin: 0 }}>
            Nothing in it yet.
          </p>
        </div>
      </div>
    );

  if (!own.length)
    return (
      <div className="card fill">
        <div className="ch">
          <h3>{title}</h3>
        </div>
        <div className="cb">
          <p className="sm" style={{ margin: 0 }}>
            {noOwn === 1 ? "The one lead in it is" : `All ${noOwn} leads in it are`} waiting for an
            owner — the card beside this one carries {noOwn === 1 ? "it" : "them"}.
          </p>
        </div>
      </div>
    );

  const live = own.filter(active);
  const tot = Math.max(1, own.length);
  const units = live.reduce((a, l) => a + l.units, 0);
  const bands = BANDS.map((b) => ({
    ...b,
    n: live.filter((l) => bandOf(Math.max(1, l.done)).t === b.t).length,
  }));
  const rungs = LADDER.map((s, i) => ({
    i: i + 1,
    t: s.t,
    n: own.filter((l) => l.done === i + 1).length,
  })).filter((r) => r.n);
  const exc = (Object.entries(EXC) as [ExcKey, [string, (c: typeof state, l: Lead) => boolean]][]).map(
    ([k, [t, fn]]) => [k, t, own.filter((l) => fn(state, l)).length] as const,
  );
  const fc: Record<FcKey, { u: number; n: number }> = {
    commit: { u: 0, n: 0 },
    probable: { u: 0, n: 0 },
    pipeline: { u: 0, n: 0 },
    none: { u: 0, n: 0 },
  };
  live.forEach((l) => {
    const c = (fcOf(l) || "none") as FcKey;
    fc[c].u += l.units;
    fc[c].n++;
  });
  const src = Object.entries(
    own.reduce<Record<string, number>>((a, l) => {
      const k = l.src || "—";
      a[k] = (a[k] || 0) + 1;
      return a;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const owners = team
    ? [...new Set(own.map((l) => l.own as PersonKey))]
        .map((k) => ({
          k,
          n: own.filter((l) => l.own === k).length,
          u: own.filter((l) => l.own === k && active(l)).reduce((a, l) => a + l.units, 0),
          red: own.filter((l) => l.own === k && rag(state, l) === "red").length,
        }))
        .sort((a, b) => b.n - a.n)
    : [];

  /* row(on, click, sw, t, n, w, col, title) — ir-console-redesigned.html:7482 */
  const row = (
    key: string,
    on: boolean,
    click: () => void,
    sw: ReactNode,
    t: string,
    n: number,
    w?: number,
    col?: string,
    tip?: string,
  ) =>
    !n && !on ? (
      <div className="srow static" key={key} title={tip || t}>
        {sw}
        <span className="t">{t}</span>
        <span className="n2">{n}</span>
      </div>
    ) : (
      <div
        className={`srow ${on ? "on" : ""}`}
        key={key}
        role="button"
        tabIndex={0}
        title={tip || t}
        onClick={click}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            click();
          }
        }}
      >
        {sw}
        <span className="t">{t}</span>
        {w != null ? (
          <div className="bar">
            <i style={{ width: `${w}%`, background: col }} />
          </div>
        ) : null}
        <span className="n2">{n}</span>
      </div>
    );

  const set = (patch: Record<string, unknown>) => dispatch({ type: "setUi", patch });

  const stageAndAttention = (
    <>
      <p className="lbl">
        By stage{" "}
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>— tap to filter</span>
      </p>
      {rungs.map((r) =>
        row(
          "rung" + r.i,
          ui.LSTAGE === r.i,
          () => set({ LSTAGE: ui.LSTAGE === r.i ? null : r.i }),
          <span className="sw" style={{ background: bandOf(r.i).c }} />,
          r.t,
          r.n,
          (r.n / tot) * 100,
          bandOf(r.i).c,
        ),
      )}

      <p className="lbl" style={{ marginTop: "12px" }}>
        Needs attention
      </p>
      {exc.map(([k, t, n]) =>
        row(
          "exc" + k,
          ui.LFILT === k,
          () => set({ LFILT: ui.LFILT === k ? null : k }),
          <span className={`rag ${n ? "red" : "green"}`} />,
          t,
          n,
        ),
      )}
    </>
  );

  const more = (
    <>
      <p className="lbl" style={{ marginTop: "12px" }}>
        Forecast, in units
      </p>
      {(
        [
          ["commit", "Commit", "var(--go)"],
          ["probable", "Probable", "var(--due)"],
          ["pipeline", "Pipeline", "var(--brand-line)"],
          ["none", "Not categorised", "var(--line)"],
        ] as const
      )
        .filter(([k]) => fc[k].n)
        .map(([k, t, c]) => (
          <div className="srow static" key={k} title={`${fc[k].n} lead${fc[k].n === 1 ? "" : "s"}`}>
            <span className="sw" style={{ background: c }} />
            <span className="t">{t}</span>
            <div className="bar">
              <i style={{ width: `${(fc[k].u / Math.max(1, units)) * 100}%`, background: c }} />
            </div>
            <span className="n2">{fc[k].u}</span>
          </div>
        ))}

      <p className="lbl" style={{ marginTop: "12px" }}>
        By source
      </p>
      {src.map(([x, n]) =>
        row(
          "src" + x,
          ui.LSRC === x,
          () => set({ LSRC: ui.LSRC === x ? null : x }),
          <span className="sw" style={{ background: srcColor(x) }} />,
          x,
          n,
          (n / tot) * 100,
          srcColor(x),
        ),
      )}

      {owners.length ? (
        <>
          <p className="lbl" style={{ marginTop: "12px" }}>
            By owner
          </p>
          {owners.map((o) =>
            row(
              "own" + o.k,
              ui.LOWN === o.k,
              () => set({ LOWN: ui.LOWN === o.k ? null : o.k }),
              <span className="ini">{P(state.PEOPLE, o.k).i}</span>,
              P(state.PEOPLE, o.k).n.split(" ")[0] + (o.red ? " · " + o.red + " breached" : ""),
              o.n,
              (o.n / tot) * 100,
              o.red ? "var(--late)" : "var(--brand)",
              P(state.PEOPLE, o.k).n + " · " + o.n + " leads · " + o.u + " active units",
            ),
          )}
        </>
      ) : null}
    </>
  );

  const doorOpen = state.DRW?.k === "p:leads.more";
  const doorToMore = (
    <div className="doors">
      <button
        type="button"
        className={`door ${doorOpen ? "on" : ""}`}
        id="door-leads-more"
        aria-haspopup="dialog"
        aria-expanded={doorOpen}
        title="Opens below"
        onClick={() => dispatch({ type: "openDrawer", k: "p:leads.more" })}
      >
        <span className="dt">
          <LeadsIcon name="numbers" />
          Other ways to cut the book
        </span>
        <span className="dv">
          {src.length} source{src.length === 1 ? "" : "s"}
          {owners.length ? ` · ${owners.length} owner${owners.length === 1 ? "" : "s"}` : ""}
        </span>
      </button>
    </div>
  );

  return (
    <div className="card fill">
      <div className="ch">
        <h3>{title}</h3>
        <div className="sp" />
        <span className="sm mono" title={noOwn ? `${noOwn} lead${noOwn === 1 ? "" : "s"} waiting for an owner — every count below is of leads that have one` : undefined}>
          {live.length} active · {units} units{noOwn ? ` · ${noOwn} waiting` : ""}
        </span>
      </div>
      <div className="cb" style={{ paddingTop: "11px" }}>
        <div
          className="invb seg"
          style={{ height: "10px", margin: "0 0 6px" }}
          title={bands.map((b) => b.t + " " + b.n).join(" · ")}
        >
          {bands
            .filter((b) => b.n)
            .map((b) => (
              <i key={b.t} style={{ width: `${(b.n / Math.max(1, live.length)) * 100}%`, background: b.c }} />
            ))}
        </div>
        <div className="leg" style={{ margin: "0 0 12px" }}>
          {bands.map((b) => (
            <span key={b.t}>
              <span className="sw" style={{ background: b.c }} />
              {b.t} {b.n}
            </span>
          ))}
        </div>

        {stageAndAttention}
        {part === "more" ? more : doorToMore}
      </div>
    </div>
  );
}
