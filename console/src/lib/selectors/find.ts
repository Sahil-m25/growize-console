/* ===== D60 b · FIND INVESTOR — one box, the whole of what you may open =====================
   growize-console-merged, ir-merged.js 10898–10997. The top-bar box lists the matches under it
   (name, the last four of the phone, stage, owner) and Enter opens one. SCOPE is one question with
   one answer, orgSearchScope(): an IR searches their own book; the IR Manager and Digital
   Infrastructure — and anybody granted every lead — search the whole organisation, and every row
   names its owner and team. Pure reads; the box itself is the shell's (TopBar.tsx).
   ========================================================================================== */
import type { Lead, PersonKey } from "@/domain";
import { norm } from "@/lib/format";
import type { Ctx } from "./ctx";
import { me } from "./ctx";
import { capsFor, hasCap, mgrOf, roleOf } from "./access";
import { canSee, digits, lost, numeric, openable } from "./leads";

export const FQMAX = 8;

/* the ONE scope rule — the same capability check the access model uses */
export function orgSearchScope(ctx: Ctx, k?: PersonKey | null): boolean {
  k = k || me(ctx);
  if (!k || !hasCap(ctx, k, "leads", "view")) return false;
  const r = roleOf(ctx.PEOPLE, k) as string;
  if (["conv", "ops"].includes(r)) return true;
  /* D60: anyone above the IR team whom Digital Infrastructure has granted Leads searches the whole organisation */
  if (["exec", "bu", "corp"].includes(r)) return true;
  /* an explicit "all leads" grant on the Leads page, however the grid carries it */
  const g = ((ctx.CAPS || {})[k] || {}) as Record<string, string[] | undefined>;
  return (g.leads || []).includes("all") || (capsFor(ctx, k, "leads") as string[]).includes("all");
}

export const fqPool = (ctx: Ctx): Lead[] => (orgSearchScope(ctx) ? ctx.LEADS : openable(ctx));

/* a phone may be searched and its last four shown where the viewer may read it — their own book,
   or the organisation when they hold org-wide search */
export const fqPhoneOK = (ctx: Ctx, l: Lead): boolean => orgSearchScope(ctx) || canSee(ctx, l);

export function fqMatch(ctx: Ctx, l: Lead, q: string): boolean {
  const ok = fqPhoneOK(ctx, l);
  const d = ok ? digits(l.ph) : "";
  const h = [l.n, ok && l.em, l.city].filter(Boolean).map(norm).join(" · ");
  const phoneHit = (t: string) => {
    const qd = digits(t);
    if (qd.length < 3 || !d) return false;
    return [qd, qd.replace(/^0+/, ""), qd.length > 10 ? qd.slice(-10) : ""].filter((x) => x.length >= 3).some((x) => d.includes(x));
  };
  if (numeric(q)) return phoneHit(q); /* "+91 98860 30012" is one number, not three words */
  return q.split(/\s+/).filter(Boolean).every((t) => h.includes(t) || (numeric(t) && phoneHit(t)));
}

export type FqHit = { l: Lead; r: number; mine: boolean };

export function fqFind(ctx: Ctx, q0: string): FqHit[] {
  const q = norm(q0).trim();
  if (!q) return [];
  const book = new Set(openable(ctx).map((l) => l.id));
  const rank = (l: Lead) => {
    const n = norm(l.n);
    return n.startsWith(q) ? 0 : n.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2;
  };
  return fqPool(ctx)
    .filter((l) => fqMatch(ctx, l, q))
    .map((l) => ({ l, r: rank(l), mine: book.has(l.id) }))
    .sort((a, b) => a.r - b.r || +b.mine - +a.mine || +lost(a.l) - +lost(b.l) || a.l.n.localeCompare(b.l.n));
}

/* the owner's team, for the org-wide row */
export const fqTeamOf = (ctx: Ctx, own: PersonKey): PersonKey | null => mgrOf(ctx.PEOPLE, own);
