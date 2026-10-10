/**
 * D138 (owner ruling 10 Oct 2026, B-10) — THE RUPEES AN IR READS, AND ONLY THOSE ZOHO SHOWS THEM.
 *
 * IRs DO see rupee amounts: they chase the balance. Every rupee figure on the IR side comes from the allotment as Zoho returns
 * it on the IR's own token (rule 2, D53) — never from the prototype's unit price (plan.ts UNIT) and never recomputed:
 *   Unit_Price               the price per unit as recorded on the allotment
 *   Total_Amount_Receivable  what the allotment is to bring in
 *   Total_Amount_Received    what has come in
 * The sandbox made these three read-only for the IR and IR Manager profiles on 10 Oct (zoho/changes/2026-10-10-sandbox.md).
 * Hold_Extension_State / Hold_Extension_Days are read alongside so the balance clock (lib/money/balance-clock) can say which day
 * the 30 days count from.
 *
 * The read degrades PER FIELD (as app-activity does, W6-IRA-1): a column Zoho refuses (hidden by field-level security, or not in
 * the org) is dropped and the read repeats; a field that is dropped, or absent from the row, is null. If Zoho hides a field the
 * IR is shown nothing for it — never a guess. A failed read is null for everything: the chase list still lists the balance, with
 * no amount. No identity field is selected (checkProjection); nothing is cached (D45); nothing here is logged.
 */
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { checkProjection, MODULES } from "../data/projections";

const RECORD_ID = /^\d{15,22}$/;
const IN_CHUNK = 100;

/** The money and extension columns an IR may read on an allotment, where Zoho shows them. Identity-checked at load. */
export const IR_MONEY_FIELDS: readonly string[] = checkProjection(MODULES.allotments, [
  "id", "Unit_Price", "Total_Amount_Receivable", "Total_Amount_Received", "Hold_Extension_State", "Hold_Extension_Days",
]);
const OPTIONAL = IR_MONEY_FIELDS.filter((f) => f !== "id");

export interface IrAllotmentMoney {
  readonly unitPrice: number | null;
  readonly receivable: number | null;
  readonly received: number | null;
  /** receivable − received (never below 0), only when Zoho showed both; else null */
  readonly due: number | null;
  readonly extension: { readonly state: string | null; readonly days: number | null };
}

const num = (r: ZohoRecord, k: string, kept: readonly string[]): number | null => {
  if (!kept.includes(k)) return null;
  const v = r[k];
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) && x >= 0 ? x : null;
};
const txt = (r: ZohoRecord, k: string, kept: readonly string[]): string | null =>
  kept.includes(k) && typeof r[k] === "string" && r[k] !== "" ? (r[k] as string).slice(0, 20) : null;

/** Pure: one row as the IR may read it. */
export function irMoneyOf(r: ZohoRecord, kept: readonly string[]): IrAllotmentMoney {
  const receivable = num(r, "Total_Amount_Receivable", kept), received = num(r, "Total_Amount_Received", kept);
  return Object.freeze({
    unitPrice: num(r, "Unit_Price", kept), receivable, received,
    due: receivable !== null && received !== null ? Math.max(0, receivable - received) : null,
    extension: Object.freeze({ state: txt(r, "Hold_Extension_State", kept), days: num(r, "Hold_Extension_Days", kept) }),
  });
}

/**
 * The money columns of these allotments, on the IR's own token. A map allotment id → what Zoho showed; an allotment Zoho did not
 * return is absent. null when the read failed outright (the caller shows no amount).
 */
export async function readIrMoney(crm: Pick<ZohoClient, "coql">, cred: UserCredential, allotmentIds: readonly string[], signal?: AbortSignal)
  : Promise<ReadonlyMap<string, IrAllotmentMoney> | null> {
  const ids = [...new Set(allotmentIds.filter((x) => typeof x === "string" && RECORD_ID.test(x)))];
  const out = new Map<string, IrAllotmentMoney>();
  if (!ids.length) return out;
  let kept: string[] = [...OPTIONAL];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const list = ids.slice(i, i + IN_CHUNK).map((x) => `'${x}'`).join(", ");
    for (;;) {
      if (!kept.length) return out;   // Zoho shows this IR none of the columns: nothing to read, nothing to show
      let r: Awaited<ReturnType<typeof crm.coql>>;
      try { r = await crm.coql(cred, `select id, ${kept.join(", ")} from ${MODULES.allotments} where id in (${list}) limit 0, 200`, { signal }); }
      catch { return null; }
      if (!r.ok) {
        if (r.error.kind !== "invalid-data") return null;
        const named = (r.error as { field?: string | null }).field ?? null;
        if (named && kept.includes(named)) { kept = kept.filter((f) => f !== named); continue; }
        /* Zoho names no column: probe each alone and keep the ones this IR can read (rare path) */
        const readable: string[] = [];
        for (const f of kept) {
          let p: Awaited<ReturnType<typeof crm.coql>>;
          try { p = await crm.coql(cred, `select id, ${f} from ${MODULES.allotments} where id in (${list}) limit 0, 200`, { signal }); } catch { return null; }
          if (p.ok) readable.push(f);
          else if (p.error.kind !== "invalid-data") return null;
        }
        if (readable.length === kept.length) return null;   // every column alone reads: the refusal was not about a column
        kept = readable;
        continue;
      }
      if (r.value.invalidRecordIds) return null;
      for (const x of r.value.records) if (typeof x.id === "string" && RECORD_ID.test(x.id)) out.set(x.id, irMoneyOf(x, kept));
      break;
    }
  }
  return out;
}
