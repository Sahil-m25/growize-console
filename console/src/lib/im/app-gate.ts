/* G2 / GC-1526 (D136) and D137 ruling 2 — the app account's 10% gate and the override, in words both sides share.
   The server (server/investors/unlock) decides; the card (features/im/money/record) and the demo fixture only say it.
   Values only — no Zoho, no server import — so a client component may import this file. */

import { COUNTING_KINDS } from "../money/ten-percent";

/** D137 ruling 2(a): the receipt kinds whose matched SUM carries the 10% — an advance, a part payment, a balance or the whole. */
export const TEN_PERCENT_KINDS: ReadonlySet<string> = COUNTING_KINDS;
/** GC-1526: the override's typed reason, at least this many characters (trimmed). */
export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 500;

export const TEN_PERCENT_TEXT = "Not unlocked — the 10% is not verified yet: Finance-matched receipts (advance and part payments together) do not reach 10% of the committed amount. Finance matches them on Payments first.";
export const TEN_PERCENT_UNKNOWN_TEXT = "Not unlocked — the investor's receipts could not be read, so the 10% advance cannot be confirmed. Try again.";
/** D137 ruling 2(b): Digital Infrastructure holds the override too. */
export const NOT_OVERRIDE_TEXT = "Only Finance Operations, the Head of Finance or Digital Infrastructure can unlock without the 10%.";
/** The disabled button's reason on the card. */
export const TEN_PERCENT_HINT = "Waits for the 10% — the matched receipts do not reach 10% of the committed amount yet.";
export const TEN_PERCENT_UNKNOWN_HINT = "The receipts could not be read, so the 10% advance cannot be confirmed. Reload to try again.";
export const overrideReasonShort = (): string =>
  `Say why the app is being unlocked without the 10% — at least ${OVERRIDE_REASON_MIN} characters. It goes on the record with your name.`;
