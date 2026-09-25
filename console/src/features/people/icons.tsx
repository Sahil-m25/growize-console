"use client";

/* A stand-in for `ic("lock")` (ir-console-redesigned.html ~2440, ICONS/ic()) until `@/components/ui`
   Icon.tsx carries a "lock" key — see crossOwnerRequests. Drawn the same way every other icon in
   that set is: one outline <path>, 24x24, currentColor stroke. Only the "Outside/Above your own
   access" tag markers use this; the drawer's inline capability-toggle glyph is the prototype's own
   literal "🔒" character (ir-console-redesigned.html:12672) and stays as-is. */
export function LockIcon() {
  return (
    <svg
      className="i"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
