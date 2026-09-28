"use client";

import { usePathname } from "next/navigation";

/* lpHere(id) — ir-merged.js 5229: this lead's own page is the one on screen, so a drawer's
   "Open lead" would only loop back to it */
export function useLpHere(id: string | null | undefined): boolean {
  const path = usePathname() || "";
  return !!id && path === "/leads/" + encodeURIComponent(id);
}
