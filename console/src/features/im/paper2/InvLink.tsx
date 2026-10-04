"use client";

/* A direct link to one investor — /inv?id=ARL-INV-0208 (M09-S08, M12-S09). It opens the record only
   when the signed-in seat reads that investor; otherwise the page says so in-page and nothing of the
   record is read. An IR (D113 ruling 2, M09-S08) opens it only for an investor from their own lead (irMayOpen); live the
   record route's IR guard decides and the page says so in-page. */

import { useEffect, useRef, useState } from "react";
import { I, irMayOpen } from "@/lib/im";
import { useApiMode } from "@/lib/data/api";
import { useConsole } from "@/lib/store";
import { useIm } from "../host";

export function InvLink() {
  const { state } = useConsole();
  const { s, me, dispatch, irSeat } = useIm();
  const mode = useApiMode();
  const [refused, setRefused] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !state.authed || !state.loaded) return;
    done.current = true;
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    if (I(s, me, id) || (irSeat && (mode === "live" || irMayOpen(s, me, id)))) dispatch({ type: "go", v: "inv", id });
    else setRefused(id);
  }, [state.authed, state.loaded, s, me, dispatch, irSeat, mode]);
  if (!refused || s.ui.SEL) return null;
  return (
    <div className="note bad" role="alert" style={{ marginBottom: 8 }}>
      <b>Not opened.</b> {refused} is not an investor your seat can open, so nothing on that record was read.
      {" "}<button type="button" className="chip" onClick={() => setRefused(null)}>OK</button>
    </div>
  );
}
