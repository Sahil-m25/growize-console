"use client";

/* 11. FARMS — imx.js 1844–1916 (vFarms, 1849). The shelf is drawn — released, held, free — rather than
   described; every figure is counted off the investor records. */

import { day6, may, pageReadable, safeNote } from "@/lib/im";
import { ImPname, type ImPageProps } from "../common";
import { FarmLlps } from "../money/pages";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { farmList, farmRelease, farmShelf, farmTakeBack } from "@/lib/data/endpoints/farms";

export function ImFarms({ s, me, dispatch }: ImPageProps) {
  /* M11-S03-W1: the tiles and per-LLP bars are GET /api/farms/shelf; M11-S04-W1: Release / Take it back are
     POST / DELETE /api/farms/[id]/release with the LLP's version from GET /api/farms (lib/data/endpoints/farms) */
  const shelf = useApiRead(farmShelf, { s, me }, undefined);
  const list = useApiRead(farmList, { s, me }, undefined);
  const release = useApiWrite(farmRelease, { s, me }, dispatch);
  const takeBack = useApiWrite(farmTakeBack, { s, me }, dispatch);
  if (!pageReadable(s, me, "farms")) return null;
  const { FIELD, UPD } = s.data;
  if (shelf.state === "idle" || shelf.state === "loading") return <div className="empty">Reading the shelf…</div>;
  if (shelf.state === "error") return <div className="note bad" role="alert">{shelf.err.error}</div>;
  const { llps: LLPS, tiles } = shelf.data;
  const version = (id: string) => (list.state === "ok" ? list.data.rows.find(r => r.id === id)?.version ?? null : null);
  const over = tiles.oversold;
  return (
    <>
      <div className="ph"><h1>Farms</h1>
        <span className="sub">{tiles.acres.toFixed(1)} acres · {tiles.units} units · {tiles.released} released</span>
        <div className="sp"></div>{over ? <span className="tag late"><span className="dot"></span>oversold</span>
          : <span className="tag go"><span className="dot"></span>{tiles.free} free to sell</span>}</div>
      <div className="stats">
        <div className="stat"><b>{tiles.released}</b><span>released — deliverable</span></div>
        <div className="stat"><b>{tiles.allotted}</b><span>allotted</span></div>
        <div className="stat"><b>{tiles.reservedOrPaid}</b><span>reserved or paid</span></div>
        <div className={`stat ${over ? "bad" : ""}`}><b>{tiles.free}</b><span>free to sell</span></div>
      </div>
      <div className="secw">
        <div className="card"><div className="ch"><h3>The shelf</h3><div className="sp"></div>
          <span className="sm">{may(s, me, "farm") ? "you can release land" : "read only"}</span></div><div className="cb">
          <div className="blocks">{LLPS.map(f => {
            const al = f.allotted, pd = f.paid ?? 0, re = f.reservedOrPaid - pd, fr = f.free;
            const w = (n: number) => (f.released ? (n / f.released * 100) + "%" : "0%");
            const args = { id: f.id, k: f.block ?? "", version: version(f.id) };
            return (
              <div className="blk" key={f.id}><b>Block {f.block}</b>
                <div className="sm">{f.acres} acres · {f.totalUnits} units</div>
                <div className="bar">{f.released ? <>
                  <i className="al" style={{ width: w(al) }}></i>
                  <i className="re" style={{ width: w(re + pd) }}></i><i className="fr" style={{ width: w(fr) }}></i></> : null}</div>
                <div className="sm">{f.released
                  ? `${al} allotted${pd ? " · " + pd + " paid" : ""}${re ? " · " + re + " reserved" : ""} · ${fr} free`
                  : <span className="tag due">not released</span>}</div>
                <div className="sm" style={{ marginTop: 5 }}>{f.cropStage}</div>
                {may(s, me, "farm") ? <div className="chips" style={{ marginTop: 8 }}>{f.released
                  ? <button className="chip" onClick={() => void takeBack(args)}>Take it back</button>
                  : <button className="chip" onClick={() => void release(args)}>Release {f.totalUnits}</button>}</div> : null}
              </div>
            );
          })}</div>
          <div className="lgnd"><span><i style={{ background: "var(--accent)" }}></i>allotted</span>
            <span><i style={{ background: "var(--due)" }}></i>reserved or paid, not yet allotted</span>
            <span><i style={{ background: "var(--go)", opacity: 0.45 }}></i>free</span>
            <span><i style={{ background: "var(--card-2)" }}></i>not released</span></div>
          <p className="sm" style={{ margin: "11px 0 0" }}>Released means the farm interface has confirmed the block
            is deliverable. Everything else on this page is counted off the investor records — no figure
            here is typed, which is how &quot;no unit is sold twice&quot; stops being a policy and becomes
            arithmetic.</p>
        </div></div>
        <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>What is happening on the land</h3>
          <div className="sp"></div>{may(s, me, "field")
            ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "field", id: null,
              seed: { FD: { blk: "A", st: "", head: "", d: "" } } })}>Record progress</button>
            : <span className="sm">read only</span>}</div><div className="cb">
          {FIELD.slice(0, 6).map(f => {
            const u = UPD.find(u => u.t.indexOf("Block " + f.blk) === 0);
            return (
              <div className="led" style={{ alignItems: "flex-start" }} key={f.id}>
                <span className={`tag ${f.blk === "A" ? "br" : ""}`}>Block {f.blk}</span>
                <span style={{ minWidth: 0 }}><b>{f.head}</b>
                  <div className="sm"><ImPname s={s} k={f.by} first /> · <span className="mono">{day6(f.at)}</span>
                    {" "}· {f.st}</div>
                  <p className="sm" style={{ margin: "5px 0 0" }}>{safeNote(s, me, f.d)}</p>
                  {u ? <p className="sm" style={{ margin: "4px 0 0" }}>Told investors: <a className="lnk" role="button" tabIndex={0}
                    onClick={() => dispatch({ type: "go", v: "upd" })}
                    onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "go", v: "upd" }); }}>{u.t}</a> · {u.on.slice(0, 6)}</p> : null}
                </span></div>
            );
          })}
          <p className="sm" style={{ margin: "10px 0 0" }}>Releasing a block and saying what is growing on it are
            different rights on purpose. Putting units on the shelf is a commitment to sell something and
            it is Finance&apos;s; what the crop is doing is known by whoever last walked the rows, which is
            usually the person who took investors round them. An investor asking “how is Block A” is
            answered from here, and the answer is the same one everybody else gets.</p>
        </div></div>
        <FarmLlps s={s} me={me} dispatch={dispatch} />
      </div>
    </>
  );
}
