/* ── the two glyphs this feature needs that `@/components/ui`'s shared `Icon` (shell-owned,
   src/components/ui/Icon.tsx) doesn't carry: "leads" (the empty-book state, ic("leads"),
   ir-console-redesigned.html:7424) and "numbers" (the "Other ways to cut the book" door,
   ir-console-redesigned.html:2452, 7519). That file's own header says a page agent wanting more
   of the prototype's set adds its own keys the same way rather than reaching into it — this is
   that, scoped to this directory. Same markup as `Icon` so `.i`/`.dt`/`.rd-empty-icon` styling
   applies identically. */
"use client";

const PATHS = {
  leads: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  numbers: "M3 3v18h18M18 17V9M13 17V5M8 17v-3",
} as const;

export function LeadsIcon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      className={`i${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
