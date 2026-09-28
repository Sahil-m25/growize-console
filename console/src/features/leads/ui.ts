/* ── the page-local form state the prototype kept as module globals ─────────────────────────
   `TCHAN`, `HORIZON`, `CALDAY`, `LSORT`, `NXD`, `TD`, `NXASK`, `LOSTW`, `LOSTN`, `NDRAFT`,
   `ASTO`, `MVOPEN`, `MVTO`, `ASKW`, `ASKD`, `FROM` — 03-app.js 1319–1343, 2160–2205, 528, 780.

   They live in the store's `ui` bag, which carries an index signature (`[k: string]: unknown`) so a
   feature slice can add its own keys without editing `src/lib/store.tsx`. These are the readers:
   each one narrows the `unknown` and answers the prototype's own initial value when the key has not
   been written yet, which is exactly what a module-level `let` did on the first paint.

   No `declare module` augmentation here on purpose: four page agents share one `UiState`, and two
   augmentations naming the same key are a compile error rather than a merge.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { Channel, Horizon, NavKey, SortKey } from "@/domain";
import type { UiState } from "@/lib/store";

/* NXD — the next-step draft, 03-app.js:2160. `ch` — the next step's own channel, 6375/6379 — is
   set directly by the drawer or derived from `t` by `channelForAction` (store.tsx's `setNXD`
   handles the derivation on a `k:"t"` write). */
export type NextDraft = { t: string; d: string; tm: string; ch: string };
/* TD — the touch draft. `k` is a Channel or "reply", which is not a channel. 03-app.js:2205 */
export type TouchDraft = { k: string; d: string; tm: string };

const s = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
const sn = (v: unknown): string | null => (typeof v === "string" ? v : null);

/* My day: today, this week, this month — 03-app.js:1341 */
export const uiHorizon = (ui: UiState): Horizon =>
  ui.HORIZON === "week" || ui.HORIZON === "month" ? ui.HORIZON : "today";
/* the day picked out of the month grid — 03-app.js:1342 */
export const uiCalday = (ui: UiState): string | null => sn(ui.CALDAY);
/* My day: which channel the queue is cut to — 03-app.js:2245. The redesign's channel filter also
   offers "Visit" (`TOUCHCHANNELS` includes it, `CHAN` lists it) — ir-console-redesigned.html's own
   `TCHAN` reads it back the same as any other channel; this reader only recognised msg/email/call/
   other, so picking Visit silently read back as "no filter" instead of narrowing the list. */
export const uiTchan = (ui: UiState): Channel | "other" | null =>
  ui.TCHAN === "msg" || ui.TCHAN === "email" || ui.TCHAN === "call" || ui.TCHAN === "visit" || ui.TCHAN === "other"
    ? ui.TCHAN
    : null;

/* Leads: the sort. The merged prototype opens on "name" (ir-merged.js:2757); setSort() falls back to "urgent" */
export const uiSort = (ui: UiState): SortKey => (sn(ui.LSORT) || "name") as SortKey;

/* Leads: "somebody asked for the lost ones back" — the redesigned prototype's own switch on top of
   the default hide, ir-console-redesigned.html:7362 (`let LLOST = false`). `LeadFilters` (in
   `@/lib/selectors`) does not carry this field yet — see this feature's cross-owner note — so the
   page composes it locally against the same `EXC`/`matches` the selector uses. */
export const uiLlost = (ui: UiState): boolean => ui.LLOST === true;

export const uiNXD = (ui: UiState): NextDraft => {
  const v = ui.NXD as Partial<NextDraft> | undefined;
  return { t: s(v?.t, ""), d: s(v?.d, ""), tm: s(v?.tm, ""), ch: s(v?.ch, "") };
};
export const uiTD = (ui: UiState): TouchDraft => {
  const v = ui.TD as Partial<TouchDraft> | undefined;
  return { k: s(v?.k, "msg"), d: s(v?.d, ""), tm: s(v?.tm, "") };
};

/* the lead whose dated next step may now be stale — 03-app.js:580 */
export const uiNxask = (ui: UiState): string | null => sn(ui.NXASK);
/* the draft reason and note, while the close-as-lost drawer is open — 03-app.js:528 */
export const uiLostw = (ui: UiState): string | null => sn(ui.LOSTW);
export const uiLostn = (ui: UiState): string => s(ui.LOSTN, "");
/* the note being typed — 03-app.js:775 */
export const uiNdraft = (ui: UiState): string => s(ui.NDRAFT, "");
/* the person picked in the "change the owner" drawer — 03-app.js:1415 */
export const uiAsto = (ui: UiState): string | null => sn(ui.ASTO);
/* the lead being asked about, and who it is being asked for — 03-app.js:1279 */
export const uiMvto = (ui: UiState): string | null => sn(ui.MVTO);
/* where the lead page was opened from, so Back goes there — 03-app.js:1318 */
export const uiFrom = (ui: UiState): NavKey | "event" =>
  (sn(ui.FROM) || "leads") as NavKey | "event";
