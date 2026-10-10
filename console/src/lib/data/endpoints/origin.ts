/* The lead an investor came from (server/investors/origin):
     GET  /api/investors/[id]/origin   W6-KAM-1: the origin lead, read-only, for a seat without the Leads page
     POST /api/investors/[id]/origin   W7-FIN-2: Digital Infrastructure sets Originating_IR from the lead owner
   Live only: the demo book has no Zoho leads behind its investors, so the fixture answers 503 "live-only". Types are type-only
   imports from the server module. */

import type { FixResult, OriginLeadView } from "@/server/investors/origin";
import { fail, type ReadEndpoint, type WriteEndpoint } from "../api";
import type { ImBook, ImDispatch } from "./im";

export type OriginLeadAnswer = { lead: OriginLeadView };
export type OriginFixAnswer = { set: Extract<FixResult, { ok: true }>["value"] };
/** W7-FIN-2 — said on Finance's "Investor created" result and on the record while Contacts.Originating_IR is empty. */
export const ORIGINATING_IR_MISSING_TEXT = "The IR won't see this investor until Digital Infrastructure sets Originating IR.";
export const ORIGIN_LIVE_ONLY_TEXT = "The origin lead is read from Zoho — the demo book has none.";
const liveOnly = () => fail(503, "live-only", ORIGIN_LIVE_ONLY_TEXT);

export const originLead: ReadEndpoint<ImBook, string | null, OriginLeadAnswer> = {
  path: id => (id ? `/api/investors/${encodeURIComponent(id)}/origin` : null),
  pick: j => j as OriginLeadAnswer,
  fixture: () => liveOnly(),
};

export const fixOriginatingIr: WriteEndpoint<ImBook, { contactId: string }, OriginFixAnswer, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${encodeURIComponent(a.contactId)}/origin`,
  pick: j => j as OriginFixAnswer,
  fixture: () => liveOnly(),
};
