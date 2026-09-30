"use client";

/* Why a wired list could not be drawn: the route's own words in the page (role="alert"), and — on a 503 —
   when this person last read it well. Never old rows (rule 8). One quiet line while it is being read. */

import type { Read } from "@/lib/data/api";
import { staleOf } from "@/lib/data/endpoints/documents";

const asOf = (at: number | null): string => (at ? new Date(at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

/** why a list could not be drawn: the route's own words, and — on a 503 — when it last read well */
export function ReadNote({ r, what }: { r: Read<unknown>; what: string }) {
  if (r.state === "loading") return <p className="sm" style={{ margin: "8px 0" }}>{"Reading " + what + "…"}</p>;
  if (r.state !== "error") return null;
  const st = staleOf(r.err);
  return (
    <div className="note bad" role="alert" style={{ marginBottom: 8 }}><b>{r.err.error}</b>
      {st ? <> Last read well {asOf(st.at)}. Nothing older is shown.</> : null}</div>
  );
}

