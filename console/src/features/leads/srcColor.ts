/* Colour follows the source, never its rank in this book — so the same source is the same colour on
   every screen and in both themes. The eight slots are the validated categorical ones.
   03-app.js:2749. */

import { SOURCES } from "@/domain";

export const srcColor = (x: string): string => {
  const i = (SOURCES as readonly string[]).indexOf(x);
  return i < 0 ? "var(--ink-3)" : `var(--c${i + 1})`;
};
