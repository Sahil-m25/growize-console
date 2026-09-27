/**
 * What was said, what was sent, and how the last call went.
 * Ports `ref/03-app.js` lines 739-753, 768-774, 787-789 and 1447.
 */

import type { CallOutcome, Objection, Sendable } from "./types";


/** What an IR may record: sent or not, and when. No sending, no contents. */
export const SENDABLE = ["Pitch deck","Farm profile","Yield note","Webinar invite"] as const satisfies readonly Sendable[];


/**
 * How the last call went. Recorded by hand, like every touch: an outcome and the objections heard,
 * so "why we lose" is built from records rather than remembered at the review.
 */
export const CALLOUT = ["Interested","Not now","Not interested","No answer","Wrong number","Call back"] as const satisfies readonly CallOutcome[];

export const OBJS = ["Price","Lock-in","Yield","Site visit first","Timing","Spouse decides"] as const satisfies readonly Objection[];

