"use client";
/* A `details.ux-disclosure[data-ux-key]` whose open state survives a redraw, per person — the
   prototype's UXDETAILS (ir-merged.js: `UXDETAILS[me()+"|"+key]`), kept in the ui bag so the page
   drawn ahead of its route and the page the route draws open the same way. */
import type { ReactNode } from "react";
import { useConsole } from "@/lib/store";

export function UxDetails({ k, className, summary, children }: { k: string; className?: string; summary: ReactNode; children: ReactNode }) {
  const { state, dispatch } = useConsole();
  const map = (state.ui.UXDETAILS ?? {}) as Record<string, boolean>;
  const key = state.WHO + "|" + k;
  return (
    <details className={className ? `ux-disclosure ${className}` : "ux-disclosure"} data-ux-key={k} open={!!map[key]}
      onToggle={(e) => {
        const open = e.currentTarget.open;
        if (!!map[key] !== open) dispatch({ type: "setUi", patch: { UXDETAILS: { ...map, [key]: open } } });
      }}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
