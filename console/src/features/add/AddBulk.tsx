"use client";

/* ── features/add/AddBulk.tsx — MANY AT ONCE ──────────────────────────────────────────────────
   Ports `ref/03-app.js` (redesigned) 8102–8199 (`vAddBulk`), 7975–8095 (the CSV reader and
   `csvImport`), plus the fold it lives inside on the door: "one fold open at a time, and the
   answer on the summary line where every other answered fold puts it."

   Two ways in, on purpose: the event sheet — one tab per field event, already tagged and already
   consented on the intake form — and a file the owner already has, whose rows were checked by
   nobody. The second is read in this tab, shown in full before one name is written, and refused
   until it names the event every row will be tagged to.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventId } from "@/domain";
import { canReach, may, P } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { pathOf } from "@/components/shell/routes";
import { Chip } from "@/components/ui";
import { newIdempotencyKey, useApiMode, useApiWrite } from "@/lib/data/api";
import { IMPORT_CHUNK, importRowsOf, leadImport, ROW_WHY } from "@/lib/data/endpoints/intake";
import { capWhy } from "./cap";
import { CSVFIELDS, csvGood, csvRead, dealTo, evIRs, splitLine, splitNames } from "./csv";
import { addDraft, addWho } from "./state";

export function AddBulk({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { state, dispatch, reloadData } = useConsole();
  const router = useRouter();
  /* C3: a file loads through POST /api/leads/import, 100 rows a call, one Idempotency-Key per file press (a retry replays the
     rows that landed). Every row has its own verdict; the ones Zoho or the rules refused are listed under the result. */
  const live = useApiMode() === "live";
  const load = useApiWrite(leadImport, state, dispatch);
  const press = useRef<{ sig: string; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [report, setReport] = useState<{ file: string; added: number; refused: { line: number; n: string; why: string }[] } | null>(null);

  const cap = may(state, "add", "capture");
  const d = addDraft(state.ui, state);
  const own = addWho(state, d);
  const ran = state.EVENTS.filter(e => e.state === "done");
  const ready = Object.keys(state.SHEET).filter(k => state.SHEET[k]!.state === "ready" && state.EVENTS.some(e => e.id === k));
  const toEv = canReach(state, "events");
  const csv = state.ui.CSV ?? null;
  const good = csvGood(csv);
  const rows = csv?.rows ?? [];
  const badN = rows.filter(r => r.bad).length, dupN = rows.filter(r => r.dupe).length;
  const csvDone = state.ui.CSVDONE ?? null;
  const sum = csv
    ? (csv.err ? csv.file + " · unreadable" : csv.file + " · " + good.length + " of " + rows.length + " to add")
    : csvDone ? csvDone.n + " added from " + csvDone.file : "";

  const csvEv = state.ui.CSVEV ?? null;
  const cev = csvEv ? state.EVENTS.find(e => e.id === csvEv) ?? null : null;
  /* live there is no roster to deal round yet (a manager's list of who may be given a lead is not read): every row goes to the
     one owner the form names, and the route refuses the ones that owner cannot take */
  const dealt = !live && !!cev && evIRs(state, cev).length > 0;
  const csvOwn = (i: number): string | null => (dealt && cev ? dealTo(state, cev, i) : own);

  const why = !cap
    ? "Capture permission is required to add these rows. You can review the file."
    : !good.length ? "There is no row in this file that can be written."
      : !csvEv ? "Choose the event these names came from first."
        : "";

  const pickFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      dispatch({ type: "setUi", patch: { CSV: csvRead(state, file.name, String(reader.result || "")), CSVEV: null, CSVDONE: null, ADDF: "bulk" } });
    };
    reader.onerror = () => {
      dispatch({ type: "setUi", patch: { CSV: { file: file.name, err: "The file could not be read." }, ADDF: "bulk" } });
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    if (!csv || !csvEv) return;
    const rows = importRowsOf(csv);
    if (!live) { void load({ eventId: csvEv, ownerId: own, rows }); return; }
    const sig = JSON.stringify([csvEv, own, rows]);
    if (!press.current || press.current.sig !== sig) press.current = { sig, key: newIdempotencyKey() };
    const goodRows = csvGood(csv);
    let added = 0;
    const refused: { line: number; n: string; why: string }[] = [];
    setImportErr(null);
    for (let at = 0; at < rows.length; at += IMPORT_CHUNK) {
      setBusy(`Loading rows ${at + 1}–${Math.min(at + IMPORT_CHUNK, rows.length)} of ${rows.length}…`);
      const r = await load({ eventId: csvEv, ownerId: own, rows: rows.slice(at, at + IMPORT_CHUNK) }, { idempotencyKey: `${press.current.key}-c${at / IMPORT_CHUNK}` });
      if (!r.ok) {
        setBusy(null);
        setImportErr(`${r.error} ${added} lead${added === 1 ? "" : "s"} loaded so far; press again to finish the rest — rows already loaded are not added twice.`);
        if (added) reloadData();
        return;
      }
      added += r.data.added;
      for (const v of r.data.rows) {
        if (v.status === "refused") {
          const g = goodRows[at + v.row];
          refused.push({ line: g ? g.i : at + v.row + 2, n: g?.n ?? "", why: ROW_WHY[v.reason] ?? v.message });
        }
      }
    }
    setBusy(null);
    press.current = null;
    setReport({ file: csv.file, added, refused });
    dispatch({ type: "setUi", patch: { CSV: null, CSVEV: null, CSVDONE: added ? { n: added, ev: csvEv, file: csv.file } : null } });
    reloadData();
  };

  const sheet = !may(state, "events", "load")
    ? <p className="sm" style={{ margin: 0 }}>{capWhy(state, "events", "load")}</p>
    : !toEv
      ? <p className="sm" style={{ margin: 0 }}>Event sheets are loaded on Events. Your seat does not reach that page.</p>
      : ready.length
        ? (
          <>
            <div className="chips">
              {ready.map(k => (
                <Chip key={k} onClick={() => router.push(pathOf("event", k))}>
                  {state.EVENTS.find(e => e.id === k)!.n} · {state.SHEET[k]!.ok} leads
                </Chip>
              ))}
            </div>
            <p className="sm" style={{ margin: "8px 0 0" }}>
              {ready.reduce((a, k) => a + state.SHEET[k]!.ok, 0)} leads ready. Event source and contact
              permission come from the intake sheet.
            </p>
          </>
        )
        : (
          <>
            <div className="chips"><Chip onClick={() => router.push(pathOf("events"))}>Open events</Chip></div>
            <p className="sm" style={{ margin: "8px 0 0" }}>No event sheet is waiting to load.</p>
          </>
        );

  return (
    <details className="ux-disclosure" data-ux-key="capture-bulk" open={open} id="fld-bulk">
      <summary onClick={(e) => { e.preventDefault(); onToggle(); }}>
        Import multiple leads<span className="ux-secondary"> · {sum || "Event sheet or CSV"}</span>
      </summary>
      <div className="cb ux-section ux-capture-bulk">
        {csvDone && state.EVENTS.some(e => e.id === csvDone.ev) && (
          <div className="note" style={{ margin: "0 0 12px" }}>
            <b>{csvDone.n} lead{csvDone.n === 1 ? "" : "s"}</b> added from {csvDone.file} to{" "}
            <b>{state.EVENTS.find(e => e.id === csvDone.ev)!.n}</b>. Record contact permission on each
            investor before reaching out.
            <div className="chips" style={{ marginTop: 9 }}>
              <Chip on onClick={() => dispatch({ type: "setUi", patch: { CSVDONE: null } })}>Read another file</Chip>
              {toEv && (
                <Chip onClick={() => router.push(pathOf("event", csvDone.ev))}>
                  Open {state.EVENTS.find(e => e.id === csvDone.ev)!.n}
                </Chip>
              )}
            </div>
          </div>
        )}

        {live && report && report.refused.length > 0 && (
          <div className="note bad" style={{ margin: "0 0 12px" }}>
            <b>{report.refused.length} row{report.refused.length === 1 ? "" : "s"}</b> of {report.file} {report.refused.length === 1 ? "was" : "were"} not added
            ({report.added} {report.added === 1 ? "was" : "were"}).
            <div className="tw"><table>
              <thead><tr><th>Row</th><th>Name</th><th>Why</th></tr></thead>
              <tbody>
                {report.refused.map(x => <tr key={x.line}><td className="mono">{x.line}</td><td>{x.n || "—"}</td><td className="sm">{x.why}</td></tr>)}
              </tbody>
            </table></div>
            <div className="chips" style={{ marginTop: 9 }}><Chip onClick={() => setReport(null)}>Dismiss</Chip></div>
          </div>
        )}

        <section className="card"><div className="ch"><h3>Event sheets</h3></div><div className="cb">{sheet}</div></section>

        <section className="card"><div className="ch"><h3>Import a CSV</h3></div><div className="cb">
          <div className="chips">
            <label className="chip file">
              {csv ? "Choose a different file" : "Choose a CSV file"}
              <input
                className="vh" type="file" accept=".csv,text/csv" id="acsv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }}
              />
            </label>
            {csv && (
              <Chip onClick={() => dispatch({ type: "setUi", patch: { CSV: null, CSVEV: null } })}>Remove file</Chip>
            )}
          </div>

          {!csv
            ? (
              <p className="sm" style={{ margin: "8px 0 0" }}>Read on this device; nothing is written until you add.</p>
            )
            : csv.err
              ? (
                <div className="note bad" style={{ margin: "10px 0 0" }}>
                  <b>{csv.file}</b> — {csv.err} Nothing was read and nothing was written.
                </div>
              )
              : (
                <>
                  <div className="stats">
                    {([
                      ["Rows", rows.length, false],
                      ["Ready to add", good.length, !good.length],
                      ["Duplicates", dupN, false],
                      ["Need correction", badN, !!badN],
                    ] as const).map(([t, n, bad]) => (
                      <div key={t} className={`stat ${bad ? "bad" : ""}`}><b>{n}</b><span>{t}</span></div>
                    ))}
                  </div>
                  {!!csv.missing?.length && (
                    <div className="note bad">
                      Missing required columns: {csv.missing.map(f => f.t).join(", ")}. Correct the file
                      and choose it again.
                    </div>
                  )}
                  <details className="ux-disclosure" data-ux-key="capture-bulk-columns">
                    <summary>Matched columns</summary>
                    <dl className="kv">
                      {CSVFIELDS.filter(f => csv.col?.[f.k] != null).map(f => (
                        <Fragment key={f.k}><dt>{f.t}</dt><dd>from &#8220;{csv.head?.[csv.col![f.k]!]}&#8221;</dd></Fragment>
                      ))}
                      {csv.missing?.map(f => (
                        <Fragment key={f.k}><dt>{f.t}</dt><dd style={{ color: "var(--late)" }}>Required column missing</dd></Fragment>
                      ))}
                    </dl>
                    {!!csv.ignored?.length && <p className="sm">Unused columns: {csv.ignored.join(", ")}.</p>}
                  </details>
                  {good.length > 0 && (
                    <details className="ux-disclosure" data-ux-key="capture-bulk-preview">
                      <summary>Preview {good.length} valid rows</summary>
                      <div className="tw"><table>
                        <thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th>Units</th></tr></thead>
                        <tbody>
                          {good.map(r => (
                            <tr key={r.i}>
                              <td>{r.n}</td><td className="sm mono">{r.ph}</td>
                              <td className="sm">{r.em || "—"}</td><td className="n">{r.units || "Not stated"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    </details>
                  )}
                  {badN + dupN > 0 && (
                    <details className="ux-disclosure" data-ux-key="capture-bulk-rejected">
                      <summary>Rows skipped · {badN + dupN}</summary>
                      <div className="tw"><table>
                        <thead><tr><th>Row</th><th>Name</th><th>Reason</th></tr></thead>
                        <tbody>
                          {rows.filter(r => r.bad || r.dupe).map(r => (
                            <tr key={r.i}><td className="mono">{r.i}</td><td>{r.n || "—"}</td><td className="sm">{r.bad || r.dupe}</td></tr>
                          ))}
                        </tbody>
                      </table></div>
                    </details>
                  )}

                  <label className="fi" style={{ marginTop: 11 }}>
                    <span>Source event · required</span>
                    <select
                      className="selw" id="acsvev" value={csvEv ?? ""}
                      onChange={(e) => dispatch({ type: "setUi", patch: { CSVEV: (e.target.value || null) as EventId | null } })}
                    >
                      <option value="">Choose the event…</option>
                      {ran.map(e => <option key={e.id} value={e.id}>{e.n} — {e.date}</option>)}
                    </select>
                  </label>
                  {csvEv && dealt ? <p className="sm" style={{ margin: "8px 0 0" }}><b id="csvsplit">{splitLine(state, good.length, csvOwn)}</b></p> : null}
                  {why && <p className="sm" style={{ margin: "11px 0 0" }}>{why}</p>}
                  <button
                    type="button" className="act" style={{ width: "100%", textAlign: "center", padding: 12, marginTop: 11 }}
                    disabled={!(cap && good.length && csvEv) || !!busy} title={why || undefined}
                    onClick={() => void doImport()}
                  >
                    {busy ?? <>Add {good.length} lead{good.length === 1 ? "" : "s"}{csvEv && cev ? " · " + cev.n : ""}</>}
                  </button>
                  {importErr ? <p className="ux-date-error" role="alert" style={{ margin: "9px 0 0" }}>{importErr}</p> : null}
                  <p className="sm" style={{ margin: "9px 0 0" }}>
                    {dealt
                      ? <>Assigned to the event&#8217;s IRs: {splitNames(state, good.length, csvOwn)}.</>
                      : own ? <>Assigned to {P(state.PEOPLE, own).n}.</> : "Added to the unassigned queue."}
                    {" "}New leads start at capture with <b>no contact permission recorded</b>.{" "}
                  </p>
                </>
              )}
        </div></section>
      </div>
    </details>
  );
}
