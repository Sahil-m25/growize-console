/* M18-S09-NOTE-9 — an event sheet that loads across several requests answers `continuing` with the counts so far.
   While it does, the card says "Loading — n of m rows so far" with those running counts, and says "loaded" only when finished. */
export type Running = { done: number; total: number; loaded: number; duplicates: number; refused: number };
type Answer = { loaded: number; duplicates: number; refused: number; continuing: { done: number; total: number } | null };

/** The running state from one answer: non-null only while the load is still continuing. */
export const runningOf = (a: Answer): Running | null =>
  a.continuing ? { done: a.continuing.done, total: a.continuing.total, loaded: a.loaded, duplicates: a.duplicates, refused: a.refused } : null;

export const loadingLine = (r: Running): string => `Loading — ${r.done} of ${r.total} rows so far`;
export const runningCounts = (r: Running): string =>
  `${r.loaded} loaded so far, ${r.duplicates} skipped as duplicates${r.refused ? `, ${r.refused} left on the sheet` : ""}`;

/** The card's tag: never "loaded" while a load is continuing. */
export const sheetTag = (ready: boolean, r: Running | null): { text: string; cls: "due" | "go" } =>
  r ? { text: "loading", cls: "due" } : ready ? { text: "ready to load", cls: "due" } : { text: "loaded", cls: "go" };
