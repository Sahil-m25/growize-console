"use client";

/* R5 — "Manager: <name> · Change · Remove" on the record's Care card, with the share line under it.
   Change opens the manager drawer (the picker); Remove asks once, inline (no native dialog), then PUT /api/investors/[id]/kam
   with kamUserId null — the account goes back to the shared pool. Only a seat holding the assign right is offered either.
   The share line reads GET /api/investors/[id]/kam/share: the Contact is shared with its KAM by a job, so a person is
   told whether the manager can open it yet, and may press Retry when it failed. */

import { useState, type ReactNode } from "react";
import { KAMS, kamGone, may, who } from "@/lib/im";
import type { ImInvestor } from "@/lib/im";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { investorRecord, kamAssign, kamShare, kamShareRetry } from "@/lib/data/endpoints/investors";
import type { ImPageProps } from "../common";

export function KamShareLine({ s, me, dispatch, id }: ImPageProps & { id: string }): ReactNode {
  const sh = useApiRead(kamShare, { s, me }, id);
  const retry = useApiWrite(kamShareRetry, { s, me }, dispatch);
  const [err, setErr] = useState<string | null>(null);
  if (sh.state !== "ok") return null;
  const st = sh.data.state;
  if (st === "none") return null;
  return (
    <div className="sm" role="status" style={{ marginTop: 6 }}>
      {st === "shared" ? "Shared with KAM ✓" : st === "pending" ? "Sharing…" : (
        <>Share failed — <button type="button" className="chip" onClick={() => void retry({ id }).then(r => setErr(r.ok ? null : r.error))}>Retry</button></>)}
      {err ? <span className="note bad" role="alert"> {err}</span> : null}
    </div>
  );
}

export function KamControl({ s, me, dispatch, x }: ImPageProps & { x: ImInvestor }) {
  const named = !!x.kam && !kamGone(s, x);
  const rec = useApiRead(investorRecord, { s, me }, named ? x.id : null);
  const assign = useApiWrite(kamAssign, { s, me }, dispatch);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!may(s, me, "assign")) return null;
  const name = who(s, x.kam).n, first = name.split(" ")[0];
  const open = () => dispatch({ type: "openDrawer", k: "kam", id: x.id, seed: { KSEL: KAMS(s).indexOf(x.kam || "") < 0 ? null : x.kam || "" } });
  const remove = async () => {
    const r = await assign({ id: x.id, kam: null, expectedModifiedTime: rec.state === "ok" ? rec.data.record.version : null });
    setErr(r.ok ? null : r.error);
    if (r.ok) setConfirm(false);
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
      {named ? <KamShareLine s={s} me={me} dispatch={dispatch} id={x.id} /> : null}
    </>
  );
}
