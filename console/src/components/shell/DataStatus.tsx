"use client";

/* M01-S03 T04 — freshness and error states. The top bar's line under the save status says how
   current the data is (live / stale / error, with Retry), from the store's own record of its last
   successful GET /api/data — never a fabricated refresh time. A failed read also puts an error
   block at the top of the screen, so old numbers are never passed off as current. */

import { useEffect, useState } from "react";
import { useConsole } from "@/lib/store";
import { freshness } from "@/lib/data/freshness";

/** re-read the wall clock every 30 s so "over 5 minutes ago" arrives on its own */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useFresh() {
  const { dataRead, reloadData } = useConsole();
  const now = useNow();
  /* before the client clock is read there is nothing honest to say */
  const f = now == null ? null : freshness(dataRead.at, dataRead.failed, Math.max(now, dataRead.at || 0));
  return { f, reloadData };
}

/** the top bar's freshness line and its Retry */
export function DataFresh() {
  const { f, reloadData } = useFresh();
  if (!f || !f.line) return null;
  return (
    <small id="data-fresh" data-tone={f.tone}>
      {f.line}
      {f.retry ? <>{" · "}<button type="button" className="lp-link" onClick={reloadData} aria-label="Retry reading the data">Retry</button></> : null}
    </small>
  );
}

/** the per-screen error block */
export function DataErrorBlock() {
  const { f, reloadData } = useFresh();
  if (!f || !f.block) return null;
  return (
    <div className="note bad" role="alert" style={{ marginBottom: 8 }}>
      <b>{f.tone === "error" ? "This page could not load." : "Could not refresh."}</b> {f.block}{" "}
      <button type="button" className="chip" onClick={reloadData}>Retry</button>
    </div>
  );
}
