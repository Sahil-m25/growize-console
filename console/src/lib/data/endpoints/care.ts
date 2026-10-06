/* D132 — the Investors-side care writes that used to change only the browser's copy (client-only saves):
     careContact  POST /api/investors/[id]/contact   logContact   (a KAM's conversation → one Touch; Idempotency-Key per press)
     careDetails  PUT  /api/investors/[id]/details   saveDetails  (Mobile / Email / Mailing_City / nominee)
     careKyc      POST /api/investors/[id]/kyc       passKyc / failKyc (Contacts.KYC + KYC_Completed_On)
   Live: the route on the person's own token, guarded by the record's version (`expectedModifiedTime`, from
   GET /api/investors/[id]/record); a success re-reads every live read (api.ts bumpLive), so the record shows what Zoho holds.
   Fixture (FIXTURE_MODE=local): the reducer action the write replaces runs as before, and answers as the route would.
   A refusal lands in the page's own note (imLiveError) and is returned for the drawer's inline line. */

import type { ContactLogged, DetailsSaved, KycDecided } from "@/server/investors/care";
import type { ImChan, ImDrafts, ImMood } from "@/lib/im";
import type { WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

export type ContactArgs = { id: string; version: string | null; ch: string; mood: string; note: string; nextDays: string };
export const careContact: WriteEndpoint<ImBook, ContactArgs, ContactLogged, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${encodeURIComponent(a.id)}/contact`,
  /* live never sends nextDays: there is no next-contact field (D132); the drawer offers only "on the cadence" live */
  body: a => ({ expectedModifiedTime: a.version, channel: a.ch, mood: a.mood, ...(a.note.trim() ? { note: a.note.trim() } : {}) }),
  idempotent: true,
  pick: j => j as ContactLogged,
  fixture: (b, d, a) => imFixtureWrite(b, d, { type: "logContact", id: a.id, ch: a.ch as ImChan, mood: a.mood as ImMood, note: a.note, nextDays: a.nextDays },
    { contactId: a.id, touchId: "fixture", introduced: false, modifiedTime: null }),
  onLiveError: imLiveError,
};

/** The keys a live details save may send (DETF minus the name and the address: D132). */
export const LIVE_DETAIL_KEYS = ["ph", "em", "city", "nominee"] as const;
export type DetailsArgs = { id: string; version: string | null; changes: Partial<Record<(typeof LIVE_DETAIL_KEYS)[number], string>> };
export const careDetails: WriteEndpoint<ImBook, DetailsArgs, DetailsSaved, ImDispatch> = {
  method: "PUT",
  path: a => `/api/investors/${encodeURIComponent(a.id)}/details`,
  body: a => ({ expectedModifiedTime: a.version, changes: a.changes }),
  pick: j => j as DetailsSaved,
  fixture: (b, d, a) => imFixtureWrite(b, d, { type: "saveDetails", id: a.id }, { contactId: a.id, fields: [], modifiedTime: null }),
  onLiveError: imLiveError,
};

/** What the drawer's draft changed, for the keys a live save may send. */
export function liveDetailChanges(det: ImDrafts["DET"], x: Record<string, unknown>): DetailsArgs["changes"] {
  const out: DetailsArgs["changes"] = {};
  for (const k of LIVE_DETAIL_KEYS) {
    const v = (det as Record<string, unknown>)[k];
    if (v == null) continue;
    const t = String(v).trim();
    if (t === String(x[k] ?? "").trim() || (!t && k !== "nominee")) continue;
    out[k] = t;
  }
  return out;
}

export type KycArgs = { id: string; version: string | null; result: "passed" | "failed"; why?: string };
export const careKyc: WriteEndpoint<ImBook, KycArgs, KycDecided, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${encodeURIComponent(a.id)}/kyc`,
  body: a => ({ expectedModifiedTime: a.version, result: a.result, ...(a.result === "failed" ? { why: a.why || "Documents do not match" } : {}) }),
  pick: j => j as KycDecided,
  fixture: (b, d, a) => imFixtureWrite(b, d, a.result === "passed" ? { type: "passKyc", id: a.id } : { type: "failKyc", id: a.id, why: a.why || "Documents do not match" },
    { contactId: a.id, kyc: a.result, on: "", noteId: null, modifiedTime: null }),
  onLiveError: imLiveError,
};
