/* Finance's queue order — the pure half of server/leads/hints.ts (M12-S11-T03), here so the screen's fixture and the
   route rank with ONE function (a client file may not value-import @/server). Types only come from the server file. */
import type { DocPaper, Hint, HintsResult } from "../../server/leads/hints";

/**
 * The hint for ONE document, or null. `leadId` is the lead the document belongs to: the NDA row's own record, or
 * for an allotment paper the lead its Contact came from (`leadsForContacts`). A hint about another paper — or about
 * the same paper on another lead — never shows.
 */
export function hintForDocument(doc: { readonly paper: DocPaper; readonly leadId: string | null }, hints: ReadonlyMap<string, readonly Hint[]> | readonly Hint[]): Hint | null {
  if (!doc || !doc.leadId) return null;
  const list = Array.isArray(hints) ? (hints as readonly Hint[]) : ((hints as ReadonlyMap<string, readonly Hint[]>).get(doc.leadId) ?? []);
  return list.find((h) => h.leadId === doc.leadId && h.paper === doc.paper) ?? null;
}

/**
 * Finance's verify queue: papers the IR says are back first (newest word first), then everything by age (oldest
 * sent first). With no hints (the read failed) it is age order, and `irSideRead: false` says so.
 */
export function rankForFinance<T extends { readonly paper: DocPaper; readonly leadId: string | null; readonly sentAt: string | null }>(
  items: readonly T[], hints: HintsResult,
): { readonly items: readonly (T & { readonly hint: Hint | null })[]; readonly irSideRead: boolean; readonly note: string | null } {
  const map = hints.ok ? hints.hints : new Map<string, readonly Hint[]>();
  const age = (x: T) => (x.sentAt && !Number.isNaN(Date.parse(x.sentAt)) ? Date.parse(x.sentAt) : Number.MAX_SAFE_INTEGER);
  const rows = items.map((x, i) => ({ x: { ...x, hint: hintForDocument(x, map) }, i }));
  rows.sort((a, b) => {
    const ha = a.x.hint ? 0 : 1, hb = b.x.hint ? 0 : 1;
    if (ha !== hb) return ha - hb;
    if (a.x.hint && b.x.hint) return Date.parse(b.x.hint.at) - Date.parse(a.x.hint.at) || a.i - b.i;
    return age(a.x) - age(b.x) || a.i - b.i;
  });
  return { items: rows.map((r) => r.x), irSideRead: hints.ok, note: hints.ok ? null : "The IR's side could not be read; this is in age order." };
}
