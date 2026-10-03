"use client";

/* M12-S04-W2 — the Zoho Sign template picker for a send (the send drawer and the Send one panel).
   Live: Finance's templates from GET /api/documents/sign/templates; one must be picked, and Send sends its id (the route
   answers "the send is incomplete" without one). Demo: the list is empty, no picker is drawn and nothing is required. The pick
   is kept in the drafts as "<paper>:<templateId>", so it never rides onto another paper; one template alone is picked for you. */

import type { Paper } from "@/server/documents/list";
import { may, type ImState } from "@/lib/im";
import { useApiMode, useApiRead, type Read } from "@/lib/data/api";
import { signTemplates, type SignTemplateView } from "@/lib/data/endpoints/sign";

export type TemplatePicked = { list: Read<readonly SignTemplateView[]>; templates: readonly SignTemplateView[]; tid: string; needs: boolean; ready: boolean };

/** the templates on offer for this paper, the one in effect, and whether Send may go (a template is picked, or none is needed) */
export function useTemplatePick(s: ImState, me: string, paper: Paper | null, DTID: string): TemplatePicked {
  const live = useApiMode() === "live";
  const list = useApiRead(signTemplates, { s, me }, !!paper && may(s, me, "doc"));
  const templates = list.state === "ok" ? list.data : [];
  const mine = paper && DTID.startsWith(paper + ":") ? DTID.slice(paper.length + 1) : "";
  const tid = templates.some(t => t.templateId === mine) ? mine : templates.length === 1 ? templates[0]!.templateId : "";
  const needs = !!paper && live;
  return { list, templates, tid, needs, ready: !needs || !!tid };
}

export function TemplatePick({ paper, pick, DTID, onPick }: { paper: Paper | null; pick: TemplatePicked; DTID: string; onPick: (v: string) => void }) {
  if (!paper) return null;
  if (pick.list.state === "error") return <div className="note bad" role="alert" style={{ marginBottom: 12 }}>{pick.list.err.error}</div>;
  if (pick.list.state === "loading") return <p className="sm" style={{ margin: "0 0 12px" }}>Reading the Zoho Sign templates…</p>;
  if (!pick.templates.length) return pick.needs
    ? <div className="note bad" role="alert" style={{ marginBottom: 12 }}>There are no Zoho Sign templates to send from. Finance adds one in Zoho Sign.</div> : null;
  return (
    <label className="fi" style={{ marginBottom: 14 }}><span>Zoho Sign template</span>
      <select className="selw" id="dtid" value={pick.tid} onChange={e => onPick(e.target.value ? paper + ":" + e.target.value : "")}>
        <option value="">Pick a template…</option>
        {pick.templates.map(t => <option key={t.templateId} value={t.templateId}>{t.name}</option>)}
      </select></label>
  );
}
