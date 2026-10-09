/* G2 / GC-1526 (D136 proposed) — the app account's 10% gate and Finance's override, in words both sides share.
   The server (server/investors/unlock) decides; the card (features/im/money/record) and the demo fixture only say it.
   Values only — no Zoho, no server import — so a client component may import this file. */

/** The receipt kinds that carry the 10%: an advance, or the whole amount at once. */
export const TEN_PERCENT_KINDS: ReadonlySet<string> = new Set(["Advance", "Full"]);
/** GC-1526: the override's typed reason, at least this many characters (trimmed). */
export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 500;

export const TEN_PERCENT_TEXT = "Not unlocked — the 10% advance is not verified yet: this investor has no matched Advance or Full receipt. Finance matches it on Payments first.";
export const TEN_PERCENT_UNKNOWN_TEXT = "Not unlocked — the investor's receipts could not be read, so the 10% advance cannot be confirmed. Try again.";
export const NOT_OVERRIDE_TEXT = "Only Finance Operations or the Head of Finance can unlock without the 10%.";
/** The disabled button's reason on the card. */
export const TEN_PERCENT_HINT = "Waits for the 10% advance — no matched Advance or Full receipt yet.";
export const TEN_PERCENT_UNKNOWN_HINT = "The receipts could not be read, so the 10% advance cannot be confirmed. Reload to try again.";
export const overrideReasonShort = (): string =>
  `Say why the app is being unlocked without the 10% — at least ${OVERRIDE_REASON_MIN} characters. It goes on the record with your name.`;
