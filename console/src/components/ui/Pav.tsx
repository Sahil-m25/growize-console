"use client";

/* ONE BADGE, EVERYWHERE A PERSON APPEARS — the prototype's pav(). 03-app.js 29–31.
   The initials are the identifier; the colour and the shape are what make a column of them
   scannable without reading a word. Eight validated categorical slots and two shapes, so sixteen
   people are told apart without spending a status colour on any of them. */

import type { ReactNode } from "react";
import type { PersonKey } from "@/domain";
import { P } from "@/lib/selectors";
import { useConsole } from "@/lib/store";

export type PavSize = "xs" | "lg";

export function Pav({
  k,
  cls,
  size,
  off,
  children,
}: {
  k: PersonKey;
  /** extra class from the call site, exactly as pav()'s second argument */
  cls?: string;
  size?: PavSize;
  off?: boolean;
  /** pav()'s `inner` — a highlighted set of initials, when Leads is searching */
  children?: ReactNode;
}) {
  const { state } = useConsole();
  const p = P(state.PEOPLE, k);
  /* pcol() — 03-app.js:29 */
  const pc = p && p.c ? `var(--c${p.c})` : "var(--ink-3)";
  const cn = ["pav", p && p.sq ? "sq" : "", size ?? "", off ? "off" : "", cls ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cn} style={{ ["--pc" as string]: pc }} title={p.n}>
      {children != null ? children : p.i}
    </span>
  );
}
