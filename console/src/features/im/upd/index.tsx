"use client";

/* 12. UPDATES — imx.js 2090–2113 (vUpd), titled "Investor updates" on the page. */

import { day6, safeNote } from "@/lib/im";
import { useApiRead } from "@/lib/data/api";
import { updateList } from "@/lib/data/endpoints/updates";
import { ImPav, type ImPageProps } from "../common";

/* M13-S06-W1: the updates are GET /api/updates (lib/data/endpoints/updates) — who it reached is the count the route stored. */
export function ImUpd({ s, me, dispatch }: ImPageProps) {
  const r = useApiRead(updateList, { s, me }, undefined);
  if (r.state === "idle" || r.state === "loading") return <div className="empty">Reading the updates…</div>;
  if (r.state === "error") return r.err.status === 403 ? null : <div className="note bad" role="alert">{r.err.error}</div>;
  const { rows, readOnly } = r.data;
  return (
    <>
      <div className="ph"><h1>Investor updates</h1>
        <span className="sub">what is pushed to the investor&apos;s app, and who it reached</span><div className="sp"></div>
        {!readOnly ? <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "upd", id: null,
          seed: { UP: { t: "", cat: "Produce", d: "", to: "all" } } })}>＋ Publish one</button>
          : <span className="tag">read only</span>}</div>
      <div className="secw"><div className="card fill"><div className="cb">
        {rows.map(u => (
          <div key={u.id} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "12px 13px", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
              <b style={{ fontSize: 14.5 }}>{u.t}</b>
              <span className="tag">{u.kind}</span><div className="sp"></div>
              <span className="sm"><span className="nw"><ImPav s={s} k={u.by} cls="xs" /> {(u.byName ?? u.by).split(" ")[0]}</span> · <span className="mono">{day6(u.on)}</span></span></div>
            <p className="sm" style={{ margin: "7px 0 0" }}>{safeNote(s, me, u.d)}</p>
            <p className="sm" style={{ margin: "7px 0 0" }}><b>Sent to {u.n} investor{u.n === 1 ? "" : "s"}</b> — {u.toText}.</p>
          </div>
        ))}
        <p className="sm" style={{ margin: "4px 0 0" }}>Published, not emailed and forgotten: every update carries
          who wrote it, who it reached and when, and the same text is what the investor sees in the app.
          An update is never sent to a segment that cannot be reconstructed from the book. Account
          Management writes most of these, because the person who has the conversations is the person
          who knows what an investor is actually asking about — a statement note is Finance&apos;s, a
          flowering note is not.</p>
      </div></div></div>
    </>
  );
}
