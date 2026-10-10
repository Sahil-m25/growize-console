"use client";

/* GC-1524 — the investor record's Journey tab, the record's main view (owner, 9 Oct: "the journey page is almost empty … the
   journey is actually a better choice with a button to the leads page if needed"). The whole story, extracted in place from
   the record route's `story` (server/investors/story — read on the viewer's own token, D53): the lead side from first touch
   to said yes, how often the lead was touched, then the investor side — reserved, fully paid, allocated, the app account,
   the account manager, onboarded. "Open lead ›" stays, as a secondary link. Nothing here is fetched another way. */

import { useState, type ReactNode } from "react";
import type { NavKey } from "@/domain";
import type { ImInvestor } from "@/lib/im";
import { fmtAt, who } from "@/lib/im";
import { useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { appCard } from "@/lib/data/endpoints/app";
import { fixOriginatingIr, originLead, ORIGINATING_IR_MISSING_TEXT } from "@/lib/data/endpoints/origin";
import { canReach } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
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

/** W6-KAM-1: the origin lead, read-only, for a seat that may read it but holds no Leads page (GET /api/investors/[id]/origin). */
export function OriginLeadCard({ s, me, id }: { s: ImPageProps["s"]; me: string; id: string }) {
  const r = useApiRead(originLead, { s, me }, id);
  if (r.state === "idle" || r.state === "loading") return <p className="sm" style={{ margin: "8px 0 0" }}>Reading the lead…</p>;
  if (r.state === "error") return <p className="sm" role="status" style={{ margin: "8px 0 0" }}>The lead could not be read: {r.err.error}</p>;
  const l = r.data.lead;
  if (!l.readable) return <p className="sm" role="status" style={{ margin: "8px 0 0" }}>{l.reason === "no-origin" ? "This investor has no origin lead." : "Zoho does not share this lead with your seat."}</p>;
  const hidden = (f: string) => l.hiddenFields.includes(f);
  const row = (k: string, f: string, v: ReactNode) => <tr key={k}><th scope="row" className="sm" style={{ textAlign: "left", paddingRight: 12 }}>{k}</th><td>{hidden(f) ? <span className="sm">not shown for your seat</span> : v ?? "—"}</td></tr>;
  return (
    <div className="card" data-testid="origin-lead" style={{ marginTop: 8 }}><div className="ch"><h3>The lead — read only</h3></div>
      <div className="cb"><table className="sm"><tbody>
        {row("Status", "Lead_Status", l.lostAt ? <>{l.status ?? "Lost"} · lost {fmtAt(l.lostAt)}</> : l.status)}
        {row("Source", "Lead_Source", l.source)}
        {row("Owner (IR)", "Owner", l.owner ? (l.owner.name ?? <ImPname s={s} k={l.owner.id} />) : null)}
        {row("Units interested", "Units_Interested", l.unitsInterested)}
        {row("Created", "Created_Time", l.createdAt ? fmtAt(l.createdAt) : null)}
        {row("Said yes", "Said_Yes_At", l.saidYesAt ? fmtAt(l.saidYesAt) : null)}
      </tbody></table>
      <p className="sm" style={{ margin: "6px 0 0" }}>Your seat reads this lead in Zoho but does not work leads, so it opens here rather than on the Leads page.</p></div></div>
  );
}

/** W7-FIN-2: an investor whose Originating_IR is empty is invisible to the IR who brought them in. Digital Infrastructure (who may
 *  write the field, D122) copies it from the origin lead's owner in one press; the Zoho workflow gz_set_originating_ir is the fix. */
function OriginatingIrFix({ s, me, id, di }: { s: ImPageProps["s"]; me: string; id: string; di: boolean }) {
  const { dispatch } = useConsole();
  const write = useApiWrite(fixOriginatingIr, { s, me }, dispatch as never);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  if (msg?.ok) return <p className="sm" role="status" data-testid="origin-ir-set" style={{ margin: "6px 0 0" }}>{msg.t}</p>;
  return (
    <div className="note" role="status" data-testid="origin-ir-missing" style={{ margin: "8px 0 0" }}>{ORIGINATING_IR_MISSING_TEXT}
      {di ? <>{" "}<button type="button" className="act" onClick={() => void write({ contactId: id }).then((r) => setMsg(r.ok
        ? { ok: true, t: r.data.set.already ? "Originating IR was already set." : "Originating IR set from the lead owner — the IR now sees this investor." }
        : { ok: false, t: r.error }))}>Set originating IR from the lead owner</button></> : null}
      {msg && !msg.ok ? <div className="sm" role="alert">{msg.t}</div> : null}</div>
  );
}

export function StoryJourney({ s, me, x, rec, irSeat }: { s: ImPageProps["s"]; me: string; x: ImInvestor; rec: InvestorRecord & { story: InvestorStory }; irSeat: boolean }) {
  const st = rec.story;
  const lead = st.steps.filter((e) => e.side === "lead"), inv = st.steps.filter((e) => e.side === "investor");
  const kam = inv.find((e) => e.k === "KAM_Since");
  /* W6-KAM-1: the link is offered only when this seat read the lead (leadSide "lead"). A seat that holds the Leads page opens it;
     one that does not (KAM, Finance) gets the lead read-only in place — never a silent bounce to /today. */
  const leadId = rec.origin.leadId ?? x.lead ?? null;
  const { state } = useConsole();
  const leadsPage = canReach(state, "leads");
  const [showLead, setShowLead] = useState(false);
  /* W7-FIN-2: Originating_IR empty (irVia is "contact" only when the Contact carries it) — said on the Investors side; DI may fix it */
  const role = s.data.P[me] ? who(s, me).r : null;
  const live = useApiMode() === "live";
  const irMissing = live && !irSeat && !!leadId && rec.origin.irVia !== "contact" && !!role && ["di", "ops", "head", "amlead"].includes(role);
  return (
    <div className="card fill" data-testid="inv-story"><div className="ch"><h3>The journey</h3><div className="sp" />
      <span className="tag ir">Lead side</span><span className="tag br">Investors side</span>
      {leadId && st.leadSide === "lead" ? (leadsPage ? <OpenLead id={leadId} name={x.n} />
        : <button type="button" className="chip" aria-expanded={showLead} aria-label={"Open lead for " + x.n} onClick={() => setShowLead((v) => !v)}>{showLead ? "Close lead" : "Open lead ›"}</button>) : null}</div>
      <div className="cb">
        {showLead && leadId && !leadsPage ? <OriginLeadCard s={s} me={me} id={x.id} /> : null}
        {irMissing ? <OriginatingIrFix s={s} me={me} id={x.id} di={role === "di"} /> : null}
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
