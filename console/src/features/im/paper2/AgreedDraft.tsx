"use client";

/* M12-S12-NOTE-2 — Finance's Send on the allotment offers the supplementary draft the IR and the investor agreed
   (Lead.Supp_Agreed_Ref, read by GET /api/documents/sign/prefill as `agreedDraft`). It is the DEFAULT document of the send:
   with the investor picked and no template chosen yet, the Supplementary agreement is already the one on offer — unless
   that paper is already out or on file (then nothing is offered). One shared hook for the send drawer and the Send one panel. */

import type { Paper } from "@/server/documents/list";
import type { AgreedDraft } from "@/server/zoho-sign/send";
import { I, may, type ImState } from "@/lib/im";
import { useApiRead } from "@/lib/data/api";
import { allotmentOf, signPrefill } from "@/lib/data/endpoints/sign";

export const SUPP_TEMPLATE = "Supplementary agreement";

/** the agreed draft on offer for this investor's allotment, and whether the supplementary may still be sent */
export function useAgreedDraft(s: ImState, me: string, invId: string | null): { draft: AgreedDraft | null; offered: boolean } {
  const x = invId ? I(s, me, invId) : null;
  const rid = x && may(s, me, "doc") ? allotmentOf({ s, me }, x.id) : null;
  const r = useApiRead(signPrefill, { s, me }, { paper: "supplementary" as Paper, id: rid });
  const draft = r.state === "ok" ? r.data.agreedDraft : null;
  return { draft, offered: !!draft && r.state === "ok" && r.data.maySend };
}

/** the line that names the document the send will carry */
export function AgreedDraftOffer({ draft }: { draft: AgreedDraft }) {
  const link = /^https:/.test(draft.ref);
  return (
    <div className="note" data-agreed-draft style={{ marginBottom: 12 }}>
      <b>Agreed final draft{draft.version ? " (draft " + draft.version + ")" : ""}</b> is the document on offer.{" "}
      {link ? <a href={draft.ref} target="_blank" rel="noreferrer">Open it</a> : "It is on the lead as an attachment."}
      {draft.at ? <> <span className="mono">{draft.at}</span></> : null}
    </div>
  );
}
