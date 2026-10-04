/* M10-S05-W1 — the weekly bank statement on Payments (D21, D22, D113: the statement confirms receipts from the source).
     GET  /api/statements   → { latest: StatementSummary | null, configured? }   "last reconciled"
     POST /api/statements   multipart field "file" (the net-banking CSV, ≤ 2 MB) → { statement: UploadView }
                            the matched lines (a pending inbound receipt the line agrees with is matched automatically,
                            D113 — `autoMatched`; a refund waits for its second hand) and the lines that "need an owner"
   Live: the routes ("pay" seats only; a KAM or a viewer is refused 403 before anything is read).
   Fixture: the demo book keeps no statements — the read answers "none yet" for a seat that uploads, and the upload
   answers that it needs the live console (no reducer action stands in for parsing a bank file). */

import type { StatementSummary, UploadView } from "@/server/money/statements";
import { may } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import type { ImBook, ImDispatch } from "./im";

export type LatestStatement = { latest: StatementSummary | null; configured?: boolean };

const FINANCE_ONLY = () => fail(403, "not-finance", "The bank statement is Finance's.");

export const statementLatest: ReadEndpoint<ImBook, void, LatestStatement> = {
  path: () => "/api/statements",
  pick: j => j as LatestStatement,
  fixture({ s, me }) {
    if (!may(s, me, "pay")) return FINANCE_ONLY();
    return ok({ latest: null, configured: false });
  },
};

export type UploadArgs = { form: FormData };
export const statementUpload: WriteEndpoint<ImBook, UploadArgs, UploadView, ImDispatch> = {
  method: "POST",
  path: () => "/api/statements",
  body: a => a.form,
  pick: j => (j as { statement: UploadView }).statement,
  fixture({ s, me }): ReturnType<WriteEndpoint<ImBook, UploadArgs, UploadView, ImDispatch>["fixture"]> {
    if (!may(s, me, "pay")) return FINANCE_ONLY();
    return fail(503, "not-configured", "Not uploaded — the demo book keeps no bank statements. Upload works against the live console.");
  },
};
