/* ── im/search.ts — investor search on the Investors page (M09-S07, D69) ────────────────────
   One box finds an investor by name, ARL ID, city, email, phone digits or farm. It filters the list
   the seat already reads (invRows applies it to Finance's book or to a KAM's own), so it can never
   reach beyond what that person may open. In phase 2 the same words go to the Contacts search with
   the person's own token; the matching rule stays this one.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import type { ImCtx, ImInvestor } from "./types";

/** the digits of a query, when it is a phone number being typed ("98450 33", "+91 97400") */
const phoneDigits = (q: string): string | null => {
  const t = q.replace(/[\s()+-]/g, "");
  return /^\d{4,}$/.test(t) ? t : null;
};
/** Does investor x match the search q? Empty q matches everyone. */
export function invMatch(s: ImCtx, x: ImInvestor, q: string): boolean {
  const t = (q || "").trim().toLowerCase();
  if (!t) return true;
  const farms = Object.keys(x.blocks).map(k => {
    const f = s.data.FARMS.find(y => y.k === k);
    return "block " + k.toLowerCase() + " " + (f ? f.n.toLowerCase() : "");
  }).join(" ");
  if ((x.n + " " + x.id + " " + x.city + " " + x.em).toLowerCase().includes(t)) return true;
  if (farms.includes(t)) return true;
  const ph = phoneDigits(t);
  return !!ph && x.ph.replace(/\D/g, "").includes(ph);
}
