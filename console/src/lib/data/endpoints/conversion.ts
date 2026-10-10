/* GC-1527 / D137 — the lead becomes an investor only on Finance's confirmation of the 10%, and a Reserved allotment converts in
   full when the remainder is in (or by hand).
     GET  /api/leads/[id]/conversion?llp=&units=   the lead's money: receipts on the lead and, with a farm, the 10% trail
     POST /api/leads/[id]/conversion               { receipt?, terms? } record a receipt on the lead / confirm and create the investor
     POST /api/investors/[id]/full-paid            { allotmentId, reason, expectedModifiedTime? } mark fully paid by hand (Finance, DI)
     POST /api/investors/[id]/full-paid/request    { allotmentId, note } D138: a KAM asks Finance to confirm the full payment
   Live only: the demo book keeps no receipts on leads and no conversion stamps, so the fixture answers 503 "live-only" and the
   panels say so instead of inventing a figure. Types come from the server modules (type-only imports). */

import type { ConvertResult, ReceiptInput } from "@/server/investors/convert";
import type { ManualResult } from "@/server/investors/full-paid";
import type { RequestResult } from "@/server/investors/full-paid-request";
import { fail, type ReadEndpoint, type WriteEndpoint } from "../api";
import type { ImBook, ImDispatch } from "./im";

export type ConversionAnswer = Extract<ConvertResult, { ok: true }>["value"];
export type FullPaidAnswer = { stamped: Extract<ManualResult, { ok: true }>["value"] };
export type FullPaidAskAnswer = { requested: Extract<RequestResult, { ok: true }>["value"] };
export const LIVE_ONLY_TEXT = "Confirming the 10% runs on Zoho — the demo book has no receipts on leads.";
const liveOnly = () => fail(503, "live-only", LIVE_ONLY_TEXT);
const enc = encodeURIComponent;

export type ConversionArgs = { leadId: string; llpId?: string | null; units?: number | null } | null;
export const leadConversion: ReadEndpoint<ImBook, ConversionArgs, ConversionAnswer> = {
  path: a => (a ? `/api/leads/${enc(a.leadId)}/conversion${a.llpId ? `?llp=${enc(a.llpId)}${a.units ? `&units=${a.units}` : ""}` : ""}` : null),
  pick: j => j as ConversionAnswer,
  fixture: () => liveOnly(),
};

export type ConfirmArgs = { leadId: string; receipt?: ReceiptInput | null; terms?: { llpId: string; units?: number | null } | null };
export const leadConfirm: WriteEndpoint<ImBook, ConfirmArgs, ConversionAnswer, ImDispatch> = {
  method: "POST",
  path: a => `/api/leads/${enc(a.leadId)}/conversion`,
  body: a => ({ ...(a.receipt ? { receipt: a.receipt } : {}), ...(a.terms ? { terms: a.terms } : {}) }),
  pick: j => j as ConversionAnswer,
  fixture: () => liveOnly(),
};

export type FullPaidArgs = { contactId: string; allotmentId: string; reason: string; expectedModifiedTime?: string | null };
export const markFullPaid: WriteEndpoint<ImBook, FullPaidArgs, FullPaidAnswer, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${enc(a.contactId)}/full-paid`,
  body: a => ({ allotmentId: a.allotmentId, reason: a.reason, expectedModifiedTime: a.expectedModifiedTime ?? null }),
  pick: j => j as FullPaidAnswer,
  fixture: () => liveOnly(),
};

/* D138: a KAM can NOT mark an allotment fully paid — the KAM asks Finance to confirm it (a row on Finance's to-do). */
export type FullPaidAskArgs = { contactId: string; allotmentId: string; note: string };
export const askFullPaid: WriteEndpoint<ImBook, FullPaidAskArgs, FullPaidAskAnswer, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${enc(a.contactId)}/full-paid/request`,
  body: a => ({ allotmentId: a.allotmentId, note: a.note }),
  pick: j => j as FullPaidAskAnswer,
  fixture: () => liveOnly(),
};
