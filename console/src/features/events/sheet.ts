/* sheetRows(ev) — the merged prototype's own row list (ir-merged.js, `function sheetRows`): the rows
   this sheet would actually put on the book, decided in one place so the split the card previews and
   the split the load writes cannot disagree. A row whose id or number is already on the book is
   refused before anybody is dealt anything. Pure: reads the sheet and the leads, writes nothing. */
import type { Lead, SheetRec } from "@/domain";
import { last10 } from "@/features/add/state";

export type SheetRow = { i: number; id: string; ph: string };

export function sheetRows(ev: string, sh: Pick<SheetRec, "ok"> | undefined, leads: readonly Pick<Lead, "id" | "ph">[]): SheetRow[] {
  if (!sh) return [];
  const out: SheetRow[] = [];
  for (let i = 0; i < sh.ok; i++) {
    const id = "S" + ev.replace("E-", "") + "-" + String(i + 1).padStart(2, "0");
    const ph = "+91 9" + String(400000000 + i * 7919).slice(0, 9);
    if (leads.some((l) => l.id === id) || leads.some((l) => last10(l.ph) === last10(ph))) continue;
    out.push({ i, id, ph });
  }
  return out;
}
