/* W4-E-1 — Documents names an investor and an allotment by what people quote (the ARL ID, "Block B"), never by a Zoho record id.
   A bare run of 10+ digits is a Zoho id and is never words (same rule as selectors.leadWords). */
const ZOHO_ID = /^\d{10,}$/;

/** The investor's ARL ID for a row: the book's code when it holds the investor, else the id only if it is not a Zoho id. */
export const investorCode = (x: { code?: string | null; id: string } | null | undefined, fallback?: string | null): string =>
  x?.code || (x && !ZOHO_ID.test(x.id) ? x.id : "") || (fallback && !ZOHO_ID.test(fallback) ? fallback : "");

/** The row's first sub-line: what kind of record the paper hangs on - "Personal · ARL-INV-0208" or "Allotment · Block B". */
export function docRecordWords(d: { module: string; recordId: string; party: string | null }, code: string): string {
  if (d.module === "Contacts") { const t = ZOHO_ID.test(d.recordId) ? code : d.recordId; return t ? "Personal · " + t : "Personal"; }
  const block = /\s\/\s*([^/]+)$/.exec(d.party ?? "")?.[1]?.trim();
  const tail = block ? "Block " + block : ZOHO_ID.test(d.recordId) ? "" : d.recordId;
  return "Allotment" + (tail ? " · " + tail : "");
}
