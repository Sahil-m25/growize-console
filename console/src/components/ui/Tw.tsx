import type { CSSProperties, ReactNode } from "react";

/* W6-A11Y-1 — the one scroll wrapper for a table. `.tw` scrolls sideways on a phone (table min-width 540px), and a
   scrollable region the keyboard cannot reach hides its right-hand columns from anyone without a pointer (axe
   scrollable-region-focusable, WCAG 2.1.1). So it takes focus (tabIndex 0) and is named (role=region + aria-label);
   console.css gives it a visible ring. Use it instead of a bare `<div className="tw">`. */
export function Tw({ label = "Table, scrolls sideways", className, style, children }: {
  label?: string; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  return (
    <div className={className ? `tw ${className}` : "tw"} style={style} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
