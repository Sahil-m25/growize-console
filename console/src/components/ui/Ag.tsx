/* ONE GLYPH PER KIND OF ACTION — the prototype's actg() and actLegend(). 03-app.js 1140–1149.

   Colour is already spoken for twice over — whose it is, and whether the lead is in trouble — so
   the kind of action gets the channel that is left: a shape, and a border that says which of the
   four families it belongs to. */

import { ACTFAM, ACTG, KINDS, VERB } from "@/domain";

const FAM = ACTFAM as unknown as Record<string, string>;
const GLYPH = ACTG as unknown as Record<string, string>;
const KIND = KINDS as unknown as Record<string, string>;
const VERBT = VERB as unknown as Record<string, string>;

export function Ag({ k, t }: { k: string; t?: string }) {
  return (
    <span className={`ag f-${FAM[k] ?? "admin"}`} title={t ?? VERBT[k] ?? KIND[k] ?? k} aria-hidden="true">
      {GLYPH[k] ?? "•"}
    </span>
  );
}

/* actLegend() — every kind, once, under whatever is being read. 03-app.js:1148 */
export function ActLegend() {
  return (
    <div className="agl">
      {Object.keys(KIND).map((k) => (
        <span key={k}>
          <Ag k={k} />
          {KIND[k]}
        </span>
      ))}
    </div>
  );
}
