"use client";

import { useEffect } from "react";

/* W6-A11Y-4 (WCAG 2.4.2) — a page that is a record names itself. The layout's static title is the console's; while an
   investor record was open the document title came back empty, so the page sets its own and says it again after every
   render (an effect with no dependency list), so a head refresh that blanks it is put right on the next paint. It
   hands the title it found back when the record closes. */
export function useDocTitle(title: string | null): void {
  const on = title !== null;
  useEffect(() => {
    if (!on) return;
    const before = document.title;
    return () => { if (before) document.title = before; };
  }, [on]);
  useEffect(() => {
    if (title && document.title !== title) document.title = title;
  });
}
