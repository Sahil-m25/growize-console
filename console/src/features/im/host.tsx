"use client";

/* =================================================================================================
   THE INVESTORS SIDE, AS PART OF THE ONE CONSOLE — merge-glue.js.

   The console is the base; the Investors module's screens are drawn into its pane and its drawer.
   `useIm()` hands an Investors page its state, the signed-in person and a dispatch that runs the
   write through the store as that person (IMHOOK.go becomes a route change). `Sided` is merge-glue's
   V[k] wrapper for a rail entry that exists on both sides; `ImOnly` draws an Investors-only entry.
   ============================================================================================== */

import { useCallback, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { NavKey } from "@/domain";
import { MERGE, IM2M } from "@/domain/signin";
import { MBOTH, MT, sidesOf } from "@/lib/selectors/access";
import { useConsole, type ConsoleState } from "@/lib/store";
import { may, pageReadable, type ImAction, type ImState } from "@/lib/im";
import { pathOf, type View } from "@/components/shell/routes";
import type { ImPageProps } from "./common";
import { ImDash } from "./dash";
import { ImInv } from "./inv";
import { ImFarms } from "./farms";
import { ImTxn } from "./txn";
import { ImDocs } from "./docs";
import { ImTkt } from "./tkt";
import { ImUpd } from "./upd";
import { ImIns } from "./ins";
import { ImSys } from "./sys";
import { ImAct } from "./act";
import { ImTeam, ImTeamBody } from "./team";

export function useIm(): ImPageProps {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const s: ImState = useMemo(() => ({ data: state.IM, ui: state.IMUI }), [state.IM, state.IMUI]);
  const d = useCallback((a: ImAction) => {
    dispatch({ type: "im", a });
    if (a.type === "go") {
      const k = IM2M[a.v];
      if (k) router.push(pathOf(k as View));
    }
  }, [dispatch, router]);
  return { s, me: state.WHO, dispatch: d };
}

/* IMX.page(v, me) — the Investors view by its own key */
const PAGES: Record<string, (p: ImPageProps) => ReactNode> = {
  dash: ImDash, inv: ImInv, farms: ImFarms, txn: ImTxn, docs: ImDocs, tkt: ImTkt, upd: ImUpd,
  ins: ImIns, sys: ImSys, act: ImAct, team: ImTeam,
};
export function ImPage({ v }: { v: string }) {
  const p = useIm();
  const Page = PAGES[v];
  return Page ? <Page {...p} /> : null;
}

/* CURSIDE — which half the pane is drawing: "im" for an Investors page, "mix" for Teams with the
   Investors seats section, "ir" otherwise. The shell reads it for the pane's classes. */
export function curSide(state: ConsoleState, k: string): "ir" | "im" | "mix" {
  if (!MERGE[k]) return "ir";
  const s = sidesOf(state, k);
  if (!s.ir && !s.im) return "ir";
  if (s.ir && s.im && MBOTH[k] === "fuller") return "im";
  if (s.ir && s.im && MBOTH[k] === "section") return "mix";
  const side = s.ir && s.im ? (state.MSIDE[k] || "ir") : s.ir ? "ir" : "im";
  return side;
}

/* sideBar(k, side) — merge-glue.js:104 */
function SideBar({ k, side }: { k: string; side: "ir" | "im" }) {
  const { dispatch } = useConsole();
  return (
    <div className="secbar mside" role="tablist" aria-label={`${MT[k]} — which side`}>
      {([["ir", "Lead side"], ["im", "Investors side"]] as const).map(([sd, t]) => (
        <button key={sd} className={`sc ${side === sd ? "on" : ""}`} role="tab" id={`side-${k}-${sd}`}
          aria-selected={side === sd} onClick={() => dispatch({ type: "setSide", k, s: sd })}>{t}</button>
      ))}
    </div>
  );
}

/* V[k] for a two-sided rail entry — merge-glue.js:112-126 */
export function Sided({ k, lead }: { k: NavKey; lead: ReactNode }) {
  const { state } = useConsole();
  const im = useIm();
  const s = sidesOf(state, k);
  const v = MERGE[k]!;
  if (!s.ir && !s.im) return null;
  if (s.ir && s.im && MBOTH[k] === "fuller") return <ImPage v={v} />;
  if (s.ir && s.im && MBOTH[k] === "section") return (
    <>
      {lead}
      <section className="imsec" aria-labelledby={`imsec-${k}`}>
        <h2 className="imsech" id={`imsec-${k}`}>Investors side seats</h2>
        <p className="sm imsecs">Who holds which seat on the Investors pages. Lead-side access is set above.</p>
        {/* merge-glue's strip regex stops at the .ph block's first </div> (the .sp spacer), so the
            seat tag survives at the top of the section */}
        {v === "team" && pageReadable(im.s, im.me, "team")
          ? <><span className={`tag ${may(im.s, im.me, "team") ? "br" : ""}`}>{may(im.s, im.me, "team") ? "you can change seats" : "read only"}</span><ImTeamBody {...im} /></>
          : v === "team" ? null : <ImPage v={v} />}
      </section>
    </>
  );
  const side = s.ir && s.im ? (state.MSIDE[k] || "ir") : s.ir ? "ir" : "im";
  return (
    <>
      {s.ir && s.im ? <SideBar k={k} side={side} /> : null}
      {side === "ir" ? lead : <ImPage v={v} />}
    </>
  );
}

/* the Investors-only band: Investors, Farms, Tickets, Investor updates */
export function ImOnly({ k }: { k: NavKey }) {
  const { state } = useConsole();
  if (!sidesOf(state, k).im) return null;
  return <ImPage v={MERGE[k]!} />;
}

/* mNoteHTML() — merge-glue.js:57. One in-page refusal or question at a time, at the top of the pane. */
export function MNote() {
  const { s, dispatch } = useIm();
  const n = s.ui.NOTE;
  if (!n) return null;
  const lines = n.msg.split("\n\n");
  const body = lines.map((p, i) => (
    <span key={i}>{i ? <><br /><br /></> : null}{p.split("\n").map((l, j) => <span key={j}>{j ? <br /> : null}{l}</span>)}</span>
  ));
  return (
    <div className={`note mnote ${n.kind}`} role={n.kind === "ask" ? "alertdialog" : "alert"} aria-live="assertive">
      <div className="mnt">{n.kind === "ask" ? <><b>Check before you go on.</b><br /></> : /^Recorded\./.test(n.msg) ? null : <><b>Not done.</b> </>}{body}</div>
      <div className="mna">
        {n.kind === "ask" ? (
          <>
            <button className="act" id="mnote-yes" autoFocus onClick={() => dispatch({ type: "confirmYes" })}>Yes, do it</button>
            <button className="btn" onClick={() => dispatch({ type: "noteClose" })}>No, leave it</button>
          </>
        ) : (
          <button className="btn" id="mnote-ok" autoFocus onClick={() => dispatch({ type: "noteClose" })}>OK</button>
        )}
      </div>
    </div>
  );
}
