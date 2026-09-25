"use client";

/* ── the three read-only surfaces' shared pieces ────────────────────────────────────────────
   Ports `ref/03-app.js` 1702 (`provL`) and 3740–3751 (`imBanner`), plus the one-line `go()` every
   row on Payments, Documents and Transfers uses.

   Finance does not have a login on this console. Harsha is a NAME — on every receipt and every
   signature — and never a seat (`PEOPLE.harsha.ext`). Finance works in the Investor Management
   portal, and what they do arrives here over the link. So for almost every viewer these three
   screens are a READ of facts written elsewhere, and the provenance treatment says so rather than
   offering a second place to type the same fact.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { IMP } from "@/domain";
import { pathOf, type View } from "@/components/shell/routes";
import { refOf, refShown, scopedFinanceReader, seeMoney } from "@/lib/selectors";
import { useConsole } from "@/lib/store";

/* provL(t) — 03-app.js:1702 */
export function ProvL({ t }: { t?: string }) {
  return (
    <span
      className="prov link"
      title={`Finance's source is the ${IMP}; this local demo displays mirror facts`}
    >
      {t || "Finance source · demo"}
    </span>
  );
}

/* imBanner() — redesigned prototype line 8837. One unconditional banner: Finance's history is a
   read-only mirror for every reader, IR and Finance's own reflection alike — there is no branch
   left to take, because there is no console session on the other side of it. */
export function ImBanner() {
  return (
    <div className="note">
      <b>Finance history · read only.</b> Payments and documents are maintained in the {IMP} and
      mirrored here for eligible investors. <span className="sm">Local demo records; live portal
      sync is not connected.</span>
    </div>
  );
}

/* go(v, id) — 03-app.js:7113. The URL is the router; VIEW is mirrored from it by the shell, so a
   screen only has to say where it is going. */
export function useGo(): (v: View, id?: string) => void {
  const router = useRouter();
  return (v, id) => router.push(pathOf(v, id));
}

/* refBtn(k,id,where,st) — redesigned prototype line 11475-11487. ONE CONTROL PER REFERENCE: the
   label, the gate and the warning are written once here so Payments, the claim block and (once
   built) the transfers register cannot disagree about what "show" and "hide" mean. Reveal/cover
   dispatch the store's showRef/hideRef, which is what actually produces the "Revealed a bank
   reference" log line and survives navigation — see selectors/finance.ts's refOf/refShown/refAllowed. */
export function RefButton({ k, id, where, style }: { k: string; id?: string; where?: string; style?: CSSProperties }) {
  const { state, dispatch } = useConsole();
  const v = refOf(state, k);
  if (!v || v === "—" || scopedFinanceReader(state) || !seeMoney(state)) return null;
  const shown = refShown(state, k);
  return (
    <button type="button" className="chip" style={{ marginLeft: 8, fontFamily: "var(--sans)", ...style }}
      title={shown ? "Cover it again" : "Shows the whole reference and writes your name and the minute into the log"}
      onClick={e => { e.stopPropagation(); dispatch(shown ? { type: "hideRef", k } : { type: "showRef", k, id, where }); }}
    >{shown ? "Hide the reference" : "Show the reference"}</button>
  );
}
