/* sheetRows(ev) — the merged prototype's own row list (ir-merged.js, `function sheetRows`): the rows
   this sheet would actually put on the book, decided in one place so the split the card previews and
   the split the load writes cannot disagree. A row whose id or number is already on the book is
   refused before anybody is dealt anything. Pure: reads the sheet and the leads, writes nothing. */
import type { Lead, SheetRec } from "@/domain";
import { last10 } from "@/features/add/state";
import { csvRows } from "@/features/add/csv";
import type { SheetIntake } from "@/lib/data/endpoints/events";

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

/* LIVE ONLY, PROVISIONAL (M14-S03-NOTE-1): there is no sheet reader yet, so a live load takes the intake sheet pasted as the tablet
   exports it — a header row, then one row each: Name, Mobile, WhatsApp, Call (yes/no — what the intake form asked) and optionally Email,
   City, Units. The consent is the sheet's own column, never assumed; the loader re-checks every row and refuses one without both.
   Pure: reads the text, writes nothing. `skipped` counts rows with no name or mobile at all (blank cells). */
const KEY = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const YES = /^(y|yes|true|1|✓)$/i;
export type Pasted = { rows: SheetIntake[]; skipped: number; err: string | null };
export function parseIntake(text: string): Pasted {
  const lines = csvRows(text.replace(/\t/g, ","));
  if (!lines.length) return { rows: [], skipped: 0, err: null };
  const head = lines[0]!.map(KEY);
  const at = (...names: string[]) => head.findIndex(h => names.includes(h));
  const c = { name: at("name", "fullname"), mobile: at("mobile", "phone", "mobileno", "mobilenumber"), msg: at("whatsapp", "msg"), call: at("call", "callok"), email: at("email"), city: at("city"), units: at("units") };
  if (c.name < 0 || c.mobile < 0) return { rows: [], skipped: 0, err: "The first row must name the columns: at least Name and Mobile, then WhatsApp and Call." };
  const rows: SheetIntake[] = []; let skipped = 0;
  for (const r of lines.slice(1)) {
    const g = (i: number) => (i < 0 ? "" : String(r[i] ?? "").trim());
    if (!g(c.name) || !g(c.mobile)) { skipped++; continue; }
    const units = Number(g(c.units));
    rows.push({ name: g(c.name), mobile: g(c.mobile), ...(g(c.email) ? { email: g(c.email) } : {}), ...(g(c.city) ? { city: g(c.city) } : {}),
      ...(g(c.units) && Number.isFinite(units) ? { units } : {}), consent: { msg: YES.test(g(c.msg)), call: YES.test(g(c.call)), email: false } });
  }
  return { rows, skipped, err: null };
}
