"use client";

import { useEffect } from "react";

/* W6-A11Y-4 (WCAG 2.4.2) — a page that is a record names itself. The layout's static title is the console's; while an
   investor record was open the document title came back empty, so the page sets its own and says it again after every
   render (an effect with no dependency list), so a head refresh that blanks it is put right on the next paint. It
   hands the title it found back when the record closes. */
/** the console's own title (app/layout.tsx metadata): what a closed record goes back to when no better one was seen */
export const CONSOLE_TITLE = "Growize IR Console — Investor workspace";
/* W6-KAM-2: remember the title that was NOT ours (the first one seen before any record set its own). `before` captured per
   mount could be blank or a previous record's name, so a close restored nothing and the name outlived the record. */
let base = "";
const ours = new Set<string>();
/* W6-KAM-2 (the "Open lead" path): the page a record's title was claimed on. A view change that leaves the record's hook
   mounted (or unmounts it after the next page has drawn) must not keep the record's name: off that page the title is put back. */
let claimedPath: string | null = null;
const here = (): string | null => (typeof location === "undefined" ? null : location.pathname);
const restore = () => { document.title = base || CONSOLE_TITLE; };

export function useDocTitle(title: string | null): void {
  const on = title !== null;
  useEffect(() => {
    if (!on) return;
    if (document.title && !ours.has(document.title)) base = document.title;
    claimedPath = here();
    return () => { claimedPath = null; restore(); };
  }, [on]);
  useEffect(() => {
    if (!title) return;
    ours.add(title);
    const at = here();
    if (claimedPath !== null && at !== null && at !== claimedPath) { if (ours.has(document.title)) restore(); return; }
    if (document.title !== title) document.title = title;
  });
}

/** W6-KAM-2: called by the shell on every path change — a record's title left behind on another page is put back. */
export function releaseStaleDocTitle(pathname: string | null): void {
  if (typeof document === "undefined" || !ours.has(document.title)) return;
  if (claimedPath === null || (pathname !== null && pathname !== claimedPath)) restore();
}
