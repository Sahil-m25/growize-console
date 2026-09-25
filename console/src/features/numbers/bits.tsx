"use client";

/* ── the small pieces Numbers draws with ────────────────────────────────────────────────────
   `srcColor` (03-app.js:2755), `crStr` (5938), `brk` (4191), and the two row shapes the live tab
   repeats — `hrow` and `hd` (4591–4596). Nothing here is a new class: `.hrow`, `.bar`, `.prov`,
   `.tag`, `.sw` and `.leg` are all already in console.css.

   The redesign (`ir-console-redesigned.html`) adds a rate floor (`MINRATE`/`pctR`/`tooFew`/
   `rateOf`/`rateTx`, 03-app.js-equivalent ~9772–9779) and a single consistent "Focus"/"Compare"/
   "Category" select — `uxNumbersFocus`, redesigned line 9409 — that replaces the `secbar` chip row
   everywhere on this page. Both are scoped to Numbers only in the prototype (grepped: neither name
   appears outside the Numbers block), so both live here rather than in the shared selectors —
   `@/lib/format`'s `pct` is untouched because other pages still call it with no floor.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { CSSProperties, ReactNode } from "react";
import { SOURCES } from "@/domain";
import type { Break } from "@/lib/selectors";
import { CLEARED_LEAD_FILTERS, hasLeads, seesTeam } from "@/lib/selectors";
import { secOf, useConsole, type UiState } from "@/lib/store";
import type { Section } from "@/components/ui";
import { useGo } from "@/features/pay/common";

/* A rate is a claim about a population; under twenty in the denominator there is no population,
   only a handful — so below the floor no percentage is printed at all, only the count. Redesigned
   line ~9776. */
export const MINRATE = 20;
export const pctR = (a: number, b: number): number | null => (b >= MINRATE ? Math.round(a / b * 100) : null);
export const fmtP = (p: number | null | undefined): string => (p == null ? "—" : p + "%");
export const tooFew = (b: number): boolean => b > 0 && b < MINRATE;
/** the same rate, for a title attribute — plain text, never a node */
export const rateTx = (a: number, b: number): string => (tooFew(b) ? `${a} of ${b}` : fmtP(pctR(a, b)));
export function rateOf(a: number, b: number): ReactNode {
  return tooFew(b)
    ? <span title={`${a} of ${b} — a rate needs at least ${MINRATE} behind it`}>{a} of {b}</span>
    : fmtP(pctR(a, b));
}

/* the provenance marks a value carries on its own back, never on the tab that shows it —
   `demo_`/`live_`/`rec_`, redesigned line ~9596 */
export function Demo({ title }: { title?: string }) {
  return (
    <span className="prov demo"
      title={title ?? "Invented for the prototype — no record behind it. Do not report it."}>demo</span>
  );
}
export function Recorded() {
  return (
    <span className="prov"
      title="Recorded in this console by the seat that owns the figure — neither computed nor invented">
      recorded</span>
  );
}

/* the one selector every Numbers view now uses in place of a `secbar` chip row —
   `uxNumbersFocus`, redesigned line 9409. Kept local: grepping the redesigned prototype shows it
   used only on this page. */
export function NumbersFocus({ v, list, label }: { v: string; list: readonly Section[]; label: string }) {
  const { state, dispatch } = useConsole();
  const cur = secOf(state, v, list);
  return (
    <div className="ux-toolbar ux-numbers-toolbar rd-numbers-focus">
      <label><span>{label}</span>
        <select className="sel" aria-label={`${label} numbers`} value={cur}
          onChange={e => dispatch({ type: "setSec", view: v, k: e.target.value })}>
          {list.map(x => <option value={x.k} key={x.k}>{x.t}</option>)}
        </select>
      </label>
    </div>
  );
}

/* Change 6 — the one click-to-Leads mechanism every Numbers view shares (NumbersLive's tiles, the
   Plan-vs-actual funnel rows, a KPI's `jump`): clear every lead filter, apply the one the caller
   names, follow the same scope-to-team the tiles already did, and refuse quietly when `hasLeads`
   is false — the caller decides whether to render a control at all; this only decides where it
   goes when one is rendered. One copy, so nothing on this page can drift from another.

   The reset is `CLEARED_LEAD_FILTERS` (selectors/leads.ts), the same object the reducer's
   `clearLeadFilters`/`toLeads` spread. */
export function useJumpToLeads(): (patch: Partial<UiState>) => void {
  const { state, dispatch } = useConsole();
  const go = useGo();
  return (patch: Partial<UiState>) => {
    if (!hasLeads(state)) return;
    dispatch({ type: "setUi", patch: { ...CLEARED_LEAD_FILTERS, ...patch } });
    if (seesTeam(state)) dispatch({ type: "setScope", view: "leads", to: "team" });
    go("leads");
  };
}

/* srcColor(x) — 03-app.js:2755. One of the eight validated categorical slots, by position in the
   closed source list; anything off the list gets the neutral ink. */
export const srcColor = (x: string): string => {
  const i = (SOURCES as readonly string[]).indexOf(x);
  return i < 0 ? "var(--ink-3)" : `var(--c${i + 1})`;
};

/* crStr(n) — 03-app.js:5938 */
export const crStr = (n: number): string => "₹" + (n / 1e7).toFixed(2) + " Cr";

/* brk(b) — 03-app.js:4191. "Koramangala Club: 26 names, 9 qualified, nothing reserved — it breaks
   at reservation." */
export function Brk({ b }: { b: Break | null }) {
  if (!b) return <span className="sm">nothing to read yet</span>;
  if (b.ok) return <span className="tag go">holding at every step</span>;
  if (b.shared) return (
    <><span className="tag">in line with the rest</span>{" "}
      <span className="sm">weakest at {b.t} — {b.pc}%, same as everywhere</span></>
  );
  return (
    <><span className={`tag ${b.own >= 30 ? "late" : "due"}`}>breaks at {b.t}</span>{" "}
      <span className="sm">{b.have} of {b.of} · {b.pc}% against {b.want}%</span></>
  );
}

/* the badge that says a figure was counted rather than typed — 03-app.js:4590 */
export function Live() {
  return (
    <span className="prov live" title="Computed from the records the console holds — not typed">
      computed
    </span>
  );
}

/* hd(t, right) — 03-app.js:4591 */
export function Hd({ t, right }: { t: string; right?: ReactNode }) {
  return (
    <div className="ch"><h3>{t}</h3><Live /><div className="sp" />{right}</div>
  );
}

/* phd(t, mark, right) — redesigned ~9601. Like `Hd`, but the provenance mark is whichever one the
   card needs (demo, live or none), never fixed to "computed" — the plan tab mixes all three. */
export function Phd({ t, mark, right }: { t: string; mark?: ReactNode; right?: ReactNode }) {
  return (
    <div className="ch"><h3>{t}</h3>{mark}<div className="sp" />{right}</div>
  );
}

/* hrow(l, w, col, v, opts) — 03-app.js:4592. A label, a bar and a figure, on one grid. */
export function HRow({
  label, plain, w, col, v, title, click, style,
}: {
  label: ReactNode;
  /** the prototype's `String(l).replace(/<[^>]*>/g,"")` — the label with its tags stripped */
  plain: string;
  w: number;
  col: string;
  v: ReactNode;
  title?: string;
  click?: (() => void) | null;
  style?: CSSProperties;
}) {
  return (
    <div className={`hrow ${click ? "k" : ""}`} style={style}
      {...(click ? {
        role: "button", tabIndex: 0, onClick: click,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") click(); },
      } : {})}
      title={title ?? plain}>
      <span className="l">{label}</span>
      <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, w))}%`, background: col }} /></div>
      <span className="v">{v}</span>
    </div>
  );
}

/* the manual's bands, as a colour — 03-app.js:4597 */
export const bandC = (p: number): string =>
  p >= 100 ? "var(--go)" : p >= 90 ? "var(--due)" : "var(--late)";
