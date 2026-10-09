"use client";

/* GC-1523 — a converted lead on the lead page (owner, 9 Oct: "Issued means they have paid … we should have them under
   contacts and not leads"). The lead is read-only (selectors converted / canEdit): this file holds the two pieces the page
   shows in place of the working controls — the "Converted · investor ARL-INV-…" banner with its door to the investor record,
   and the paperwork as it stands (done / with Finance), never an IR beat to press. History stays readable from the page. */

import { useRouter } from "next/navigation";
import type { Lead } from "@/domain";
import { canReach, investorFor, isIR } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useApiMode, useApiRead } from "@/lib/data/api";
import { paperworkRow, type RoundView } from "@/lib/data/endpoints/paperwork";
import { lpPaperName } from "./lp";

/** Open the investor record a lead became (the Investors page decides whether this seat may read it, D69). */
export function useOpenInvestor() {
  const { dispatch } = useConsole();
  const router = useRouter();
  return (id: string) => {
    dispatch({ type: "im", a: { type: "go", v: "inv", id } });
    router.push("/inv");
  };
}

/** The banner's words and whether its door shows: a seat that reads the record (live: it was read on this person's own token;
 *  the demo: a seat with the Investors page, or the IR on their own lead's investor, read-only per D69). */
export function convertedBanner(state: ReturnType<typeof useConsole>["state"], l: Lead, live: boolean) {
  const x = investorFor(state, l);
  const may = !!x && (live || canReach(state, "inv") || isIR(state.ROLE));
  return { text: "Converted · " + (x?.code ? "investor " + x.code : "now an investor"), investorId: may ? x!.id : null };
}

export function ConvertedAlert({ l }: { l: Lead }) {
  const { state } = useConsole();
  const live = useApiMode() === "live";
  const open = useOpenInvestor();
  const b = convertedBanner(state, l, live);
  return (
    <div className="lp-alert" role="status" data-testid="lp-converted">
      <span><b>{b.text}</b> — the money is in, so this lead is read-only. Their journey continues on the investor record; the history here stays as it was.</span>
      {b.investorId ? <button type="button" className="act" onClick={() => open(b.investorId!)}>Open investor record ›</button> : null}
    </div>
  );
}

/** One round's standing on a converted lead: signed, or with Finance — never "your move". */
export const roundStanding = (r: RoundView): { t: string; cls: string } =>
  r.verified ? { t: "signed and verified", cls: "go" }
    : r.sent ? { t: "with Finance — out for signature", cls: "due" }
    : r.said ? { t: "with Finance — checking the signed copy", cls: "due" }
    : { t: "with Finance", cls: "" };

export function LpPaperDone({ l }: { l: Lead }) {
  const { state } = useConsole();
  const r = useApiRead(paperworkRow, state, l.id);
  if (r.state === "error") return r.err.status === 403 || r.err.status === 404 ? null
    : <div className="lp-stage d60d-paper"><span className="sm">Paperwork</span><p className="lp-err" role="alert" style={{ margin: 0 }}>{r.err.error}</p></div>;
  if (r.state !== "ok") return r.state === "loading" ? <div className="lp-stage d60d-paper"><span className="sm">Paperwork</span><span className="sm">Reading…</span></div> : null;
  return (
    <div className="lp-stage d60d-paper"><span className="sm">Paperwork</span>
      <div className="d60d-pbody">{r.data.rounds.map((x) => {
        const s = x.round === "supp" && r.data.suppUnread ? { t: "not readable for this seat", cls: "" } : roundStanding(x);
        return <span key={x.round} className="d60d-sub"><b>{lpPaperName(x.round)}</b> · <span className={`tag ${s.cls}`}>{s.t}</span></span>;
      })}</div></div>
  );
}
