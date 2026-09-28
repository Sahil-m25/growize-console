"use client";

/* A <details class="ux-disclosure"> that remembers whether it was open, per signed-in person and per
   data-ux-key — the prototype's UXDETAILS (ir-merged.js:4127-4130): every draw records each keyed
   disclosure's state and puts it back after the redraw, so a disclosure the person opened stays open
   when the drawer it sits in is drawn again (the grant drawer → back to the member). `force` opens it
   regardless, the way `data-ux-force` / an `open` attribute written by the body does. */

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useConsole } from "@/lib/store";

const UXDETAILS = new Map<string, boolean>();

export function UxDetails({ k, force, children }: { k: string; force?: boolean; children: ReactNode }) {
  const { state } = useConsole();
  const ref = useRef<HTMLDetailsElement>(null);
  const id = state.WHO + "|" + k;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = UXDETAILS.get(id);
    el.open = force ? true : was ?? false;
  }, [id, force]);
  return (
    <details
      className="ux-disclosure"
      data-ux-key={k}
      ref={ref}
      onToggle={(e) => UXDETAILS.set(id, (e.currentTarget as HTMLDetailsElement).open)}
    >
      {children}
    </details>
  );
}
