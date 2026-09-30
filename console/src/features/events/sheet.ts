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

/* The rows the card posts with "Load N leads" — the sheet as the page read it (PROVISIONAL, D85/jev 0.95: until a sheet
   reader exists the page posts the parsed intake rows, and the route re-checks every one). The demo book keeps the
   sheet as counts only, so its rows are dealt the way the reducer's own loadSheet deals them. */
export type IntakeRow = { name: string; mobile: string; city: string; units: number; consent: { msg: boolean; call: boolean; email: boolean } };
export function intakeRows(state: { SHEETNAMES: readonly string[] }, ev: string, sh: Pick<SheetRec, "ok"> | undefined, city: string): IntakeRow[] {
  if (!sh) return [];
  void ev;
  return Array.from({ length: sh.ok }, (_, i) => ({
    name: state.SHEETNAMES[i % state.SHEETNAMES.length] ?? "", mobile: "+91 9" + String(400000000 + i * 7919).slice(0, 9), city, units: 1,
    consent: { msg: true, call: true, email: false },
  }));
}
