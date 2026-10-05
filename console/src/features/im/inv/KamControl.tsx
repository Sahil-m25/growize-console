"use client";

/* R5 — "Manager: <name> · Change · Remove" on the record's Care card.
   Change opens the manager drawer (the picker); Remove asks once, inline (no native dialog), then PUT /api/investors/[id]/kam
   with kamUserId null — the account goes back to the shared pool. Only a seat holding the assign right is offered either.
   D122: access follows Contacts.KAM inside Zoho (its own sharing and workflows), so there is no share status or Retry here;
   after a change the page says so, plainly, once. */

import { useState, type ReactNode } from "react";
import { KAMS, kamGone, may, who } from "@/lib/im";
import type { ImInvestor } from "@/lib/im";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { investorRecord, kamAssign } from "@/lib/data/endpoints/investors";
import type { ImPageProps } from "../common";

export function KamControl({ s, me, dispatch, x }: ImPageProps & { x: ImInvestor }) {
  const named = !!x.kam && !kamGone(s, x);
  const rec = useApiRead(investorRecord, { s, me }, named ? x.id : null);
  const assign = useApiWrite(kamAssign, { s, me }, dispatch);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  if (!may(s, me, "assign")) return null;
  const name = who(s, x.kam).n, first = name.split(" ")[0];
  const open = () => dispatch({ type: "openDrawer", k: "kam", id: x.id, seed: { KSEL: KAMS(s).indexOf(x.kam || "") < 0 ? null : x.kam || "" } });
  const remove = async () => {
    const r = await assign({ id: x.id, kam: null, expectedModifiedTime: rec.state === "ok" ? rec.data.record.version : null });
    setErr(r.ok ? null : r.error);
    if (r.ok) { setConfirm(false); setChanged(true); }
  };
  return (
    <>
      <div className="chips" style={{ marginTop: 7 }}>
        {named ? (
          <>
            <button type="button" className="chip" onClick={open}>Change</button>
            <button type="button" className="chip" aria-expanded={confirm} onClick={() => setConfirm(c => !c)}>Remove</button>
          </>
        ) : <button type="button" className="chip" onClick={open}>Name a manager</button>}
      </div>
      {confirm && named ? (
        <div className="note warn" role="status" style={{ marginTop: 8 }}>
          <b>Return this account to the shared pool?</b> Nobody will be answerable for it by name until you name a manager.
          <div className="chips" style={{ marginTop: 7 }}>
            <button type="button" className="act" onClick={() => void remove()}>Return it to the pool</button>
            <button type="button" className="chip" onClick={() => setConfirm(false)}>Keep {first}</button>
          </div>
        </div>
      ) : null}
      {err ? <div className="note bad" role="alert" style={{ marginTop: 8 }}>{err}</div> : null}
      {changed ? <div className="sm" role="status" style={{ marginTop: 6 }}>Access follows in Zoho within a minute.</div> : null}
    </>
  );
}
