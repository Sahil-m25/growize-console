"use client";

/* M01-S10-W1 — THE STEP-UP PANEL (D22, rule 7: a reveal is a second, logged call behind step-up).
   Before a reveal or a release the page asks GET /api/auth/step-up/status for that action (the endpoint in
   @/lib/data/endpoints/session). A step-up already open lets the action go on; otherwise the panel asks the
   person to confirm it is them with a fresh Zoho sign-in, which is a navigation to /api/auth/step-up (Zoho
   asks for a fresh login, then sends them back here with ?stepup=ok|failed|cancelled|locked). A locked
   step-up shows the route's own message and no button. The demo has no Zoho, so in fixture mode no step-up
   is ever open and the panel always asks — nothing is shown or released behind it. */

import { useEffect, useState } from "react";
import { useApiRead } from "@/lib/data/api";
import { STEPUP_RETURN, stepUpHref, stepUpReturnOf, stepUpStatus, type StepUpAction, type StepUpReturn } from "@/lib/data/endpoints/session";

const WHAT: Record<StepUpAction, string> = {
  reveal: "before it is shown",
  release: "before the reservation is released",
  export: "before the export is made",
  erase: "before anything is erased",
  seat: "before the seat is changed",
};

/** ?stepup=<code> as the callback left it on the address (read once, after the first paint). */
export function useStepUpReturn(): StepUpReturn | null {
  const [r, setR] = useState<StepUpReturn | null>(null);
  useEffect(() => { setR(stepUpReturnOf(new URLSearchParams(window.location.search).get("stepup"))); }, []);
  return r;
}

/**
 * Ask for `action` (null = not asking). `onOpen` runs once when a step-up is already open for it.
 * Renders nothing while not asking; one quiet line while the status is read; else the panel.
 */
export function StepUp({ action, onOpen, onCancel }: { action: StepUpAction | null; onOpen: () => void; onCancel: () => void }) {
  const r = useApiRead(stepUpStatus, null, action);
  const back = useStepUpReturn();
  const open = r.state === "ok" && r.data.valid;
  useEffect(() => { if (open) onOpen(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!action) return back ? <p className="sm" role="status">{STEPUP_RETURN[back]}</p> : null;
  if (r.state === "loading") return <p className="sm">Checking your sign-in…</p>;
  if (r.state === "error") return <p className="note bad" role="alert">{r.err.error}</p>;
  if (r.state !== "ok" || r.data.valid) return null;
  const locked = r.data.code === "locked";
  return (
    <div className="note" role="dialog" aria-label="Confirm it is you" style={{ marginTop: 7 }}>
      <b>Confirm it is you.</b>{" "}
      {locked ? r.data.message : `Sign in to Zoho again with a fresh sign-in code ${WHAT[action]}. This is logged with your name against it.`}
      {back && back !== "ok" ? <div className="sm">{STEPUP_RETURN[back]}</div> : null}
      <div className="chips" style={{ marginTop: 7 }}>
        {locked ? null : (
          <button className="chip" onClick={() => window.location.assign(stepUpHref(action, window.location.pathname))}>Confirm with Zoho</button>
        )}
        <button className="chip" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
