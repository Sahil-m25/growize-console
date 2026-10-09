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

export function useDocTitle(title: string | null): void {
  const on = title !== null;
  useEffect(() => {
    if (!on) return;
    if (document.title && !ours.has(document.title)) base = document.title;
    return () => { document.title = base || CONSOLE_TITLE; };
  }, [on]);
  useEffect(() => {
    if (!title) return;
    ours.add(title);
    if (document.title !== title) document.title = title;
  });
}
