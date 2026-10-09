"use client";

/* GC-1524 — the investor record's Journey tab, the record's main view (owner, 9 Oct: "the journey page is almost empty … the
   journey is actually a better choice with a button to the leads page if needed"). The whole story, extracted in place from
   the record route's `story` (server/investors/story — read on the viewer's own token, D53): the lead side from first touch
   to said yes, how often the lead was touched, then the investor side — reserved, fully paid, allocated, the app account,
   the account manager, onboarded. "Open lead ›" stays, as a secondary link. Nothing here is fetched another way. */

import type { ReactNode } from "react";
import type { NavKey } from "@/domain";
import type { ImInvestor } from "@/lib/im";
import { fmtAt } from "@/lib/im";
import { useApiRead } from "@/lib/data/api";
import { appCard } from "@/lib/data/endpoints/app";
import { useGoLead } from "@/features/leads/nav";
import type { InvestorRecord } from "@/server/investors/record";
import type { InvestorStory, StoryStep, StoryTouches } from "@/server/investors/story";
import { ImPname } from "../common";
import type { ImPageProps } from "../common";

const SRC: Record<string, string> = { lead: "from the lead", contact: "from the investor record", allotment: "from the allotment", receipt: "from the receipts" };

/** The record's sections, Journey first: the tab the record opens on (secOf picks the first). */
export const journeyFirst = <K extends string>(sections: readonly K[]): K[] =>
  sections.includes("jrn" as K) ? ["jrn" as K, ...sections.filter((k) => k !== "jrn")] : [...sections];

/** "WhatsApp 3 · Call 2 · 2 replies · first 12 Aug 10:05 · last 30 Sep 16:40" — or the honest "none recorded". */
export function touchLine(t: StoryTouches): string {
  if (!t.total && !t.replies) return "No touches recorded on the lead.";
  const ch = Object.entries(t.byChannel).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + " " + n);
  return [t.total + " touch" + (t.total === 1 ? "" : "es"), ...ch, ...(t.replies ? [t.replies + " repl" + (t.replies === 1 ? "y" : "ies")] : []),
    ...(t.first ? ["first " + fmtAt(t.first)] : []), ...(t.last && t.last !== t.first ? ["last " + fmtAt(t.last)] : [])].join(" · ");
}

function Step({ e, extra }: { e: StoryStep; extra?: ReactNode }) {
  return (
    <div className={`jev ${e.side === "lead" ? "ir" : ""} ${e.done ? "" : "q"}`} data-step={e.k}>
      <b>{e.done ? "✓ " : ""}{e.t}</b>
      <div className="m">{e.done
        ? <>{e.at ? <span className="mono">{fmtAt(e.at)}</span> : <span className="sm">done — not dated for your seat</span>}
          {e.src ? <span className="sm">{" · " + SRC[e.src]}</span> : null}{extra}</>
        : <span className="sm">not yet</span>}</div>
    </div>
  );
}

/** The app account, from the App account card the seat already reads (GET /api/investors/[id]/unlock); an IR reads none. */
function AppStep({ s, me, id, on }: { s: ImPageProps["s"]; me: string; id: string; on: boolean }) {
  const r = useApiRead(appCard, { s, me }, on ? id : null);
  if (!on || r.state !== "ok") return null;
  const c = r.data.card;
  const opened = !!(c.openedAt || c.access || c.mark);
  return <Step e={{ k: "app", t: "App account", side: "investor", done: opened, at: c.openedAt, src: null }}
    extra={opened ? <span className="sm">{" · " + c.text}</span> : null} />;
}

function OpenLead({ id, name }: { id: string; name: string }) {
  const goLead = useGoLead("inv" as NavKey);
  return <button type="button" className="chip" aria-label={"Open lead for " + name} onClick={() => goLead(id)}>Open lead ›</button>;
}

export function StoryJourney({ s, me, x, rec, irSeat }: { s: ImPageProps["s"]; me: string; x: ImInvestor; rec: InvestorRecord & { story: InvestorStory }; irSeat: boolean }) {
  const st = rec.story;
  const lead = st.steps.filter((e) => e.side === "lead"), inv = st.steps.filter((e) => e.side === "investor");
  const kam = inv.find((e) => e.k === "KAM_Since");
  /* W6-KAM-1: the link is offered only when this seat read the lead (leadSide "lead"); otherwise it landed on /today unexplained */
  const leadId = rec.origin.leadId ?? x.lead ?? null;
  return (
    <div className="card fill" data-testid="inv-story"><div className="ch"><h3>The journey</h3><div className="sp" />
      <span className="tag ir">Lead side</span><span className="tag br">Investors side</span>
      {leadId && st.leadSide === "lead" ? <OpenLead id={leadId} name={x.n} /> : null}</div>
      <div className="cb">
        <div className="jrn">{lead.map((e) => <Step key={e.k} e={e} />)}</div>
        {st.leadSide === "contact" ? <p className="sm" style={{ margin: "6px 0 0" }}>The lead itself is not readable for your seat, so the lead side shows what the investor record holds.</p> : null}
        <p className="sm" style={{ margin: "10px 0" }}><b>Touches:</b> {st.touches ? touchLine(st.touches) : "the lead's touches are not readable for your seat."}</p>
        <div className="jrn">{inv.filter((e) => e.k !== "KAM_Since" && e.k !== "Onboarded_At").map((e) => <Step key={e.k} e={e} />)}
          <AppStep s={s} me={me} id={x.id} on={!irSeat} />
          {kam ? <Step e={kam} extra={kam.done && kam.who ? <>{" · "}<ImPname s={s} k={kam.who} /></> : null} /> : null}
          {inv.filter((e) => e.k === "Onboarded_At").map((e) => <Step key={e.k} e={e} />)}</div>
      </div></div>
  );
}
